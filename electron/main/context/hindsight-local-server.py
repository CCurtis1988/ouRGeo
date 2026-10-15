"""Operator-started Linux Hindsight server for the reviewed lexical profile.

Requires the separately installed pinned private environment. No installation,
model downloads, external credentials, extraction or reflection are permitted.
The desktop can attach only after verifying this process and its distribution.
"""
import argparse
import atexit
import fcntl
import hashlib
import importlib.util
import json
import logging
import math
import os
import pathlib
import re
import secrets
import signal
import socket
import sys
import subprocess
import time
from importlib.metadata import version


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--postgres', required=True)
    args = parser.parse_args()
    if sys.platform != 'linux' or sys.version_info[:2] != (3, 14):
        raise RuntimeError('Use the reviewed Linux Python 3.14 environment.')
    root = pathlib.Path(args.state).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.stat()
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Choose a private directory owned by this account (mode 0700).')
    lock = os.open(root/'server.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    marker = root/'dedicated-profile'
    if not marker.exists():
        if set(path.name for path in root.iterdir()) != {'server.lock'}:
            raise RuntimeError('Choose a new empty directory for this dedicated profile.')
        marker.write_text('hindsight-local-chunks-v1\n')
        marker.chmod(0o600)
    elif marker.read_text() != 'hindsight-local-chunks-v1\n' or marker.is_symlink():
        raise RuntimeError('Use a directory already owned by this dedicated profile.')
    os.chdir(root)
    sys.dont_write_bytecode = True
    kept = {key: value for key, value in os.environ.items() if key in ('PATH', 'LANG', 'LC_ALL', 'TMPDIR')}
    os.environ.clear()
    os.environ.update(kept)
    os.environ.update({'XDG_CACHE_HOME': str(root/'cache'), 'XDG_CONFIG_HOME': str(root/'config'), 'XDG_DATA_HOME': str(root/'data')})
    if version('hindsight-api-slim') != '0.10.2':
        raise RuntimeError('Install the pinned Hindsight 0.10.2 environment before starting the server.')
    # Upstream logs may include request text on error. This profile emits only
    # content-free readiness/failure markers; PostgreSQL query logging is off.
    logging.disable(logging.CRITICAL)

    # Unix socket paths have a small platform limit; the user's deployment
    # directory can be much longer. This deterministic short directory remains
    # private and is never an unauthenticated public socket location.
    database_socket = pathlib.Path('/tmp')/('ourgeo-hindsight-'+str(os.getuid())+'-'+hashlib.sha256(str(root).encode()).hexdigest()[:20])
    database_socket.mkdir(mode=0o700, exist_ok=True)
    assert not database_socket.is_symlink() and database_socket.stat().st_uid == os.getuid() and not database_socket.stat().st_mode & 0o077
    postgres_binary = pathlib.Path(args.postgres).resolve()
    assert postgres_binary.name == 'postgres' and postgres_binary.parent.name == 'bin'
    postgres_environment = dict(os.environ, LD_LIBRARY_PATH=str(postgres_binary.parent.parent/'lib'))
    cluster = root/'postgres-data'
    if not cluster.exists():
        initialised = subprocess.run([str(postgres_binary.parent/'initdb'), '-D', str(cluster), '--username=ourgeo', '--auth=trust', '--encoding=UTF8', '--no-instructions'], env=postgres_environment, capture_output=True)
        if initialised.returncode:
            raise RuntimeError('Repair the pinned PostgreSQL installation before creating its empty cluster: '+initialised.stderr.decode(errors='replace')[-2000:])
        (cluster/'pg_hba.conf').write_text('local all all trust\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n')
    assert not cluster.is_symlink() and (cluster/'PG_VERSION').read_text().strip() == '18'
    configuration = {
        'listen_addresses': '', 'unix_socket_directories': str(database_socket), 'port': '5432', 'wal_recycle': 'off', 'wal_init_zero': 'on', 'archive_mode': 'off',
        'log_statement': 'none', 'log_min_duration_statement': '-1', 'log_min_duration_sample': '-1', 'log_min_error_statement': 'panic', 'log_parameter_max_length_on_error': '0',
        'fsync': 'on', 'synchronous_commit': 'on', 'full_page_writes': 'on', 'shared_buffers': '64MB', 'max_connections': '32', 'logging_collector': 'off',
    }
    command = [str(postgres_binary), '-D', str(cluster)]
    for key, value in configuration.items():
        command.extend(['-c', key+'='+value])
    owned_pid = None
    pid_path = cluster/'postmaster.pid'
    if pid_path.exists():
        candidate = int(pid_path.read_text().splitlines()[0])
        process = pathlib.Path('/proc')/str(candidate)
        if process.exists():
            assert process.stat().st_uid == os.getuid() and (process/'exe').resolve() == postgres_binary
            assert (process/'cmdline').read_bytes().split(b'\0')[:-1] == [part.encode() for part in command]
            owned_pid = candidate
    child = None
    if owned_pid is None:
        child = subprocess.Popen(command, env=postgres_environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        owned_pid = child.pid

    def stop_database():
        process = pathlib.Path('/proc')/str(owned_pid)
        if not process.exists():
            return
        assert process.stat().st_uid == os.getuid() and (process/'exe').resolve() == postgres_binary
        assert (process/'cmdline').read_bytes().split(b'\0')[:-1] == [part.encode() for part in command]
        os.kill(owned_pid, signal.SIGTERM)
        deadline = time.monotonic()+10
        while pid_path.exists() and time.monotonic() < deadline:
            time.sleep(0.025)
        if pid_path.exists():
            raise RuntimeError('Dedicated database shutdown is pending; preserve its files.')
        if child:
            child.wait(timeout=2)

    atexit.register(stop_database)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    ready = database_socket/'.s.PGSQL.5432'
    deadline = time.monotonic()+10
    while not ready.exists():
        if child and child.poll() is not None or time.monotonic() > deadline:
            raise RuntimeError('Repair the pinned PostgreSQL distribution before starting this profile.')
        time.sleep(0.025)
    database_uri = f'postgresql://ourgeo@/postgres?host={database_socket}&port=5432'
    os.environ.update({'HINDSIGHT_API_DATABASE_URL': database_uri, 'HINDSIGHT_API_LLM_PROVIDER': 'none', 'HINDSIGHT_API_RETAIN_EXTRACTION_MODE': 'chunks',
        'HINDSIGHT_API_EMBEDDINGS_PROVIDER': 'local',
        'HINDSIGHT_API_RERANKER_PROVIDER': 'rrf', 'HINDSIGHT_API_ENABLE_OBSERVATIONS': 'false', 'LITELLM_LOCAL_MODEL_COST_MAP': 'True', 'OTEL_SDK_DISABLED': 'true', 'DO_NOT_TRACK': '1'})
    import asyncpg
    import uvicorn
    from hindsight_api import MemoryEngine
    from hindsight_api.api import create_app
    from hindsight_api.engine.embeddings import Embeddings

    class LocalLexical(Embeddings):
        """The upstream public embedding interface, with no model or socket.

        These deterministic token features support the labelled lexical profile;
        they are not semantic embeddings and make no semantic quality claim.
        """
        @property
        def provider_name(self):
            return 'local-lexical-hash-128'

        @property
        def dimension(self):
            return 128

        async def initialize(self):
            pass

        async def encode(self, texts):
            vectors = []
            for text in texts:
                vector = [0.0]*128
                for token in re.findall(r'\w+', text.lower()):
                    vector[int.from_bytes(hashlib.sha256(token.encode()).digest()[:2], 'big') % 128] += 1.0
                norm = math.sqrt(sum(item*item for item in vector)) or 1.0
                vectors.append([item/norm for item in vector])
            return vectors
    directory = pathlib.Path(__file__).resolve().parent

    def load(name):
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), directory/(name+'.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    secret = secrets.token_bytes(32)
    descriptor = os.open(root/'server-secret', os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        os.write(descriptor, secret)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    app = load('hindsight-gateway').HindsightRetentionGateway(
        lambda: create_app(memory=MemoryEngine(embeddings=LocalLexical()), http_api_enabled=True, mcp_api_enabled=False, initialize_memory=True),
        lambda: asyncpg.connect(database_uri), load('hindsight-retention').compact_hindsight_store, root, secret)
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(('127.0.0.1', args.port))
    listener.listen(64)
    metadata = {'version': 1, 'profile': 'hindsight-local-chunks-v1', 'pid': os.getpid(), 'endpoint': f'http://127.0.0.1:{listener.getsockname()[1]}',
        'script': str(pathlib.Path(__file__).resolve()), 'python': str(pathlib.Path(sys.executable).resolve()), 'sitePackages': str(pathlib.Path(sys.prefix)/'lib/python3.14/site-packages'),
        'postgresPort': 5432, 'postgresDirectory': str(postgres_binary.parent.parent), 'databaseSocket': str(database_socket), 'processing': 'local-lexical-hash-128', 'llm': 'none'}
    descriptor = os.open(root/'server.json', os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    try:
        os.write(descriptor, json.dumps(metadata).encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    uvicorn.Server(uvicorn.Config(app, log_level='critical', access_log=False)).run(sockets=[listener])
    os.close(lock)


if __name__ == '__main__':
    run()
