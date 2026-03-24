#!/bin/bash

# Qodex - Seed Knowledge Base
# Uploads all PDFs and documents from a local folder to the running backend
#
# Usage:
#   ./seed.sh                          # seeds from ./New_Syllabi (default)
#   ./seed.sh /path/to/folder          # seeds from a custom folder
#   ./seed.sh --dry-run                # preview what would be uploaded
#   ./seed.sh /path/to/folder --dry-run

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Parse args ───────────────────────────────
SEED_DIR="$SCRIPT_DIR/New_Syllabi"
DRY_RUN=false

for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
        DRY_RUN=true
    elif [ -d "$arg" ]; then
        SEED_DIR="$arg"
    fi
done

BACKEND_URL="http://localhost:8000"
ALLOWED_EXTENSIONS=("pdf" "docx" "txt" "md")

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║         Qodex - Seed Knowledge Base   ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ── Validate folder ──────────────────────────
if [ ! -d "$SEED_DIR" ]; then
    echo -e "${RED}Error: Seed folder not found: $SEED_DIR${NC}"
    echo "Usage: ./seed.sh [/path/to/folder] [--dry-run]"
    exit 1
fi

echo -e "  Folder:   $SEED_DIR"
$DRY_RUN && echo -e "  ${YELLOW}Mode:     Dry run — no files will be uploaded${NC}" || echo -e "  Mode:     Live upload"
echo ""

# ── Check backend is up ──────────────────────
if ! $DRY_RUN; then
    HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BACKEND_URL/health" 2>/dev/null)
    if [ "$HEALTH" != "200" ]; then
        echo -e "${RED}Error: Backend is not responding at $BACKEND_URL${NC}"
        echo "Run ./start.sh first."
        exit 1
    fi
    echo -e "${GREEN}✓ Backend is reachable${NC}"
    echo ""
fi

# ── Collect files ────────────────────────────
FILES=()
for ext in "${ALLOWED_EXTENSIONS[@]}"; do
    while IFS= read -r -d '' file; do
        FILES+=("$file")
    done < <(find "$SEED_DIR" -maxdepth 1 -type f -iname "*.${ext}" -print0 2>/dev/null)
done

TOTAL=${#FILES[@]}

if [ "$TOTAL" -eq 0 ]; then
    echo -e "${YELLOW}No supported files found in $SEED_DIR${NC}"
    echo "Supported formats: PDF, DOCX, TXT, MD"
    exit 0
fi

echo -e "Found ${BLUE}$TOTAL${NC} file(s) to upload:"
echo ""

# ── Upload loop ──────────────────────────────
SUCCESS=0
SKIPPED=0
FAILED=0

for filepath in "${FILES[@]}"; do
    filename=$(basename "$filepath")

    if $DRY_RUN; then
        echo -e "  ${YELLOW}[DRY RUN]${NC} $filename"
        continue
    fi

    # Check if already uploaded by querying document list
    EXISTING=$(curl -s --max-time 5 "$BACKEND_URL/api/documents" 2>/dev/null | \
        python3 -c "
import sys, json
try:
    docs = json.load(sys.stdin)
    names = [d.get('filename','') for d in docs]
    print('yes' if '$filename' in names else 'no')
except:
    print('no')
" 2>/dev/null)

    if [ "$EXISTING" = "yes" ]; then
        echo -e "  ${YELLOW}[SKIP]${NC}    $filename (already in KB)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    # Upload
    HTTP_CODE=$(curl -s -o /tmp/qodex_seed_response.json -w "%{http_code}" \
        --max-time 60 \
        -X POST "$BACKEND_URL/api/documents/upload" \
        -F "file=@$filepath" \
        2>/dev/null)

    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo -e "  ${GREEN}[OK]${NC}      $filename"
        SUCCESS=$((SUCCESS + 1))
    else
        ERROR=$(python3 -c "
import sys, json
try:
    data = json.load(open('/tmp/qodex_seed_response.json'))
    print(data.get('detail', 'Unknown error'))
except:
    print('HTTP $HTTP_CODE')
" 2>/dev/null)
        echo -e "  ${RED}[FAIL]${NC}    $filename — $ERROR"
        FAILED=$((FAILED + 1))
    fi

    # Small delay to avoid overwhelming the embedding API
    sleep 0.5
done

echo ""
echo "────────────────────────────────────────"

if $DRY_RUN; then
    echo -e "${YELLOW}Dry run complete — $TOTAL file(s) would be uploaded${NC}"
else
    echo -e "${GREEN}✓ Uploaded: $SUCCESS${NC}  ${YELLOW}Skipped: $SKIPPED${NC}  ${RED}Failed: $FAILED${NC}  Total: $TOTAL"
    if [ "$SUCCESS" -gt 0 ]; then
        echo ""
        echo -e "${GREEN}Knowledge base updated. New documents are now queryable.${NC}"
    fi
fi
echo ""
