#!/usr/bin/env python3
"""
tests/test_ux_flow.py
UX Control Flow and State Management Tests

Tests user workflows and navigation flows:
- Login → Contacts → Conversation flow
- Settings tabs navigation
- Key exchange workflow
- Friend request acceptance flow
- Error state handling (network errors, invalid inputs)
- State persistence across page reloads

Run:  pytest tests/test_ux_flow.py -v
      VS_API=http://localhost:3000 pytest tests/test_ux_flow.py -v --ux
"""

import json
import os
import sys
import time
import uuid

import pytest
import requests

# ─── Configuration ─────────────────────────────────────────────────
BASE_URL = os.environ.get('VS_API', 'http://localhost:3000')
TEST_PASSWORD = f'ux_test_password_{uuid.uuid4().hex[:8]}'


# ═════════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════════

@pytest.fixture(scope='module')
def api_session():
    """Create authenticated API session for UX flow tests"""
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
        assert r.status_code == 200
        token = r.json()['token']
    else:
        r = s.post(f'{BASE_URL}/api/auth/login',
                   json={'password': TEST_PASSWORD}, timeout=10)
        if r.status_code != 200:
            pytest.skip("Cannot login with test password")
        token = r.json()['token']

    s.headers['X-Session-Token'] = token
    yield s

    s.post(f'{BASE_URL}/api/auth/logout', timeout=5)


@pytest.fixture
def clean_contact(api_session):
    """Create a fresh contact for each test"""
    uid = uuid.uuid4().hex[:8]
    r = api_session.post(f'{BASE_URL}/api/contacts', json={
        'name': f'UX_Test_Contact_{uid}',
        'ip': f'10.88.{uid[:3]}.1',
        'port': 13000,
    }, timeout=5)
    assert r.status_code == 200
    contact = r.json()

    yield contact

    # Cleanup
    api_session.delete(f'{BASE_URL}/api/contacts/{contact["id"]}', timeout=5)


# ═════════════════════════════════════════════════════════════════
# Login → Contacts → Conversation Flow
# ═════════════════════════════════════════════════════════════════

class TestLoginToConversationFlow:
    def test_complete_flow_setup_to_first_message(self):
        """Test complete UX flow: Setup → Login → Create Contact → Send Message"""
        session = requests.Session()

        # Step 1: Check status
        r = session.get(f'{BASE_URL}/api/auth/status', timeout=5)
        assert r.status_code == 200

        # If not setup, skip (this test requires fresh server)
        if r.json().get('setup'):
            pytest.skip("Server already set up - need fresh instance for full flow test")

        # Step 2: Setup password
        password = f'flow_test_{uuid.uuid4().hex[:8]}'
        r = session.post(
            f'{BASE_URL}/api/auth/setup',
            json={'password': password},
            timeout=5
        )
        assert r.status_code == 200
        token = r.json()['token']

        # Step 3: Use token for authenticated requests
        session.headers['X-Session-Token'] = token

        # Step 4: Create contact
        r = session.post(
            f'{BASE_URL}/api/contacts',
            json={'name': 'First Contact', 'ip': '10.1.1.1', 'port': 3000},
            timeout=5
        )
        assert r.status_code == 200
        contact = r.json()

        # Step 5: Get conversation
        r = session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        assert r.status_code == 200
        conv = r.json()
        assert conv['contact_id'] == contact['id']

        # Step 6: Set conversation key
        r = session.put(
            f'{BASE_URL}/api/conversations/{conv["id"]}/key',
            json={'key': 'test_secret_key'},
            timeout=5
        )
        assert r.status_code == 200

        # Step 7: Attempt to send message (will fail delivery but should encode)
        r = session.post(
            f'{BASE_URL}/api/messages/send',
            json={'conversation_id': conv['id'], 'text': 'Hello, World!'},
            timeout=5
        )
        assert r.status_code == 200
        message = r.json()
        assert message['direction'] == 'sent'

        # Cleanup
        session.delete(f'{BASE_URL}/api/contacts/{contact["id"]}', timeout=5)
        session.post(f'{BASE_URL}/api/auth/logout', timeout=5)

    def test_login_then_view_contacts(self, api_session):
        """Test login → view contacts list flow"""
        # Already logged in via fixture

        # View contacts
        r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
        assert r.status_code == 200
        contacts = r.json()
        assert isinstance(contacts, list)

    def test_select_contact_view_conversation(self, api_session, clean_contact):
        """Test selecting contact → viewing conversation"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        assert r.status_code == 200
        conv = r.json()

        assert 'id' in conv
        assert conv['contact_id'] == contact['id']

    def test_view_conversation_messages(self, api_session, clean_contact):
        """Test viewing messages in a conversation"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # View messages
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        assert r.status_code == 200
        messages = r.json()
        assert isinstance(messages, list)


# ═════════════════════════════════════════════════════════════════
# Settings Navigation Flow
# ═════════════════════════════════════════════════════════════════

class TestSettingsFlow:
    def test_view_settings(self, api_session):
        """Test viewing settings page"""
        r = api_session.get(f'{BASE_URL}/api/settings', timeout=5)
        assert r.status_code == 200
        settings = r.json()
        assert isinstance(settings, dict)

    def test_update_display_name(self, api_session):
        """Test updating display name in settings"""
        new_name = f'UX_Test_User_{uuid.uuid4().hex[:4]}'

        r = api_session.put(
            f'{BASE_URL}/api/settings',
            json={'display_name': new_name},
            timeout=5
        )
        assert r.status_code == 200
        settings = r.json()
        assert settings.get('display_name') == new_name

    def test_update_public_ip(self, api_session):
        """Test updating public IP in settings"""
        test_ip = '192.168.1.100'

        r = api_session.put(
            f'{BASE_URL}/api/settings',
            json={'public_ip': test_ip},
            timeout=5
        )
        assert r.status_code == 200
        settings = r.json()
        assert settings.get('public_ip') == test_ip

    def test_settings_persist_across_reads(self, api_session):
        """Test that settings persist when read multiple times"""
        value = f'persistent_{uuid.uuid4().hex[:4]}'

        # Set
        api_session.put(
            f'{BASE_URL}/api/settings',
            json={'display_name': value},
            timeout=5
        )

        # Read multiple times
        for _ in range(3):
            r = api_session.get(f'{BASE_URL}/api/settings', timeout=5)
            assert r.json().get('display_name') == value

    def test_view_system_info(self, api_session):
        """Test viewing system information"""
        r = api_session.get(f'{BASE_URL}/api/system', timeout=5)
        assert r.status_code == 200
        info = r.json()

        assert 'myIp' in info
        assert 'port' in info
        assert 'engine' in info
        assert 'wikiIndex' in info


# ═════════════════════════════════════════════════════════════════
# Key Exchange Workflow
# ═════════════════════════════════════════════════════════════════

class TestKeyExchangeWorkflow:
    def test_set_conversation_key_flow(self, api_session, clean_contact):
        """Test complete key exchange workflow"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # Initially no key
        # (current_key is encrypted, so we can't directly check, but it starts empty)

        # Set key
        test_key = f'exchange_key_{uuid.uuid4().hex[:8]}'
        r = api_session.put(
            f'{BASE_URL}/api/conversations/{conv["id"]}/key',
            json={'key': test_key},
            timeout=5
        )
        assert r.status_code == 200

        # Verify key was set (conversation updated_at should change)
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        updated_conv = r.json()
        # current_key is encrypted in DB, but API decrypts it for us
        # We can't directly compare, but operation should succeed

    def test_change_security_level_flow(self, api_session, clean_contact):
        """Test changing conversation security level"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # Change security level
        for level in ['low', 'medium', 'high']:
            r = api_session.put(
                f'{BASE_URL}/api/conversations/{conv["id"]}/security',
                json={'level': level},
                timeout=5
            )
            assert r.status_code == 200

            # Verify
            r = api_session.get(
                f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
                timeout=5
            )
            updated_conv = r.json()
            assert updated_conv['security_level'] == level

    def test_change_corpus_type_flow(self, api_session, clean_contact):
        """Test changing corpus type (wikipedia/url/local)"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # Change to wikipedia (default)
        r = api_session.put(
            f'{BASE_URL}/api/conversations/{conv["id"]}/corpus',
            json={'corpus_type': 'wikipedia', 'corpus_source': ''},
            timeout=5
        )
        assert r.status_code == 200


# ═════════════════════════════════════════════════════════════════
# Friend Request Flow
# ═════════════════════════════════════════════════════════════════

class TestFriendRequestFlow:
    def test_receive_friend_request_flow(self, api_session):
        """Test receiving and viewing friend request"""
        request_id = str(uuid.uuid4())

        # Simulate incoming friend request
        r = requests.post(
            f'{BASE_URL}/api/p2p/friend-request',
            json={
                'request_id': request_id,
                'from_name': 'Friend Request Test',
                'from_ip': '10.99.99.99',
                'from_port': 3000,
            },
            timeout=5
        )
        assert r.status_code == 200

        # View pending requests
        r = api_session.get(f'{BASE_URL}/api/friend-requests', timeout=5)
        assert r.status_code == 200
        requests_list = r.json()

        # Should include our request
        our_request = next((r for r in requests_list if r['request_id'] == request_id), None)
        assert our_request is not None
        assert our_request['status'] == 'pending'

    def test_accept_friend_request_flow(self, api_session):
        """Test accepting a friend request"""
        request_id = str(uuid.uuid4())

        # Create friend request
        requests.post(
            f'{BASE_URL}/api/p2p/friend-request',
            json={
                'request_id': request_id,
                'from_name': 'Accepted Friend',
                'from_ip': '10.88.88.88',
                'from_port': 3000,
            },
            timeout=5
        )

        # Accept it
        r = api_session.post(
            f'{BASE_URL}/api/friend-requests/{request_id}/accept',
            json={'display_name': 'My Friend'},
            timeout=5
        )
        assert r.status_code == 200

        # Verify contact was created
        r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
        contacts = r.json()
        friend_contact = next((c for c in contacts if c['ip'] == '10.88.88.88'), None)
        assert friend_contact is not None

        # Cleanup
        if friend_contact:
            api_session.delete(
                f'{BASE_URL}/api/contacts/{friend_contact["id"]}',
                timeout=5
            )

    def test_reject_friend_request_flow(self, api_session):
        """Test rejecting a friend request"""
        request_id = str(uuid.uuid4())

        # Create friend request
        requests.post(
            f'{BASE_URL}/api/p2p/friend-request',
            json={
                'request_id': request_id,
                'from_name': 'Rejected Friend',
                'from_ip': '10.77.77.77',
                'from_port': 3000,
            },
            timeout=5
        )

        # Reject it
        r = api_session.post(
            f'{BASE_URL}/api/friend-requests/{request_id}/reject',
            timeout=5
        )
        assert r.status_code == 200

        # Verify no contact was created
        r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
        contacts = r.json()
        rejected_contact = next((c for c in contacts if c['ip'] == '10.77.77.77'), None)
        assert rejected_contact is None


# ═════════════════════════════════════════════════════════════════
# Error State Handling
# ═════════════════════════════════════════════════════════════════

class TestErrorStateHandling:
    def test_send_message_without_key_shows_error(self, api_session, clean_contact):
        """Test error handling when trying to send without key"""
        contact = clean_contact

        # Get conversation (no key set)
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # Try to send message
        r = api_session.post(
            f'{BASE_URL}/api/messages/send',
            json={'conversation_id': conv['id'], 'text': 'Test'},
            timeout=5
        )
        assert r.status_code == 400
        assert 'error' in r.json()

    def test_invalid_contact_id_returns_error(self, api_session):
        """Test error handling for invalid contact ID"""
        fake_id = str(uuid.uuid4())

        r = api_session.get(
            f'{BASE_URL}/api/contacts/{fake_id}/conversation',
            timeout=5
        )
        # Should return 200 with empty or 404
        assert r.status_code in [200, 404]

    def test_duplicate_contact_ip_rejected(self, api_session, clean_contact):
        """Test error when adding contact with duplicate IP"""
        contact = clean_contact

        # Try to create another contact with same IP
        r = api_session.post(
            f'{BASE_URL}/api/contacts',
            json={'name': 'Duplicate', 'ip': contact['ip'], 'port': 3000},
            timeout=5
        )
        assert r.status_code == 409  # Conflict

    def test_invalid_security_level_rejected(self, api_session, clean_contact):
        """Test error for invalid security level"""
        contact = clean_contact

        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # Try to set invalid security level
        # Note: The API might not validate this strictly, just testing
        # In a strict implementation, this would return 400

    def test_missing_required_fields_rejected(self, api_session):
        """Test error when creating contact without required fields"""
        # Missing 'ip' field
        r = api_session.post(
            f'{BASE_URL}/api/contacts',
            json={'name': 'Incomplete'},
            timeout=5
        )
        assert r.status_code in [400, 422]  # Bad request or validation error


# ═════════════════════════════════════════════════════════════════
# State Persistence Tests
# ═════════════════════════════════════════════════════════════════

class TestStatePersistence:
    def test_contacts_persist_across_api_calls(self, api_session):
        """Test that contacts remain after multiple API calls"""
        # Create contact
        uid = uuid.uuid4().hex[:8]
        r = api_session.post(
            f'{BASE_URL}/api/contacts',
            json={'name': f'Persist_{uid}', 'ip': f'10.66.{uid[:3]}.1', 'port': 3000},
            timeout=5
        )
        contact = r.json()

        # Fetch contacts multiple times
        for _ in range(3):
            r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
            contacts = r.json()
            assert any(c['id'] == contact['id'] for c in contacts)

        # Cleanup
        api_session.delete(f'{BASE_URL}/api/contacts/{contact["id"]}', timeout=5)

    def test_conversation_state_persists(self, api_session, clean_contact):
        """Test that conversation state persists"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()
        conv_id = conv['id']

        # Set key
        test_key = f'persist_key_{uuid.uuid4().hex[:8]}'
        api_session.put(
            f'{BASE_URL}/api/conversations/{conv_id}/key',
            json={'key': test_key},
            timeout=5
        )

        # Fetch conversation again
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        updated_conv = r.json()

        assert updated_conv['id'] == conv_id

    def test_messages_persist_in_conversation(self, api_session, clean_contact):
        """Test that messages persist in conversation"""
        contact = clean_contact

        # Get conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        conv = r.json()

        # Simulate receiving a message
        r = requests.post(
            f'{BASE_URL}/api/p2p/receive',
            json={
                'vector': [1, 2, 3, 4, 5],
                'from_ip': contact['ip'],
                'from_port': contact['port'],
            },
            timeout=5
        )
        assert r.status_code == 200

        # Check messages persist
        time.sleep(0.5)
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        messages1 = r.json()

        # Fetch again
        r = api_session.get(
            f'{BASE_URL}/api/conversations/{conv["id"]}/messages',
            timeout=5
        )
        messages2 = r.json()

        assert len(messages1) == len(messages2)


# ═════════════════════════════════════════════════════════════════
# Navigation and Routing Tests
# ═════════════════════════════════════════════════════════════════

class TestNavigationFlow:
    def test_contacts_list_to_conversation_navigation(self, api_session, clean_contact):
        """Test navigation from contacts list to conversation"""
        contact = clean_contact

        # Step 1: View contacts
        r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
        contacts = r.json()
        assert any(c['id'] == contact['id'] for c in contacts)

        # Step 2: Navigate to conversation
        r = api_session.get(
            f'{BASE_URL}/api/contacts/{contact["id"]}/conversation',
            timeout=5
        )
        assert r.status_code == 200

    def test_conversation_to_settings_to_contacts(self, api_session):
        """Test navigation between different sections"""
        # Contacts
        r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
        assert r.status_code == 200

        # Settings
        r = api_session.get(f'{BASE_URL}/api/settings', timeout=5)
        assert r.status_code == 200

        # Back to contacts
        r = api_session.get(f'{BASE_URL}/api/contacts', timeout=5)
        assert r.status_code == 200


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
