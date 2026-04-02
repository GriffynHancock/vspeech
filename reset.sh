#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# reset.sh  –  VectorSpeech Chat reset utility
#
# Modes:
#   ./reset.sh              — interactive menu
#   ./reset.sh --password   — reset only the master password (keep messages)
#   ./reset.sh --full       — wipe everything (messages, contacts, keys, password)
#   ./reset.sh --indexes    — delete Wikipedia indexes (forces re-download)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'
BLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ok()   { echo -e "${GRN}  ✓ $*${NC}"; }
warn() { echo -e "${YLW}  ⚠ $*${NC}"; }
info() { echo -e "${CYN}  · $*${NC}"; }
err()  { echo -e "${RED}  ✗ $*${NC}"; }

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
confirm() {
  local prompt="$1"
  local answer
  echo -e "${YLW}${BLD}  $prompt${NC}"
  printf "  Type YES to continue: "
  read -r answer
  [[ "$answer" == "YES" ]]
}

reset_password() {
  echo ""
  warn "PASSWORD RESET"
  warn "This deletes auth.json. The master password will be cleared."
  warn "Your messages and contacts stay encrypted in the database."
  warn "However, YOU WILL NOT BE ABLE TO READ THEM until you set a new"
  warn "password AND re-enter the same encryption key phrase you used before."
  warn "(The key phrase is what actually encrypts your data — not the login password.)"
  echo ""
  if confirm "Delete auth.json and reset the master login password?"; then
    rm -f auth.json
    ok "auth.json deleted"
    echo ""
    info "Next steps:"
    info "  1. Start the app:  ./start.sh"
    info "  2. Set a new master password"
    info "  3. In each conversation, open Key Manager and re-enter your shared key phrase"
    info "     This re-derives the encryption key and decrypts your stored messages."
    echo ""
  else
    info "Cancelled."
  fi
}

reset_indexes() {
  echo ""
  warn "This will delete all downloaded Wikipedia indexes."
  warn "The demo index (vital_articles_demo.json) will be kept."
  warn "You will need to re-download the full index to use full security."
  echo ""
  if confirm "Delete Wikipedia index files?"; then
    rm -f vital_articles_v[0-9]*.json
    rm -f vital_articles_v*.titles_cache.json
    ok "Indexes deleted (demo kept)"
  else
    info "Cancelled."
  fi
}

reset_full() {
  echo ""
  echo -e "${RED}${BLD}  ╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}${BLD}  ║              ⚠  FULL WIPE WARNING  ⚠                ║${NC}"
  echo -e "${RED}${BLD}  ╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  warn "This will permanently delete:"
  warn "  • vectorspeech.db    — ALL contacts, conversations, and messages"
  warn "  • auth.json          — master login password"
  warn "  • output/            — encoded message JSON files"
  warn "  • temp/              — temporary tokenizer files"
  warn "  • Wikipedia indexes  — will need re-download"
  echo ""
  warn "This action CANNOT be undone. All encrypted messages will be lost."
  echo ""
  if confirm "PERMANENTLY DELETE ALL DATA?"; then
    echo ""
    warn "Are you really sure? This deletes EVERYTHING."
    if confirm "Yes, wipe all VectorSpeech data permanently"; then
      rm -f auth.json
      rm -f vectorspeech.db vectorspeech.db-shm vectorspeech.db-wal
      rm -rf output/
      rm -rf temp/
      rm -f vital_articles_v[0-9]*.json
      rm -f vital_articles_v*.titles_cache.json
      mkdir -p output temp logs
      ok "All data wiped"
      ok "App is now in factory-fresh state"
      info "Run ./start.sh to set a new password and start fresh"
    else
      info "Cancelled."
    fi
  else
    info "Cancelled."
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYN}${BLD}  VectorSpeech Reset Utility${NC}"
echo -e "  Working dir: $(pwd)"
echo ""

case "${1:-}" in
  --password)
    reset_password
    ;;
  --full)
    reset_full
    ;;
  --indexes)
    reset_indexes
    ;;
  --help|-h)
    echo "Usage: $0 [option]"
    echo ""
    echo "  (no option)   Interactive menu"
    echo "  --password    Reset master login password only (keeps messages)"
    echo "  --full        Wipe all data (contacts, messages, password, indexes)"
    echo "  --indexes     Delete Wikipedia indexes (re-download required)"
    echo ""
    ;;
  *)
    # Interactive menu
    echo "  Choose a reset option:"
    echo ""
    echo "  [1] Reset master password only"
    echo "      → Keeps all messages/contacts; lets you set a new login password."
    echo "      → Use this if you forgot your password."
    echo ""
    echo "  [2] Delete Wikipedia indexes"
    echo "      → Forces re-download of the full index on next use."
    echo "      → Use this if the index is corrupt or you want a fresher snapshot."
    echo ""
    echo "  [3] Full wipe — DELETE EVERYTHING"
    echo "      → Removes all messages, contacts, keys, and indexes."
    echo "      → Use this to hand off the machine or start completely fresh."
    echo ""
    echo "  [q] Quit"
    echo ""
    printf "  Choice: "
    read -r choice

    case "$choice" in
      1) reset_password ;;
      2) reset_indexes  ;;
      3) reset_full     ;;
      q|Q) info "Quit." ;;
      *) err "Unknown option: $choice" ;;
    esac
    ;;
esac

echo ""
