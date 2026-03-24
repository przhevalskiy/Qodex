#!/bin/bash

# Qodex - Tail Logs
# Streams backend and frontend logs side by side in real time

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║         Qodex - Live Logs             ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${GREEN}[BACKEND]${NC}  backend log output"
echo -e "  ${CYAN}[FRONTEND]${NC} frontend log output"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop tailing${NC}"
echo "────────────────────────────────────────"
echo ""

# Check log files exist
if [ ! -f "$LOG_DIR/backend.log" ] && [ ! -f "$LOG_DIR/frontend.log" ]; then
    echo -e "${RED}No log files found. Run ./start.sh first.${NC}"
    exit 1
fi

# Tail both logs simultaneously, prefixing each line with source
tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" 2>/dev/null | awk '
    /^==> .*backend.log <==/ { source="BACKEND";  next }
    /^==> .*frontend.log <==/ { source="FRONTEND"; next }
    source == "BACKEND"  { print "\033[0;32m[BACKEND] \033[0m" $0 }
    source == "FRONTEND" { print "\033[0;36m[FRONTEND]\033[0m " $0 }
'
