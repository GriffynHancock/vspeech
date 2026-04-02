#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start.sh  –  VectorSpeech Chat launcher
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'
DIM='\033[2m'; NC='\033[0m'

step() { echo -e "\n${CYN}▶ $*${NC}"; }
ok()   { echo -e "${GRN}  ✓ $*${NC}"; }
warn() { echo -e "${YLW}  ⚠ $*${NC}"; }
info() { echo -e "${DIM}  · $*${NC}"; }
die()  {
  echo -e "\n${RED}✗ ERROR: $*${NC}\n"
  echo "  ──────────────────────────────────────────"
  echo "  Check logs/server.log for more detail."
  echo "  Run ./reset.sh --password if you forgot your password."
  echo "  Press Enter to close..."
  read -r _; exit 1
}

# ── Source shell profiles for PATH (bun, pyenv, etc.) ────────────
for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zprofile"; do
  [[ -f "$f" ]] && source "$f" 2>/dev/null || true
done
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# ── Resolve Python ────────────────────────────────────────────────
resolve_python() {
  if [[ -n "${PYTHON:-}" ]]; then echo "$PYTHON"; return; fi
  for p in \
    "$(pwd)/venv/bin/python3" \
    "$(pwd)/.venv/bin/python3" \
    "$(pwd)/venv/Scripts/python.exe" \
    "$(pwd)/.venv/Scripts/python.exe"
  do [[ -f "$p" ]] && { echo "$p"; return; }; done
  for c in python3 python; do
    command -v "$c" &>/dev/null && { echo "$c"; return; }
  done
  echo ""
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
mkdir -p output temp logs

echo ""
echo -e "  ${CYN}VectorSpeech Chat${NC}  —  startup checks"
echo -e "  Working dir: ${DIM}$(pwd)${NC}"
echo ""

# ── 1. Security state ─────────────────────────────────────────────
step "Security state"
if [[ -f auth.json ]]; then
  ok "auth.json exists — password already configured"
  info "Forget your password? Run: ./reset.sh --password"
else
  warn "auth.json not found — first-run setup will be required in the browser"
fi

if [[ -f vectorspeech.db ]]; then
  DB_SIZE=$(du -sh vectorspeech.db 2>/dev/null | cut -f1)
  ok "Database present ($DB_SIZE)"
else
  info "No database yet — will be created on first run"
fi

# ── 2. Python ─────────────────────────────────────────────────────
step "Python"
PY="$(resolve_python)"
[[ -z "$PY" ]] && die "No Python interpreter found.
Install Python 3:  sudo apt install python3 python3-pip python3-venv
Or set PYTHON=/path/to/python3 before running this script."

"$PY" --version &>/dev/null || die "Python binary not executable: $PY"
PYVER=$("$PY" --version 2>&1)
ok "Found: $PY  ($PYVER)"
export PYTHON="$PY"

# ── 3. Python dependencies (validate against requirements.txt) ────
step "Python dependencies"
MISSING_PY=()
if [[ -f requirements.txt ]]; then
  while IFS= read -r line; do
    # Skip comments and blank lines
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    # Extract package name (before >= <= == etc.)
    PKG=$(echo "$line" | sed 's/[><=!].*//' | tr '[:upper:]' '[:lower:]' | tr -d ' ')
    [[ -z "$PKG" ]] && continue
    if ! "$PY" -c "import importlib; importlib.import_module('${PKG//-/_}')" 2>/dev/null; then
      MISSING_PY+=("$line")
    fi
  done < requirements.txt
fi

if [[ ${#MISSING_PY[@]} -gt 0 ]]; then
  warn "Missing Python packages: ${MISSING_PY[*]}"
  echo "  Installing from requirements.txt…"
  "$PY" -m pip install -r requirements.txt --quiet 2>&1 | tail -5 || {
    die "pip install failed.
Run manually: $PY -m pip install -r requirements.txt
If using a venv: source venv/bin/activate && pip install -r requirements.txt"
  }
  # Re-verify
  for pkg in "${MISSING_PY[@]}"; do
    PKG=$(echo "$pkg" | sed 's/[><=!].*//' | tr '[:upper:]' '[:lower:]' | tr -d ' ')
    "$PY" -c "import importlib; importlib.import_module('${PKG//-/_}')" 2>/dev/null || \
      warn "Still can't import $PKG — check your Python environment"
  done
  ok "Dependencies installed"
else
  SPM_VER=$("$PY" -c "import sentencepiece; print(sentencepiece.__version__)" 2>/dev/null || echo "?")
  ok "sentencepiece==$SPM_VER  requests=ok"
fi

# ── 4. Bun ───────────────────────────────────────────────────────
step "Bun JavaScript runtime"
if ! command -v bun &>/dev/null; then
  die "Bun not found.
Install Bun:  curl -fsSL https://bun.sh/install | bash
Then restart terminal, or run:  source ~/.bashrc"
fi
BUN_VER=$(bun --version 2>&1)
ok "Bun $BUN_VER  ($(command -v bun))"

# ── 5. JS dependencies ────────────────────────────────────────────
step "JavaScript dependencies"
if [[ ! -d node_modules ]]; then
  echo "  Running bun install…"
  bun install 2>&1 || die "bun install failed. Check internet connection."
fi
ok "node_modules present"

# ── 6. Engine files ───────────────────────────────────────────────
step "Engine files"
ENGINE_OK=true
for f in vectorspeech_engine_fixed.py vectorspeech_corpus_helper.py; do
  if [[ -f "$f" ]]; then ok "$f"; else
    warn "$f not found — encoding/decoding will fail"; ENGINE_OK=false; fi
done

# ── 7. Wikipedia index status ─────────────────────────────────────
step "Wikipedia article index"
INDEX_STATUS="missing"
INDEX_FILE=""
INDEX_ARTICLES=0

for candidate in vital_articles_v4.json vital_articles_v3.json vital_articles_v1.json vital_articles_demo.json; do
  if [[ -f "$candidate" ]]; then
    # Quick check: count articles
    COUNT=$(python3 -c "
import json, sys
try:
  d = json.load(open('$candidate'))
  idx = d.get('index', [])
  meta = d.get('metadata', {})
  partial = meta.get('partial', False)
  is_demo = '$candidate' == 'vital_articles_demo.json'
  status = 'demo' if is_demo else ('partial' if partial else 'ready')
  print(f'{status}:{len(idx)}:{candidate}')
except Exception as e:
  print(f'error:0:$candidate')
" 2>/dev/null || echo "error:0:$candidate")
    INDEX_STATUS=$(echo "$COUNT" | cut -d: -f1)
    INDEX_ARTICLES=$(echo "$COUNT" | cut -d: -f2)
    INDEX_FILE=$(echo "$COUNT" | cut -d: -f3)
    break
  fi
done

case "$INDEX_STATUS" in
  ready)
    ok "Full index: $INDEX_FILE ($INDEX_ARTICLES articles)"
    ;;
  demo)
    warn "Demo index only: $INDEX_ARTICLES articles — LIMITED SECURITY"
    warn "Download a full index via Settings > Dataset in the browser UI"
    ;;
  partial)
    warn "Partial index: $INDEX_FILE ($INDEX_ARTICLES articles) — build was interrupted"
    warn "Resume build via Settings > Dataset in the browser UI"
    ;;
  missing|*)
    warn "No Wikipedia index found"
    warn "Using demo index fallback if present, otherwise encoding will fail"
    warn "Download an index via Settings > Dataset in the browser UI"
    ;;
esac

# ── 8. requirements.txt check ─────────────────────────────────────
step "Requirements file"
if [[ -f requirements.txt ]]; then
  ok "requirements.txt present"
else
  warn "requirements.txt not found — dependencies may not be reproducible"
fi

# ── Summary ───────────────────────────────────────────────────────
echo ""
echo "  ┌──────────────────────────────────────────────────┐"
if [[ "$ENGINE_OK" == true ]]; then
  echo -e "  │  ${GRN}All checks passed${NC}                                │"
else
  echo -e "  │  ${YLW}Started with warnings — see above${NC}                 │"
fi
echo "  └──────────────────────────────────────────────────┘"

# ── Launch ────────────────────────────────────────────────────────
MODE="${1:-dev}"

case "$MODE" in
  prod)
    step "Building client (production)…"
    bun run build 2>&1 || die "Vite build failed."
    ok "Build complete."
    echo ""
    echo -e "  ${CYN}Production server${NC}  →  http://localhost:${PORT:-3000}"
    bun run start 2>&1
    EXIT_CODE=$?
    [[ $EXIT_CODE -ne 0 ]] && die "Server exited with code $EXIT_CODE"
    ;;
  setup)
    ok "Setup checks complete. Run ./start.sh to start."
    ;;
  *)
    echo ""
    echo -e "  ${CYN}API server${NC}   →  http://localhost:3000"
    echo -e "  ${CYN}Dev UI${NC}       →  http://localhost:5173  ← open this"
    echo -e "  ${CYN}Log file${NC}     →  $(pwd)/logs/server.log"
    echo -e "  ${CYN}Python${NC}       →  $PY"
    echo -e "  ${CYN}Reset tool${NC}   →  ./reset.sh"
    echo ""
    echo "  (Ctrl+C to stop)"
    echo ""
    bun run dev 2>&1
    EXIT_CODE=$?
    if [[ $EXIT_CODE -ne 0 ]]; then
      echo -e "\n${RED}Server exited (code $EXIT_CODE)${NC}"
      echo "Check logs/server.log for details."
      echo "Press Enter to close..."
      read -r _
    fi
    ;;
esac
