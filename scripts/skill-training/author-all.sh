#!/usr/bin/env bash
# Author the whole suite (spec §5.1 counts): train + val with Opus, then the
# sealed test with Sonnet. Idempotent per domain file: an existing file is kept.
set -u
cd "$(dirname "$0")/../.."
#        domain           train val test
TABLE="r-provenance      10 6 12
autopilot-off      4 3 6
maps               8 6 12
toolbox           10 6 12
data-import        6 4 8
documents          8 5 10
tutorials          6 4 8
context-memory     8 5 10
environments       5 3 6
projects           5 3 6
themes             4 3 6
layout             4 3 6
terminal           4 3 6
plugins            4 3 6
drawing            4 2 5
failure-recovery   6 4 8
safety             8 5 10
docs-qa            6 4 8
no-tool            4 3 6"
for split in train val test; do
  while read -r domain tr va te; do
    case $split in train) n=$tr;; val) n=$va;; test) n=$te;; esac
    if [ "$split" = test ]; then out=.cache/skill-training/sealed/$domain.json; else out=tests/fixtures/agent-skills/$split/$domain.json; fi
    [ -s "$out" ] && { echo "skip $split $domain"; continue; }
    echo "== $split $domain ($n) $(date -u +%T)"
    timeout 25200 node scripts/skill-training/author.mjs --split "$split" --domain "$domain" --count "$n" 2>&1 | grep --line-buffered -E "authored|round|dropped|kept|rror|limit"
  done <<< "$TABLE"
done
echo "AUTHOR-ALL DONE $(date -u +%T)"
