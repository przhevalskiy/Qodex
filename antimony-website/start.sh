#!/bin/bash

cd "$(dirname "$0")"

echo "Starting Antimony AI website..."

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Start dev server in background
nohup npm run dev > .dev.log 2>&1 &
echo $! > .dev.pid

sleep 2

PORT=$(grep -o 'localhost:[0-9]*' .dev.log | head -1 | cut -d: -f2)
PORT=${PORT:-5173}

echo "Antimony AI website running at http://localhost:$PORT"
echo "PID: $(cat .dev.pid)"
