"""Stop only an orphan database from this repository's synthetic test roots."""
import argparse
import os
import pathlib
import signal

parser = argparse.ArgumentParser()
parser.add_argument('directory')
args = parser.parse_args()
repo = pathlib.Path(__file__).resolve().parents[2]
root = pathlib.Path(args.directory).resolve()
assert root.name.startswith('fixture-') and root.parent == repo/'.cache/stage34/hindsight'
assert (root/'dedicated-profile').read_text() == 'hindsight-local-chunks-v1\n'
cluster = root/'postgres-data'
pid_file = (cluster/'postmaster.pid').read_text().splitlines()
assert pid_file[1] == str(cluster)
pid = int(pid_file[0])
process = pathlib.Path('/proc')/str(pid)
assert process.stat().st_uid == os.getuid()
assert str(cluster).encode() in (process/'cmdline').read_bytes().split(b'\0')
os.kill(pid, signal.SIGTERM)
print('Stopped the exact owned synthetic PostgreSQL process.')
