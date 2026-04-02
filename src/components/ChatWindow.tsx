import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Key, Check, X, Trash2, Pencil, RefreshCw } from 'lucide-react';
import type { Contact, Conversation, Message, SecurityLevel, CorpusType } from '../types';
import MessageBubble from './MessageBubble';
import KeyManager    from './KeyManager';
import EditContact   from './EditContact';

const ROTATION_THRESHOLD = 100;

interface Props {
  contact:             Contact;
  conversation:        Conversation;
  messages:            Message[];
  messageCount:        number;
  onSend:              (text: string) => void;
  onUpdateKey:         (key: string, security: SecurityLevel) => void;
  onUpdateCorpus:      (type: any, source: string) => Promise<any>;
  onReprocessSelected: (ids: string[]) => void;
  onDeleteContact:     () => void;
  onEditContact:       (data: { name: string; ip: string; port: number }) => Promise<void>;
}

function groupByDate(messages: Message[]) {
  const groups: Array<{ date: string; msgs: Message[] }> = [];
  for (const msg of messages) {
    const d = new Date(msg.created_at).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const last = groups[groups.length - 1];
    if (last?.date === d) last.msgs.push(msg);
    else groups.push({ date: d, msgs: [msg] });
  }
  return groups;
}

export default function ChatWindow({
  contact, conversation, messages, messageCount,
  onSend, onUpdateKey, onUpdateCorpus, onReprocessSelected, onDeleteContact, onEditContact,
}: Props) {
  const [text,          setText]          = useState('');
  const [showKey,       setShowKey]       = useState(false);
  const [showEdit,      setShowEdit]      = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    setSelectionMode(false);
    setSelected(new Set());
    setText('');
  }, [contact.id]);

  const handleSend = useCallback(() => {
    const t = text.trim();
    if (!t || !conversation.current_key) return;
    onSend(t);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  }, [text, conversation.current_key, onSend]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const toggleSelect = useCallback((id: string) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const handleSaveKey = (key: string, security: SecurityLevel) => {
    onUpdateKey(key, security);
    if (key !== conversation.current_key && messages.some(m => m.token_vector)) {
      setSelectionMode(true);
      setSelected(new Set());
    }
  };

  const handleApplyReprocess = () => {
    if (selected.size === 0) return;
    onReprocessSelected([...selected]);
    setSelectionMode(false);
    setSelected(new Set());
  };

  const hasKey       = !!conversation.current_key;
  const shouldRotate = hasKey && messageCount >= ROTATION_THRESHOLD;
  const groupedMsg   = groupByDate(messages);

  return (
    <div className="chat-area">
      {/* ── Header ── */}
      <div className="chat-header">
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--bg-panel)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 600, color: 'var(--accent-teal)', flexShrink: 0,
        }}>
          {contact.name.charAt(0).toUpperCase()}
        </div>

        <div className="chat-header-info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="chat-header-name">{contact.name}</span>
            <button
              className="icon-btn"
              style={{ width: 20, height: 20 }}
              onClick={() => setShowEdit(true)}
              title="Edit contact name / IP"
            >
              <Pencil size={11} />
            </button>
          </div>
          <div className="chat-header-ip">{contact.ip}:{contact.port}</div>
        </div>

        <div className="header-actions">
          {/* Selection mode controls */}
          {selectionMode && (
            <>
              <button
                className="btn-secondary"
                onClick={() => { setSelectionMode(false); setSelected(new Set()); }}
                style={{ padding: '5px 10px', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <X size={11} /> Cancel
              </button>
              <button
                className="apply-btn"
                onClick={handleApplyReprocess}
                disabled={selected.size === 0}
              >
                <Check size={13} />
                Re-decode {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
            </>
          )}

          {/* Key rotation nudge */}
          {shouldRotate && !selectionMode && (
            <button
              className="key-btn"
              onClick={() => setShowKey(true)}
              style={{ borderColor: 'var(--accent-yellow)', color: 'var(--accent-yellow)', animation: 'blink 2s ease-in-out infinite' }}
              title={`${messageCount} messages — consider rotating your key`}
            >
              <RefreshCw size={11} />
              Rotate key
            </button>
          )}

          {/* Key button */}
          <button
            className={`key-btn ${hasKey ? 'key-active' : 'key-empty'}`}
            onClick={() => setShowKey(true)}
            title={hasKey ? 'Change encryption key' : 'Set encryption key'}
          >
            <span className="key-dot" />
            <Key size={11} />
            {hasKey
              ? conversation.current_key.length > 14
                ? conversation.current_key.slice(0, 14) + '…'
                : conversation.current_key
              : 'no key'
            }
          </button>

          {/* Delete contact */}
          <button className="icon-btn" onClick={onDeleteContact} title="Remove contact">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className={`messages-scroll ${selectionMode ? 'selection-mode' : ''}`}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', color: 'var(--text-muted)',
            gap: 8, paddingTop: 80,
          }}>
            <Key size={32} style={{ opacity: 0.15 }} />
            <div style={{ fontSize: 12 }}>
              {hasKey ? 'No messages yet. Send the first one.' : 'Set a key to start messaging.'}
            </div>
          </div>
        ) : (
          groupedMsg.map(group => (
            <div key={group.date}>
              <div className="date-divider">{group.date}</div>
              {group.msgs.map(msg => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  selectionMode={selectionMode}
                  selected={selected.has(msg.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className={`input-area ${!hasKey ? 'no-key' : ''}`}>
        <textarea
          ref={textareaRef}
          className="message-input"
          placeholder={hasKey ? 'Message  (Enter to send · Shift+Enter for newline)' : 'Set a key first…'}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={!hasKey}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={!hasKey || !text.trim()}
        >
          <Send size={15} />
        </button>
      </div>

      {/* ── Modals ── */}
      {showKey && (
        <KeyManager
          conversation={conversation}
          messageCount={messageCount}
          onSave={handleSaveKey}
          onSaveCorpus={onUpdateCorpus}
          onClose={() => setShowKey(false)}
        />
      )}
      {showEdit && (
        <EditContact
          contact={contact}
          onSave={onEditContact}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}
