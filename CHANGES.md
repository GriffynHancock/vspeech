# VectorSpeech — Bug Fix & Improvement Changelog

## Summary

This document details every issue reported and how it was resolved,
with file-by-file change descriptions and testing instructions.

---

## Fix 1: `auth.json` committed to repo → fresh-clone login lock

**Root cause:** `auth.json` (which contains the scrypt password verifier) was committed to git.
A fresh `git clone` found an existing auth file with someone else's password hash.
The server reported `setup: true`, the frontend showed a login screen, and
the new user could not log in (they don't know the committed password).

**Fixes applied:**
- `.gitignore` — added `auth.json`, `vectorspeech.db*`, `vital_articles_v*.json`, caches
- `reset.sh --password` — provides a documented path out of this situation
- `server/index.ts` — `GET /api/auth/status` still correct; setup flag now clearly explains state
- `src/components/LoginScreen.tsx` — shows "Forgot password? Run `./reset.sh --password`" hint

**Files changed:** `.gitignore`, `reset.sh` (new), `src/components/LoginScreen.tsx`

---

## Fix 2: "Unauthenticated" when sending friend requests on Linux/Mac

**Root cause:** When the Bun dev server restarted (file-watch trigger, or manual restart),
the in-memory `sessions` Map was wiped. The browser still held the old token in
`sessionStorage`. All subsequent authenticated requests returned 401.

The frontend had no 401 handler — errors were thrown and bubbled silently or
displayed as generic toast messages. The user saw "Unauthenticated" with no
indication that a re-login was needed.

**Fixes applied:**

### `src/App.tsx`
- `apiFetch()` now detects HTTP 401 and:
  1. Clears `sessionStorage` token
  2. Resets `_token` module variable
  3. Calls the registered `_onSessionExpired` handler
- `_onSessionExpired` sets a React state flag `sessionExpired=true`
- If `sessionExpired=true`, the login screen is shown immediately with an
  "expired" banner explaining the server restarted
- On page load, the saved token is **validated** against `/api/auth/check`
  before being trusted (was previously trusted blindly)

### `src/components/LoginScreen.tsx`
- Accepts `expired?: boolean` prop
- Shows a yellow banner when `expired=true`:
  `"Session expired — the server was restarted. Please log in again."`

### `server/index.ts`
- Added `GET /api/auth/check` endpoint — lightweight token validation probe
  (doesn't load contacts/messages, just verifies the session)
- `requireAuth()` now returns a typed object `{ ok: false, status: 401, body }` instead
  of a raw `Response`. This avoids Elysia's response-wrapping ambiguity.
- All protected routes use `if (f) { set.status = 401; return f.body; }` pattern —
  unambiguous in Elysia 1.x

**Files changed:** `src/App.tsx`, `src/components/LoginScreen.tsx`, `server/index.ts`

---

## Fix 3: WikiIndexPanel stuck state — can't go back after selecting L3/L4

**Root cause:** The `buildPhase` was not explicitly tracked. Once a build
completed, the UI showed a read-only checksum view with no escape path.
The "level selection" buttons were only rendered when `status !== 'ready'`,
so after a successful build the user was permanently stuck in the done view.

**Fixes applied:**

### `src/components/SettingsPanel.tsx` (Dataset tab, replaces WikiIndexPanel inline)
- Explicit `buildPhase: 'select' | 'building' | 'done'` state variable
- `'select'` phase: shows level buttons + Download button (always reachable)
- `'building'` phase: shows progress bar + log + Cancel button
- `'done'` phase: shows log + **"← Back"** button → sets `buildPhase = 'select'`
- Rebuild button shown in status box when `status === 'ready'` and `buildPhase === 'select'`
- Cancel correctly aborts the Python subprocess and returns to `'select'`

**Files changed:** `src/components/SettingsPanel.tsx` (Dataset tab), `server/index.ts`

---

## Fix 4: No option to set a custom/private dataset

**Root cause:** The corpus configuration was per-conversation only and not
documented clearly. There was no UI guidance on how to establish a shared
private corpus with a contact.

**Fixes applied:**

### `src/components/SettingsPanel.tsx` → Dataset tab
- Added a "Private dataset (advanced)" section explaining the workflow:
  1. Open conversation → click 🔑 key button → Corpus Source tab
  2. Set URL (or local path) for shared `.txt` files
  3. A SHA-256 fingerprint of all file contents is computed
  4. Share the fingerprint out-of-band with your contact to confirm match
  5. Both parties pivot to the private corpus automatically

### `src/components/KeyManager.tsx` (existing, unchanged)
- Already supports URL/local corpus with fingerprint display
- Now better surfaced via Settings → Dataset tab guidance

**Files changed:** `src/components/SettingsPanel.tsx`

---

## Fix 5: Dataset menu buried in settings — settings needs tabs

**Root cause:** The Settings modal had a single-page layout. The Wikipedia
index management required navigating to a separate WikiIndexPanel modal
(accessed via a status bar button or a settings button).

**Fixes applied:**

### `src/components/SettingsPanel.tsx` — full rewrite with 3 tabs
- **General tab**: display name, VPN/public IP
- **Dataset tab**: Wikipedia index status + level selection + build progress +
  custom corpus guidance — previously required a separate modal
- **Security tab**: encryption stack details, engine status, log file path,
  reset instructions

The separate `WikiIndexPanel.tsx` is now redundant (all its functionality is
in Settings → Dataset). The status bar no longer needs a direct "wiki:" link
since users know to go to ⚙ → Dataset.

**Files changed:** `src/components/SettingsPanel.tsx` (full rewrite), `src/App.tsx`

---

## Fix 6: No `requirements.txt`

**Root cause:** The Python dependencies (`sentencepiece`, `requests`) were
undocumented. Users pulling the repo had no pip install command to run.

**Fixes applied:**
- Added `requirements.txt` with pinned minimum versions
- `start.sh` reads `requirements.txt` and pip-installs any missing packages
  automatically on startup
- `tests/run_tests.sh` validates all requirements are importable

**Files changed:** `requirements.txt` (new), `start.sh`

---

## Fix 7: `start.sh` — no validation of prerequisites

**Root cause:** The old `start.sh` just ran `bun run dev` with no checks.
On a fresh clone, it would fail cryptically if Python, sentencepiece, Bun, or
the Wikipedia index were missing.

**Fixes applied:** Full `start.sh` rewrite with these checks in order:

1. **Security state** — whether `auth.json` exists (first-run vs existing user)
2. **Database** — whether `vectorspeech.db` exists and its size
3. **Python** — searches venv, `.venv`, `python3`, `python`; exits with
   install instructions if not found
4. **Python dependencies** — parses `requirements.txt` and pip-installs any
   missing packages automatically
5. **Bun** — checks PATH (sources `~/.bashrc` etc. first); exit with install URL
6. **JS dependencies** — runs `bun install` if `node_modules/` missing
7. **Engine files** — warns if `vectorspeech_engine_fixed.py` or
   `vectorspeech_corpus_helper.py` are missing
8. **Wikipedia index** — detects status (missing/demo/partial/ready) and
   prints article count with advice to download via Settings → Dataset
9. **Summary box** — green if all clear, yellow if warnings

**Files changed:** `start.sh`

---

## New: `reset.sh` — account / data reset utility

Provides a safe, documented way to recover from common failure states.

```
./reset.sh                # interactive menu
./reset.sh --password     # reset master login password only (keep messages)
./reset.sh --full         # wipe everything (warns twice)
./reset.sh --indexes      # delete Wikipedia indexes (keep demo)
```

All destructive operations require typing `YES` (not just pressing Enter).

**Files added:** `reset.sh`

---

## New: Test harnesses

### `tests/test_engine.py` — Python unit tests
- `TestHashChain`: determinism, independence across iterations, pure-Python formula
- `TestPageSelection`: reproducibility, security-level article counts
- `TestSecurityPresets`: validates constants, vocab size = 256
- `TestRoundTrip`: encode → decode recovers original; different iterations differ;
  wrong corpus fails to decode
- `TestCLIInterface`: CLI `--help` and missing-args exit codes
- `TestRequirementsFile`: `requirements.txt` exists and has correct deps
- `TestProjectStructure`: all required files present, `.gitignore` audit,
  `reset.sh` and `start.sh` are executable

Run with:
```bash
python3 tests/test_engine.py
python3 tests/test_engine.py -v    # verbose
```

### `tests/test_api.sh` — Bash integration tests
Tests every API endpoint with authentication flow:
- Auth: setup, bad-password, login, session check, logout, post-logout 401
- Settings: GET, PUT
- Contacts: create, duplicate-IP 409, list, PATCH
- Conversations: create, set key, security level, corpus, message count
- Messages: empty list, message-count endpoint
- Friend requests: GET, send to unreachable peer (502 not 401)
- P2P: inbound receive, inbound friend-request, accepted callback
- Wiki index: status endpoint

Run with server running:
```bash
./tests/test_api.sh
```

### `tests/run_tests.sh` — master test runner
```bash
./tests/run_tests.sh           # engine unit tests only
./tests/run_tests.sh --api     # + API tests (server must be running)
./tests/run_tests.sh --full    # all tests
```

---

## Security posture improvements

| Area | Before | After |
|------|--------|-------|
| `auth.json` in git | ❌ committed | ✅ `.gitignore`d |
| `vectorspeech.db` in git | ❌ committed | ✅ `.gitignore`d |
| Session expiry UX | silent 401 errors | re-login prompt with explanation |
| Token validation on page load | blindly trusted from sessionStorage | validated against `/api/auth/check` |
| `requireAuth` return pattern | returned `Response` object (Elysia ambiguity) | returns typed descriptor, caller sets `set.status` |
| Password reset path | undocumented | `./reset.sh --password` with clear instructions |
| Full wipe | no mechanism | `./reset.sh --full` (requires double confirmation) |
| Custom auth header | `X-Session-Token` only | also accepts `Authorization: Bearer` fallback |
| CORS | default | explicitly allows `X-Session-Token` in `allowedHeaders` |

---

## Applying these changes

```bash
# 1. Pull the repo
git pull

# 2. Remove the committed auth.json if it was in the old repo
git rm --cached auth.json 2>/dev/null || true
git rm --cached vectorspeech.db 2>/dev/null || true

# 3. Make scripts executable
chmod +x start.sh reset.sh tests/test_api.sh tests/run_tests.sh

# 4. Install Python deps
pip install -r requirements.txt

# 5. Start (will run all checks first)
./start.sh

# 6. Run tests (engine only, no server needed)
python3 tests/test_engine.py

# 7. Run API tests (requires server running)
./start.sh &
sleep 3
./tests/test_api.sh
```

If you had the old `auth.json` committed, existing users need to run:
```bash
./reset.sh --password    # then set a new password in the browser
```
