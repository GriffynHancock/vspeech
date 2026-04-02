#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tests/test_api.sh  —  VectorSpeech API test harness
#
# Tests every authenticated and unauthenticated endpoint.
# Requires the server to be running on localhost:3000.
# Creates a fresh test account, runs all tests, then cleans up.
#
# Usage:
#   ./tests/test_api.sh                     # default port 3000
#   SERVER_PORT=3001 ./tests/test_api.sh    # custom port
#   ./tests/test_api.sh --no-cleanup        # keep test data after run
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PORT="${SERVER_PORT:-3000}"
BASE="http://localhost:$PORT"
CLEANUP=true
[[ "${1:-}" == "--no-cleanup" ]] && CLEANUP=false

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; CYN='\033[0;36m'; NC='\033[0m'

PASS=0; FAIL=0; SKIP=0
TOKEN=""
CONTACT_ID=""
CONV_ID=""
MSG_ID=""

# ─── Helpers ─────────────────────────────────────────────────────
pass() { echo -e "  ${GRN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }
skip() { echo -e "  ${YLW}·${NC} $1 (skipped)"; SKIP=$((SKIP+1)); }
section() { echo -e "\n${CYN}── $1 ──${NC}"; }

# Make a curl request and return status code + body
request() {
  local method="$1" url="$2" body="${3:-}"
  local extra_headers="${4:-}"
  
  local auth_header=""
  [[ -n "$TOKEN" ]] && auth_header="-H 'X-Session-Token: $TOKEN'"
  
  if [[ -n "$body" ]]; then
    eval curl -s -o /tmp/vs_resp -w '%{http_code}' \
      -X "$method" \
      -H "'Content-Type: application/json'" \
      $([[ -n "$TOKEN" ]] && echo "-H 'X-Session-Token: $TOKEN'") \
      $extra_headers \
      -d "'$body'" \
      "'${BASE}${url}'" > /tmp/vs_code 2>&1 || true
  else
    eval curl -s -o /tmp/vs_resp -w '%{http_code}' \
      -X "$method" \
      -H "'Content-Type: application/json'" \
      $([[ -n "$TOKEN" ]] && echo "-H 'X-Session-Token: $TOKEN'") \
      $extra_headers \
      "'${BASE}${url}'" > /tmp/vs_code 2>&1 || true
  fi
  
  cat /tmp/vs_code
}

# Simple curl wrapper
do_curl() {
  local method="$1"; local url="$2"; local body="${3:-}"; local code
  
  if [[ -n "$body" ]]; then
    code=$(curl -s -o /tmp/vs_resp -w '%{http_code}' \
      -X "$method" \
      -H "Content-Type: application/json" \
      ${TOKEN:+-H "X-Session-Token: $TOKEN"} \
      -d "$body" \
      "${BASE}${url}" 2>/dev/null) || code=0
  else
    code=$(curl -s -o /tmp/vs_resp -w '%{http_code}' \
      -X "$method" \
      -H "Content-Type: application/json" \
      ${TOKEN:+-H "X-Session-Token: $TOKEN"} \
      "${BASE}${url}" 2>/dev/null) || code=0
  fi
  
  echo "$code"
}

get_body() { cat /tmp/vs_resp 2>/dev/null || echo "{}"; }
get_field() { get_body | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null || echo ""; }

assert_code() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else
    fail "$label (expected $expected, got $actual: $(get_body | head -c 200))"; fi
}

assert_field() {
  local field="$1" expected="$2" label="$3"
  local actual; actual=$(get_field "$field")
  if [[ "$actual" == "$expected" ]]; then pass "$label"; else
    fail "$label (field '$field': expected '$expected', got '$actual')"; fi
}

# ─── Pre-flight ──────────────────────────────────────────────────
echo ""
echo -e "${CYN}VectorSpeech API Test Harness${NC}"
echo -e "Target: ${BASE}"
echo ""

# Check server is up
if ! curl -sf "${BASE}/api/auth/status" > /dev/null 2>&1; then
  echo -e "${RED}Server not reachable at $BASE${NC}"
  echo "Start it with: ./start.sh"
  exit 1
fi
echo -e "${GRN}Server is reachable${NC}"

# ─── 1. Auth endpoints ───────────────────────────────────────────
section "Auth — setup & login"

# Check status
CODE=$(do_curl GET /api/auth/status)
assert_code 200 "$CODE" "GET /api/auth/status returns 200"

SETUP=$(get_field "setup")
if [[ "$SETUP" == "True" || "$SETUP" == "true" ]]; then
  # Already set up — try to login with test password; if it fails, skip auth tests
  CODE=$(do_curl POST /api/auth/login '{"password":"test_harness_pw_XYZ123"}')
  if [[ "$CODE" == "200" ]]; then
    TOKEN=$(get_field "token")
    pass "Login with existing test password"
  else
    skip "Server already has a password set — cannot run full auth tests"
    skip "Run with a fresh auth.json for complete coverage"
    # Continue with what we have
    TOKEN=""
  fi
else
  # Fresh setup
  CODE=$(do_curl POST /api/auth/setup '{"password":"short"}')
  assert_code 400 "$CODE" "Setup rejects passwords < 8 chars"

  CODE=$(do_curl POST /api/auth/setup '{"password":"test_harness_pw_XYZ123"}')
  assert_code 200 "$CODE" "Setup creates password"
  TOKEN=$(get_field "token")
  [[ -n "$TOKEN" ]] && pass "Setup returns session token" || fail "Setup: no token in response"

  # Duplicate setup should fail
  CODE=$(do_curl POST /api/auth/setup '{"password":"test_harness_pw_XYZ123"}')
  assert_code 409 "$CODE" "Duplicate setup returns 409"

  # Bad login
  CODE=$(do_curl POST /api/auth/login '{"password":"wrongpassword"}')
  assert_code 401 "$CODE" "Wrong password returns 401"

  # Good login
  TOKEN=""
  CODE=$(do_curl POST /api/auth/login '{"password":"test_harness_pw_XYZ123"}')
  assert_code 200 "$CODE" "Correct password returns 200"
  TOKEN=$(get_field "token")
  [[ -n "$TOKEN" ]] && pass "Login returns session token" || fail "Login: no token"
fi

# Session check
CODE=$(do_curl GET /api/auth/check)
assert_code 200 "$CODE" "GET /api/auth/check with valid token"

# Unauthed request
OLD_TOKEN="$TOKEN"
TOKEN=""
CODE=$(do_curl GET /api/contacts)
assert_code 401 "$CODE" "Unauthenticated request returns 401"
TOKEN="$OLD_TOKEN"

# ─── 2. Settings ─────────────────────────────────────────────────
section "Settings"

CODE=$(do_curl GET /api/settings)
assert_code 200 "$CODE" "GET /api/settings"

CODE=$(do_curl PUT /api/settings '{"display_name":"TestUser","public_ip":""}')
assert_code 200 "$CODE" "PUT /api/settings"
assert_field "display_name" "TestUser" "Settings saved display_name"

# ─── 3. System info ──────────────────────────────────────────────
section "System"

CODE=$(do_curl GET /api/system)
assert_code 200 "$CODE" "GET /api/system"
IP=$(get_field "myIp")
[[ -n "$IP" ]] && pass "System returns myIp ($IP)" || fail "System: no myIp"

# ─── 4. Contacts CRUD ────────────────────────────────────────────
section "Contacts — CRUD"

# Create
CODE=$(do_curl POST /api/contacts '{"name":"TestPeer","ip":"192.0.2.1","port":3000}')
assert_code 200 "$CODE" "POST /api/contacts creates contact"
CONTACT_ID=$(get_field "id")
[[ -n "$CONTACT_ID" ]] && pass "New contact has ID ($CONTACT_ID)" || fail "Contact: no ID"

# Duplicate IP
CODE=$(do_curl POST /api/contacts '{"name":"Dup","ip":"192.0.2.1","port":3000}')
assert_code 409 "$CODE" "Duplicate IP returns 409"

# List
CODE=$(do_curl GET /api/contacts)
assert_code 200 "$CODE" "GET /api/contacts lists contacts"

# Update
CODE=$(do_curl PATCH "/api/contacts/$CONTACT_ID" '{"name":"UpdatedPeer"}')
assert_code 200 "$CODE" "PATCH /api/contacts/:id updates name"
assert_field "name" "UpdatedPeer" "Updated name reflected"

# ─── 5. Conversations ────────────────────────────────────────────
section "Conversations"

CODE=$(do_curl GET "/api/contacts/$CONTACT_ID/conversation")
assert_code 200 "$CODE" "GET /api/contacts/:id/conversation"
CONV_ID=$(get_field "id")
[[ -n "$CONV_ID" ]] && pass "Conversation has ID ($CONV_ID)" || fail "Conversation: no ID"

# Set key
CODE=$(do_curl PUT "/api/conversations/$CONV_ID/key" '{"key":"test-shared-key-phrase"}')
assert_code 200 "$CODE" "PUT /api/conversations/:id/key sets key"

# Set security level
CODE=$(do_curl PUT "/api/conversations/$CONV_ID/security" '{"level":"low"}')
assert_code 200 "$CODE" "PUT /api/conversations/:id/security"

# Set corpus (wikipedia = no-op)
CODE=$(do_curl PUT "/api/conversations/$CONV_ID/corpus" '{"corpus_type":"wikipedia","corpus_source":""}')
assert_code 200 "$CODE" "PUT /api/conversations/:id/corpus (wikipedia)"

# Message count (empty)
CODE=$(do_curl GET "/api/conversations/$CONV_ID/message-count")
assert_code 200 "$CODE" "GET /api/conversations/:id/message-count"
assert_field "count" "0" "Empty conversation has 0 messages"

# List messages (empty)
CODE=$(do_curl GET "/api/conversations/$CONV_ID/messages")
assert_code 200 "$CODE" "GET /api/conversations/:id/messages (empty)"

# ─── 6. Friend requests ──────────────────────────────────────────
section "Friend requests"

CODE=$(do_curl GET /api/friend-requests)
assert_code 200 "$CODE" "GET /api/friend-requests"

# Send to unreachable peer (expect 502, not 401)
CODE=$(do_curl POST /api/friend-requests/send '{"target_ip":"192.0.2.254","target_port":3000}')
[[ "$CODE" == "502" || "$CODE" == "504" || "$CODE" == "500" ]] \
  && pass "Send friend request to unreachable peer returns 5xx (not 401)" \
  || fail "Send friend request: unexpected code $CODE (body: $(get_body))"

# ─── 7. P2P endpoints (no auth) ──────────────────────────────────
section "P2P — unauthenticated inbound endpoints"

# Simulate incoming message
CODE=$(do_curl POST /api/p2p/receive \
  '{"vector":[1,2,3,4,5],"security_level":"low","corpus_type":"wikipedia","corpus_source":"","from_ip":"192.0.2.2","from_port":3000}')
assert_code 200 "$CODE" "POST /api/p2p/receive accepts inbound message"

# Simulate incoming friend request
FR_ID="test-req-$(date +%s)"
CODE=$(do_curl POST /api/p2p/friend-request \
  "{\"request_id\":\"$FR_ID\",\"from_name\":\"RemotePeer\",\"from_ip\":\"192.0.2.2\",\"from_port\":3000}")
assert_code 200 "$CODE" "POST /api/p2p/friend-request accepts inbound request"

# Accept it
PENDING=$(do_curl GET /api/friend-requests)
assert_code 200 "$PENDING" "GET /api/friend-requests after inbound request"

# Simulate acceptance callback
CODE=$(do_curl POST /api/p2p/friend-accepted \
  "{\"request_id\":\"$FR_ID\",\"my_name\":\"RemotePeer\",\"my_ip\":\"192.0.2.2\",\"my_port\":3000}")
assert_code 200 "$CODE" "POST /api/p2p/friend-accepted callback"

# ─── 8. Wiki index status ────────────────────────────────────────
section "Wiki index"

CODE=$(do_curl GET /api/wiki-index/status)
assert_code 200 "$CODE" "GET /api/wiki-index/status"
STATUS=$(get_field "status")
[[ -n "$STATUS" ]] && pass "Wiki index status: $STATUS" || fail "Wiki index: no status field"

# ─── 9. Auth — logout ────────────────────────────────────────────
section "Auth — logout"

CODE=$(do_curl POST /api/auth/logout '{}')
assert_code 200 "$CODE" "POST /api/auth/logout"

# Token should now be invalid
CODE=$(do_curl GET /api/contacts)
assert_code 401 "$CODE" "Request after logout returns 401"

# ─── Cleanup ─────────────────────────────────────────────────────
if [[ "$CLEANUP" == true && -n "$CONTACT_ID" && -n "$TOKEN" ]]; then
  # Re-login to clean up
  CODE=$(do_curl POST /api/auth/login '{"password":"test_harness_pw_XYZ123"}')
  if [[ "$CODE" == "200" ]]; then
    TOKEN=$(get_field "token")
    do_curl DELETE "/api/contacts/$CONTACT_ID" > /dev/null 2>&1 || true
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo "─────────────────────────────────────────"
echo -e "  Results: ${GRN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YLW}$SKIP skipped${NC}  / $TOTAL total"
echo "─────────────────────────────────────────"
echo ""

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
