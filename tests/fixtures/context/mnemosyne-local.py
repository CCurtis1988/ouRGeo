"""Synthetic delivery spike; run only with the pinned private runtime/assets.

The audit hook observes and refuses Python socket use. This is evidence for the
minimal dependency profile, not an OS sandbox or third-party native-code promise.
"""
import json
import sqlite3
import sys
from pathlib import Path

sys.path[:0] = [sys.argv[1], sys.argv[2]]
attempts = []


def no_network(event, args):
    if event.startswith("socket."):
        attempts.append(event)
        raise RuntimeError("Local profile attempted network access")


sys.addaudithook(no_network)
from mnemosyne.core.beam import BeamMemory
from mnemosyne.core import embeddings

assert embeddings.available() is False
directory = Path(sys.argv[3])
directory.mkdir(parents=True, exist_ok=True)
memory = BeamMemory("scope-a", directory / "scope-a.sqlite", use_cloud=False)
statement = "SYNTHETIC_CRS_DECISION: use EPSG:27700 for parcel buffers."
ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]
for identifier in ids:
    stored = memory.remember(statement, source="user", memory_id=identifier,
                             dedupe=False, extract=False, extract_entities=False,
                             veracity="stated", scope="global")
    assert stored == identifier
    assert memory.get(identifier)["content"] == statement
    assert memory.update_working(identifier, pinned=1) is True
hits = memory.recall("EPSG:27700", top_k=5, vec_weight=0, fts_weight=1,
                     importance_weight=0, _cross_session=False,
                     _skip_provenance=True, _track_recall=False)
assert set(ids).issubset({hit["id"] for hit in hits})
other = BeamMemory("scope-b", directory / "scope-b.sqlite", use_cloud=False)
assert other.get(ids[0]) is None
assert other.recall("EPSG:27700", top_k=5, vec_weight=0, fts_weight=1,
                    _cross_session=False, _skip_provenance=True,
                    _track_recall=False) == []
replacement = "SYNTHETIC_CRS_CORRECTION: use EPSG:3857 for display only."
assert memory.update_working(ids[0], content=replacement) is True
assert memory.get(ids[0])["content"] == replacement
assert memory.forget_working(ids[0]) is True
assert memory.get(ids[0]) is None
memory.conn.close()
other.conn.close()
# Observe derivative retention separately: a tier deletion is not certification
# that all graph/annotation data has been removed. Rebuilding from canonical
# records is an option for the managed adapter if this gate fails.
database = sqlite3.connect(directory / "scope-a.sqlite")
retained_tables = []
retained_text_tables = []
for (table,) in database.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    if table.startswith("sqlite_"):
        continue
    quoted = '"' + table.replace('"', '""') + '"'
    for row in database.execute("SELECT * FROM " + quoted):
        if any(isinstance(value, str) and ids[0] in value for value in row):
            retained_tables.append(table)
        if any(isinstance(value, str) and "SYNTHETIC_CRS_CORRECTION" in value for value in row):
            retained_text_tables.append(table)
database.close()
assert not attempts
print(json.dumps({"python": sys.version.split()[0], "fts5": True,
                  "separateDatabases": True, "duplicateContentIds": True,
                  "correctionAndTierDeletion": True,
                  "remainingDeletedIdTables": retained_tables,
                  "remainingDeletedTextTables": retained_text_tables,
                  "auditedSocketAttempts": attempts}))
