#!/usr/bin/env bash
# Exits, which wakes the supervising session, when the study has produced no
# output for $1 minutes (default 45). A process being alive proves nothing: the
# 2026-11-05 stall left every runner alive and silent for 7 hours. Exit also
# happens when the pipelines finish.
cd "$(dirname "$0")/../.."
L=.cache/skill-training; limit=$(( ${1:-45} * 60 ))
while :; do
  newest=$(find $L/ledger $L/sealed $L/optimize tests/fixtures/agent-skills $L/*.log -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1)
  age=$(( $(date +%s) - ${newest:-0} ))
  [ "$age" -gt "$limit" ] && { echo "STALL: no output for $((age/60)) min at $(date -u +%T)"; exit 1; }
  pgrep -f 'pipeline-p2.sh|author-all.sh|resume.sh|regrade.mjs|after-levers.sh|confirm-l14.sh|queue2.sh|p5.sh|trigger.sh|final.sh' >/dev/null || { echo "pipelines finished $(date -u +%T)"; exit 0; }
  sleep 120
done
