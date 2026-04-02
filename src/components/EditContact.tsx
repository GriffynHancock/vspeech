import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Contact } from '../types';

interface Props {
  contact: Contact;
  onSave: (data: { name: string; ip: string; port: number }) => Promise<void>;
  onClose: () => void;
}

export default function EditContact({ contact, onSave, onClose }: Props) {
  const [name,  setName]  = useState(contact.name);
  const [ip,    setIp]    = useState(contact.ip);
  const [port,  setPort]  = useState(String(contact.port));
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const p = parseInt(port, 10);
    if (!name.trim())               { setError('Name is required'); return; }
    if (!ip.trim())                 { setError('IP address is required'); return; }
    if (isNaN(p) || p < 1 || p > 65535) { setError('Port must be 1–65535'); return; }

    setBusy(true); setError('');
    try {
      await onSave({ name: name.trim(), ip: ip.trim(), port: p });
      onClose();
    } catch (e: any) {
      setError(e?.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-title">
          <Pencil size={14} style={{ color: 'var(--accent-blue)' }} />
          Edit Contact
        </div>
        <div className="modal-subtitle">
          Changing the IP updates where future messages are sent.
          All existing messages and conversation history are preserved.
        </div>

        {error && (
          <div style={{
            padding: '8px 10px', marginBottom: 12,
            background: 'rgba(244,135,113,0.1)',
            border: '1px solid var(--status-error)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 11, color: 'var(--status-error)',
          }}>
            {error}
          </div>
        )}

        <div className="modal-field">
          <label className="modal-label">Display name</label>
          <input
            className="modal-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Contact name"
            autoFocus
          />
        </div>

        <div className="modal-field">
          <label className="modal-label">IP address</label>
          <input
            className="modal-input"
            value={ip}
            onChange={e => setIp(e.target.value)}
            placeholder="e.g. 100.64.0.2"
          />
        </div>

        <div className="modal-field">
          <label className="modal-label">Port</label>
          <input
            className="modal-input"
            value={port}
            onChange={e => setPort(e.target.value)}
            placeholder="3000"
            style={{ width: 100 }}
          />
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
