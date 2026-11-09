#!/usr/bin/env bash
# Hold off idle sleep while the given study processes run, so an unattended
# batch is not cut by the laptop hibernating. Nothing is changed in the
# maintainer's power settings: the lock is a process and dies with this script.
# Lid close and the power key still work. On battery the lock is released at
# BATTERY_FLOOR so the machine can still save itself.
set -u
FLOOR=${BATTERY_FLOOR:-25}
lock=
hold() { [ -n "$lock" ] && kill -0 "$lock" 2>/dev/null && return
  systemd-inhibit --what=sleep:idle --mode=block --who=ourgeo-skill-training --why="Skill training batch running" sleep infinity & lock=$!; echo "$(date -u +%T) holding (pid $lock)"; }
release() { [ -n "$lock" ] && { pkill -P "$lock" 2>/dev/null; kill "$lock" 2>/dev/null; echo "$(date -u +%T) released"; lock=; }; }
trap 'release' EXIT
while :; do
  alive=0; for p in "$@"; do kill -0 "$p" 2>/dev/null && alive=1; done
  [ "$alive" = 1 ] || break
  status=$(cat /sys/class/power_supply/BAT0/status 2>/dev/null); cap=$(cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo 100)
  if [ "$status" = Discharging ] && [ "$cap" -le "$FLOOR" ]; then release; else hold; fi
  sleep 60
done
