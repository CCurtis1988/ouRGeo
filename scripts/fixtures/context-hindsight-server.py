"""Synthetic-only pinned Hindsight API fixture, with no model or credentials.

Install hindsight-api-slim[embedded-db] from the documented immutable upstream
source into a private venv first. This fixture installs and downloads nothing.
Hash vectors test API mechanics, not semantic retrieval quality.
"""
import argparse
import atexit
import hashlib
import json
import math
import os
import pathlib
import re
import signal
import sys
import threading
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version

parser = argparse.ArgumentParser()
parser.add_argument('--state', required=True)
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--gateway', action='store_true')
args = parser.parse_args()
root = pathlib.Path(args.state).resolve()
root.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chdir(root)
# Ambient provider keys, telemetry configuration and .env files are excluded.
kept = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR')}
os.environ.clear()
os.environ.update(kept)
os.environ.update({'XDG_CACHE_HOME': str(root/'cache'), 'XDG_CONFIG_HOME': str(root/'config'), 'XDG_DATA_HOME': str(root/'data')})
if version('hindsight-api-slim') != '0.10.2':
    raise RuntimeError('Install the documented pinned Hindsight 0.10.2 fixture.')
from pg0 import Pg0

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *unused): pass
    def reply(self, value):
        body = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        self.reply({'model_id': 'synthetic-lexical-hash-128'})
    def do_POST(self):
        size = int(self.headers.get('Content-Length', 0))
        if size > 262144:
            self.send_error(413); return
        value = json.loads(self.rfile.read(size))
        inputs = value.get('inputs', [])
        inputs = [inputs] if isinstance(inputs, str) else inputs
        vectors = []
        for text in inputs:
            vector = [0.0]*128
            for token in re.findall(r'\w+', text.lower()):
                vector[int.from_bytes(hashlib.sha256(token.encode()).digest()[:2], 'big') % 128] += 1.0
            norm = math.sqrt(sum(x*x for x in vector)) or 1.0
            vectors.append([x/norm for x in vector])
        self.reply(vectors)

tei = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=tei.serve_forever, daemon=True).start()
pg = Pg0(name='ourgeo-'+root.name, data_dir=str(root/'postgres-data'), username='fixture', password='synthetic-local-only', database='fixture', config={'listen_addresses': '127.0.0.1', 'unix_socket_directories': '', 'wal_recycle': 'off', 'wal_init_zero': 'on', 'archive_mode': 'off', 'log_min_error_statement': 'panic', 'log_parameter_max_length_on_error': '0'})
info = pg.start()
atexit.register(pg.stop)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
os.environ.update({'HINDSIGHT_API_DATABASE_URL': info.uri, 'HINDSIGHT_API_LLM_PROVIDER': 'none', 'HINDSIGHT_API_RETAIN_EXTRACTION_MODE': 'chunks', 'HINDSIGHT_API_EMBEDDINGS_PROVIDER': 'tei', 'HINDSIGHT_API_EMBEDDINGS_TEI_URL': f'http://127.0.0.1:{tei.server_port}', 'HINDSIGHT_API_RERANKER_PROVIDER': 'rrf', 'HINDSIGHT_API_ENABLE_OBSERVATIONS': 'false', 'LITELLM_LOCAL_MODEL_COST_MAP': 'True', 'OTEL_SDK_DISABLED': 'true', 'DO_NOT_TRACK': '1'})
from hindsight_api import MemoryEngine
from hindsight_api.api import create_app
import uvicorn
def make_app():
    return create_app(memory=MemoryEngine(), http_api_enabled=True, mcp_api_enabled=False, initialize_memory=True)
app = make_app()
if args.gateway:
    import asyncpg
    import secrets
    sys.dont_write_bytecode = True
    directory = pathlib.Path(__file__).resolve().parents[2]/'electron/main/context'
    def load(name):
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), directory/(name+'.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    secret = secrets.token_bytes(32)
    (root/'gateway-secret').write_bytes(secret)
    (root/'gateway-secret').chmod(0o600)
    app = load('hindsight-gateway').HindsightRetentionGateway(make_app, lambda: asyncpg.connect(info.uri), load('hindsight-retention').compact_hindsight_store, root, secret)
(root/'fixture-processing.json').write_text(json.dumps({'pid': os.getpid(), 'postgresPort': info.port, 'embeddingPort': tei.server_port, 'apiPort': args.port, 'model': 'synthetic-lexical-hash-128', 'llm': 'none', 'paidProcessing': False}))
uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
