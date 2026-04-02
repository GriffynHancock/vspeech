import { useState, useEffect } from 'react';
import { Settings, Globe, User, X } from 'lucide-react';
import type { AppSettings } from '../types';

interface Props {
  settings:     AppSettings;
  detectedIp:   string;
  onSave:       (s: Partial<AppSettings>) => Promise<void>;
  onClose:      () => void;
  onOpenWikiIndex?: () => void;
}

export default function SettingsPanel({ settings, detectedIp, onSave, onClose, onOpenWikiIndex }: Props) {
  const [publicIp,     setPublicIp]     = useState(settings.public_ip     ?? '');
  const [displayName,  setDisplayName]  = useState(settings.display_name  ?? '');
  const [busy,         setBusy]         = useState(false);
  const [saved,        setSaved]        = useState(false);

  useEffect(() => {
    setPublicIp(settings.public_ip ?? '');
    setDisplayName(settings.display_name ?? '');
  }, [settings]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave({ public_ip: publicIp.trim(), display_name: displayName.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="modal-title">
            <Settings size={14} style={{ color: 'var(--accent-blue)' }} />
            Settings
          </div>
          <button className="icon-btn" onClick={onClose}><X size={13} /></button>
        </div>
        <div className="modal-subtitle">
          These settings affect how you appear to peers. Changes take effect immediately.
        </div>

        <div className="modal-field">
          <label className="modal-label">
            <Globe size={10} style={{ display: 'inline', marginRight: 4 }} />
            Your public / VPN IP address
          </label>
          <input
            className="modal-input"
            value={publicIp}
            onChange={e => setPublicIp(e.target.value)}
            placeholder={`auto-detected: ${detectedIp}`}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.6 }}>
            When using Tailscale or a VPN, set this to your VPN IP (e.g. <code style={{ color: 'var(--accent-teal)' }}>100.x.x.x</code>) so peers can reach you.
            Leave blank to auto-detect.
          </div>
        </div>

        <div className="modal-field">
          <label className="modal-label">
            <User size={10} style={{ display: 'inline', marginRight: 4 }} />
            Your display name (shown to peers in friend requests)
          </label>
          <input
            className="modal-input"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Alice"
          />
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : saved ? '✓ Saved!' : 'Save settings'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>

        {onOpenWikiIndex && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => { onClose(); onOpenWikiIndex(); }}
              style={{
                width: '100%', padding: '8px 0', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11,
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6, transition: 'all var(--anim-fast)',
              }}
              onMouseOver={e => { (e.target as any).style.borderColor = 'var(--accent-teal)'; (e.target as any).style.color = 'var(--accent-teal)'; }}
              onMouseOut={e => { (e.target as any).style.borderColor = 'var(--border)'; (e.target as any).style.color = 'var(--text-secondary)'; }}
            >
              ◈ Manage Wikipedia article index
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
