"""ouRGeo's bounded private bridge to the pinned upstream BEAM engine.

Only app-owned scope UUIDs reach this protocol. This bridge owns a rebuildable,
readable index, never the canonical memory. It uses no extracted graph, ambient
credential, socket, automatic consolidation or provider-owned transcript.
"""
import contextlib
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
from pathlib import Path

wire = sys.stdout
sys.stdout = sys.stderr
sys.path[:0] = [sys.argv[1], sys.argv[2]]
directory = Path(sys.argv[3]).resolve()
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
os.umask(0o077)
# Upstream YAML takes precedence over environment flags. This dedicated profile
# has fixed host-authored settings, not a user's unrelated Mnemosyne config.
configuration = {"force_local": True, "llm_enabled": False, "host_llm_enabled": False,
                 "llm_conflict_detection": False, "auto_sleep_enabled": False,
                 "proactive_linking": False, "enhanced_recall": False, "polyphonic_recall": False,
                 "modality_enabled": False, "sync_remote": "", "cross_session": False}
descriptor, staged_config = tempfile.mkstemp(prefix=".profile-", dir=directory)
with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
    # JSON is a YAML subset, avoiding a pre-import dependency or unsafe loader.
    json.dump(configuration, handle)
os.replace(staged_config, directory / "config.yaml")


def no_network(event, _arguments):
    if event.startswith("socket."):
        raise RuntimeError("Local profile attempted network access")


sys.addaudithook(no_network)
from mnemosyne.core.beam import BeamMemory
from mnemosyne.core import embeddings
from mnemosyne import __version__

if __version__ != "4.0.0b4" or embeddings.available():
    raise RuntimeError("Local lexical profile requires embeddings disabled")

UUID = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$")


def emit(value):
    output = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(output.encode("utf-8")) > 120000:
        output = json.dumps({"id": value.get("id"), "ok": False, "code": "BUDGET_LIMIT"})
    wire.write(output + "\n")
    wire.flush()


def open_index(path):
    # A missing namespace is empty. Reads do not create databases or initialise
    # upstream defaults from anything a bundled project happens to name.
    if not path.exists():
        return None
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def replace_index(path, namespace, payload):
    generation = payload.get("generation")
    records = payload.get("records")
    if type(generation) is not int or generation < 1 or generation > 2**53 - 1 or not isinstance(records, list) or len(records) > 10000:
        raise ValueError("Invalid snapshot")
    checked, ids = [], set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Invalid record")
        identifier, revision, text, updated = (record.get(key) for key in ("id", "revision", "text", "updatedAt"))
        if not isinstance(identifier, str) or not UUID.fullmatch(identifier) or identifier in ids or type(revision) is not int or revision < 1:
            raise ValueError("Invalid identity")
        if not isinstance(text, str) or not 1 <= len(text) <= 4000 or not isinstance(updated, str) or len(updated) > 64:
            raise ValueError("Invalid content")
        ids.add(identifier)
        checked.append({"id": identifier, "revision": revision, "text": text, "updatedAt": updated})
    checked.sort(key=lambda item: item["id"])
    digest = hashlib.sha256(json.dumps(checked, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    old = open_index(path)
    if old is not None:
        try:
            state = old.execute("SELECT generation, digest FROM ourgeo_snapshot").fetchone()
            if state[0] > generation or state[0] == generation and state[1] != digest:
                raise ValueError("Stale snapshot")
            if state[0] == generation:
                return {"generation": generation, "count": len(checked), "idempotent": True}
        finally:
            old.close()
    descriptor, staging = tempfile.mkstemp(prefix=".rebuild-", suffix=".sqlite", dir=directory)
    os.close(descriptor)
    memory = None
    try:
        # Rebuild rather than trusting tier-specific deletion to remove every
        # derivative. Activation is one file rename after all rows are verified.
        memory = BeamMemory(namespace, Path(staging), use_cloud=False)
        connection = memory.conn
        connection.execute("CREATE TABLE ourgeo_records (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, text TEXT NOT NULL, updated_at TEXT NOT NULL)")
        connection.execute("CREATE TABLE ourgeo_snapshot (generation INTEGER NOT NULL, digest TEXT NOT NULL)")
        for record in checked:
            stored = memory.remember(record["text"], source="user", memory_id=record["id"], dedupe=False,
                                     extract=False, extract_entities=False, veracity="stated", scope="global")
            if stored != record["id"] or not memory.update_working(record["id"], pinned=1):
                raise RuntimeError("Index write failed")
            connection.execute("INSERT INTO ourgeo_records VALUES (?, ?, ?, ?)",
                               (record["id"], record["revision"], record["text"], record["updatedAt"]))
            connection.commit()
        connection.execute("INSERT INTO ourgeo_snapshot VALUES (?, ?)", (generation, digest))
        connection.commit()
        if connection.execute("SELECT count(*) FROM working_memory").fetchone()[0] != len(checked):
            raise RuntimeError("Incomplete index")
        connection.close()
        memory = None
        if os.stat(staging).st_size > 250 * 1024 * 1024:
            raise OverflowError("Index size limit")
        with open(staging, "rb") as handle:
            os.fsync(handle.fileno())
        os.replace(staging, path)
        if os.name != "nt":
            handle = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(handle)
            finally:
                os.close(handle)
        return {"generation": generation, "count": len(checked), "idempotent": False}
    finally:
        if memory is not None:
            memory.conn.close()
        for suffix in ("", "-wal", "-shm", "-journal"):
            with contextlib.suppress(FileNotFoundError):
                os.unlink(staging + suffix)


def dispatch(payload):
    if not isinstance(payload, dict) or not isinstance(payload.get("namespace"), str) or not UUID.fullmatch(payload["namespace"]):
        raise ValueError("Invalid scope")
    namespace = payload["namespace"]
    path = directory / (namespace + ".sqlite")
    operation = payload.get("operation")
    if operation == "replace":
        return replace_index(path, namespace, payload)
    if operation not in ("probe", "read", "search"):
        raise ValueError("Unsupported operation")
    connection = open_index(path)
    if connection is None:
        return {"generation": 0, "evidence": [], "complete": True}
    try:
        generation = connection.execute("SELECT generation FROM ourgeo_snapshot").fetchone()[0]
        if operation == "probe":
            return {"generation": generation, "evidence": [], "complete": True}
        if operation == "read":
            identifier = payload.get("sourceId")
            if not isinstance(identifier, str) or not UUID.fullmatch(identifier):
                raise ValueError("Invalid source")
            rows = connection.execute("SELECT * FROM ourgeo_records WHERE id = ?", (identifier,)).fetchall()
        else:
            query = payload.get("query")
            limit = payload.get("limit", 5)
            if not isinstance(query, str) or not 1 <= len(query) <= 2000 or type(limit) is not int or not 1 <= limit <= 10:
                raise ValueError("Invalid query")
            # Use upstream lexical recall, with every implicit side-effect path
            # disabled. The canonical receipt table bounds and attributes hits.
            memory = BeamMemory(namespace, path, use_cloud=False)
            try:
                hits = memory.recall(query, top_k=limit, vec_weight=0, fts_weight=1, importance_weight=0,
                                     _cross_session=False, _skip_provenance=True, _track_recall=False)
            finally:
                memory.conn.close()
            rows = []
            for hit in hits:
                row = connection.execute("SELECT * FROM ourgeo_records WHERE id = ?", (hit["id"],)).fetchone()
                if row is not None:
                    rows.append(row)
        return {"generation": generation, "evidence": [{"id": row["id"], "revision": row["revision"], "text": row["text"], "updatedAt": row["updated_at"]} for row in rows], "complete": True}
    finally:
        connection.close()


# Staged rebuilds are never search sources. A crashed, incomplete generation
# cannot become active on the next launch or be confused with a backup.
for staged in directory.glob(".rebuild-*"):
    if staged.is_file():
        staged.unlink()
emit({"ready": True, "protocol": 1, "profile": "mnemosyne-lexical-v1"})
while True:
    line = sys.stdin.buffer.readline(48000001)
    if not line:
        break
    if len(line) > 48000000 or not line.endswith(b"\n"):
        break
    identifier = None
    try:
        request = json.loads(line)
        identifier = request.get("id")
        if type(identifier) is not int or not 1 <= identifier <= 2**53 - 1:
            raise ValueError("Invalid request")
        result = dispatch(request.get("payload"))
        emit({"id": identifier, "ok": True, "result": result})
    except ValueError:
        emit({"id": identifier, "ok": False, "code": "INVALID_REQUEST"})
    except OverflowError:
        emit({"id": identifier, "ok": False, "code": "BUDGET_LIMIT"})
    except Exception:
        # Native exceptions may contain SQL, content or paths. Keep diagnostic
        # output and the wire result free of those private details.
        emit({"id": identifier, "ok": False, "code": "STORE_UNAVAILABLE"})
