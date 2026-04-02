#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# tests/run_tests.sh  –  VectorSpeech test runner
#
# Usage:
#   ./tests/run_tests.sh           # engine unit tests only (no server needed)
#   ./tests/run_tests.sh --api     # + API integration tests (server must be running)
#   ./tests/run_tests.sh --full    # all tests
# ─────────────────────────────────────────────────────────────────

set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'
DIM='\033[2m'; NC='\033[0m'

ok()    { echo -e "${GRN}  ✓ $*${NC}"; }
fail()  { echo -e "${RED}  ✗ $*${NC}"; }
warn()  { echo -e "${YLW}  ⚠ $*${NC}"; }
step()  { echo -e "\n${CYN}▶ $*${NC}"; }
info()  { echo -e "${DIM}  · $*${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

RUN_API=false
RUN_FULL=false

for arg in "$@"; do
  case "$arg" in
    --api)  RUN_API=true ;;
    --full) RUN_FULL=true; RUN_API=true ;;
    --help|-h)
      echo "Usage: $0 [--api] [--full]"
      echo "  (no flag)  Engine unit tests only (no server needed)"
      echo "  --api      + API integration tests (server must be on :3000)"
      echo "  --full     All tests"
      exit 0 ;;
  esac
done

PASS=0; FAIL=0
START_TIME=$SECONDS

echo ""
echo -e "  ${CYN}VectorSpeech Test Suite${NC}"
echo -e "  Working dir: ${DIM}$(pwd)${NC}"
echo ""

# ── Resolve Python ──────────────────────────────────────────────
PY=""
for p in "$(pwd)/venv/bin/python3" python3 python; do
  command -v "$p" &>/dev/null && { PY="$p"; break; } 2>/dev/null || true
  [[ -f "$p" ]] && { PY="$p"; break; }
done

[[ -z "$PY" ]] && { fail "No Python interpreter found. Install python3."; exit 1; }
info "Python: $PY ($("$PY" --version 2>&1))"

# ── Check pytest ─────────────────────────────────────────────────
if ! "$PY" -m pytest --version &>/dev/null; then
  warn "pytest not found — installing..."
  "$PY" -m pip install pytest pytest-timeout requests --quiet || {
    fail "Cannot install pytest"; exit 1;
  }
fi
info "pytest: $("$PY" -m pytest --version 2>&1 | head -1)"

# ── Engine unit tests ─────────────────────────────────────────────
step "Engine unit tests (no network required)"

# Verify engine exists
if [[ ! -f vectorspeech_engine_fixed.py ]]; then
  warn "vectorspeech_engine_fixed.py not found — skipping engine tests"
else
  if "$PY" -m pytest tests/test_engine.py -v \
      --tb=short \
      --timeout=60 \
      --no-header \
      2>&1; then
    ok "Engine tests passed"
    PASS=$((PASS + 1))
  else
    fail "Engine tests FAILED"
    FAIL=$((FAIL + 1))
  fi
fi

# ── Dependency check ─────────────────────────────────────────────
step "Dependency check"

if [[ -f requirements.txt ]]; then
  MISSING=()
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    PKG=$(echo "$line" | sed 's/[><=!].*//' | tr '[:upper:]' '[:lower:]' | tr -d ' ')
    [[ -z "$PKG" ]] && continue
    if ! "$PY" -c "import importlib; importlib.import_module('${PKG//-/_}')" 2>/dev/null; then
      MISSING+=("$PKG")
    fi
  done < requirements.txt

  if [[ ${#MISSING[@]} -eq 0 ]]; then
    ok "All Python requirements satisfied"
    PASS=$((PASS + 1))
  else
    fail "Missing packages: ${MISSING[*]}"
    FAIL=$((FAIL + 1))
  fi
else
  warn "requirements.txt not found"
fi

# ── Wiki index check ─────────────────────────────────────────────
step "Wikipedia index check"

if [[ -f vital_articles_demo.json ]]; then
  COUNT=$("$PY" -c "import json; d=json.load(open('vital_articles_demo.json')); print(len(d.get('index',[])))" 2>/dev/null || echo 0)
  if [[ "$COUNT" -ge 20 ]]; then
    ok "Demo index present ($COUNT articles)"
    PASS=$((PASS + 1))
  else
    fail "Demo index present but has only $COUNT articles (need ≥ 20)"
    FAIL=$((FAIL + 1))
  fi
else
  fail "vital_articles_demo.json not found (required fallback)"
  FAIL=$((FAIL + 1))
fi

# ── .gitignore check ─────────────────────────────────────────────
step "Security: .gitignore audit"

GITIGNORE_ISSUES=()
[[ -f auth.json ]] && GITIGNORE_ISSUES+=("auth.json committed to repo — contains password hash!")

if [[ -f .gitignore ]]; then
  grep -q 'auth\.json' .gitignore || GITIGNORE_ISSUES+=("auth.json not in .gitignore")
  grep -q 'vital_articles_v\[' .gitignore || GITIGNORE_ISSUES+=("full wiki indexes not in .gitignore")
  grep -q '\.db' .gitignore || GITIGNORE_ISSUES+=("*.db not in .gitignore")
fi

if [[ ${#GITIGNORE_ISSUES[@]} -eq 0 ]]; then
  ok ".gitignore looks correct"
  PASS=$((PASS + 1))
else
  for issue in "${GITIGNORE_ISSUES[@]}"; do
    fail "$issue"
  done
  FAIL=$((FAIL + 1))
fi

# ── API tests (optional) ─────────────────────────────────────────
if [[ "$RUN_API" == true ]]; then
  step "API integration tests"

  # Check if server is reachable
  if curl -sf http://localhost:3000/api/auth/status &>/dev/null; then
    if "$PY" -m pytest tests/test_api.py -v \
        --tb=short \
        --timeout=30 \
        --no-header \
        2>&1; then
      ok "API tests passed"
      PASS=$((PASS + 1))
    else
      fail "API tests FAILED"
      FAIL=$((FAIL + 1))
    fi
  else
    warn "Server not running at :3000 — skipping API tests"
    warn "Start with: ./start.sh &  then re-run with --api"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────
ELAPSED=$((SECONDS - START_TIME))
echo ""
echo "  ────────────────────────────────────────────"
echo -e "  Test suites:  ${GRN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  (${ELAPSED}s)"

if [[ $FAIL -eq 0 ]]; then
  echo -e "  ${GRN}✓ All checks passed${NC}"
  echo ""
  exit 0
else
  echo -e "  ${RED}✗ $FAIL check(s) failed — see output above${NC}"
  echo ""
  exit 1
fi
