#!/usr/bin/env bash
# Kill eval app instances (Electron + R) whose sandbox path contains $1.
# Matches on the process ENVIRONMENT (XDG_CONFIG_HOME/HOME inside
# .cache/skill-training/sandboxes), never on command lines, so it cannot hit
# the developer's own ouRGeo, R session or this shell.
pattern="${1:?sandbox substring}"
for p in $(pgrep -f "node_modules/electron/dist/electron|server\.R"); do
  if tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -q "^XDG_CONFIG_HOME=.*skill-training/sandboxes/.*$pattern\|^HOME=.*skill-training/sandboxes/.*$pattern"; then
    kill -9 "$p" 2>/dev/null && echo "killed $p"
  fi
done
