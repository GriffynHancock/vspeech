import { useState } from 'react';
import {
  Key, Eye, EyeOff, RefreshCw, Globe, FolderOpen, Database,
  AlertTriangle, Copy, CheckCircle,
} from 'lucide-react';
import type { SecurityLevel, CorpusType, Conversation } from '../types';

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────
const SECURITY_INFO: Record<SecurityLevel, { label: string; detail: string }> = {
  low:    { label: 'Low',    detail: '5 pages · fastest'  },
  medium: { label: 'Medium', detail: '10 pages · balanced' },
  high:   { label: 'High',   detail: '20 pages · slowest' },
};

const ROTATION_THRESHOLD = 100;

type Tab = 'key' | 'corpus';

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────
interface Props {
  conversation:  Conversation;
  messageCount:  number;
  onSave:        (key: string, security: SecurityLevel) => void;
  onSaveCorpus:  (type: CorpusType, source: string) => Promise<{ corpus_fingerprint?: string } | void>;
  onClose:       () => void;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────
export default function KeyManager({
  conversation, messageCount, onSave, onSaveCorpus, onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('key');

  // ── Key tab ───────────────────────────────────────────────────
  const [newKey,  setNewKey]  = useState('');
  const [sec,     setSec]     = useState<SecurityLevel>(conversation.security_level);
  const [show,    setShow]    = useState(false);
  const [keyErr,  setKeyErr]  = useState('');

  // ── Corpus tab ────────────────────────────────────────────────
  const [cType,    setCType]    = useState<CorpusType>(conversation.corpus_type ?? 'wikipedia');
  const [cSource,  setCSource]  = useState(conversation.corpus_source ?? '');
  const [cBusy,    setCBusy]    = useState(false);
  const [cFp,      setCFp]      = useState('');
  const [cErr,     setCErr]     = useState('');
  const [fpCopied, setFpCopied] = useState(false);

  const hasKey      = !!conversation.current_key;
  const shouldRotate = hasKey && messageCount >= ROTATION_THRESHOLD;

  // ── Handlers ──────────────────────────────────────────────────
  const handleSaveKey = () => {
    if (!hasKey && !newKey.trim()) { setKeyErr('Enter a shared key phrase.'); return; }
    if (hasKey && !newKey.trim()) {
      // Just updating security level with existing key
      onSave(conversation.current_key, sec);
      onClose();
      return;
    }
    setKeyErr('');
    onSave(newKey.trim(), sec);
    onClose();
  };

  const handleSaveCorpus = async () => {
    if (cType !== 'wikipedia' && !cSource.trim()) {
      setCErr('Provide a URL or directory path.'); return;
    }
    setCBusy(true); setCErr(''); setCFp('');
    try {
      const result = await onSaveCorpus(cType, cSource.trim());
      if (result && (result as any).corpus_fingerprint) {
        setCFp((result as any).corpus_fingerprint);
      } else {
        setCFp(''); // wikipedia has no fingerprint — that's fine
      }
    } catch (e: any) {
      setCErr(e?.message ?? 'Failed to validate corpus');
    } finally { setCBusy(false); }
  };

  const copyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(cFp);
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 460 }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', margin: '0 -24px 20px',
          borderBottom: '1px solid var(--border)', padding: '0 24px',
        }}>
          {([
            { id: 'key'    as Tab, icon: <Key size={11} />,      label: 'Encryption Key'  },
            { id: 'corpus' as Tab, icon: <Database size={11} />, label: 'Dataset / Corpus' },
          ] as const).map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1, padding: '8px 0', background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === id ? 'var(--accent-teal)' : 'transparent'}`,
                color: tab === id ? 'var(--text-bright)' : 'var(--text-muted)',
                cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all var(--anim-fast)', marginBottom: -1,
              }}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* ══════════════════ KEY TAB ══════════════════ */}
        {tab === 'key' && (
          <>
            {/* Rotation nudge */}
            {shouldRotate && (
              <div style={{
                display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 14,
                background: 'rgba(220,220,170,0.08)',
                border: '1px solid var(--accent-yellow)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11, color: 'var(--accent-yellow)', lineHeight: 1.6,
              }}>
                <RefreshCw size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  <strong>Key rotation suggested</strong> — {messageCount} messages sent. Enter a
                  new shared phrase below to rotate.
                </span>
              </div>
            )}

            {/* How it works */}
            <div className="key-hint" style={{ marginBottom: 14 }}>
              <strong>Seed phrase</strong> + message iteration → Wikipedia pages (or custom dataset)
              → one-time SentencePiece tokeniser → encoded vector.
              The seed phrase is <em>never transmitted</em>. Both parties enter it independently.
            </div>

            {/* Current key (masked) */}
            {hasKey && (
              <div className="modal-field">
                <label className="modal-label">Current key</label>
                <div style={{
                  padding: '8px 12px', background: 'var(--bg-editor)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span>{show
                    ? conversation.current_key
                    : '•'.repeat(Math.min(conversation.current_key.length, 40))
                  }</span>
                  <button
                    onClick={() => setShow(s => !s)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                  >
                    {show ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            )}

            {/* New key input */}
            <div className="modal-field">
              <label className="modal-label">
                {hasKey ? 'New key phrase (leave blank to keep current)' : 'Shared key phrase'}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="modal-input"
                  type={show ? 'text' : 'password'}
                  autoComplete="off" spellCheck={false}
                  placeholder={
                    hasKey
                      ? 'Type new phrase to rotate key…'
                      : 'e.g. correct horse battery staple'
                  }
                  value={newKey}
                  onChange={e => { setNewKey(e.target.value); setKeyErr(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                  autoFocus={!hasKey}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', display: 'flex', padding: 0,
                  }}
                >
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {keyErr && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--status-error)' }}>
                  {keyErr}
                </div>
              )}
            </div>

            {/* Security level */}
            <div className="modal-field">
              <label className="modal-label">Security level (pages sampled per message)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(Object.entries(SECURITY_INFO) as [SecurityLevel, typeof SECURITY_INFO[SecurityLevel]][]).map(([level, info]) => {
                  const active = sec === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setSec(level)}
                      style={{
                        flex: 1, padding: '8px 6px', textAlign: 'center',
                        background: active ? 'rgba(79,195,247,0.1)' : 'var(--bg-input)',
                        border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        transition: 'all var(--anim-fast)',
                      }}
                    >
                      <div style={{
                        fontSize: 11, fontWeight: 600, fontFamily: 'var(--font)', marginBottom: 2,
                        color: active ? 'var(--accent-blue)' : 'var(--text-primary)',
                      }}>
                        {info.label}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font)' }}>
                        {info.detail}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={handleSaveKey}>
                {hasKey ? (newKey ? 'Rotate key' : 'Save security level') : 'Set key'}
              </button>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* ══════════════════ CORPUS TAB ══════════════════ */}
        {tab === 'corpus' && (
          <>
            <div className="modal-subtitle">
              Both parties <strong>must use the same dataset</strong>. The tokeniser is trained on
              it — any difference means messages can't be decoded. Verify the fingerprint matches
              out-of-band before sending.
            </div>

            {/* Source type selector */}
            <div className="modal-field">
              <label className="modal-label">Dataset source</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { type: 'wikipedia' as CorpusType, icon: <Database size={11} />, label: 'Wikipedia' },
                  { type: 'url'       as CorpusType, icon: <Globe size={11} />,    label: 'URL'       },
                  { type: 'local'     as CorpusType, icon: <FolderOpen size={11}/>,label: 'Local dir' },
                ] as const).map(({ type, icon, label }) => {
                  const active = cType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => { setCType(type); setCFp(''); setCErr(''); }}
                      style={{
                        flex: 1, padding: '8px 4px', textAlign: 'center',
                        background: active ? 'rgba(79,195,247,0.1)' : 'var(--bg-input)',
                        border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                        color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                        fontSize: 11, fontFamily: 'var(--font)', fontWeight: 600,
                      }}
                    >
                      {icon} {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Wikipedia explanation */}
            {cType === 'wikipedia' && (
              <div style={{
                padding: '12px', background: 'var(--bg-editor)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7,
              }}>
                Uses the Vital Articles Wikipedia index. Deterministic — both parties train on
                exactly the same pages as long as they have the same index version. No shared files
                needed. Download the full index in <em>Settings → Wikipedia Index</em>.
              </div>
            )}

            {/* URL corpus */}
            {cType === 'url' && (
              <>
                <div className="modal-field">
                  <label className="modal-label">HTTP directory URL</label>
                  <input
                    className="modal-input"
                    value={cSource}
                    onChange={e => setCSource(e.target.value)}
                    placeholder="http://192.168.1.x:8080/corpus/"
                    autoFocus
                  />
                </div>
                <div style={{
                  padding: '10px 12px', marginBottom: 10,
                  background: 'var(--bg-editor)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7,
                }}>
                  <strong style={{ color: 'var(--accent-yellow)' }}>Private dataset workflow:</strong><br />
                  1. Create a directory of <code>.txt</code> files on one machine.<br />
                  2. Serve it: <code style={{ color: 'var(--accent-teal)' }}>python3 -m http.server 8080</code><br />
                  3. Both parties enter the same URL here and click Save.<br />
                  4. <strong>Share the fingerprint out-of-band</strong> to confirm files match.
                </div>
              </>
            )}

            {/* Local corpus */}
            {cType === 'local' && (
              <>
                <div className="modal-field">
                  <label className="modal-label">Absolute directory path (on the server machine)</label>
                  <input
                    className="modal-input"
                    value={cSource}
                    onChange={e => setCSource(e.target.value)}
                    placeholder="/home/user/private-corpus"
                    autoFocus
                  />
                </div>
                <div style={{
                  padding: '10px 12px', marginBottom: 10,
                  background: 'rgba(244,135,113,0.06)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7,
                }}>
                  <AlertTriangle size={11} style={{ display: 'inline', marginRight: 4, color: 'var(--accent-yellow)' }} />
                  Both peers must have <strong>identical .txt files</strong> at this path on their own machines.
                  Any difference — even whitespace — changes the tokeniser and breaks decoding.
                  Always verify using the fingerprint below.
                </div>
              </>
            )}

            {/* Fingerprint result */}
            {cFp && (
              <div style={{
                padding: '10px 12px', marginTop: 12,
                background: 'rgba(78,201,176,0.08)',
                border: '1px solid var(--accent-teal)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 6,
                }}>
                  <div style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: 'var(--accent-teal)',
                  }}>
                    Corpus fingerprint — both parties must see this exact value
                  </div>
                  <button
                    onClick={copyFingerprint}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', background: 'transparent',
                      border: '1px solid var(--accent-teal)', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', color: 'var(--accent-teal)',
                      fontFamily: 'var(--font)', fontSize: 10,
                    }}
                  >
                    {fpCopied ? <CheckCircle size={10} /> : <Copy size={10} />}
                    {fpCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div style={{
                  fontFamily: 'var(--font)', fontSize: 14, fontWeight: 700,
                  color: 'var(--text-bright)', letterSpacing: '0.12em',
                }}>
                  {cFp.match(/.{4}/g)?.join(' ') ?? cFp}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  If your contact's fingerprint differs, your file sets don't match.
                  Check for missing, extra, or modified .txt files.
                </div>
              </div>
            )}

            {/* Wikipedia save note (no fingerprint) */}
            {cFp === '' && cType === 'wikipedia' && !cBusy && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                Wikipedia mode: verify via the index checksum in Settings → Wikipedia Index.
              </div>
            )}

            {/* Error */}
            {cErr && (
              <div style={{
                marginTop: 10, padding: '8px 10px',
                background: 'rgba(244,135,113,0.1)',
                border: '1px solid var(--status-error)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11, color: 'var(--status-error)',
              }}>
                {cErr}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn-primary" onClick={handleSaveCorpus} disabled={cBusy}>
                {cBusy ? 'Validating…' : 'Save dataset settings'}
              </button>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
