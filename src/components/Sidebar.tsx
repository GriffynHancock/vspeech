import { useState } from 'react';
import { Lock, Settings, UserPlus, Send } from 'lucide-react';
import type { Contact, FriendRequest } from '../types';

interface Props {
  contacts:         Contact[];
  activeContactId:  string | null;
  myIp:             string;
  myPort:           number;
  pendingRequests:  number;
  onSelect:         (contact: Contact) => void;
  onSendRequest:    (ip: string, port: number) => Promise<void>;
  onOpenSettings:   () => void;
}

function fmt(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'yesterday';
  if (days <  7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function Sidebar({
  contacts, activeContactId, myIp, myPort,
  pendingRequests, onSelect, onSendRequest, onOpenSettings,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [ip,      setIp]      = useState('');
  const [port,    setPort]    = useState('3000');
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState('');
  const [sent,    setSent]    = useState(false);

  const handleSend = async () => {
    const p = parseInt(port, 10);
    if (!ip.trim() || isNaN(p)) { setErr('IP and port required'); return; }
    setSending(true); setErr('');
    try {
      await onSendRequest(ip.trim(), p);
      setSent(true);
      setTimeout(() => { setSent(false); setShowAdd(false); setIp(''); setPort('3000'); }, 2000);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to send request');
    } finally { setSending(false); }
  };

  return (
    <aside className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div>
          <div className="sidebar-title">VectorSpeech</div>
          <div className="sidebar-my-ip">{myIp}:{myPort}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {pendingRequests > 0 && (
            <div style={{
              width: 18, height: 18, borderRadius: '50%',
              background: 'var(--accent-blue)',
              color: 'var(--bg-editor)', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {pendingRequests}
            </div>
          )}
          <button className="icon-btn" onClick={onOpenSettings} title="Settings">
            <Settings size={13} />
          </button>
          <Lock size={14} style={{ color: 'var(--accent-teal)', opacity: 0.6 }} />
        </div>
      </div>

      {/* Contact list */}
      <div className="contact-list">
        {contacts.length === 0 && !showAdd && (
          <div style={{ padding: '24px 14px', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.7 }}>
            No contacts yet.<br />Send a friend request by IP address.
          </div>
        )}
        {contacts.map(c => (
          <div
            key={c.id}
            className={`contact-item ${activeContactId === c.id ? 'active' : ''}`}
            onClick={() => onSelect(c)}
          >
            <div className="contact-avatar">{c.name.trim().charAt(0).toUpperCase()}</div>
            <div className="contact-info">
              <div className="contact-name">{c.name}</div>
              <div className="contact-preview">
                {c.last_message
                  ? c.last_message.length > 28 ? c.last_message.slice(0, 28) + '…' : c.last_message
                  : <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                      {c.current_key ? 'No messages yet' : '⚠ no key set'}
                    </span>
                }
              </div>
            </div>
            <div className="contact-time">{fmt(c.last_message_at ?? c.created_at)}</div>
          </div>
        ))}
      </div>

      {/* Add / send request */}
      {!showAdd ? (
        <button className="add-contact-btn" onClick={() => { setShowAdd(true); setSent(false); setErr(''); }}>
          <UserPlus size={13} /> Send friend request
        </button>
      ) : (
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 10 }}>
            Send friend request
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.6 }}>
            Enter their VPN / LAN IP. They'll see your name and preferred IP, and can accept with theirs.
          </div>
          {err  && <div style={{ fontSize: 11, color: 'var(--status-error)', marginBottom: 8 }}>{err}</div>}
          {sent && <div style={{ fontSize: 11, color: 'var(--status-ok)',   marginBottom: 8 }}>✓ Request sent! Waiting for them to accept.</div>}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input className="modal-input" placeholder="IP address" value={ip}
              onChange={e => setIp(e.target.value)} style={{ flex: 1 }} autoFocus />
            <input className="modal-input" placeholder="Port" value={port}
              onChange={e => setPort(e.target.value)} style={{ width: 68 }}
              onKeyDown={e => e.key === 'Enter' && handleSend()} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-primary" onClick={handleSend} disabled={sending || sent}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Send size={11} />{sending ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-secondary" onClick={() => { setShowAdd(false); setErr(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </aside>
  );
}
