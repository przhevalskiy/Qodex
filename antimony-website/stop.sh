#!/bin/bash

cd "$(dirname "$0")"

if [ -f .dev.pid ]; then
  PID=$(cat .dev.pid)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Antimony AI website stopped (PID $PID)"
  else
    echo "Process $PID not running"
  fi
  rm -f .dev.pid
else
  # Fallback: kill by port
  PID=$(lsof -ti :5173)
  if [ -n "$PID" ]; then
    kill "$PID"
    echo "Antimony AI website stopped (PID $PID)"
  else
    echo "No running instance found"
  fi
fi
