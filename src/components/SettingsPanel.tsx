/**
 * SettingsPanel.tsx — Tabbed settings modal
 *
 * Tab 1 GENERAL  : display name, VPN IP
 * Tab 2 DATASET  : Wikipedia index build + custom corpus guidance
 * Tab 3 SECURITY : encryption info, reset instructions
 */
import { useState, useEffect, useRef } from 'react';
import {
  Settings, Globe, User, X, Database, Download, RefreshCw,
  CheckCircle, AlertCircle, Clock, Shield, Key,
} from 'lucide-react';
import type { AppSettings, SystemInfo } from '../types';

interface Props {
  settings:   AppSettings;
  systemInfo: SystemInfo | null;
  onSave:     (s: Partial<AppSettings>) => Promise<void>;
  onClose:    () => void;
}

type Tab = 'general' | 'dataset' | 'security';
type IndexStatus = 'missing' | 'demo' | 'partial' | 'ready';
interface WikiStatus {
  status:   IndexStatus;
  articles: number;
  level:    number | null;
  date:     string | null;
  checksum: string | null;
}

async function apiCall<T>(url: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('vs_token') ?? '';
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as any).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function TabBtn({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '9px 4px', background: 'none', border: 'none',
      borderBottom: `2px solid ${active ? 'var(--accent-teal)' : 'transparent'}`,
      color: active ? 'var(--text-bright)' : 'var(--text-muted)',
      cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11, fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      transition: 'all var(--anim-fast)',
    }}>
      {icon} {label}
    </button>
  );
}

const STATUS_COLOUR: Record<IndexStatus, string> = {
  missing: 'var(--status-error)',
  demo:    'var(--accent-yellow)',
  partial: 'var(--accent-yellow)',
  ready:   'var(--status-ok)',
};
const STATUS_LABEL: Record<IndexStatus, string> = {
  missing: 'No index found',
  demo:    'Demo index — ~100 articles (limited security)',
  partial: 'Partial build — can resume',
  ready:   'Full index ready',
};

export default function SettingsPanel({ settings, systemInfo, onSave, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');

  // ── GENERAL state ──────────────────────────────────────────────
  const [publicIp,    setPublicIp]    = useState(settings.public_ip    ?? '');
  const [displayName, setDisplayName] = useState(settings.display_name ?? '');
  const [saveBusy,    setSaveBusy]    = useState(false);
  const [saveMsg,     setSaveMsg]     = useState('');

  useEffect(() => {
    setPublicIp(settings.public_ip ?? '');
    setDisplayName(settings.display_name ?? '');
  }, [settings]);

  const handleSaveGeneral = async () => {
    setSaveBusy(true);
    try {
      await onSave({ public_ip: publicIp.trim(), display_name: displayName.trim() });
      setSaveMsg('✓ Saved!');
      setTimeout(() => setSaveMsg(''), 2000);
    } finally { setSaveBusy(false); }
  };

  // ── DATASET / wiki state ───────────────────────────────────────
  const [wikiStatus,    setWikiStatus]    = useState<WikiStatus | null>(null);
  const [wikiLoading,   setWikiLoading]   = useState(true);
  const [wikiBuilding,  setWikiBuilding]  = useState(false);
  const [buildLevel,    setBuildLevel]    = useState(4);
  const [buildPhase,    setBuildPhase]    = useState<'select' | 'building' | 'done'>('select');
  const [progressLines, setProgressLines] = useState<any[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiCall<WikiStatus>('/api/wiki-index/status')
      .then(s => { setWikiStatus(s); setWikiLoading(false); })
      .catch(() => setWikiLoading(false));
  }, []);

  // WS events for build progress come via existing App WS hook.
  // We listen for a custom DOM event that App dispatches.
  useEffect(() => {
    const onMsg = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (!msg) return;
      if (msg.type === 'wiki_index_started') {
        setWikiBuilding(true); setBuildPhase('building'); setProgressLines([]);
      } else if (msg.type === 'wiki_index_progress') {
        setProgressLines(prev => [...prev, msg]);
      } else if (msg.type === 'wiki_index_finished') {
        setWikiBuilding(false); setBuildPhase('done');
        if (msg.status) setWikiStatus(msg.status);
      }
    };
    window.addEventListener('vs:ws', onMsg);
    return () => window.removeEventListener('vs:ws', onMsg);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progressLines]);

  const handleBuild = async (level: number, resume: boolean) => {
    setProgressLines([]); setBuildPhase('building'); setWikiBuilding(true);
    try {
      await apiCall('/api/wiki-index/build', { method: 'POST', body: JSON.stringify({ level, resume }) });
    } catch (e: any) {
      setWikiBuilding(false); setBuildPhase('select');
      alert(`Build failed: ${e.message}`);
    }
  };

  const handleCancelBuild = async () => {
    await apiCall('/api/wiki-index/cancel', { method: 'POST', body: '{}' }).catch(() => {});
    setWikiBuilding(false); setBuildPhase('select');
  };

  const latestProg = progressLines[progressLines.length - 1];
  const buildPct   = latestProg?.percent ?? 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !wikiBuilding && onClose()}>
      <div className="modal" style={{ width: 500, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div className="modal-title">
            <Settings size={14} style={{ color: 'var(--accent-blue)' }} />
            Settings
          </div>
          {!wikiBuilding && <button className="icon-btn" onClick={onClose}><X size={13} /></button>}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)',
          marginTop: 12, marginBottom: 20, flexShrink: 0 }}>
          <TabBtn active={tab === 'general'} onClick={() => setTab('general')}
            icon={<User size={11} />} label="General" />
          <TabBtn active={tab === 'dataset'} onClick={() => setTab('dataset')}
            icon={<Database size={11} />} label="Dataset" />
          <TabBtn active={tab === 'security'} onClick={() => setTab('security')}
            icon={<Shield size={11} />} label="Security" />
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 2 }}>

          {/* ─── GENERAL ─── */}
          {tab === 'general' && (
            <>
              <div className="modal-field">
                <label className="modal-label">
                  <User size={10} style={{ display: 'inline', marginRight: 4 }} />
                  Display name (shown to peers)
                </label>
                <input className="modal-input" value={displayName}
                  onChange={e => setDisplayName(e.target.value)} placeholder="e.g. Alice" autoFocus />
              </div>

              <div className="modal-field">
                <label className="modal-label">
                  <Globe size={10} style={{ display: 'inline', marginRight: 4 }} />
                  Public / VPN IP address
                </label>
                <input className="modal-input" value={publicIp}
                  onChange={e => setPublicIp(e.target.value)}
                  placeholder={`auto-detected: ${systemInfo?.myIp ?? '…'}`} />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.6 }}>
                  Set your Tailscale / VPN IP so peers can reach you.
                  Currently advertising:{' '}
                  <strong style={{ color: 'var(--accent-teal)' }}>
                    {systemInfo?.advertisedIp ?? '…'}
                  </strong>
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn-primary" onClick={handleSaveGeneral} disabled={saveBusy}>
                  {saveBusy ? 'Saving…' : saveMsg || 'Save settings'}
                </button>
                <button className="btn-secondary" onClick={onClose}>Close</button>
              </div>
            </>
          )}

          {/* ─── DATASET ─── */}
          {tab === 'dataset' && (
            <>
              {/* Current index status */}
              {wikiLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingBottom: 12 }}>
                  Checking index…
                </div>
              ) : wikiStatus && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '10px 14px', marginBottom: 16,
                  background: 'var(--bg-editor)',
                  border: `1px solid ${STATUS_COLOUR[wikiStatus.status]}44`,
                  borderRadius: 'var(--radius-sm)',
                }}>
                  {/* Status icon */}
                  {wikiStatus.status === 'ready'
                    ? <CheckCircle size={14} style={{ color: 'var(--status-ok)', flexShrink: 0, marginTop: 1 }} />
                    : wikiStatus.status === 'partial'
                    ? <Clock size={14} style={{ color: 'var(--accent-yellow)', flexShrink: 0, marginTop: 1 }} />
                    : <AlertCircle size={14} style={{ color: STATUS_COLOUR[wikiStatus.status], flexShrink: 0, marginTop: 1 }} />
                  }
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLOUR[wikiStatus.status] }}>
                      {STATUS_LABEL[wikiStatus.status]}
                    </div>
                    {wikiStatus.articles > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {wikiStatus.articles.toLocaleString()} articles
                        {wikiStatus.level ? ` · Level ${wikiStatus.level}` : ''}
                        {wikiStatus.date ? ` · ${wikiStatus.date}` : ''}
                      </div>
                    )}
                    {/* Checksum for ready index */}
                    {wikiStatus.status === 'ready' && wikiStatus.checksum && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                          letterSpacing: '0.1em', color: 'var(--accent-teal)', marginBottom: 3 }}>
                          Checksum — share with contact to verify match
                        </div>
                        <code style={{ fontSize: 11, color: 'var(--text-bright)',
                          letterSpacing: '0.04em', wordBreak: 'break-all' }}>
                          {wikiStatus.checksum.match(/.{8}/g)?.join(' ') ?? wikiStatus.checksum}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Security explanation (only for non-ready) */}
              {wikiStatus && wikiStatus.status !== 'ready' && buildPhase === 'select' && (
                <div style={{
                  padding: '10px 12px', marginBottom: 14,
                  background: 'rgba(220,220,170,0.06)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', fontSize: 11,
                  color: 'var(--text-secondary)', lineHeight: 1.7,
                }}>
                  <strong style={{ color: 'var(--accent-yellow)' }}>Security impact:</strong>{' '}
                  The demo index has ~100 pages. Level 4 has 10,000 — 100× harder to brute-force.
                  Both peers must use the same index; compare checksums out-of-band.
                </div>
              )}

              {/* Level selection */}
              {buildPhase === 'select' && !wikiBuilding && (
                <div className="modal-field">
                  <label className="modal-label">Download Wikipedia index</label>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {([3, 4] as const).map(l => {
                      const meta = {
                        3: { art: '~1,000',  time: '~1 min',   sec: 'Good · 10× demo' },
                        4: { art: '~10,000', time: '5–15 min', sec: 'Excellent · 100× demo' },
                      }[l];
                      const active = buildLevel === l;
                      return (
                        <button key={l} type="button" onClick={() => setBuildLevel(l)} style={{
                          flex: 1, padding: '10px 8px', textAlign: 'left',
                          background: active ? 'rgba(79,195,247,0.08)' : 'var(--bg-input)',
                          border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                          borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                          fontFamily: 'var(--font)', transition: 'all var(--anim-fast)',
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3,
                            color: active ? 'var(--accent-blue)' : 'var(--text-primary)' }}>
                            Level {l} · {meta.art}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            ⏱ {meta.time}<br />🔒 {meta.sec}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                      onClick={() => handleBuild(buildLevel, false)}>
                      <Download size={13} /> Download Level {buildLevel}
                    </button>
                    {wikiStatus?.status === 'partial' && (
                      <button className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => handleBuild(buildLevel, true)}>
                        <RefreshCw size={12} /> Resume
                      </button>
                    )}
                    {wikiStatus?.status === 'ready' && (
                      <button className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => handleBuild(buildLevel, false)}>
                        <RefreshCw size={12} /> Rebuild
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Build progress */}
              {(buildPhase === 'building' || buildPhase === 'done') && (
                <div style={{ marginBottom: 16 }}>
                  {wikiBuilding && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between',
                        fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        <span>{latestProg?.message ?? 'Starting…'}</span>
                        <span>{buildPct}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--bg-input)', borderRadius: 2,
                        marginBottom: 10, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent-teal)',
                          width: `${buildPct}%`, transition: 'width 0.3s ease' }} />
                      </div>
                    </>
                  )}

                  <div ref={logRef} style={{
                    height: 160, overflowY: 'auto', padding: '6px 10px',
                    background: 'var(--bg-editor)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font)',
                    fontSize: 10, color: 'var(--text-secondary)', lineHeight: 1.6,
                  }}>
                    {progressLines.length === 0
                      ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Starting build…</span>
                      : progressLines.map((l, i) => (
                          <div key={i} style={{
                            color: l.type === 'error' ? 'var(--status-error)'
                                 : l.type === 'done'  ? 'var(--status-ok)'
                                 : l.type === 'phase' ? 'var(--accent-blue)'
                                 : 'var(--text-secondary)',
                          }}>
                            {l.type === 'progress'
                              ? `  ↳ ${l.done?.toLocaleString()}/${l.total?.toLocaleString()} — ${l.message}`
                              : `${l.type === 'done' ? '✓' : l.type === 'error' ? '✗' : '·'} ${l.message}`
                            }
                          </div>
                        ))
                    }
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {wikiBuilding ? (
                      <button className="btn-danger"
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        onClick={handleCancelBuild}>
                        <X size={12} /> Cancel
                      </button>
                    ) : (
                      <>
                        <button className="btn-secondary"
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          onClick={() => setBuildPhase('select')}>
                          ← Back
                        </button>
                        <button className="btn-primary" style={{ flex: 1 }} onClick={onClose}>
                          Done
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Private dataset guidance */}
              <div style={{ marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
                  marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Key size={11} style={{ color: 'var(--accent-purple)' }} />
                  Using a private dataset
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                  To use your own files instead of Wikipedia, open a conversation and click the{' '}
                  <strong style={{ color: 'var(--accent-yellow)' }}>🔑 key button</strong> →{' '}
                  <strong>Corpus Source</strong> tab. Point both parties to the same URL directory
                  (serve with <code>python3 -m http.server 8080</code>) or local folder of{' '}
                  <code>.txt</code> files. A fingerprint is generated — verify it matches
                  out-of-band before messaging.
                </div>
              </div>
            </>
          )}

          {/* ─── SECURITY ─── */}
          {tab === 'security' && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                {/* Engine */}
                <InfoBox>
                  <InfoLabel>Python Engine</InfoLabel>
                  <div style={{ fontSize: 11, color: systemInfo?.engine.ok ? 'var(--status-ok)' : 'var(--status-error)' }}>
                    {systemInfo?.engine.ok ? '✓ Ready' : '✗ Offline — install deps'}
                  </div>
                  {systemInfo?.engine.python && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                      {systemInfo.engine.python}
                    </div>
                  )}
                  {!systemInfo?.engine.ok && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                      <code style={{ color: 'var(--accent-teal)' }}>pip install -r requirements.txt</code>
                    </div>
                  )}
                </InfoBox>

                {/* Encryption model */}
                <InfoBox>
                  <InfoLabel>Encryption Stack</InfoLabel>
                  <div style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.8 }}>
                    <div>🔑 Login: scrypt (N=2¹⁶) → 64 MB RAM / brute-force attempt</div>
                    <div>🔒 Storage: AES-256-GCM, random 96-bit IV per field, auth tag verified</div>
                    <div>🌐 Tokeniser: SentencePiece BPE, 256-vocab, trained per-message-iteration</div>
                    <div>📚 Corpus: Wikipedia Vital Articles, seeded from shared key + iteration</div>
                    <div>🔗 Hash chain: SHA-256(seed ‖ H_{n-1}) per iteration</div>
                  </div>
                </InfoBox>

                {/* Log */}
                {systemInfo?.logFile && (
                  <InfoBox>
                    <InfoLabel>Server Log</InfoLabel>
                    <code style={{ fontSize: 10, color: 'var(--accent-teal)', wordBreak: 'break-all' }}>
                      {systemInfo.logFile}
                    </code>
                  </InfoBox>
                )}

                {/* Reset instructions */}
                <div style={{
                  padding: '12px 14px',
                  background: 'rgba(244,135,113,0.05)',
                  border: '1px solid rgba(244,135,113,0.25)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7,
                }}>
                  <div style={{ fontWeight: 700, color: 'var(--status-error)', marginBottom: 6 }}>
                    Recovery options (run in project directory):
                  </div>
                  <div><code style={{ color: 'var(--accent-teal)' }}>./reset.sh --password</code> — reset login password only, keep messages</div>
                  <div><code style={{ color: 'var(--accent-teal)' }}>./reset.sh --indexes</code>  — delete Wikipedia indexes, force re-download</div>
                  <div><code style={{ color: 'var(--accent-teal)' }}>./reset.sh --full</code>     — wipe everything (irreversible)</div>
                </div>
              </div>

              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn-secondary" onClick={onClose}>Close</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Small helper components
function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '12px 14px', background: 'var(--bg-editor)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    }}>
      {children}
    </div>
  );
}

function InfoLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.1em', color: 'var(--text-secondary)', marginBottom: 6,
    }}>
      {children}
    </div>
  );
}
