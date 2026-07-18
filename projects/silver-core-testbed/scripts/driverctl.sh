#!/usr/bin/env bash
# 驱动器启停脚本 (施工封面 §2 第一战): start / stop / status / kill9 for the
# testbed daemon in soak mode. kill9 exists ON PURPOSE — the soak battle
# (§2 第三战) requires a daily hard-kill to prove restart recovery.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTBED="$(dirname "$HERE")"
STATE="$TESTBED/state"
PIDFILE="$STATE/daemon.pid"

pid_alive() {
  [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

case "${1:-}" in
  start)
    if pid_alive; then
      echo "daemon already running (pid $(cat "$PIDFILE"))"
      exit 0
    fi
    mkdir -p "$STATE"
    nohup node "$TESTBED/src/daemon.mjs" >> "$STATE/daemon.log" 2>&1 &
    echo "daemon starting (pid $!)"
    ;;
  stop)
    if pid_alive; then
      kill -TERM "$(cat "$PIDFILE")"
      echo "SIGTERM sent to $(cat "$PIDFILE")"
    else
      echo "daemon not running"
    fi
    ;;
  kill9)
    if pid_alive; then
      kill -9 "$(cat "$PIDFILE")"
      echo "SIGKILL sent to $(cat "$PIDFILE") (pid file left behind on purpose — restart runs the crash sweep)"
    else
      echo "daemon not running"
    fi
    ;;
  status)
    if pid_alive; then
      echo "daemon running (pid $(cat "$PIDFILE"))"
    else
      echo "daemon not running"
      [[ -f "$PIDFILE" ]] && echo "stale pid file present: $PIDFILE (unclean death)"
    fi
    ;;
  *)
    echo "usage: driverctl.sh {start|stop|kill9|status}"
    exit 2
    ;;
esac
