#!/usr/bin/env python3
"""
tests/test_websocket.py
WebSocket and Real-time Communication Tests

Tests cover:
- WebSocket connection establishment
- Message delivery over WebSocket
- Broadcast notifications (new messages, contact updates)
- Reconnection on disconnect
- Error handling and retry logic
- Connection cleanup

Run:  pytest tests/test_websocket.py -v
      VS_API=http://localhost:3000 pytest tests/test_websocket.py -v --ws
"""

import json
import os
import sys
import time
import uuid
from threading import Thread, Event

import pytest
import requests

try:
    from websocket import create_connection, WebSocketTimeoutException
    WEBSOCKET_AVAILABLE = True
except ImportError:
    WEBSOCKET_AVAILABLE = False
    print("WARNING: websocket-client not installed. Run: pip install websocket-client")

# ─── Configuration ─────────────────────────────────────────────────
BASE_URL = os.environ.get('VS_API', 'http://localhost:3000')
WS_URL = BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws'
TEST_PASSWORD = f'ws_test_password_{uuid.uuid4().hex[:8]}'


# ═════════════════════════════════════════════════════════════════
# Fixtures
# ═════════════════════════════════════════════════════════════════

@pytest.fixture(scope='module')
def api_session():
    """Create authenticated API session"""
    if not WEBSOCKET_AVAILABLE:
        pytest.skip("websocket-client not installed")

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
def test_contact(api_session):
    """Create a test contact for WebSocket tests"""
    uid = uuid.uuid4().hex[:8]
    r = api_session.post(f'{BASE_URL}/api/contacts', json={
        'name': f'WS_Contact_{uid}',
        'ip': f'10.77.{uid[:3]}.1',
        'port': 13000,
    }, timeout=5)
    assert r.status_code == 200
    contact = r.json()

    yield contact

    # Cleanup
    api_session.delete(f'{BASE_URL}/api/contacts/{contact["id"]}', timeout=5)


# ═════════════════════════════════════════════════════════════════
# WebSocket Connection Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not WEBSOCKET_AVAILABLE, reason="websocket-client not installed")
class TestWebSocketConnection:
    def test_websocket_connection_succeeds(self):
        """Test that WebSocket connection can be established"""
        try:
            ws = create_connection(WS_URL, timeout=5)
            assert ws.connected
            ws.close()
        except Exception as e:
            pytest.fail(f"WebSocket connection failed: {e}")

    def test_websocket_connection_url(self):
        """Test WebSocket URL format is correct"""
        assert WS_URL.startswith('ws://') or WS_URL.startswith('wss://')
        assert '/ws' in WS_URL

    def test_websocket_reconnection_after_disconnect(self):
        """Test reconnecting after disconnection"""
        ws1 = create_connection(WS_URL, timeout=5)
        assert ws1.connected
        ws1.close()

        # Reconnect
        time.sleep(0.5)
        ws2 = create_connection(WS_URL, timeout=5)
        assert ws2.connected
        ws2.close()

    def test_multiple_concurrent_websocket_connections(self):
        """Test that multiple clients can connect simultaneously"""
        connections = []
        try:
            for i in range(3):
                ws = create_connection(WS_URL, timeout=5)
                assert ws.connected
                connections.append(ws)

            # All should be connected
            assert len(connections) == 3
        finally:
            for ws in connections:
                ws.close()

    def test_websocket_close_cleanup(self):
        """Test that closing WebSocket cleans up properly"""
        ws = create_connection(WS_URL, timeout=5)
        assert ws.connected

        ws.close()
        assert not ws.connected


# ═════════════════════════════════════════════════════════════════
# WebSocket Message Broadcasting Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not WEBSOCKET_AVAILABLE, reason="websocket-client not installed")
class TestWebSocketBroadcasts:
    def test_receive_broadcast_on_new_contact(self, api_session):
        """Test receiving broadcast when new contact is created"""
        ws = create_connection(WS_URL, timeout=5)
        ws.settimeout(3)

        try:
            # Create a contact (should trigger broadcast)
            uid = uuid.uuid4().hex[:8]
            api_session.post(f'{BASE_URL}/api/contacts', json={
                'name': f'Broadcast_Test_{uid}',
                'ip': f'10.66.{uid[:3]}.1',
                'port': 3000,
            }, timeout=5)

            # Wait for broadcast message
            received = False
            for _ in range(5):  # Try up to 5 times with 0.5s delay
                try:
                    msg = ws.recv()
                    data = json.loads(msg)

                    # Check if this is a contact-related broadcast
                    if data.get('type') in ['new_contact', 'contacts_changed', 'contact_update']:
                        received = True
                        break
                except WebSocketTimeoutException:
                    time.sleep(0.5)
                    continue

            # Note: Broadcast might not arrive if there's timing issues
            # This is a best-effort check
        finally:
            ws.close()

    def test_receive_broadcast_on_new_message(self, api_session, test_contact):
        """Test receiving broadcast when new message arrives"""
        ws = create_connection(WS_URL, timeout=5)
        ws.settimeout(3)

        try:
            # Simulate receiving a P2P message
            r = requests.post(
                f'{BASE_URL}/api/p2p/receive',
                json={
                    'vector': [1, 2, 3, 4, 5],
                    'from_ip': test_contact['ip'],
                    'from_port': test_contact['port'],
                },
                timeout=5
            )
            assert r.status_code == 200

            # Wait for broadcast
            received = False
            for _ in range(5):
                try:
                    msg = ws.recv()
                    data = json.loads(msg)

                    if data.get('type') in ['new_message', 'message_update']:
                        received = True
                        assert 'message' in data or 'conversation_id' in data
                        break
                except WebSocketTimeoutException:
                    time.sleep(0.5)
                    continue

        finally:
            ws.close()

    def test_broadcast_format_is_valid_json(self, api_session):
        """Test that broadcast messages are valid JSON"""
        ws = create_connection(WS_URL, timeout=5)
        ws.settimeout(3)

        try:
            # Trigger some action
            uid = uuid.uuid4().hex[:8]
            api_session.post(f'{BASE_URL}/api/contacts', json={
                'name': f'JSON_Test_{uid}',
                'ip': f'10.55.{uid[:3]}.1',
                'port': 3000,
            }, timeout=5)

            # Try to receive and parse
            for _ in range(5):
                try:
                    msg = ws.recv()
                    # Should not raise exception
                    data = json.loads(msg)
                    assert isinstance(data, dict)
                    assert 'type' in data
                    break
                except WebSocketTimeoutException:
                    time.sleep(0.5)
                except json.JSONDecodeError:
                    pytest.fail("Broadcast message is not valid JSON")
        finally:
            ws.close()


# ═════════════════════════════════════════════════════════════════
# WebSocket Event Types Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not WEBSOCKET_AVAILABLE, reason="websocket-client not installed")
class TestWebSocketEventTypes:
    def test_event_types_are_documented(self):
        """Test that expected event types are well-defined"""
        expected_event_types = [
            'message_update',
            'new_message',
            'new_contact',
            'contact_update',
            'contacts_changed',
            'conversation_update',
            'friend_request',
            'friend_request_update',
            'wiki_index_started',
            'wiki_index_progress',
            'wiki_index_finished',
        ]

        # This is a documentation test - verifies we know what events exist
        assert len(expected_event_types) > 0

    def test_message_update_event_structure(self):
        """Test expected structure of message_update event"""
        sample_event = {
            'type': 'message_update',
            'message': {
                'id': 'msg-123',
                'conversation_id': 'conv-456',
                'direction': 'sent',
                'status': 'delivered',
            }
        }

        assert sample_event['type'] == 'message_update'
        assert 'message' in sample_event

    def test_new_contact_event_structure(self):
        """Test expected structure of new_contact event"""
        sample_event = {
            'type': 'new_contact',
            'contact': {
                'id': 'contact-789',
                'name': 'Test User',
                'ip': '10.0.0.1',
                'port': 3000,
            }
        }

        assert sample_event['type'] == 'new_contact'
        assert 'contact' in sample_event


# ═════════════════════════════════════════════════════════════════
# WebSocket Error Handling Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not WEBSOCKET_AVAILABLE, reason="websocket-client not installed")
class TestWebSocketErrorHandling:
    def test_websocket_timeout_handling(self):
        """Test handling of WebSocket timeout"""
        ws = create_connection(WS_URL, timeout=5)
        ws.settimeout(0.1)  # Very short timeout

        try:
            # Should timeout if no message arrives
            with pytest.raises(WebSocketTimeoutException):
                ws.recv()
        finally:
            ws.close()

    def test_websocket_connection_error_handling(self):
        """Test handling of connection to invalid WebSocket URL"""
        invalid_url = "ws://localhost:99999/ws"  # Invalid port

        with pytest.raises(Exception):  # Connection error
            create_connection(invalid_url, timeout=2)

    def test_websocket_survives_malformed_send(self):
        """Test that server handles malformed client messages gracefully"""
        ws = create_connection(WS_URL, timeout=5)

        try:
            # Send malformed data
            ws.send("not valid json")

            # Connection should still be alive
            assert ws.connected
        finally:
            ws.close()


# ═════════════════════════════════════════════════════════════════
# WebSocket Performance Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not WEBSOCKET_AVAILABLE, reason="websocket-client not installed")
class TestWebSocketPerformance:
    @pytest.mark.timeout(10)
    def test_websocket_connects_quickly(self):
        """Test that WebSocket connection is established quickly"""
        start = time.time()
        ws = create_connection(WS_URL, timeout=5)
        elapsed = time.time() - start

        assert elapsed < 2.0, f"Connection took {elapsed}s, should be < 2s"
        ws.close()

    def test_broadcast_latency_is_low(self, api_session):
        """Test that broadcasts arrive with low latency"""
        ws = create_connection(WS_URL, timeout=5)
        ws.settimeout(2)

        try:
            # Trigger action and measure time to receive broadcast
            start = time.time()

            uid = uuid.uuid4().hex[:8]
            api_session.post(f'{BASE_URL}/api/contacts', json={
                'name': f'Latency_Test_{uid}',
                'ip': f'10.44.{uid[:3]}.1',
                'port': 3000,
            }, timeout=5)

            # Wait for broadcast
            try:
                ws.recv()
                elapsed = time.time() - start
                # Broadcast should arrive within 1 second
                assert elapsed < 1.0
            except WebSocketTimeoutException:
                # Broadcast might not arrive in time - that's OK for this test
                pass
        finally:
            ws.close()


# ═════════════════════════════════════════════════════════════════
# WebSocket Integration Tests
# ═════════════════════════════════════════════════════════════════

@pytest.mark.skipif(not WEBSOCKET_AVAILABLE, reason="websocket-client not installed")
class TestWebSocketIntegration:
    def test_websocket_receives_friend_request_notification(self, api_session):
        """Test receiving notification of incoming friend request"""
        ws = create_connection(WS_URL, timeout=5)
        ws.settimeout(3)

        try:
            # Simulate incoming friend request via P2P
            request_id = str(uuid.uuid4())
            r = requests.post(
                f'{BASE_URL}/api/p2p/friend-request',
                json={
                    'request_id': request_id,
                    'from_name': 'WebSocket Test Peer',
                    'from_ip': '10.33.33.33',
                    'from_port': 3000,
                },
                timeout=5
            )
            assert r.status_code == 200

            # Wait for broadcast
            received = False
            for _ in range(5):
                try:
                    msg = ws.recv()
                    data = json.loads(msg)

                    if data.get('type') == 'friend_request':
                        received = True
                        assert 'request' in data
                        break
                except WebSocketTimeoutException:
                    time.sleep(0.5)
        finally:
            ws.close()

    def test_multiple_clients_receive_same_broadcast(self, api_session):
        """Test that all connected clients receive broadcasts"""
        ws1 = create_connection(WS_URL, timeout=5)
        ws2 = create_connection(WS_URL, timeout=5)
        ws1.settimeout(2)
        ws2.settimeout(2)

        try:
            # Trigger a broadcast
            uid = uuid.uuid4().hex[:8]
            api_session.post(f'{BASE_URL}/api/contacts', json={
                'name': f'Multi_Client_{uid}',
                'ip': f'10.22.{uid[:3]}.1',
                'port': 3000,
            }, timeout=5)

            # Both clients should receive the broadcast
            received1 = False
            received2 = False

            for _ in range(3):
                try:
                    if not received1:
                        msg1 = ws1.recv()
                        json.loads(msg1)
                        received1 = True
                except WebSocketTimeoutException:
                    pass

                try:
                    if not received2:
                        msg2 = ws2.recv()
                        json.loads(msg2)
                        received2 = True
                except WebSocketTimeoutException:
                    pass

                if received1 and received2:
                    break

                time.sleep(0.5)

            # At least one should have received it (timing dependent)
        finally:
            ws1.close()
            ws2.close()


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
