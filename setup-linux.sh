#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# setup-linux.sh  –  First-time setup for Kali / Debian / Ubuntu
#
# Run this ONCE on the Linux machine before using start.sh:
#   chmod +x setup-linux.sh && ./setup-linux.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GRN}✓ $*${NC}"; }
warn() { echo -e "${YLW}⚠ $*${NC}"; }
step() { echo -e "\n${CYN}━━ $* ━━${NC}"; }
fail() { echo -e "${RED}✗ $*${NC}"; exit 1; }

# Must run from the project directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  VectorSpeech Chat — Linux first-time setup"
echo "  Working dir: $(pwd)"
echo ""

# ── System packages ───────────────────────────────────────────
step "System packages"
if command -v apt-get &>/dev/null; then
  echo "  Updating package lists…"
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    unzip \
    build-essential
  ok "System packages installed"
else
  warn "apt-get not found — skipping system package install"
  warn "Ensure python3, pip3, and curl are installed manually"
fi

# ── Python venv ───────────────────────────────────────────────
step "Python virtual environment"
if [[ ! -d venv ]]; then
  echo "  Creating venv/…"
  python3 -m venv venv
  ok "venv created"
else
  ok "venv already exists"
fi

VENV_PY="$(pwd)/venv/bin/python3"
echo "  Installing Python dependencies into venv…"
"$VENV_PY" -m pip install --upgrade pip --quiet
"$VENV_PY" -m pip install sentencepiece requests --quiet
ok "sentencepiece + requests installed"

# Verify
"$VENV_PY" -c "import sentencepiece, requests; print('  Import OK')"

# ── Bun ───────────────────────────────────────────────────────
step "Bun JavaScript runtime"
if command -v bun &>/dev/null || [[ -f "$HOME/.bun/bin/bun" ]]; then
  BUN_BIN="${HOME}/.bun/bin/bun"
  [[ ! -f "$BUN_BIN" ]] && BUN_BIN="$(command -v bun)"
  ok "Bun already installed: $("$BUN_BIN" --version)"
else
  echo "  Downloading Bun…"
  curl -fsSL https://bun.sh/install | bash
  ok "Bun installed to ~/.bun/bin/bun"
fi

# Add bun to PATH for this session
export PATH="$HOME/.bun/bin:$PATH"

if ! command -v bun &>/dev/null; then
  fail "Bun installed but not on PATH. Run:  source ~/.bashrc  then re-run start.sh"
fi
ok "Bun $(bun --version) ready"

# ── JS dependencies ───────────────────────────────────────────
step "JavaScript dependencies"
bun install
ok "node_modules installed"

# ── Directories ───────────────────────────────────────────────
mkdir -p output temp logs
ok "output/ temp/ logs/ created"

# ── Engine files ──────────────────────────────────────────────
step "Engine file check"
MISSING=0
for f in vectorspeech_engine_fixed.py vital_articles_demo.json; do
  if [[ -f "$f" ]]; then
    ok "$f found"
  else
    warn "$f NOT found — copy it here before sending/receiving messages"
    MISSING=$((MISSING + 1))
  fi
done

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║         Setup complete!                   ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""
echo "  Python venv:  $(pwd)/venv/bin/python3"
echo "  Bun:          $(command -v bun)  ($(bun --version))"

if [[ $MISSING -gt 0 ]]; then
  echo ""
  echo -e "  ${YLW}⚠ $MISSING engine file(s) missing — see warnings above${NC}"
fi

echo ""
echo "  To start the app:"
echo "    ./start.sh"
echo ""
echo "  The app uses the local venv automatically."
echo "  Log file will be at: $(pwd)/logs/server.log"
echo ""
