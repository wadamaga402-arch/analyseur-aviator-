#!/bin/sh
# Stops local test servers (wrangler dev / workerd / e2e runner)
for pid in $(pgrep -f "workerd|wrangler.*dev|test/e2e" ); do [ "$pid" != "$$" ] && kill "$pid" 2>/dev/null; done
exit 0
