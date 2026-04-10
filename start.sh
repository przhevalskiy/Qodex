#!/bin/bash

# Qodex - Start All Services
# This script starts the backend and frontend services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PID_DIR="$SCRIPT_DIR/.pids"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║         Qodex - Starting Services     ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Create PID directory
mkdir -p "$PID_DIR"

# Check if services are already running
if [ -f "$PID_DIR/backend.pid" ]; then
    BACKEND_PID=$(cat "$PID_DIR/backend.pid")
    if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}Warning: Backend is already running (PID: $BACKEND_PID)${NC}"
        echo "Run ./stop.sh first to stop existing services"
        exit 1
    fi
fi

if [ -f "$PID_DIR/frontend.pid" ]; then
    FRONTEND_PID=$(cat "$PID_DIR/frontend.pid")
    if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}Warning: Frontend is already running (PID: $FRONTEND_PID)${NC}"
        echo "Run ./stop.sh first to stop existing services"
        exit 1
    fi
fi

# Check for .env files
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: Backend .env file not found${NC}"
    if [ -f "$BACKEND_DIR/.env.example" ]; then
        echo "Creating .env from .env.example..."
        cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
        echo -e "${YELLOW}Please edit $BACKEND_DIR/.env and add your API keys${NC}"
    fi
fi

if [ ! -f "$FRONTEND_DIR/.env" ]; then
    echo -e "${YELLOW}Warning: Frontend .env file not found${NC}"
    if [ -f "$FRONTEND_DIR/.env.example" ]; then
        echo "Creating .env from .env.example..."
        cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env"
    fi
fi

# Start Backend
echo -e "${BLUE}Starting Backend...${NC}"
cd "$BACKEND_DIR"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and install dependencies
source venv/bin/activate
pip install -r requirements.txt --quiet

# Start uvicorn in background
nohup env PYTHONUNBUFFERED=1 uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > "$SCRIPT_DIR/logs/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$PID_DIR/backend.pid"
echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"

# Deactivate virtual environment
deactivate

# Start Frontend
echo -e "${BLUE}Starting Frontend...${NC}"
cd "$FRONTEND_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install --silent
fi

# Create logs directory
mkdir -p "$SCRIPT_DIR/logs"

# Start Vite dev server in background
nohup npm run dev > "$SCRIPT_DIR/logs/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$PID_DIR/frontend.pid"
echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"

# Wait a moment for services to start
sleep 3

# Check if services are running
echo ""
echo -e "${BLUE}Checking services...${NC}"

BACKEND_RUNNING=false
FRONTEND_RUNNING=false

if ps -p $(cat "$PID_DIR/backend.pid") > /dev/null 2>&1; then
    BACKEND_RUNNING=true
    echo -e "${GREEN}✓ Backend is running on http://localhost:8000${NC}"
else
    echo -e "${RED}✗ Backend failed to start. Check logs/backend.log${NC}"
fi

if ps -p $(cat "$PID_DIR/frontend.pid") > /dev/null 2>&1; then
    FRONTEND_RUNNING=true
    echo -e "${GREEN}✓ Frontend is running on http://localhost:5173${NC}"
else
    echo -e "${RED}✗ Frontend failed to start. Check logs/frontend.log${NC}"
fi

echo ""
if $BACKEND_RUNNING && $FRONTEND_RUNNING; then
    echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     Qodex is ready!                   ║${NC}"
    echo -e "${GREEN}║                                       ║${NC}"
    echo -e "${GREEN}║     Frontend: http://localhost:5173   ║${NC}"
    echo -e "${GREEN}║     Backend:  http://localhost:8000   ║${NC}"
    echo -e "${GREEN}║     API Docs: http://localhost:8000/docs${NC}"
    echo -e "${GREEN}║                                       ║${NC}"
    echo -e "${GREEN}║     Run ./stop.sh to stop services    ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
else
    echo -e "${RED}Some services failed to start. Check the logs directory.${NC}"
    exit 1
fi
