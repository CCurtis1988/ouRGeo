#!/usr/bin/env bash
# P2 baselines + P3 structural levers (spec §9), unattended. Qwen starts at once
# on what exists; Claude arms and val wait for val authoring to actually finish.
# Every run is resumable: the ledger skips what is already recorded.
set -u
cd "$(dirname "$0")/../.."
L=.cache/skill-training
DOMAINS=19
run() { node scripts/skill-training/run.mjs "$@" 2>&1 | grep --line-buffered -vE "^\[pid=" ; }
n() { ls tests/fixtures/agent-skills/$1/*.json 2>/dev/null | wc -l; }

echo "P2 start $(date -u +%T)"
run --model qwen --split pilot --runs 1 --label pilot-qwen-b1 > $L/pilot-qwen-b1.log
run --model qwen --split train --runs 1 --label base-qwen-train >> $L/p2-qwen.log
echo "qwen first pass done $(date -u +%T)"

until [ "$(n val)" -ge "$DOMAINS" ] || grep -q "AUTHOR-ALL DONE" $L/author-all.log; do sleep 60; done
if [ "$(n train)" -lt "$DOMAINS" ] || [ "$(n val)" -lt "$DOMAINS" ]; then
  echo "STOP: authoring incomplete (train $(n train), val $(n val) of $DOMAINS) $(date -u +%T)"; exit 1
fi

node scripts/skill-training/calibrate-judge.mjs > $L/judge-calibration.log 2>&1 || { echo "STOP: judge calibration failed, see judge-calibration.log $(date -u +%T)"; exit 1; }

( run --model haiku --split train --runs 2 --label base-haiku-train
  run --model haiku --split val --runs 2 --label base-haiku-val
  run --model sonnet --split val --runs 1 --label base-sonnet-val ) > $L/p2-claude.log &
run --model qwen --split val --runs 2 --label base-qwen-val > $L/p2-qwen-val.log
run --model qwen --split train --runs 1 --label base-qwen-train >> $L/p2-qwen.log
wait
echo "P2 baselines done $(date -u +%T)"

for lever in $L/levers/*.json; do
  name=$(basename "$lever" .json)
  run --model haiku --split val --runs 2 --overlay "$lever" --label "lever-$name-haiku" > $L/p3-$name-haiku.log &
  run --model qwen --split val --runs 1 --overlay "$lever" --label "lever-$name-qwen" > $L/p3-$name-qwen.log
  wait
  echo "lever $name done $(date -u +%T)"
done
echo "P3 DONE $(date -u +%T)"
