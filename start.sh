#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# start.sh  –  VectorSpeech Chat launcher
# ─────────────────────────────────────────────────────────────

# !! NO set -euo pipefail here — we handle errors explicitly
# !! so the terminal stays open long enough to read the message.

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; NC='\033[0m'

step() { echo -e "\n${CYN}▶ $*${NC}"; }
ok()   { echo -e "${GRN}  ✓ $*${NC}"; }
warn() { echo -e "${YLW}  ⚠ $*${NC}"; }
die()  {
  echo -e "\n${RED}✗ ERROR: $*${NC}\n"
  echo "──────────────────────────────────────────"
  echo "Check logs/server.log for more detail."
  echo "Press Enter to close this window..."
  read -r _
  exit 1
}

# ── Source shell profiles to pick up PATH additions (like ~/.bun/bin) ──
# This matters when launched from a file manager or desktop shortcut
for f in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  # shellcheck disable=SC1090
  [[ -f "$f" ]] && source "$f" 2>/dev/null || true
done

# ── Bun: add common install locations to PATH ──────────────────
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# ── Resolve Python ─────────────────────────────────────────────
resolve_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    echo "$PYTHON"; return
  fi
  for p in \
    "$(pwd)/venv/bin/python3" \
    "$(pwd)/.venv/bin/python3" \
    "$(pwd)/venv/Scripts/python.exe" \
    "$(pwd)/.venv/Scripts/python.exe"
  do
    [[ -f "$p" ]] && { echo "$p"; return; }
  done
  for candidate in python3 python; do
    command -v "$candidate" &>/dev/null && { echo "$candidate"; return; }
  done
  echo ""
}

# ── Ensure we're running from the project root ─────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
echo "Working directory: $(pwd)"

mkdir -p output temp logs

# ── Check Python ───────────────────────────────────────────────
step "Checking Python…"
PY="$(resolve_python)"
[[ -z "$PY" ]] && die "No Python interpreter found.
Install Python 3: sudo apt install python3
Or set PYTHON=/path/to/python3 before running this script."

# Verify the binary actually works
if ! "$PY" --version &>/dev/null; then
  die "Python binary not executable: $PY"
fi
PYVER=$("$PY" --version 2>&1)
ok "Found Python: $PY  ($PYVER)"
export PYTHON="$PY"

# ── Check Python deps ──────────────────────────────────────────
step "Checking Python dependencies…"
if ! "$PY" -c "import sentencepiece, requests" 2>/dev/null; then
  warn "Missing sentencepiece or requests — attempting install…"
  "$PY" -m pip install sentencepiece requests 2>&1 | tail -5 || {
    die "pip install failed.
Run manually:  $PY -m pip install sentencepiece requests
If using a venv, activate it first:  source venv/bin/activate"
  }
  # Re-verify
  "$PY" -c "import sentencepiece, requests" 2>/dev/null || \
    die "Packages installed but still not importable. Check your Python environment."
  ok "Python deps installed"
else
  SPM_VER=$("$PY" -c "import sentencepiece; print(sentencepiece.__version__)" 2>/dev/null || echo "?")
  ok "sentencepiece==$SPM_VER  requests=ok"
fi

# ── Check Bun ──────────────────────────────────────────────────
step "Checking Bun…"
if ! command -v bun &>/dev/null; then
  die "Bun not found on PATH.
Install Bun:   curl -fsSL https://bun.sh/install | bash
Then restart your terminal (or run:  source ~/.bashrc)
Or re-run this script — it will find ~/.bun/bin automatically next time."
fi
BUN_VER=$(bun --version 2>&1)
ok "Bun $BUN_VER  ($(command -v bun))"

# ── Check engine files ─────────────────────────────────────────
step "Checking engine files…"
if [[ ! -f "vectorspeech_engine_fixed.py" ]]; then
  warn "vectorspeech_engine_fixed.py not found in $(pwd)"
  warn "Encoding/decoding will fail until it is placed here."
else
  ok "vectorspeech_engine_fixed.py found"
fi
if [[ ! -f "vital_articles_demo.json" ]]; then
  warn "vital_articles_demo.json not found in $(pwd)"
else
  ok "vital_articles_demo.json found"
fi

# ── Install JS deps ────────────────────────────────────────────
step "Checking JS dependencies…"
if [[ ! -d node_modules ]]; then
  echo "  Running bun install…"
  bun install 2>&1 || die "bun install failed. Check your internet connection."
fi
ok "node_modules present"

# ── Launch ─────────────────────────────────────────────────────
MODE="${1:-dev}"

case "$MODE" in
  setup)
    echo ""
    ok "Setup complete!"
    echo ""
    echo "  Run the app:   ./start.sh"
    echo "  Log file:      logs/server.log"
    echo "  Python used:   $PY"
    echo ""
    ;;

  prod)
    step "Building client (production)…"
    bun run build 2>&1 || die "Vite build failed — check output above."
    ok "Build complete."
    echo ""
    echo "  Starting production server on port ${PORT:-3000}…"
    echo "  Log file: logs/server.log"
    echo ""
    # Don't use exec — keep shell alive so errors are visible
    bun run start 2>&1
    EXIT_CODE=$?
    if [[ $EXIT_CODE -ne 0 ]]; then
      echo ""
      die "Server exited with code $EXIT_CODE"
    fi
    ;;

  *)
    echo ""
    echo "  ┌─────────────────────────────────────────┐"
    echo "  │  Starting VectorSpeech Chat (dev mode)  │"
    echo "  └─────────────────────────────────────────┘"
    echo ""
    echo -e "  ${CYN}API server${NC}   →  http://localhost:3000"
    echo -e "  ${CYN}Dev UI${NC}       →  http://localhost:5173  ← open this"
    echo -e "  ${CYN}Log file${NC}     →  $(pwd)/logs/server.log"
    echo -e "  ${CYN}Python${NC}       →  $PY"
    echo ""
    echo "  (Press Ctrl+C to stop)"
    echo ""
    # Run directly (not exec) so the shell stays alive after stop/crash
    bun run dev 2>&1
    EXIT_CODE=$?
    if [[ $EXIT_CODE -ne 0 ]]; then
      echo ""
      echo -e "${RED}Server exited with code $EXIT_CODE${NC}"
      echo "Check logs/server.log for details."
      echo ""
      echo "Press Enter to close..."
      read -r _
    fi
    ;;
esac
