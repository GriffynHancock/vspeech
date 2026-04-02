# VectorSpeech Test Suite - Quick Start Guide

## 🚀 TL;DR - Run Tests Now

### Basic Tests (No Server, 30 seconds)
```bash
cd /Users/gaura/Downloads/vectorspeech-chat
./tests/run_tests.sh
```

### All Tests (Server Required, 2-5 minutes)
```bash
# Terminal 1: Start server
./start.sh

# Terminal 2: Run tests
./tests/run_tests.sh --full
```

## 📦 First-Time Setup

### 1. Install Dependencies
```bash
# Basic dependencies (required)
pip install -r requirements.txt

# WebSocket tests (optional but recommended)
pip install websocket-client
```

### 2. Verify Installation
```bash
# Check Python and pytest
python3 --version
pytest --version

# Check if server starts
./start.sh &
sleep 5
curl http://localhost:3000/api/auth/status
pkill -f "bun.*server"
```

## 🎯 Common Test Scenarios

### Scenario 1: Quick Validation (Before Commit)
```bash
# Run basic unit tests (30 seconds)
./tests/run_tests.sh
```

### Scenario 2: API Changes (Server Required)
```bash
# Terminal 1
./start.sh

# Terminal 2
./tests/run_tests.sh --api --ux
```

### Scenario 3: Database Changes
```bash
./tests/run_tests.sh --db
```

### Scenario 4: Crypto/Message Changes
```bash
# Start server first
./start.sh &
sleep 5

# Run engine + E2E tests
./tests/run_tests.sh --e2e
```

### Scenario 5: Complete Validation (CI/CD)
```bash
# Start server
./start.sh &
sleep 10

# Run everything
./tests/run_tests.sh --full

# Cleanup
pkill -f "bun.*server"
```

## 📊 Test Categories Quick Reference

| Flag | Tests | Time | Server? | Purpose |
|------|-------|------|---------|---------|
| *(none)* | Engine, checks | 30s | No | Quick validation |
| `--wiki` | Wikipedia index | 1m | No | Index generation |
| `--e2e` | Message lifecycle | 2m | Yes | ≥90% fidelity |
| `--db` | Database | 30s | No | SQLite CRUD |
| `--auth` | Auth & encryption | 1m | Yes | Security |
| `--ws` | WebSocket | 30s | Yes | Real-time |
| `--ux` | UX flows | 1m | Yes | Workflows |
| `--api` | API endpoints | 1m | Yes | REST API |
| `--full` | **All tests** | **2-5m** | **Yes** | **Complete** |

## 🔧 Troubleshooting

### Issue: "Server not reachable"
```bash
# Check if server is running
curl http://localhost:3000/api/auth/status

# If not, start it
./start.sh &
sleep 5
```

### Issue: "Demo index not found"
```bash
# Check if demo index exists
ls -lh vital_articles_demo.json

# If missing, build it (included in repo)
python3 build_wiki_index.py --level 3
```

### Issue: "websocket-client not installed"
```bash
pip install websocket-client
```

### Issue: "pytest not found"
```bash
pip install pytest pytest-timeout
```

### Issue: Tests hang or timeout
```bash
# Kill hung processes
pkill -f pytest
pkill -f "bun.*server"

# Restart fresh
./start.sh &
sleep 10
./tests/run_tests.sh --full
```

## 📈 Expected Results

### Success Output
```
  VectorSpeech Comprehensive Test Suite

▶ Engine unit tests
  ✓ Engine tests passed

▶ Wikipedia index generation tests
  ✓ Wikipedia index tests passed

▶ End-to-end message lifecycle tests
  ✓ E2E message tests passed

▶ Database integration tests
  ✓ Database tests passed

▶ Authentication & encryption at rest tests
  ✓ Auth & encryption tests passed

▶ WebSocket & real-time communication tests
  ✓ WebSocket tests passed

▶ UX flow & state management tests
  ✓ UX flow tests passed

▶ API integration tests
  ✓ API tests passed

  ────────────────────────────────────────────
  Test suites:  8 passed  0 failed  (120s)
  ✓ All checks passed
```

### Failure Output
```
▶ End-to-end message lifecycle tests
  ✗ E2E message tests FAILED

  ────────────────────────────────────────────
  Test suites:  7 passed  1 failed  (95s)
  ✗ 1 check(s) failed — see output above
```

## 🎓 Test File Reference

| Test File | Purpose | Key Tests |
|-----------|---------|-----------|
| `test_engine.py` | Crypto engine | Hash chain, tokenization |
| `test_wiki_index.py` | Index generation | Schema, checksums, errors |
| `test_e2e_message.py` | Message flow | ≥90% fidelity, encode/decode |
| `test_db_integration.py` | Database | CRUD, constraints, transactions |
| `test_auth_encryption.py` | Security | Password, sessions, encryption |
| `test_websocket.py` | WebSocket | Connections, broadcasts |
| `test_ux_flow.py` | User flows | Workflows, navigation |
| `test_api.py` | REST API | Endpoints, auth, errors |

## 💡 Pro Tips

### Run Specific Test
```bash
# Single file
pytest tests/test_wiki_index.py -v

# Single class
pytest tests/test_e2e_message.py::TestE2EMessageLifecycle -v

# Single test
pytest tests/test_db_integration.py::TestDatabaseSchema::test_required_tables_exist -v

# Pattern matching
pytest tests/ -k "encryption" -v
```

### Verbose Output
```bash
# Show more details
pytest tests/test_engine.py -vv --tb=long

# Show print statements
pytest tests/test_api.py -v -s
```

### Coverage Report
```bash
# Generate HTML coverage report
pytest tests/ --cov=. --cov-report=html

# Open in browser
open htmlcov/index.html
```

### Fast Iteration
```bash
# Run only failed tests from last run
pytest tests/ --lf

# Stop on first failure
pytest tests/ -x

# Run tests in parallel (if pytest-xdist installed)
pytest tests/ -n auto
```

## 📚 Documentation

- **Detailed Guide:** `tests/README.md` (comprehensive documentation)
- **Implementation Summary:** `tests/TEST_SUMMARY.md` (coverage report)
- **This File:** `tests/QUICK_START.md` (quick reference)

## ✅ Pre-Commit Checklist

Before committing code changes:

1. ✅ Run basic unit tests: `./tests/run_tests.sh`
2. ✅ If server code changed: `./tests/run_tests.sh --api --ux`
3. ✅ If database schema changed: `./tests/run_tests.sh --db`
4. ✅ If crypto/engine changed: `./tests/run_tests.sh --e2e`
5. ✅ All tests passing before push

## 🚀 CI/CD Integration

```yaml
# GitHub Actions example
- run: pip install -r requirements.txt
- run: ./tests/run_tests.sh  # Basic tests
- run: ./start.sh &
- run: sleep 10
- run: ./tests/run_tests.sh --full  # Integration tests
```

## 🎯 Success Criteria

Tests are passing when:
- ✅ All engine unit tests pass (hash chain, tokenization)
- ✅ Wikipedia index tests validate structure
- ✅ **E2E message tests achieve ≥90% fidelity**
- ✅ Database tests validate schema and CRUD
- ✅ Auth tests verify security (scrypt, AES-256-GCM)
- ✅ WebSocket tests confirm real-time updates
- ✅ UX tests validate workflows
- ✅ API tests cover all endpoints

---

**Need Help?** See `tests/README.md` for detailed documentation.

**Found a Bug?** Check `tests/TEST_SUMMARY.md` for coverage details.

**Quick Test:** `./tests/run_tests.sh` (30 seconds, no server needed)
