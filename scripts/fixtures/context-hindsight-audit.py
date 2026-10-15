"""Audit only the synthetic fixture's owned banks and PostgreSQL directory."""
import argparse
import asyncio
import json
import pathlib
import asyncpg

parser = argparse.ArgumentParser()
parser.add_argument('--state', required=True)
parser.add_argument('--records', required=True)
args = parser.parse_args()
root = pathlib.Path(args.state).resolve()
processing = json.loads((root/'fixture-processing.json').read_text())
records = json.loads(pathlib.Path(args.records).read_text())
assert records['namespaces'] and all(name.startswith('ourgeo_fixture_') for name in records['namespaces'])
assert records['ids'] and all(len(item) == 36 for item in records['ids'])

async def main():
    db = await asyncpg.connect(host='127.0.0.1', port=processing['postgresPort'], user='fixture', password='synthetic-local-only', database='fixture')
    try:
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
    for path in (root/'postgres-data').rglob('*'):
        if not path.is_file() or path.stat().st_size > 67108864:
            continue
        body = path.read_bytes()
        if any(item in body for item in encoded):
            residual.append(str(path.relative_to(root)))
        if any(item in body for item in statements):
            plaintext.append(str(path.relative_to(root)))
    housekeeping = sum(item['type'] == 'graph_maintenance' and not item['forgottenCanonicalIdInPayload'] and not item['forgottenCanonicalIdInMetadata'] for item in operations)
    content_remaining = sum(count for table, count in remaining.items() if table not in ('async_operations', 'graph_maintenance_queue', 'entity_maintenance_queue')) + len(operations) - housekeeping
    print(json.dumps({'activeDerivativeRows': remaining, 'activeRowsRemaining': sum(remaining.values()), 'contentRowsRemaining': content_remaining, 'housekeepingOperationCount': housekeeping, 'operationDiagnostics': operations, 'physicalFilesContainingForgottenCanonicalIds': residual, 'physicalFilesContainingForgottenPlaintext': plaintext, 'physicalDeletionPassed': not residual, 'plaintextDeletionPassed': not plaintext, 'boundary': 'Private synthetic PostgreSQL data and WAL; empty bank descriptors and content-free graph housekeeping retained; no user store inspected'}))

asyncio.run(main())
