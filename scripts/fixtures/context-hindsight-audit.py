"""Audit only the synthetic fixture's owned banks and PostgreSQL directory."""
import argparse
import asyncio
import json
import pathlib
import importlib.util
import os
import sys
import re
import asyncpg

sys.dont_write_bytecode = True

parser = argparse.ArgumentParser()
parser.add_argument('--state', required=True)
parser.add_argument('--records', required=True)
parser.add_argument('--maintain', action='store_true')
parser.add_argument('--check-guards', action='store_true')
args = parser.parse_args()
root = pathlib.Path(args.state).resolve()
dedicated = (root/'server.json').exists()
processing = json.loads((root/('server.json' if dedicated else 'fixture-processing.json')).read_text())
username = 'ourgeo' if dedicated else 'fixture'
password = 'dedicated-socket-only' if dedicated else 'synthetic-local-only'
records = json.loads(pathlib.Path(args.records).read_text())
assert records['namespaces'] and all(name.startswith('ourgeo_fixture_') or re.fullmatch(r'[a-f0-9-]{36}', name) for name in records['namespaces'])
assert records['ids'] and all(len(item) == 36 for item in records['ids'])
pg = None
if args.maintain:
    assert processing['llm'] == 'none' and processing['paidProcessing'] is False
    try:
        os.kill(processing['pid'], 0)
    except ProcessLookupError:
        pass
    else:
        raise RuntimeError('Stop the owned synthetic API before retention maintenance.')
    from pg0 import Pg0
    pg = Pg0(name='ourgeo-'+root.name, data_dir=str(root/'postgres-data'), username='fixture', password='synthetic-local-only', database='fixture', config={'listen_addresses': '127.0.0.1', 'unix_socket_directories': '', 'wal_recycle': 'off', 'wal_init_zero': 'on', 'archive_mode': 'off', 'log_min_error_statement': 'panic', 'log_parameter_max_length_on_error': '0'})
    processing['postgresPort'] = pg.start().port

async def main():
    db = await asyncpg.connect(host=processing['databaseSocket'] if dedicated else '127.0.0.1', port=processing['postgresPort'], user=username, password=None if dedicated else password, database='postgres' if dedicated else username)
    try:
        maintenance = None
        guards_checked = False
        if args.maintain or args.check_guards:
            file = pathlib.Path(__file__).resolve().parents[2]/'electron/main/context/hindsight-retention.py'
            spec = importlib.util.spec_from_file_location('hindsight_retention', file)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            if args.check_guards:
                try:
                    await module.compact_hindsight_store(db)
                except RuntimeError as error:
                    assert 'Stop the dedicated API' in str(error)
                    guards_checked = True
                else:
                    raise RuntimeError('Active-client maintenance guard failed.')
            else:
                maintenance = await module.compact_hindsight_store(db)
        tables = await db.fetch("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='bank_id' ORDER BY table_name")
        remaining = {}
        operations = []
        for row in await db.fetch('SELECT operation_type,status,task_payload::text,result_metadata::text FROM async_operations WHERE bank_id=ANY($1::text[])', records['namespaces']):
            payload = row['task_payload'] or ''
            metadata = row['result_metadata'] or ''
            operations.append({'type': row['operation_type'], 'status': row['status'], 'payloadCharacters': len(payload), 'forgottenCanonicalIdInPayload': any(item in payload for item in records['ids']), 'forgottenCanonicalIdInMetadata': any(item in metadata for item in records['ids'])})
        for row in tables:
            table = row['table_name']
            assert table.replace('_', '').isalnum()
            # Banks are retained as empty namespace descriptors; all other
            # memory and derivative rows must be absent after document deletion.
            if table != 'banks':
                remaining[table] = await db.fetchval(f'SELECT count(*) FROM "{table}" WHERE bank_id=ANY($1::text[])', records['namespaces'])
        await db.execute('CHECKPOINT')
    finally:
        await db.close()
    encoded = [item.encode() for item in records['ids']]
    statements = [item.encode() for item in records['statements']]
    residual = []
    plaintext = []
    scanned_bytes = 0
    scanned_files = 0
    overlap = max(len(item) for item in encoded + statements) - 1
    for path in (root/'postgres-data').rglob('*'):
        if path.is_symlink():
            raise RuntimeError('Unexpected linked PostgreSQL audit file.')
        if not path.is_file():
            continue
        scanned_files += 1
        scanned_bytes += path.stat().st_size
        if scanned_files > 65536 or scanned_bytes > 4294967296:
            raise RuntimeError('PostgreSQL audit exceeds its fixture bounds; no file may be silently skipped.')
        found_id = found_statement = False
        with path.open('rb') as stream:
            tail = b''
            while chunk := stream.read(1048576):
                body = tail + chunk
                found_id = found_id or any(item in body for item in encoded)
                found_statement = found_statement or any(item in body for item in statements)
                tail = body[-overlap:] if overlap else b''
        if found_id: residual.append(str(path.relative_to(root)))
        if found_statement: plaintext.append(str(path.relative_to(root)))
    housekeeping = sum(item['type'] == 'graph_maintenance' and not item['forgottenCanonicalIdInPayload'] and not item['forgottenCanonicalIdInMetadata'] for item in operations)
    content_remaining = sum(count for table, count in remaining.items() if table not in ('async_operations', 'graph_maintenance_queue', 'entity_maintenance_queue')) + len(operations) - housekeeping
    print(json.dumps({'maintenance': maintenance, 'activeClientGuardChecked': guards_checked, 'scannedFiles': scanned_files, 'scannedBytes': scanned_bytes, 'activeDerivativeRows': remaining, 'activeRowsRemaining': sum(remaining.values()), 'contentRowsRemaining': content_remaining, 'housekeepingOperationCount': housekeeping, 'operationDiagnostics': operations, 'physicalFilesContainingForgottenCanonicalIds': residual, 'physicalFilesContainingForgottenPlaintext': plaintext, 'physicalDeletionPassed': not residual, 'plaintextDeletionPassed': not plaintext, 'boundary': 'Private synthetic PostgreSQL data and WAL; empty bank descriptors and content-free graph housekeeping retained; no user store inspected'}))

try:
    asyncio.run(main())
finally:
    if pg is not None: pg.stop()
