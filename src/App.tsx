import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Contact, Conversation, Message, SystemInfo, WSEvent,
  SecurityLevel, CorpusType, FriendRequest, AppSettings
} from './types';
import Sidebar           from './components/Sidebar';
import ChatWindow        from './components/ChatWindow';
import LoginScreen       from './components/LoginScreen';
import FriendRequests    from './components/FriendRequests';
import SettingsPanel     from './components/SettingsPanel';
import { useWebSocket }  from './hooks/useWebSocket';
import { Lock }          from 'lucide-react';
import WikiIndexPanel, { type IndexStatus } from './components/WikiIndexPanel';

// ─── API client ─────────────────────────────────────────────────────────────
let _token = '';
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': _token, ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [needsSetup,    setNeedsSetup]    = useState<boolean | null>(null);
  const [sessionToken,  setSessionToken]  = useState('');

  // App data
  const [contacts,      setContacts]      = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [conversation,  setConversation]  = useState<Conversation | null>(null);
  const [messages,      setMessages]      = useState<Message[]>([]);
  const [msgCount,      setMsgCount]      = useState(0);
  const [systemInfo,    setSystemInfo]    = useState<SystemInfo | null>(null);
  const [settings,      setSettings]      = useState<AppSettings>({});
  const [friendReqs,    setFriendReqs]    = useState<FriendRequest[]>([]);

  // UI overlays
  const [showSettings,  setShowSettings]  = useState(false);
  const [showWikiIndex, setShowWikiIndex] = useState(false);
  const [wikiStatus,    setWikiStatus]    = useState<IndexStatus | null>(null);
  const [wikiBuilding,  setWikiBuilding]  = useState(false);
  const [wikiProgress,  setWikiProgress]  = useState<any[]>([]);
  const [engineChecked, setEngineChecked] = useState(false);

  // Keep module-level token in sync
  useEffect(() => { _token = sessionToken; }, [sessionToken]);

  // ── Auth check ──
  useEffect(() => {
    fetch('/api/auth/status').then(r => r.json())
      .then(d => setNeedsSetup(!d.setup))
      .catch(() => setNeedsSetup(false));
  }, []);

  const handleAuthSuccess = useCallback((token: string) => {
    _token = token;
    setSessionToken(token);
    sessionStorage.setItem('vs_token', token);
  }, []);

  // Restore on dev hot-reload
  useEffect(() => {
    const saved = sessionStorage.getItem('vs_token');
    if (saved && !sessionToken) { _token = saved; setSessionToken(saved); }
  }, [sessionToken]);

  // ── Post-login data load ──
  useEffect(() => {
    if (!sessionToken) return;
    apiFetch<SystemInfo>('/api/system').then(i => { setSystemInfo(i); setEngineChecked(true); }).catch(() => setEngineChecked(true));
    apiFetch<AppSettings>('/api/settings').then(setSettings).catch(() => {});
    apiFetch<FriendRequest[]>('/api/friend-requests').then(setFriendReqs).catch(() => {});
    apiFetch<IndexStatus>('/api/wiki-index/status').then(setWikiStatus).catch(() => {});
  }, [sessionToken]);

  // ── Contacts ──
  const loadContacts = useCallback(async () => {
    if (!sessionToken) return;
    try { setContacts(await apiFetch<Contact[]>('/api/contacts')); } catch {}
  }, [sessionToken]);
  useEffect(() => { loadContacts(); }, [loadContacts]);

  // ── Reload all data on WS reconnect (catches missed events) ──
  const handleReconnect = useCallback(() => {
    loadContacts();
    apiFetch<FriendRequest[]>('/api/friend-requests').then(setFriendReqs).catch(() => {});
    apiFetch<IndexStatus>('/api/wiki-index/status').then(setWikiStatus).catch(() => {});
    if (conversation) {
      apiFetch<Message[]>(`/api/conversations/${conversation.id}/messages`)
        .then(setMessages).catch(() => {});
    }
  }, [loadContacts, conversation]);

  // ── Select contact ──
  const selectContact = useCallback(async (contact: Contact) => {
    setActiveContact(contact); setMessages([]); setMsgCount(0);
    try {
      const convo = await apiFetch<Conversation>(`/api/contacts/${contact.id}/conversation`);
      setConversation(convo);
      const [msgs, { count }] = await Promise.all([
        apiFetch<Message[]>(`/api/conversations/${convo.id}/messages`),
        apiFetch<{ count: number }>(`/api/conversations/${convo.id}/message-count`),
      ]);
      setMessages(msgs); setMsgCount(count);
    } catch (e) { console.error(e); }
  }, []);

  // ── WebSocket ──
  const handleWsEvent = useCallback((event: WSEvent) => {
    switch (event.type) {
      case 'message_update':
        setMessages(prev => {
          const i = prev.findIndex(m => m.id === event.message.id);
          if (i === -1) return prev;
          const n = [...prev]; n[i] = event.message; return n;
        });
        loadContacts();
        break;

      case 'new_message':
        loadContacts();
        setConversation(cur => {
          if (cur && event.message.conversation_id === cur.id) {
            setMessages(prev => prev.find(m => m.id === event.message.id) ? prev : [...prev, event.message]);
            setMsgCount(c => c + 1);
          }
          return cur;
        });
        break;

      case 'new_contact':
        setContacts(prev => prev.find(c => c.id === event.contact.id) ? prev : [event.contact, ...prev]);
        break;

      case 'contact_update':
        setContacts(prev => prev.map(c => c.id === event.contact.id ? { ...c, ...event.contact } : c));
        setActiveContact(cur => cur?.id === event.contact.id ? { ...cur, ...event.contact } : cur);
        break;

      case 'conversation_update':
        setConversation(cur => cur?.id === event.conversation.id ? event.conversation : cur);
        break;

      case 'friend_request':
        setFriendReqs(prev => [...prev.filter(r => r.request_id !== event.request.request_id), event.request]);
        break;

      case 'friend_request_update':
        setFriendReqs(prev => prev.map(r =>
          r.request_id === event.requestId ? { ...r, status: event.status } : r
        ));
        break;

      case 'contacts_changed':
        loadContacts();
        break;

      case 'wiki_index_started':
        setWikiBuilding(true);
        setWikiProgress([]);
        break;

      case 'wiki_index_progress':
        setWikiProgress(prev => [...prev, event]);
        break;

      case 'wiki_index_finished':
        setWikiBuilding(false);
        if ((event as any).status) setWikiStatus((event as any).status);
        break;
    }
  }, [loadContacts]);

  useWebSocket(handleWsEvent, handleReconnect);

  // ── Friend requests ──
  const handleAcceptRequest = useCallback(async (requestId: string, displayName: string) => {
    await apiFetch(`/api/friend-requests/${requestId}/accept`, {
      method: 'POST', body: JSON.stringify({ display_name: displayName }),
    });
    setFriendReqs(prev => prev.map(r => r.request_id === requestId ? { ...r, status: 'accepted' } : r));
    await loadContacts();
  }, [loadContacts]);

  const handleRejectRequest = useCallback(async (requestId: string) => {
    await apiFetch(`/api/friend-requests/${requestId}/reject`, { method: 'POST', body: '{}' });
    setFriendReqs(prev => prev.map(r => r.request_id === requestId ? { ...r, status: 'rejected' } : r));
  }, []);

  const handleSendFriendRequest = useCallback(async (ip: string, port: number) => {
    await apiFetch('/api/friend-requests/send', {
      method: 'POST', body: JSON.stringify({ target_ip: ip, target_port: port }),
    });
  }, []);

  // ── Settings ──
  const handleSaveSettings = useCallback(async (s: Partial<AppSettings>) => {
    const updated = await apiFetch<AppSettings>('/api/settings', {
      method: 'PUT', body: JSON.stringify(s),
    });
    setSettings(updated);
  }, []);

  // ── Edit contact ──
  const handleEditContact = useCallback(async (data: { name: string; ip: string; port: number }) => {
    if (!activeContact) return;
    const updated = await apiFetch<Contact>(`/api/contacts/${activeContact.id}`, {
      method: 'PATCH', body: JSON.stringify(data),
    });
    setActiveContact(updated); loadContacts();
  }, [activeContact, loadContacts]);

  // ── Update key ──
  const handleUpdateKey = useCallback(async (key: string, security: SecurityLevel) => {
    if (!conversation) return;
    const updated = await apiFetch<Conversation>(`/api/conversations/${conversation.id}/key`, {
      method: 'PUT', body: JSON.stringify({ key }),
    });
    await apiFetch(`/api/conversations/${conversation.id}/security`, {
      method: 'PUT', body: JSON.stringify({ level: security }),
    });
    setConversation({ ...updated, security_level: security });
    loadContacts();
  }, [conversation, loadContacts]);

  // ── Update corpus ──
  const handleUpdateCorpus = useCallback(async (type: CorpusType, source: string) => {
    if (!conversation) return;
    const result = await apiFetch<Conversation & { corpus_fingerprint?: string }>(
      `/api/conversations/${conversation.id}/corpus`,
      { method: 'PUT', body: JSON.stringify({ corpus_type: type, corpus_source: source }) }
    );
    setConversation(prev => prev ? { ...prev, corpus_type: type, corpus_source: source } : prev);
    return result;
  }, [conversation]);

  // ── Send message ──
  const handleSend = useCallback(async (text: string) => {
    if (!conversation) return;
    try {
      const msg = await apiFetch<Message>('/api/messages/send', {
        method: 'POST', body: JSON.stringify({ conversation_id: conversation.id, text }),
      });
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
      setMsgCount(c => c + 1);
      loadContacts();
    } catch (e: any) { alert(`Send failed: ${e?.message ?? e}`); }
  }, [conversation, loadContacts]);

  // ── Reprocess ──
  const handleReprocess = useCallback(async (ids: string[]) => {
    if (!conversation) return;
    try {
      await apiFetch('/api/messages/reprocess', {
        method: 'POST', body: JSON.stringify({ message_ids: ids, conversation_id: conversation.id }),
      });
    } catch (e: any) { alert(`Reprocess failed: ${e?.message ?? e}`); }
  }, [conversation]);

  // ── Delete contact ──
  const handleDeleteContact = useCallback(async () => {
    if (!activeContact || !confirm(`Remove "${activeContact.name}"? All messages will be deleted.`)) return;
    await apiFetch(`/api/contacts/${activeContact.id}`, { method: 'DELETE' });
    setActiveContact(null); setConversation(null); setMessages([]);
    loadContacts();
  }, [activeContact, loadContacts]);

  // ── Wiki index ──
  const handleBuildWikiIndex = useCallback(async (level: number, resume: boolean) => {
    setWikiProgress([]);
    setWikiBuilding(true);
    try {
      await apiFetch('/api/wiki-index/build', { method: 'POST', body: JSON.stringify({ level, resume }) });
    } catch (e: any) {
      setWikiBuilding(false);
      alert(`Build failed: ${e?.message}`);
    }
  }, []);

  const handleCancelWikiIndex = useCallback(async () => {
    await apiFetch('/api/wiki-index/cancel', { method: 'POST', body: '{}' }).catch(() => {});
    setWikiBuilding(false);
  }, []);

  // ─── Render: connecting ───────────────────────────────────────────────────
  if (needsSetup === null) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Connecting…</div>;
  }

  // ─── Render: auth gate ────────────────────────────────────────────────────
  if (!sessionToken) {
    return <LoginScreen mode={needsSetup ? 'setup' : 'login'} onSuccess={handleAuthSuccess} />;
  }

  // ─── Render: main app ─────────────────────────────────────────────────────
  const engineOk      = systemInfo?.engine.ok ?? false;
  const pendingReqs   = friendReqs.filter(r => r.status === 'pending').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="app-shell" style={{ flex: 1, minHeight: 0 }}>

        {/* Sidebar with friend-request panel */}
        <div style={{ display: 'flex', flexDirection: 'column', width: 'var(--sidebar-w)', minWidth: 'var(--sidebar-w)', borderRight: '1px solid var(--border)' }}>
          <FriendRequests
            requests={friendReqs}
            onAccept={handleAcceptRequest}
            onReject={handleRejectRequest}
          />
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Sidebar
              contacts={contacts}
              activeContactId={activeContact?.id ?? null}
              myIp={systemInfo?.advertisedIp ?? systemInfo?.myIp ?? '…'}
              myPort={systemInfo?.port ?? 3000}
              pendingRequests={pendingReqs}
              onSelect={selectContact}
              onSendRequest={handleSendFriendRequest}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>
        </div>

        {/* Chat area */}
        {activeContact && conversation
          ? (
            <ChatWindow
              contact={activeContact}
              conversation={conversation}
              messages={messages}
              messageCount={msgCount}
              onSend={handleSend}
              onUpdateKey={handleUpdateKey}
              onUpdateCorpus={handleUpdateCorpus}
              onReprocessSelected={handleReprocess}
              onDeleteContact={handleDeleteContact}
              onEditContact={handleEditContact}
            />
          )
          : (
            <div className="chat-empty">
              <Lock size={48} style={{ opacity: 0.12 }} />
              <div className="chat-empty-title">VectorSpeech</div>
              <div className="chat-empty-subtitle">
                End-to-end encrypted via one-time Wikipedia-trained tokenisers.
                <br />Send a friend request or select a contact.
              </div>
              {engineChecked && !engineOk && (
                <div style={{
                  marginTop: 16, padding: '10px 16px',
                  background: 'rgba(244,135,113,0.08)', border: '1px solid var(--status-error)',
                  borderRadius: 'var(--radius-sm)', fontSize: 11,
                  color: 'var(--status-error)', maxWidth: 340, textAlign: 'center', lineHeight: 1.6,
                }}>
                  ⚠ Python engine unavailable<br />
                  <span style={{ color: 'var(--text-muted)' }}>{systemInfo?.engine.message}</span>
                </div>
              )}
            </div>
          )
        }
      </div>

      {/* Status bar */}
      <div className="status-bar">
        <div className="status-bar-item">
          <span className={`status-dot ${!engineChecked ? 'pending' : engineOk ? 'ok' : 'error'}`} />
          {!engineChecked ? 'checking…' : engineOk ? `python: ${systemInfo?.engine.python?.split('/').pop()}` : 'engine offline'}
        </div>
        {activeContact && (
          <div className="status-bar-item">
            <span style={{ margin: '0 4px', color: 'var(--text-muted)' }}>→</span>
            {activeContact.ip}:{activeContact.port}
          </div>
        )}
        <div className="status-bar-item" style={{ marginLeft: 'auto' }}>🔒 encrypted at rest</div>
        <div className="status-bar-item" style={{ cursor: 'pointer', marginLeft: 8 }}
          onClick={() => setShowWikiIndex(true)}
          title={wikiStatus ? `Wikipedia index: ${wikiStatus.status} (${wikiStatus.articles.toLocaleString()} articles)` : 'Wikipedia index'}
        >
          <span style={{ color: wikiStatus?.status === 'ready' ? 'var(--status-ok)' : wikiStatus?.status === 'missing' ? 'var(--status-error)' : 'var(--accent-yellow)' }}>
            ◈
          </span>
          {' '}wiki: {wikiStatus?.status ?? '…'}
          {wikiBuilding && ' ⟳'}
        </div>
        <div className="status-bar-item" style={{ marginLeft: 12 }}>
          me: {systemInfo?.advertisedIp ?? systemInfo?.myIp ?? '…'}
        </div>
      </div>

      {/* Overlays */}
      {showWikiIndex && wikiStatus && (
        <WikiIndexPanel
          status={wikiStatus}
          isBuilding={wikiBuilding}
          progressLines={wikiProgress}
          onBuild={handleBuildWikiIndex}
          onCancel={handleCancelWikiIndex}
          onClose={() => setShowWikiIndex(false)}
        />
      )}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          detectedIp={systemInfo?.myIp ?? ''}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          onOpenWikiIndex={() => { setShowSettings(false); setShowWikiIndex(true); }}
        />
      )}
    </div>
  );
}
