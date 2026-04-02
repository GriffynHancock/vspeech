import { useState, useEffect, useRef } from 'react';
import { Database, Download, X, CheckCircle, AlertCircle, Clock, RefreshCw } from 'lucide-react';

export interface IndexStatus {
  status:   'missing' | 'demo' | 'partial' | 'ready';
  articles: number;
  level:    number | null;
  date:     string | null;
  checksum: string | null;
  path:     string | null;
}

interface ProgressEvent {
  type:     string;
  message?: string;
  done?:    number;
  total?:   number;
  percent?: number;
  phase?:   number;
  articles?: number;
  errors?:  number;
  checksum?: string;
}

interface Props {
  status:         IndexStatus;
  isBuilding:     boolean;
  progressLines:  ProgressEvent[];
  onBuild:        (level: number, resume: boolean) => void;
  onCancel:       () => void;
  onClose:        () => void;
}

const STATUS_INFO = {
  missing: { icon: AlertCircle, colour: 'var(--status-error)',   label: 'No index found' },
  demo:    { icon: AlertCircle, colour: 'var(--accent-yellow)',  label: 'Demo index (limited security)' },
  partial: { icon: Clock,       colour: 'var(--accent-yellow)',  label: 'Partial build (resume available)' },
  ready:   { icon: CheckCircle, colour: 'var(--status-ok)',      label: 'Full index ready' },
};

const LEVEL_INFO: Record<number, { articles: string; time: string; security: string }> = {
  3: { articles: '~1,000',  time: '~1 min',   security: 'Good — 10× demo' },
  4: { articles: '~10,000', time: '5–15 min', security: 'Excellent — 100× demo' },
  5: { articles: '~50,000', time: '1–3 hrs',  security: 'Maximum — 500× demo' },
};

export default function WikiIndexPanel({ status, isBuilding, progressLines, onBuild, onCancel, onClose }: Props) {
  const [level,   setLevel]   = useState(4);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progressLines]);

  // Latest progress event
  const latest   = progressLines[progressLines.length - 1];
  const pct      = latest?.percent ?? 0;
  const isDone   = !isBuilding && progressLines.some(l => l.type === 'done');
  const canResume = status.status === 'partial';

  const { icon: StatusIcon, colour, label } = STATUS_INFO[status.status];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !isBuilding && onClose()}>
      <div className="modal" style={{ width: 500 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div className="modal-title">
            <Database size={14} style={{ color: 'var(--accent-teal)' }} />
            Wikipedia Article Index
          </div>
          {!isBuilding && (
            <button className="icon-btn" onClick={onClose}><X size={13} /></button>
          )}
        </div>

        {/* Current status */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', marginBottom: 16,
          background: 'var(--bg-editor)', border: `1px solid ${colour}33`,
          borderRadius: 'var(--radius-sm)',
        }}>
          <StatusIcon size={16} style={{ color: colour, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colour }}>{label}</div>
            {status.articles > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {status.articles.toLocaleString()} articles
                {status.level ? ` · Level ${status.level}` : ''}
                {status.date ? ` · snapshot ${status.date}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* Why this matters */}
        {(status.status === 'missing' || status.status === 'demo') && !isBuilding && (
          <div style={{
            padding: '10px 12px', marginBottom: 16,
            background: 'rgba(220,220,170,0.06)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7,
          }}>
            <strong style={{ color: 'var(--accent-yellow)' }}>Why this matters for security:</strong><br />
            The demo index has only ~100 pages. Each message samples from that pool — an attacker
            who knows you're using VectorSpeech can narrow down the tokeniser to ~100 candidates.
            The full Level 4 index has 10,000 pages, making the selection space 100× larger.
            <br /><br />
            Both peers need the same index. The snapshot date and checksum confirm they match.
          </div>
        )}

        {/* Build controls — shown when not building and not fully ready */}
        {!isBuilding && status.status !== 'ready' && (
          <>
            <div className="modal-field">
              <label className="modal-label">Select index level</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([3, 4] as const).map(l => {
                  const info = LEVEL_INFO[l]; const active = level === l;
                  return (
                    <button key={l} type="button" onClick={() => setLevel(l)} style={{
                      flex: 1, padding: '10px 8px', textAlign: 'left',
                      background: active ? 'rgba(79,195,247,0.08)' : 'var(--bg-input)',
                      border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      fontFamily: 'var(--font)', transition: 'all var(--anim-fast)',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: active ? 'var(--accent-blue)' : 'var(--text-primary)', marginBottom: 4 }}>
                        Level {l} · {info.articles}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        ⏱ {info.time}<br />
                        🔒 {info.security}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={() => onBuild(level, false)}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Download size={13} /> Download Level {level} index
              </button>
              {canResume && (
                <button className="btn-secondary" onClick={() => onBuild(level, true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <RefreshCw size={12} /> Resume
                </button>
              )}
            </div>
          </>
        )}

        {/* Already ready — show checksum */}
        {!isBuilding && status.status === 'ready' && (
          <>
            <div style={{
              padding: '10px 12px', marginBottom: 14,
              background: 'rgba(78,201,176,0.06)', border: '1px solid var(--accent-teal)',
              borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent-teal)', marginBottom: 6 }}>
                Index checksum (share with your contact to verify match)
              </div>
              <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--text-bright)', letterSpacing: '0.06em', wordBreak: 'break-all' }}>
                {(status.checksum ?? '').match(/.{8}/g)?.join(' ') ?? status.checksum}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" onClick={() => onBuild(4, false)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <Download size={11} /> Rebuild
              </button>
              <button className="btn-primary" onClick={onClose} style={{ flex: 1 }}>Close</button>
            </div>
          </>
        )}

        {/* Progress display */}
        {(isBuilding || isDone) && (
          <div style={{ marginTop: 16 }}>
            {/* Progress bar */}
            {isBuilding && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  <span>{latest?.message ?? 'Starting…'}</span>
                  <span>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-input)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 2,
                    background: 'var(--accent-teal)',
                    width: `${pct}%`,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
                {latest?.done != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {latest.done.toLocaleString()} / {(latest.total ?? 0).toLocaleString()} articles
                  </div>
                )}
              </>
            )}

            {/* Log window */}
            <div ref={logRef} style={{
              height: 180, overflowY: 'auto', padding: '8px 10px',
              background: 'var(--bg-editor)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font)', fontSize: 10,
              color: 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              {progressLines.map((line, i) => (
                <div key={i} style={{
                  color: line.type === 'error' ? 'var(--status-error)'
                       : line.type === 'done'  ? 'var(--status-ok)'
                       : line.type === 'phase' ? 'var(--accent-blue)'
                       : 'var(--text-secondary)',
                }}>
                  {line.type === 'progress'
                    ? `  ↳ ${line.done?.toLocaleString()}/${line.total?.toLocaleString()} — ${line.message}`
                    : `${line.type === 'done' ? '✓' : line.type === 'error' ? '✗' : '·'} ${line.message}`
                  }
                </div>
              ))}
            </div>

            {isBuilding && (
              <button className="btn-danger" onClick={onCancel}
                style={{ marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <X size={12} /> Cancel download
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
