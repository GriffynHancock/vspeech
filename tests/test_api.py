#!/usr/bin/env python3
"""
tests/test_api.py
Integration tests for the VectorSpeech REST API.

Requires the server running on localhost:3000.

Run:
    # Start server first:  ./start.sh &
    pytest tests/test_api.py -v
    # or with a custom host:
    VS_API=http://localhost:3000 pytest tests/test_api.py -v
"""

import os
import time
import json
import uuid
import pytest
import requests

BASE = os.environ.get('VS_API', 'http://localhost:3000')
TEST_PASSWORD = f'test_password_{uuid.uuid4().hex[:8]}'


# ─── Session fixture ──────────────────────────────────────────────

@pytest.fixture(scope='module')
def session():
    """Create a fresh auth session for the test run."""
    s = requests.Session()

    # Check server reachability
    try:
        r = s.get(f'{BASE}/api/auth/status', timeout=5)
        r.raise_for_status()
    except Exception as e:
        pytest.skip(f"Server not reachable at {BASE}: {e}")

    status = r.json()

    # Setup if needed
    if not status.get('setup'):
        r = s.post(f'{BASE}/api/auth/setup', json={'password': TEST_PASSWORD}, timeout=10)
        assert r.status_code == 200, f"Setup failed: {r.text}"
        token = r.json()['token']
    else:
        # Try to login (may fail if password differs — that's OK, skip auth tests)
        r = s.post(f'{BASE}/api/auth/login', json={'password': TEST_PASSWORD}, timeout=10)
        if r.status_code != 200:
            pytest.skip(f"Cannot login with test password (server has existing auth). "
                        f"Run ./reset.sh --password first, then re-run.")
        token = r.json()['token']

    s.headers['X-Session-Token'] = token
    yield s

    # Cleanup: logout
    s.post(f'{BASE}/api/auth/logout', timeout=5)


# ═════════════════════════════════════════════════════════════════
# Auth tests
# ═════════════════════════════════════════════════════════════════

class TestAuth:
    def test_status_endpoint(self):
        r = requests.get(f'{BASE}/api/auth/status', timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert 'setup' in data
        assert isinstance(data['setup'], bool)

    def test_unauthenticated_request_returns_401(self):
        r = requests.get(f'{BASE}/api/contacts', timeout=5)
        assert r.status_code == 401

    def test_wrong_token_returns_401(self):
        r = requests.get(
            f'{BASE}/api/contacts',
            headers={'X-Session-Token': 'wrong-token-' + uuid.uuid4().hex},
            timeout=5,
        )
        assert r.status_code == 401

    def test_authenticated_request_succeeds(self, session):
        r = session.get(f'{BASE}/api/contacts', timeout=5)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ═════════════════════════════════════════════════════════════════
# System / health
# ═════════════════════════════════════════════════════════════════

class TestSystem:
    def test_system_info(self, session):
        r = session.get(f'{BASE}/api/system', timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert 'myIp' in data
        assert 'port' in data
        assert 'engine' in data
        assert 'ok' in data['engine']
        assert 'python' in data['engine']

    def test_wiki_index_status(self, session):
        r = session.get(f'{BASE}/api/wiki-index/status', timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data['status'] in ('missing', 'demo', 'partial', 'ready')
        assert isinstance(data['articles'], int)


# ═════════════════════════════════════════════════════════════════
# Settings
# ═════════════════════════════════════════════════════════════════

class TestSettings:
    def test_get_settings(self, session):
        r = session.get(f'{BASE}/api/settings', timeout=5)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_update_settings(self, session):
        payload = {'display_name': 'TestUser', 'public_ip': ''}
        r = session.put(f'{BASE}/api/settings', json=payload, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data.get('display_name') == 'TestUser'

    def test_settings_persist(self, session):
        session.put(f'{BASE}/api/settings', json={'display_name': 'Persisted'}, timeout=5)
        r = session.get(f'{BASE}/api/settings', timeout=5)
        assert r.json().get('display_name') == 'Persisted'


# ═════════════════════════════════════════════════════════════════
# Contact CRUD
# ═════════════════════════════════════════════════════════════════

class TestContacts:
    @pytest.fixture
    def contact(self, session):
        """Create a temporary contact and clean up after."""
        uid = uuid.uuid4().hex[:8]
        r = session.post(f'{BASE}/api/contacts', json={
            'name': f'TestContact_{uid}',
            'ip':   f'10.0.{uid[:3]}.1',
            'port': 13000,
        }, timeout=5)
        assert r.status_code == 200, f"Contact creation failed: {r.text}"
        c = r.json()
        yield c
        # Cleanup
        session.delete(f'{BASE}/api/contacts/{c["id"]}', timeout=5)

    def test_list_contacts(self, session):
        r = session.get(f'{BASE}/api/contacts', timeout=5)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_contact(self, session):
        uid = uuid.uuid4().hex[:8]
        r = session.post(f'{BASE}/api/contacts', json={
            'name': f'Temp_{uid}', 'ip': f'10.99.{uid[:3]}.1', 'port': 19000,
        }, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert 'id' in data
        assert data['name'] == f'Temp_{uid}'
        # Cleanup
        session.delete(f'{BASE}/api/contacts/{data["id"]}', timeout=5)

    def test_duplicate_ip_rejected(self, contact, session):
        r = session.post(f'{BASE}/api/contacts', json={
            'name': 'Duplicate', 'ip': contact['ip'], 'port': 3000,
        }, timeout=5)
        assert r.status_code == 409

    def test_update_contact(self, contact, session):
        r = session.patch(f'{BASE}/api/contacts/{contact["id"]}',
                          json={'name': 'UpdatedName'}, timeout=5)
        assert r.status_code == 200
        assert r.json()['name'] == 'UpdatedName'

    def test_delete_contact(self, session):
        uid = uuid.uuid4().hex[:8]
        create = session.post(f'{BASE}/api/contacts', json={
            'name': f'Del_{uid}', 'ip': f'10.88.{uid[:3]}.1', 'port': 18000,
        }, timeout=5)
        cid = create.json()['id']
        r = session.delete(f'{BASE}/api/contacts/{cid}', timeout=5)
        assert r.status_code == 200


# ═════════════════════════════════════════════════════════════════
# Conversations
# ═════════════════════════════════════════════════════════════════

class TestConversations:
    @pytest.fixture
    def contact_and_conv(self, session):
        uid = uuid.uuid4().hex[:8]
        c = session.post(f'{BASE}/api/contacts', json={
            'name': f'Conv_{uid}', 'ip': f'10.77.{uid[:3]}.1', 'port': 17000,
        }, timeout=5).json()
        conv = session.get(f'{BASE}/api/contacts/{c["id"]}/conversation', timeout=5).json()
        yield c, conv
        session.delete(f'{BASE}/api/contacts/{c["id"]}', timeout=5)

    def test_get_conversation(self, contact_and_conv, session):
        c, conv = contact_and_conv
        r = session.get(f'{BASE}/api/contacts/{c["id"]}/conversation', timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert 'id' in data
        assert data['contact_id'] == c['id']

    def test_set_conversation_key(self, contact_and_conv, session):
        _, conv = contact_and_conv
        r = session.put(f'{BASE}/api/conversations/{conv["id"]}/key',
                        json={'key': 'my-secret-phrase'}, timeout=5)
        assert r.status_code == 200

    def test_set_security_level(self, contact_and_conv, session):
        _, conv = contact_and_conv
        for level in ('low', 'medium', 'high'):
            r = session.put(f'{BASE}/api/conversations/{conv["id"]}/security',
                            json={'level': level}, timeout=5)
            assert r.status_code == 200

    def test_message_count(self, contact_and_conv, session):
        _, conv = contact_and_conv
        r = session.get(f'{BASE}/api/conversations/{conv["id"]}/message-count', timeout=5)
        assert r.status_code == 200
        assert 'count' in r.json()
        assert isinstance(r.json()['count'], int)

    def test_corpus_update_wikipedia(self, contact_and_conv, session):
        _, conv = contact_and_conv
        r = session.put(f'{BASE}/api/conversations/{conv["id"]}/corpus',
                        json={'corpus_type': 'wikipedia', 'corpus_source': ''}, timeout=5)
        assert r.status_code == 200


# ═════════════════════════════════════════════════════════════════
# P2P receive (no auth required)
# ═════════════════════════════════════════════════════════════════

class TestP2PReceive:
    def test_receive_creates_message(self, session):
        r = requests.post(f'{BASE}/api/p2p/receive', json={
            'vector':         [1, 2, 3, 4, 5],
            'security_level': 'low',
            'corpus_type':    'wikipedia',
            'corpus_source':  '',
            'from_ip':        '10.1.2.3',
            'from_port':      3000,
        }, timeout=5)
        assert r.status_code == 200
        assert r.json().get('ok') is True

    def test_receive_no_auth_required(self):
        """P2P receive must work without session token (from external peers)."""
        r = requests.post(f'{BASE}/api/p2p/receive', json={
            'vector':      [10, 20, 30],
            'from_ip':     '10.9.8.7',
            'from_port':   3001,
        }, timeout=5)
        # Should succeed (200) or maybe 422 for validation, never 401
        assert r.status_code != 401, "P2P receive must not require auth"

    def test_receive_requires_vector_field(self):
        r = requests.post(f'{BASE}/api/p2p/receive', json={
            'from_ip': '10.0.0.1',
        }, timeout=5)
        # Missing required field → 422 or 400, not 500
        assert r.status_code in (400, 422)


# ═════════════════════════════════════════════════════════════════
# Friend requests
# ═════════════════════════════════════════════════════════════════

class TestFriendRequests:
    def test_list_pending(self, session):
        r = session.get(f'{BASE}/api/friend-requests', timeout=5)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_inbound_p2p_request(self, session):
        """Simulate an inbound friend request from a peer (no auth)."""
        rid = uuid.uuid4().hex
        r = requests.post(f'{BASE}/api/p2p/friend-request', json={
            'request_id': rid,
            'from_name':  'TestPeer',
            'from_ip':    '10.5.5.5',
            'from_port':  3000,
        }, timeout=5)
        assert r.status_code == 200
        assert r.json().get('ok') is True

    def test_reject_request(self, session):
        # First inject one
        rid = uuid.uuid4().hex
        requests.post(f'{BASE}/api/p2p/friend-request', json={
            'request_id': rid, 'from_name': 'ToReject',
            'from_ip': '10.6.6.6', 'from_port': 3000,
        }, timeout=5)
        # Reject it
        r = session.post(f'{BASE}/api/friend-requests/{rid}/reject', timeout=5)
        assert r.status_code == 200

    def test_send_request_requires_auth(self):
        r = requests.post(f'{BASE}/api/friend-requests/send', json={
            'target_ip': '10.7.7.7', 'target_port': 3000,
        }, timeout=5)
        assert r.status_code == 401


# ═════════════════════════════════════════════════════════════════
# Error handling
# ═════════════════════════════════════════════════════════════════

class TestErrorHandling:
    def test_nonexistent_contact_conversation(self, session):
        r = session.get(f'{BASE}/api/contacts/{uuid.uuid4()}/conversation', timeout=5)
        # Should return 404 or empty, not 500
        assert r.status_code in (200, 404)

    def test_send_message_no_key_returns_error(self, session):
        """Sending a message to a conversation with no key set should fail gracefully."""
        uid = uuid.uuid4().hex[:8]
        c = session.post(f'{BASE}/api/contacts', json={
            'name': f'NoKey_{uid}', 'ip': f'10.66.{uid[:3]}.1', 'port': 16000,
        }, timeout=5).json()
        conv = session.get(f'{BASE}/api/contacts/{c["id"]}/conversation', timeout=5).json()
        r = session.post(f'{BASE}/api/messages/send', json={
            'conversation_id': conv['id'], 'text': 'hello',
        }, timeout=5)
        assert r.status_code == 400
        # Cleanup
        session.delete(f'{BASE}/api/contacts/{c["id"]}', timeout=5)

    def test_messages_endpoint_returns_list(self, session):
        uid = uuid.uuid4().hex[:8]
        c = session.post(f'{BASE}/api/contacts', json={
            'name': f'MsgList_{uid}', 'ip': f'10.55.{uid[:3]}.1', 'port': 15000,
        }, timeout=5).json()
        conv = session.get(f'{BASE}/api/contacts/{c["id"]}/conversation', timeout=5).json()
        r = session.get(f'{BASE}/api/conversations/{conv["id"]}/messages', timeout=5)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        session.delete(f'{BASE}/api/contacts/{c["id"]}', timeout=5)


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
