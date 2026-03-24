#!/bin/bash

# Qodex - Service Status Check
# Shows running state of backend and frontend, and pings the health endpoint

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$SCRIPT_DIR/.pids"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║         Qodex - Service Status        ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

ALL_OK=true

# ── Backend ──────────────────────────────────
echo -e "${BLUE}Backend${NC}"

if [ -f "$PID_DIR/backend.pid" ]; then
    BACKEND_PID=$(cat "$PID_DIR/backend.pid")
    if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
        echo -e "  Process   ${GREEN}✓ Running${NC} (PID: $BACKEND_PID)"
    else
        echo -e "  Process   ${RED}✗ Not running${NC} (stale PID file)"
        ALL_OK=false
    fi
else
    echo -e "  Process   ${RED}✗ Not running${NC}"
    ALL_OK=false
fi

# Ping health endpoint
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8000/health 2>/dev/null)
if [ "$HEALTH" = "200" ]; then
    echo -e "  Health    ${GREEN}✓ http://localhost:8000/health → 200 OK${NC}"

    # Show provider status from health endpoint
    HEALTH_JSON=$(curl -s --max-time 3 http://localhost:8000/health 2>/dev/null)
    if command -v python3 &>/dev/null && [ -n "$HEALTH_JSON" ]; then
        PROVIDERS=$(echo "$HEALTH_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    providers = data.get('providers', {})
    for name, status in providers.items():
        mark = '✓' if status else '✗'
        print(f'  Provider  {mark} {name}')
except:
    pass
" 2>/dev/null)
        [ -n "$PROVIDERS" ] && echo "$PROVIDERS"
    fi
else
    echo -e "  Health    ${RED}✗ http://localhost:8000/health → unreachable${NC}"
    ALL_OK=false
fi

echo ""

# ── Frontend ─────────────────────────────────
echo -e "${BLUE}Frontend${NC}"

if [ -f "$PID_DIR/frontend.pid" ]; then
    FRONTEND_PID=$(cat "$PID_DIR/frontend.pid")
    if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
        echo -e "  Process   ${GREEN}✓ Running${NC} (PID: $FRONTEND_PID)"
    else
        echo -e "  Process   ${RED}✗ Not running${NC} (stale PID file)"
        ALL_OK=false
    fi
else
    echo -e "  Process   ${RED}✗ Not running${NC}"
    ALL_OK=false
fi

FRONTEND_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:5173 2>/dev/null)
if [ "$FRONTEND_STATUS" = "200" ]; then
    echo -e "  Reachable ${GREEN}✓ http://localhost:5173 → 200 OK${NC}"
else
    echo -e "  Reachable ${RED}✗ http://localhost:5173 → unreachable${NC}"
    ALL_OK=false
fi

echo ""

# ── Summary ──────────────────────────────────
echo "────────────────────────────────────────"
if $ALL_OK; then
    echo -e "${GREEN}✓ All systems operational${NC}"
else
    echo -e "${RED}✗ Some services are down — run ./start.sh to restart${NC}"
fi
echo ""
