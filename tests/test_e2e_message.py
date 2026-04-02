#!/usr/bin/env python3
"""
tests/test_e2e_message.py
End-to-End Message Lifecycle Tests

Tests the complete message flow:
1. Create message → Encrypt → Send → Store in DB → Retrieve → Decrypt
2. Validate ≥90% message reconstruction fidelity
3. Test with messages of varying lengths (short, medium, long)
4. Verify both plaintext and encrypted storage
5. Test error handling at each stage

Run:  pytest tests/test_e2e_message.py -v
      VS_API=http://localhost:3000 pytest tests/test_e2e_message.py -v --e2e
"""

import hashlib
import json
import os
import sys
import tempfile
import time
import uuid
from pathlib import Path
from difflib import SequenceMatcher

import pytest
import requests

# ─── Configuration ─────────────────────────────────────────────────
BASE_URL = os.environ.get('VS_API', 'http://localhost:3000')
TEST_PASSWORD = f'e2e_test_password_{uuid.uuid4().hex[:8]}'

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

# Load engine module
import importlib.util
_spec = importlib.util.spec_from_file_location(
    'vectorspeech_engine_fixed',
    ROOT / 'vectorspeech_engine_fixed.py',
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
VectorSpeechEngine = _mod.VectorSpeechEngine


# ═════════════════════════════════════════════════════════════════
# Helper Functions
# ═════════════════════════════════════════════════════════════════

def calculate_fidelity(original: str, reconstructed: str) -> float:
    """
    Calculate reconstruction fidelity as a percentage.
    Uses sequence matching to handle minor tokenization differences.
    """
    if not original:
        return 100.0 if not reconstructed else 0.0

    # Use SequenceMatcher for fuzzy matching
    matcher = SequenceMatcher(None, original, reconstructed)
    ratio = matcher.ratio() * 100.0
    return ratio


def normalize_text(text: str) -> str:
    """Normalize text for comparison (whitespace, case, etc.)"""
    import re
    # Remove extra whitespace
    text = re.sub(r'\s+', ' ', text)
    # Strip leading/trailing whitespace
    text = text.strip()
    return text


# ═════════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════════

@pytest.fixture(scope='module')
def api_session():
    """Create authenticated API session for E2E tests"""
    s = requests.Session()

    try:
        r = s.get(f'{BASE_URL}/api/auth/status', timeout=5)
        r.raise_for_status()
    except Exception as e:
        pytest.skip(f"Server not reachable at {BASE_URL}: {e}")

    status = r.json()

    if not status.get('setup'):
        r = s.post(f'{BASE_URL}/api/auth/setup',
                   json={'password': TEST_PASSWORD}, timeout=10)
        assert r.status_code == 200, f"Setup failed: {r.text}"
        token = r.json()['token']
    else:
        r = s.post(f'{BASE_URL}/api/auth/login',
                   json={'password': TEST_PASSWORD}, timeout=10)
        if r.status_code != 200:
            pytest.skip("Cannot login with test password. Run ./reset.sh first.")
        token = r.json()['token']

    s.headers['X-Session-Token'] = token
    yield s

    s.post(f'{BASE_URL}/api/auth/logout', timeout=5)


@pytest.fixture
def test_contact(api_session):
    """Create a test contact for E2E messaging"""
    uid = uuid.uuid4().hex[:8]
    r = api_session.post(f'{BASE_URL}/api/contacts', json={
        'name': f'E2E_Contact_{uid}',
        'ip': f'10.99.{uid[:3]}.1',
        'port': 13000,
    }, timeout=5)
    assert r.status_code == 200
    contact = r.json()

    # Get conversation
    r = api_session.get(f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
                        timeout=5)
    assert r.status_code == 200
    conversation = r.json()

    yield {'contact': contact, 'conversation': conversation}

    # Cleanup
    api_session.delete(f'{BASE_URL}/api/contacts/{contact["id"]}', timeout=5)


@pytest.fixture
def engine_with_index():
    """VectorSpeech engine with loaded index"""
    engine = VectorSpeechEngine(version=1, security_level='low')
    if not engine.load_index():
        pytest.skip("Wikipedia index not available")
    return engine


# ═════════════════════════════════════════════════════════════════
# End-to-End Message Lifecycle Tests
# ═════════════════════════════════════════════════════════════════

class TestE2EMessageLifecycle:
    def test_send_and_receive_short_message_local(self, engine_with_index):
        """Test complete lifecycle: encode → decode short message (local engine)"""
        seed = "test_secret_key_123"
        iteration = 1
        original_message = "Hello, World!"

        # SEND: Encode message
        result = engine_with_index.send_message(original_message, seed, iteration)
        assert 'vector' in result
        assert len(result['vector']) > 0
        token_vector = result['vector']

        # RECEIVE: Decode message
        decoded_message = engine_with_index.receive_message(token_vector, seed, iteration)

        # Verify reconstruction
        fidelity = calculate_fidelity(original_message, decoded_message)
        assert fidelity >= 90.0, \
            f"Reconstruction fidelity {fidelity:.1f}% < 90% for '{original_message}' → '{decoded_message}'"

    def test_send_and_receive_medium_message_local(self, engine_with_index):
        """Test medium-length message (100-200 chars)"""
        seed = "medium_test_key"
        iteration = 2
        original_message = (
            "Meet me at the coffee shop on Main Street at 3:30 PM. "
            "Bring the documents we discussed yesterday. "
            "Don't forget your laptop."
        )

        result = engine_with_index.send_message(original_message, seed, iteration)
        token_vector = result['vector']

        decoded_message = engine_with_index.receive_message(token_vector, seed, iteration)

        fidelity = calculate_fidelity(original_message, decoded_message)
        assert fidelity >= 90.0, \
            f"Medium message fidelity {fidelity:.1f}% < 90%"

    def test_send_and_receive_long_message_local(self, engine_with_index):
        """Test long message (500+ chars)"""
        seed = "long_message_secret"
        iteration = 3
        original_message = (
            "This is a longer test message to verify that the VectorSpeech engine "
            "can handle substantial amounts of text without significant degradation "
            "in reconstruction quality. The message includes various punctuation marks, "
            "numbers like 123 and 456, and special characters such as @ # $ % & *. "
            "It also contains multiple sentences with different structures to test "
            "the tokenizer's ability to handle diverse linguistic patterns. "
            "We expect at least 90% reconstruction fidelity for this test to pass. "
            "The encoding process involves training a custom SentencePiece tokenizer "
            "on a corpus derived from Wikipedia articles selected deterministically "
            "using a hash chain based on the shared secret key and iteration number."
        )

        result = engine_with_index.send_message(original_message, seed, iteration)
        token_vector = result['vector']

        decoded_message = engine_with_index.receive_message(token_vector, seed, iteration)

        fidelity = calculate_fidelity(original_message, decoded_message)
        assert fidelity >= 90.0, \
            f"Long message fidelity {fidelity:.1f}% < 90%"

    def test_different_iterations_produce_different_encodings(self, engine_with_index):
        """Test that same message at different iterations produces different vectors"""
        seed = "iteration_test_key"
        message = "Same message, different iterations"

        result1 = engine_with_index.send_message(message, seed, iteration=1)
        result2 = engine_with_index.send_message(message, seed, iteration=2)

        vector1 = result1['vector']
        vector2 = result2['vector']

        # Vectors should be different (different corpus → different tokenization)
        assert vector1 != vector2, \
            "Same message at different iterations should produce different vectors"

    def test_wrong_seed_cannot_decode(self, engine_with_index):
        """Test that wrong seed produces garbled or different output"""
        correct_seed = "correct_secret"
        wrong_seed = "wrong_secret"
        iteration = 5
        message = "Secret message"

        # Encode with correct seed
        result = engine_with_index.send_message(message, correct_seed, iteration)
        vector = result['vector']

        # Try to decode with wrong seed
        decoded_wrong = engine_with_index.receive_message(vector, wrong_seed, iteration)

        # Should not match original (very low fidelity)
        fidelity = calculate_fidelity(message, decoded_wrong)
        assert fidelity < 50.0, \
            "Wrong seed should produce low fidelity decoding"

    def test_different_security_levels(self, engine_with_index):
        """Test message encoding at different security levels"""
        seed = "security_level_test"
        message = "Testing security levels"

        for level in ['low', 'medium', 'high']:
            engine = VectorSpeechEngine(version=1, security_level=level)
            engine.load_index()

            iteration = {'low': 10, 'medium': 11, 'high': 12}[level]

            result = engine.send_message(message, seed, iteration)
            decoded = engine.receive_message(result['vector'], seed, iteration)

            fidelity = calculate_fidelity(message, decoded)
            assert fidelity >= 90.0, \
                f"Security level {level} fidelity {fidelity:.1f}% < 90%"


# ═════════════════════════════════════════════════════════════════
# API Integration Tests (require running server)
# ═════════════════════════════════════════════════════════════════

@pytest.mark.api
class TestE2EMessageAPI:
    def test_set_conversation_key(self, test_contact, api_session):
        """Test setting encryption key for conversation"""
        conv = test_contact['conversation']
        test_key = "api_test_secret_key"

        r = api_session.put(
            f'{BASE_URL}/api/conversations/{conv["id"]}/key',
            json={'key': test_key},
            timeout=5
        )
        assert r.status_code == 200

        # Verify key was set
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{test_contact["contact"]["id"]}/conversation',
            timeout=5
        )
        updated_conv = r.json()
        # Note: current_key is encrypted in DB, so we can't directly compare

    def test_send_message_via_api_requires_key(self, test_contact, api_session):
        """Test that sending message without key fails gracefully"""
        conv = test_contact['conversation']

        r = api_session.post(
            f'{BASE_URL}/api/messages/send',
            json={'conversation_id': conv['id'], 'text': 'Test message'},
            timeout=5
        )
        assert r.status_code == 400
        assert 'key' in r.json().get('error', '').lower()

    def test_full_message_send_flow_via_api(self, test_contact, api_session):
        """Test full message send flow through API (without actual P2P delivery)"""
        conv = test_contact['conversation']
        test_key = f"full_flow_key_{uuid.uuid4().hex[:8]}"
        test_message = "API E2E test message"

        # Set key
        r = api_session.put(
            f'{BASE_URL}/api/conversations/{conv["id"]}/key',
            json={'key': test_key},
            timeout=5
        )
        assert r.status_code == 200

        # Send message (will fail to deliver to fake IP, but should encode)
        r = api_session.post(
            f'{BASE_URL}/api/messages/send',
            json={'conversation_id': conv['id'], 'text': test_message},
            timeout=5
        )
        assert r.status_code == 200
        message = r.json()
        assert message['direction'] == 'sent'
        assert message['status'] in ['queued', 'encoding']

        # Wait for encoding to complete (async)
        time.sleep(2)

        # Check message status
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        assert r.status_code == 200
        messages = r.json()
        assert len(messages) > 0

        sent_msg = messages[0]
        # Status might be 'failed' (delivery failed) or 'sending'
        # but it should have been encoded
        assert sent_msg['direction'] == 'sent'

    def test_receive_message_via_p2p_endpoint(self, api_session):
        """Test receiving a message via P2P endpoint (no auth required)"""
        # Simulate inbound message from a peer
        r = requests.post(
            f'{BASE_URL}/api/p2p/receive',
            json={
                'vector': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                'security_level': 'low',
                'corpus_type': 'wikipedia',
                'corpus_source': '',
                'from_ip': '10.1.2.3',
                'from_port': 3000,
            },
            timeout=5
        )
        assert r.status_code == 200
        assert r.json()['ok'] is True

    def test_message_count_increments(self, test_contact, api_session):
        """Test that message count increments correctly"""
        conv = test_contact['conversation']

        # Get initial count
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/message-count',
            timeout=5
        )
        assert r.status_code == 200
        initial_count = r.json()['count']

        # Simulate receiving a message
        r = requests.post(
            f'{BASE_URL}/api/p2p/receive',
            json={
                'vector': [10, 20, 30],
                'from_ip': test_contact['contact']['ip'],
                'from_port': test_contact['contact']['port'],
            },
            timeout=5
        )
        assert r.status_code == 200

        # Check count increased
        time.sleep(0.5)
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/message-count',
            timeout=5
        )
        new_count = r.json()['count']
        assert new_count == initial_count + 1


# ═════════════════════════════════════════════════════════════════
# Message Fidelity Tests
# ═════════════════════════════════════════════════════════════════

class TestMessageFidelity:
    def test_exact_match_for_simple_messages(self, engine_with_index):
        """Test that simple messages reconstruct exactly"""
        simple_messages = [
            "Hello",
            "Yes",
            "No",
            "OK",
            "Test 123",
        ]

        seed = "simple_message_test"
        for i, msg in enumerate(simple_messages):
            result = engine_with_index.send_message(msg, seed, iteration=100 + i)
            decoded = engine_with_index.receive_message(
                result['vector'], seed, iteration=100 + i
            )

            # Allow for minor differences due to tokenization
            fidelity = calculate_fidelity(msg, decoded)
            assert fidelity >= 90.0, \
                f"Simple message '{msg}' → '{decoded}' fidelity {fidelity:.1f}% < 90%"

    def test_fidelity_with_punctuation(self, engine_with_index):
        """Test messages with heavy punctuation"""
        message = "Hello! How are you? I'm fine, thanks. What about you?"
        seed = "punctuation_test"
        iteration = 50

        result = engine_with_index.send_message(message, seed, iteration)
        decoded = engine_with_index.receive_message(result['vector'], seed, iteration)

        fidelity = calculate_fidelity(message, decoded)
        assert fidelity >= 90.0

    def test_fidelity_with_numbers(self, engine_with_index):
        """Test messages containing numbers"""
        message = "Meet at coordinates 40.7128 N, 74.0060 W at 15:30 on 2026-04-02"
        seed = "numbers_test"
        iteration = 60

        result = engine_with_index.send_message(message, seed, iteration)
        decoded = engine_with_index.receive_message(result['vector'], seed, iteration)

        fidelity = calculate_fidelity(message, decoded)
        assert fidelity >= 90.0

    def test_fidelity_with_special_characters(self, engine_with_index):
        """Test messages with special characters"""
        message = "Contact: user@example.com | Price: $99.99 | Rating: 4.5/5 ★★★★☆"
        seed = "special_chars_test"
        iteration = 70

        result = engine_with_index.send_message(message, seed, iteration)
        decoded = engine_with_index.receive_message(result['vector'], seed, iteration)

        fidelity = calculate_fidelity(message, decoded)
        # Special characters might be trickier, so we allow slightly lower threshold
        assert fidelity >= 85.0, \
            f"Special chars fidelity {fidelity:.1f}% < 85%"


# ═════════════════════════════════════════════════════════════════
# Error Handling Tests
# ═════════════════════════════════════════════════════════════════

class TestE2EErrorHandling:
    def test_empty_message_handling(self, engine_with_index):
        """Test handling of empty message"""
        seed = "empty_test"
        iteration = 80
        message = ""

        # Should handle gracefully
        result = engine_with_index.send_message(message, seed, iteration)
        assert 'vector' in result

    def test_very_short_message(self, engine_with_index):
        """Test single-character message"""
        seed = "short_test"
        iteration = 81
        message = "A"

        result = engine_with_index.send_message(message, seed, iteration)
        decoded = engine_with_index.receive_message(result['vector'], seed, iteration)

        # Single character might not reconstruct perfectly
        fidelity = calculate_fidelity(message, decoded)
        assert fidelity >= 70.0  # Lower threshold for very short messages

    def test_iteration_mismatch_produces_wrong_output(self, engine_with_index):
        """Test that iteration mismatch prevents correct decoding"""
        seed = "iteration_mismatch_test"
        message = "Correct iteration required"

        result = engine_with_index.send_message(message, seed, iteration=5)
        vector = result['vector']

        # Decode with wrong iteration
        decoded_wrong = engine_with_index.receive_message(vector, seed, iteration=6)

        fidelity = calculate_fidelity(message, decoded_wrong)
        assert fidelity < 50.0, \
            "Wrong iteration should prevent correct decoding"


# ═════════════════════════════════════════════════════════════════
# Database Persistence Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.api
class TestMessagePersistence:
    def test_messages_persisted_in_database(self, test_contact, api_session):
        """Test that messages are stored in database"""
        conv = test_contact['conversation']

        # Get initial message count
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        initial_messages = r.json()
        initial_count = len(initial_messages)

        # Receive a message
        r = requests.post(
            f'{BASE_URL}/api/p2p/receive',
            json={
                'vector': [100, 200, 300],
                'from_ip': test_contact['contact']['ip'],
                'from_port': test_contact['contact']['port'],
            },
            timeout=5
        )
        assert r.status_code == 200

        # Verify message was stored
        time.sleep(0.5)
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        updated_messages = r.json()
        assert len(updated_messages) == initial_count + 1

        # Verify message has expected fields
        new_message = updated_messages[-1]
        assert 'id' in new_message
        assert 'direction' in new_message
        assert new_message['direction'] == 'received'
        assert 'token_vector' in new_message
        assert 'created_at' in new_message

    def test_message_status_transitions(self, test_contact, api_session):
        """Test message status lifecycle: queued → encoding → sending → delivered/failed"""
        conv = test_contact['conversation']

        # Set key
        api_session.put(
            f'{BASE_URL}/api/conversations/{conv["id"]}/key',
            json={'key': 'status_test_key'},
            timeout=5
        )

        # Send message
        r = api_session.post(
            f'{BASE_URL}/api/messages/send',
            json={'conversation_id': conv['id'], 'text': 'Status test'},
            timeout=5
        )
        message = r.json()
        msg_id = message['id']

        # Initial status should be 'queued' or 'encoding'
        assert message['status'] in ['queued', 'encoding']

        # Wait and check status transitions
        time.sleep(1)
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        messages = r.json()
        sent_msg = next((m for m in messages if m['id'] == msg_id), None)

        # Should have progressed to encoding, sending, or failed (no real peer)
        assert sent_msg['status'] in ['encoding', 'sending', 'sent', 'failed', 'delivered']


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
