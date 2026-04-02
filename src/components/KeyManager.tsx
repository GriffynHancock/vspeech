import { useState } from 'react';
import { Key, Eye, EyeOff, RefreshCw, Globe, FolderOpen, Database } from 'lucide-react';
import type { SecurityLevel, CorpusType, Conversation } from '../types';

interface Props {
  conversation:  Conversation;
  messageCount:  number;
  onSave:        (key: string, security: SecurityLevel) => void;
  onSaveCorpus:  (type: CorpusType, source: string) => Promise<{ corpus_fingerprint?: string } | void>;
  onClose:       () => void;
}

const SECURITY_INFO: Record<SecurityLevel, { label: string; detail: string }> = {
  low:    { label: 'Low',    detail: '5 files · fastest' },
  medium: { label: 'Medium', detail: '10 files · balanced' },
  high:   { label: 'High',   detail: '20 files · slowest' },
};
const ROTATION_THRESHOLD = 100;

type Tab = 'key' | 'corpus';

export default function KeyManager({ conversation, messageCount, onSave, onSaveCorpus, onClose }: Props) {
  const [tab,       setTab]       = useState<Tab>('key');

  // Key tab
  const [newKey,    setNewKey]    = useState('');
  const [sec,       setSec]       = useState<SecurityLevel>(conversation.security_level);
  const [show,      setShow]      = useState(false);
  const [keyErr,    setKeyErr]    = useState('');

  // Corpus tab
  const [cType,     setCType]     = useState<CorpusType>(conversation.corpus_type ?? 'wikipedia');
  const [cSource,   setCSource]   = useState(conversation.corpus_source ?? '');
  const [cBusy,     setCBusy]     = useState(false);
  const [cFp,       setCFp]       = useState('');
  const [cErr,      setCErr]      = useState('');

  const hasKey      = !!conversation.current_key;
  const shouldRotate = hasKey && messageCount >= ROTATION_THRESHOLD;

  const handleSaveKey = () => {
    if (hasKey && !newKey.trim()) { setKeyErr('Type a new phrase to replace the current key, or Cancel.'); return; }
    if (!hasKey && !newKey.trim()) { setKeyErr('Enter a key phrase.'); return; }
    setKeyErr('');
    onSave(newKey.trim() || conversation.current_key, sec);
    onClose();
  };

  const handleSaveCorpus = async () => {
    if (cType !== 'wikipedia' && !cSource.trim()) { setCErr('Provide a URL or path.'); return; }
    setCBusy(true); setCErr(''); setCFp('');
    try {
      const result = await onSaveCorpus(cType, cSource.trim());
      if (result && (result as any).corpus_fingerprint) {
        setCFp((result as any).corpus_fingerprint);
      }
    } catch (e: any) {
      setCErr(e?.message ?? 'Failed to save corpus settings');
    } finally { setCBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 440 }}>
        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          {(['key', 'corpus'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '8px 0', background: 'none', border: 'none',
              borderBottom: `2px solid ${tab === t ? 'var(--accent-teal)' : 'transparent'}`,
              color: tab === t ? 'var(--text-bright)' : 'var(--text-muted)',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all var(--anim-fast)',
            }}>
              {t === 'key' ? <Key size={12} /> : <Database size={12} />}
              {t === 'key' ? 'Encryption Key' : 'Corpus Source'}
            </button>
          ))}
        </div>

        {/* ─── Key tab ─── */}
        {tab === 'key' && (
          <>
            {shouldRotate && (
              <div style={{
                display: 'flex', gap: 10, padding: '10px 12px', marginBottom: 14,
                background: 'rgba(220,220,170,0.08)', border: '1px solid var(--accent-yellow)',
                borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--accent-yellow)', lineHeight: 1.6,
              }}>
                <RefreshCw size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                <span><strong>Key rotation suggested</strong> — {messageCount} messages sent with this key.</span>
              </div>
            )}

            <div className="key-hint" style={{ marginBottom: 14 }}>
              <strong>Seed phrase</strong> + iteration → Wikipedia pages (or custom corpus) →
              one-time tokeniser. Never transmitted. Both parties enter it independently offline.
            </div>

            {hasKey && (
              <div className="modal-field">
                <label className="modal-label">Current key</label>
                <div style={{
                  padding: '8px 12px', background: 'var(--bg-editor)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font)',
                }}>
                  {show ? conversation.current_key : '•'.repeat(Math.min(conversation.current_key.length, 32))}
                </div>
              </div>
            )}

            <div className="modal-field">
              <label className="modal-label">
                {hasKey ? 'New key phrase (leave blank to keep current)' : 'Key phrase / shared secret'}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  className="modal-input"
                  type={show ? 'text' : 'password'}
                  autoComplete="off" spellCheck={false}
                  placeholder={hasKey ? 'Type new phrase to replace…' : 'e.g. correct horse battery staple'}
                  value={newKey}
                  onChange={e => { setNewKey(e.target.value); setKeyErr(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
                  autoFocus={!hasKey}
                  style={{ paddingRight: 40 }}
                />
                <button type="button" onClick={() => setShow(s => !s)} style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', display: 'flex', padding: 0,
                }}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {keyErr && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--status-error)' }}>{keyErr}</div>}
            </div>

            <div className="modal-field">
              <label className="modal-label">Security level</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(Object.keys(SECURITY_INFO) as SecurityLevel[]).map(level => {
                  const info = SECURITY_INFO[level]; const active = sec === level;
                  return (
                    <button key={level} type="button" onClick={() => setSec(level)} style={{
                      flex: 1, padding: '8px 6px', textAlign: 'center',
                      background: active ? 'rgba(79,195,247,0.1)' : 'var(--bg-input)',
                      border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer', transition: 'all var(--anim-fast)',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: active ? 'var(--accent-blue)' : 'var(--text-primary)', fontFamily: 'var(--font)', marginBottom: 2 }}>
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
                {hasKey ? (newKey ? 'Change key' : 'Save settings') : 'Set key'}
              </button>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {/* ─── Corpus tab ─── */}
        {tab === 'corpus' && (
          <>
            <div className="modal-subtitle">
              Both parties must use the <strong>same corpus source</strong>.
              Verify the fingerprint matches out-of-band before messaging.
            </div>

            <div className="modal-field">
              <label className="modal-label">Source type</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { type: 'wikipedia' as CorpusType, icon: <Globe size={11} />,      label: 'Wikipedia' },
                  { type: 'url'       as CorpusType, icon: <Globe size={11} />,      label: 'URL' },
                  { type: 'local'     as CorpusType, icon: <FolderOpen size={11} />, label: 'Local files' },
                ].map(({ type, icon, label }) => {
                  const active = cType === type;
                  return (
                    <button key={type} type="button" onClick={() => { setCType(type); setCFp(''); setCErr(''); }} style={{
                      flex: 1, padding: '8px 4px', textAlign: 'center',
                      background: active ? 'rgba(79,195,247,0.1)' : 'var(--bg-input)',
                      border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                      fontSize: 11, fontFamily: 'var(--font)', fontWeight: 600,
                    }}>
                      {icon}{label}
                    </button>
                  );
                })}
              </div>
            </div>

            {cType === 'url' && (
              <div className="modal-field">
                <label className="modal-label">Directory URL</label>
                <input className="modal-input" value={cSource} onChange={e => setCSource(e.target.value)}
                  placeholder="http://192.168.1.x:8080/corpus/" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.6 }}>
                  Host your .txt files with <code>python3 -m http.server 8080</code> in the corpus directory.
                  The server expects an Apache-style directory listing or a <code>corpus.json</code> file listing filenames.
                </div>
              </div>
            )}

            {cType === 'local' && (
              <div className="modal-field">
                <label className="modal-label">Local directory path (server-side)</label>
                <input className="modal-input" value={cSource} onChange={e => setCSource(e.target.value)}
                  placeholder="/home/user/corpus-files" />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.6 }}>
                  Absolute path to a directory of .txt files on the machine running the VectorSpeech server.
                  Both users must have identical file sets — verify the fingerprint matches.
                </div>
              </div>
            )}

            {cType === 'wikipedia' && (
              <div style={{
                padding: '12px', background: 'var(--bg-editor)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7,
              }}>
                Uses the Vital Articles Wikipedia index. No shared files needed — deterministic selection
                based on the key and iteration number ensures both parties train on the same pages.
              </div>
            )}

            {cFp && (
              <div style={{
                padding: '10px 12px', marginTop: 12,
                background: 'rgba(78,201,176,0.08)', border: '1px solid var(--accent-teal)',
                borderRadius: 'var(--radius-sm)',
              }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent-teal)', marginBottom: 6 }}>
                  Corpus fingerprint — verify with your contact
                </div>
                <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text-bright)', letterSpacing: '0.08em' }}>
                  {cFp.match(/.{4}/g)?.join(' ') ?? cFp}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                  Both parties must see this same value. If it differs, your .txt files don't match.
                </div>
              </div>
            )}

            {cErr && (
              <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(244,135,113,0.1)', border: '1px solid var(--status-error)', borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--status-error)' }}>
                {cErr}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn-primary" onClick={handleSaveCorpus} disabled={cBusy}>
                {cBusy ? 'Validating…' : 'Save corpus settings'}
              </button>
              <button className="btn-secondary" onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
