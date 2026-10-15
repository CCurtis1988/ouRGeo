"""Quiescent retention maintenance for a dedicated Hindsight PostgreSQL store.

This is an operator-side deployment primitive, never an assistant/admin RPC.
Stop the API and workers first. A deployment using replicas, WAL archiving or
independent backups needs its own retention plan and cannot use this profile.
No user rows are deleted here: VACUUM FULL rewrites live rows into new relations,
and PostgreSQL removes obsolete WAL itself with recycling disabled. This does
not promise physical erasure from storage devices or independent backups.
"""
import re
import asyncio


async def compact_hindsight_store(db):
    async with asyncio.timeout(45):
        return await _compact_hindsight_store(db)


async def _compact_hindsight_store(db):
    if not await db.fetchval('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'):
        raise RuntimeError('Retention maintenance requires the dedicated deployment operator.')
    if await db.fetchval('SELECT pg_is_in_recovery()'):
        raise RuntimeError('Retention maintenance requires the dedicated primary.')
    settings = dict(await db.fetch('SELECT name,setting FROM pg_settings WHERE name=ANY($1::text[])', [
        'archive_mode', 'wal_recycle', 'wal_init_zero', 'log_statement',
        'log_min_duration_statement', 'log_min_duration_sample', 'log_min_error_statement', 'log_parameter_max_length_on_error',
    ]))
    if (settings.get('archive_mode') != 'off' or settings.get('wal_recycle') != 'off'
            or settings.get('wal_init_zero') != 'on' or settings.get('log_statement') != 'none'
            or settings.get('log_min_duration_statement') != '-1'
            or settings.get('log_min_duration_sample') != '-1'
            or settings.get('log_min_error_statement') != 'panic'
            or settings.get('log_parameter_max_length_on_error') != '0'):
        raise RuntimeError('Use the reviewed no-archive, no-recycling, no-query-log retention configuration.')
    if await db.fetchval('SELECT count(*) FROM pg_replication_slots') or await db.fetchval('SELECT count(*) FROM pg_stat_replication'):
        raise RuntimeError('Replication retention needs a separately reviewed cleanup profile.')
    if await db.fetchval("SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend'"):
        raise RuntimeError('Stop the dedicated API, workers and other database clients before maintenance.')
    if not await db.fetchval('SELECT pg_try_advisory_lock(6841950231047263)'):
        raise RuntimeError('Another retention maintenance operation is active.')
    try:
        # Quiescence is enforced by the deployment owner stopping its clients;
        # an advisory lock cannot prevent arbitrary upstream writers reconnecting.
        tables = await db.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        if not {'documents', 'memory_units', 'chunks', 'async_operations', 'banks'}.issubset({row['tablename'] for row in tables}) or len(tables) > 128 or any(not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', row['tablename']) for row in tables):
            raise RuntimeError('Review the bounded pinned Hindsight schema before maintenance.')
        for row in tables:
            await db.execute('VACUUM (FULL, ANALYZE) public."' + row['tablename'] + '"')
        # ANALYZE copies common column values into pg_statistic. Repeated
        # online deletions otherwise leave earlier text in dead catalogue
        # tuples even after every user relation has been rewritten.
        for catalogue in ('pg_statistic', 'pg_statistic_ext_data'):
            await db.execute('VACUUM (FULL) pg_catalog.' + catalogue)
        # No manual unlinking of pg_wal: the database owns crash recovery. The
        # second switch/checkpoint advances past the first checkpoint record.
        for _ in range(2):
            await db.execute('CHECKPOINT')
            await db.fetchval('SELECT pg_switch_wal()')
        await db.execute('CHECKPOINT')
        return {'tablesRewritten': len(tables), 'walSwitches': 2, 'configuration': settings,
                'boundary': 'Quiescent dedicated PostgreSQL only; live rows preserved; no device/independent-backup erasure claim'}
    finally:
        await db.fetchval('SELECT pg_advisory_unlock(6841950231047263)')
