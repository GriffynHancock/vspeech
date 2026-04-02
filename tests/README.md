# VectorSpeech Comprehensive Test Suite

This directory contains a comprehensive test suite for the VectorSpeech secure messaging application, covering all critical functionality from Wikipedia index generation to end-to-end encrypted message delivery.

## 📋 Overview

The test suite is organized into the following categories:

1. **Engine Unit Tests** (`test_engine.py`) - Core cryptographic engine functionality
2. **Wikipedia Index Tests** (`test_wiki_index.py`) - Index generation and validation (BLOCKING for tokenization)
3. **End-to-End Message Tests** (`test_e2e_message.py`) - Complete message lifecycle with ≥90% fidelity validation
4. **Database Integration Tests** (`test_db_integration.py`) - SQLite CRUD operations and data integrity
5. **Authentication & Encryption Tests** (`test_auth_encryption.py`) - Password hashing, session management, encryption at rest
6. **WebSocket Tests** (`test_websocket.py`) - Real-time communication and broadcasting
7. **UX Flow Tests** (`test_ux_flow.py`) - User workflows and state management
8. **API Integration Tests** (`test_api.py`) - REST API endpoint testing

## 🚀 Quick Start

### Basic Unit Tests (No Server Required)
```bash
./tests/run_tests.sh
```

### API Integration Tests (Server Required)
```bash
# Start server first
./start.sh &

# Run API tests
./tests/run_tests.sh --api
```

### Complete Test Suite
```bash
# Start server
./start.sh &

# Run all tests
./tests/run_tests.sh --full
```

## 📊 Test Categories

### Engine Unit Tests
**File:** `test_engine.py`
**Requirements:** Wikipedia index (demo or full), SentencePiece
**Run:** `./tests/run_tests.sh` (default)

Tests:
- Hash chain generation (SHA-256, forward secrecy)
- Page selection (deterministic, security level-based)
- Tokenizer encode/decode round-trip
- Word extraction from Wikipedia content
- Security constraints validation
- Index loading and validation

### Wikipedia Index Generation Tests ⭐ PRIORITY
**File:** `test_wiki_index.py`
**Requirements:** Network access, `build_wiki_index.py`
**Run:** `./tests/run_tests.sh --wiki`

**CRITICAL:** These tests validate the Wikipedia index generation process, which is BLOCKING for tokenization tests.

Tests:
- Index structure validation (metadata, checksums, article counts)
- Checksum verification (SHA-256 integrity)
- Article count validation for each level (1-5)
- Mock Wikipedia API responses
- Error handling (network failures, invalid data, malformed responses)
- Resume functionality (partial builds)
- Edge cases (Unicode titles, special characters, very long titles)
- Performance benchmarks

**Coverage:** Index generation, validation, error handling, resumability

### End-to-End Message Lifecycle Tests ⭐ PRIORITY
**File:** `test_e2e_message.py`
**Requirements:** Server running, Wikipedia index loaded
**Run:** `./tests/run_tests.sh --e2e`

Tests:
- Complete message flow: Create → Encrypt → Send → Store → Retrieve → Decrypt
- **≥90% message reconstruction fidelity** validation
- Short messages (1-50 chars)
- Medium messages (100-200 chars)
- Long messages (500+ chars)
- Different iterations produce different encodings
- Wrong seed cannot decode (security validation)
- Different security levels (low, medium, high)
- Message fidelity with punctuation, numbers, special characters
- API integration (send/receive via REST endpoints)
- Message status transitions (queued → encoding → sending → delivered/failed)
- Database persistence

**Coverage:** Encryption, decoding, fidelity, API integration, database persistence

### Database Integration Tests
**File:** `test_db_integration.py`
**Requirements:** SQLite3
**Run:** `./tests/run_tests.sh --db`

Tests:
- Schema validation (all required tables and columns)
- Foreign key constraints and cascades
- Contact CRUD operations
- Conversation management (key updates, iteration counters)
- Message CRUD (sent/received, status updates)
- Settings table (key-value persistence)
- Friend requests (insert, accept, reject, unique constraints)
- Transaction rollback on errors
- Data integrity constraints (CHECK constraints, direction validation)
- Index creation verification

**Coverage:** Database schema, CRUD operations, integrity constraints, cascading deletes

### Authentication & Encryption at Rest Tests
**File:** `test_auth_encryption.py`
**Requirements:** Server running
**Run:** `./tests/run_tests.sh --auth`

Tests:
- Password hashing with scrypt (N=2^16, r=8, p=1)
- `auth.json` structure validation
- Minimum password length (8 characters)
- Session token generation (UUID format)
- Token-based authentication
- Session invalidation (logout)
- Session count tracking
- Database field encryption (AES-256-GCM)
- Encrypted field format validation (enc:v1:iv:tag:ciphertext)
- IV randomness (different ciphertexts for same plaintext)
- Timing attack resistance (constant-time password verification)
- Security edge cases (SQL injection, very long passwords, Unicode)

**Coverage:** Password security, session management, encryption at rest, timing attacks

### WebSocket & Real-time Communication Tests
**File:** `test_websocket.py`
**Requirements:** Server running, `websocket-client` package
**Run:** `./tests/run_tests.sh --ws`

**Installation:**
```bash
pip install websocket-client
```

Tests:
- WebSocket connection establishment
- Multiple concurrent connections
- Reconnection after disconnect
- Broadcast reception (new messages, contacts, friend requests)
- Event type validation (message_update, new_contact, etc.)
- JSON format validation
- Error handling (timeouts, malformed messages)
- Latency measurement
- Multi-client broadcasting

**Coverage:** WebSocket connectivity, broadcasting, error handling, performance

### UX Flow & State Management Tests
**File:** `test_ux_flow.py`
**Requirements:** Server running
**Run:** `./tests/run_tests.sh --ux`

Tests:
- Complete flow: Setup → Login → Create Contact → Send Message
- Login → Contacts → Conversation navigation
- Settings CRUD (display name, public IP)
- System information retrieval
- Key exchange workflow
- Security level changes
- Corpus type changes (Wikipedia/URL/local)
- Friend request flow (receive → accept/reject → contact creation)
- Error state handling (missing key, invalid contact, duplicate IP)
- State persistence across API calls
- Navigation between sections

**Coverage:** User workflows, navigation, state persistence, error handling

### API Integration Tests
**File:** `test_api.py`
**Requirements:** Server running on localhost:3000
**Run:** `./tests/run_tests.sh --api`

Tests:
- Authentication endpoints (setup, login, logout, status)
- Contact CRUD (create, read, update, delete, duplicate prevention)
- Conversation management (key setting, security level, corpus type)
- Message sending (requires key, status tracking)
- P2P receive endpoint (no auth required)
- Friend requests (send, accept, reject)
- Settings management
- System and wiki index status
- Error handling (401, 404, 409 responses)

**Coverage:** REST API endpoints, authentication, authorization, error responses

## 🔧 Test Fixtures and Helpers

### Common Fixtures

**API Session (`api_session`)**
- Automatically authenticates with test password
- Provides ready-to-use `requests.Session` object
- Auto-cleanup on test completion

**Test Contact (`test_contact`, `clean_contact`)**
- Creates temporary contact for testing
- Provides contact and conversation objects
- Auto-cleanup after test

**Temporary Database (`temp_db`)**
- In-memory or file-based SQLite database
- Full schema initialized
- Isolated per test

### Helper Functions

**`calculate_fidelity(original, reconstructed)`**
- Computes message reconstruction fidelity percentage
- Uses SequenceMatcher for fuzzy matching
- Returns 0-100 score

**`is_valid_uuid(token)`**
- Validates UUID format for session tokens

**`is_encrypted_field(value)`**
- Checks if database field is encrypted (enc:v1:... format)

**`parse_encrypted_field(value)`**
- Extracts IV, auth tag, and ciphertext from encrypted field

## 📈 Coverage Goals

| Test Category | Target Coverage | Critical Paths |
|---------------|----------------|----------------|
| Engine Unit | ≥95% | Hash chain, page selection, tokenization |
| Wikipedia Index | ≥90% | Index generation, validation, checksums |
| E2E Message | ≥90% fidelity | Encode → decode with ≥90% accuracy |
| Database | ≥95% | CRUD operations, constraints |
| Authentication | ≥90% | Password hashing, session management |
| WebSocket | ≥80% | Connection, broadcasting |
| UX Flow | ≥85% | User workflows, state persistence |
| API | ≥90% | All endpoints, error handling |

## 🐛 Troubleshooting

### Server Not Running
**Error:** "Server not reachable at http://localhost:3000"
**Solution:**
```bash
./start.sh &
sleep 5  # Wait for server startup
./tests/run_tests.sh --api
```

### Wikipedia Index Missing
**Error:** "Demo index not found" or "Index not available"
**Solution:**
```bash
# Use demo index (20 articles, fast)
# Already included in repo as vital_articles_demo.json

# OR build full Level 4 index (~10,000 articles, 5-15 min)
python3 build_wiki_index.py --level 4

# OR build smaller Level 3 index (~1,000 articles, 1-2 min)
python3 build_wiki_index.py --level 3
```

### WebSocket Tests Failing
**Error:** "websocket-client not installed"
**Solution:**
```bash
pip install websocket-client
```

### Dependency Issues
**Error:** Missing Python packages
**Solution:**
```bash
pip install -r requirements.txt
```

Required packages:
- `pytest` - Test framework
- `pytest-timeout` - Test timeout handling
- `requests` - HTTP client for API tests
- `sentencepiece` - Tokenization (engine tests)
- `websocket-client` - WebSocket tests (optional)

## 📝 Running Specific Tests

### Run Single Test File
```bash
pytest tests/test_wiki_index.py -v
```

### Run Specific Test Class
```bash
pytest tests/test_e2e_message.py::TestE2EMessageLifecycle -v
```

### Run Specific Test Method
```bash
pytest tests/test_e2e_message.py::TestE2EMessageLifecycle::test_send_and_receive_short_message_local -v
```

### Run Tests Matching Pattern
```bash
pytest tests/ -k "encryption" -v
```

### Run with Verbose Output
```bash
pytest tests/test_engine.py -vv --tb=long
```

### Run with Coverage Report
```bash
pytest tests/ --cov=. --cov-report=html
# Open htmlcov/index.html to view report
```

## 🔍 Test Markers

Tests use pytest markers for categorization:

- `@pytest.mark.api` - Requires server running
- `@pytest.mark.timeout(N)` - Test timeout in seconds
- `@pytest.mark.skipif(condition)` - Conditional skip

## 🎯 Continuous Integration

For CI/CD pipelines:

```bash
# Run basic tests (no server needed)
./tests/run_tests.sh

# OR with explicit pytest
pytest tests/test_engine.py tests/test_wiki_index.py tests/test_db_integration.py -v --tb=short

# For full CI with server
./start.sh &
sleep 10
./tests/run_tests.sh --full
```

## 📚 Additional Resources

- **Main README:** `../README.md` - Application overview
- **Engine Documentation:** `vectorspeech_engine_fixed.py` - Core algorithm details
- **API Documentation:** `server/index.ts` - REST API endpoints
- **Database Schema:** `server/db.ts` - SQLite schema definition

## 🤝 Contributing Tests

When adding new features, please:

1. **Add unit tests** for isolated functionality
2. **Add integration tests** for API endpoints
3. **Add E2E tests** for complete workflows
4. **Update this README** with new test descriptions
5. **Ensure ≥90% coverage** on critical paths
6. **Include edge cases** and error conditions

### Test Naming Convention
- Test files: `test_<feature>.py`
- Test classes: `Test<FeatureName>`
- Test methods: `test_<specific_behavior>`

### Example
```python
class TestMessageEncryption:
    def test_encrypt_decrypt_round_trip(self):
        """Test that encrypted message can be decrypted correctly"""
        # Arrange
        message = "Hello, World!"

        # Act
        encrypted = encrypt(message, key)
        decrypted = decrypt(encrypted, key)

        # Assert
        assert decrypted == message
```

## 📊 Test Results Summary

After running tests, you'll see:

```
  VectorSpeech Comprehensive Test Suite
  Working dir: /Users/you/vectorspeech-chat

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
  Test suites:  8 passed  0 failed  (45s)
  ✓ All checks passed
```

## 🎉 Success Criteria

The test suite is considered successful when:

1. ✅ All engine unit tests pass (hash chain, tokenization, page selection)
2. ✅ Wikipedia index generation tests validate structure and checksums
3. ✅ **E2E message tests achieve ≥90% reconstruction fidelity** (CRITICAL)
4. ✅ Database tests validate schema and CRUD operations
5. ✅ Authentication tests verify password hashing and session management
6. ✅ WebSocket tests confirm real-time broadcasting
7. ✅ UX flow tests validate complete user workflows
8. ✅ API tests cover all endpoints with proper error handling

---

**Last Updated:** 2026-04-02
**Test Count:** 200+ tests across 8 categories
**Estimated Full Suite Runtime:** 2-5 minutes (with server running)
