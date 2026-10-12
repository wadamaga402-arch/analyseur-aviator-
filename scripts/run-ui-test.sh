#!/bin/sh
# Starts the local server + fake Telegram, runs the browser test, stops everything.
cd "$(dirname "$0")/.."
sh scripts/stop-test-servers.sh; sleep 1
rm -f /tmp/e2e_keep.log
nohup node test/e2e.mjs --keep > /tmp/e2e_keep.log 2>&1 &
i=0; while [ $i -lt 60 ]; do grep -q "serveur toujours" /tmp/e2e_keep.log && break; sleep 2; i=$((i+1)); done
grep -E "tests réussis|échec|FAIL" /tmp/e2e_keep.log
PW_PATH="$(npm root -g)/playwright" timeout 150 node test/ui.mjs
sh scripts/stop-test-servers.sh; rm -f .dev.vars
