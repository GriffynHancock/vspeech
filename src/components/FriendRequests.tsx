import { useState } from 'react';
import { UserPlus, Check, X, Loader } from 'lucide-react';
import type { FriendRequest } from '../types';

interface Props {
  requests:  FriendRequest[];
  onAccept:  (requestId: string, displayName: string) => Promise<void>;
  onReject:  (requestId: string) => Promise<void>;
}

export default function FriendRequests({ requests, onAccept, onReject }: Props) {
  const pending = requests.filter(r => r.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      background: 'rgba(79,195,247,0.04)',
    }}>
      <div style={{
        padding: '6px 14px', fontSize: 9, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
        color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <UserPlus size={11} />
        Incoming requests ({pending.length})
      </div>
      {pending.map(req => (
        <RequestRow
          key={req.request_id}
          request={req}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </div>
  );
}

function RequestRow({ request, onAccept, onReject }: {
  request:  FriendRequest;
  onAccept: (id: string, name: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const [name,   setName]   = useState(request.from_name);
  const [busy,   setBusy]   = useState(false);
  const [expand, setExpand] = useState(false);

  const accept = async () => {
    setBusy(true);
    try { await onAccept(request.request_id, name); }
    finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true);
    try { await onReject(request.request_id); }
    finally { setBusy(false); }
  };

  return (
    <div
      style={{
        padding: '8px 14px',
        borderTop: '1px solid var(--border)',
        cursor: expand ? 'default' : 'pointer',
      }}
      onClick={() => !expand && setExpand(true)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--bg-panel)', border: '1px solid var(--accent-blue)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: 'var(--accent-blue)', flexShrink: 0,
        }}>
          {request.from_name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {request.from_name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {request.from_ip}:{request.from_port}
          </div>
        </div>
        {!expand && (
          <div style={{ fontSize: 10, color: 'var(--accent-blue)' }}>tap</div>
        )}
      </div>

      {expand && (
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
            Save them as
          </label>
          <input
            className="modal-input"
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ width: '100%', marginBottom: 8, fontSize: 12, padding: '6px 10px' }}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && accept()}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={accept}
              disabled={busy || !name.trim()}
              style={{
                flex: 1, padding: '6px 0', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 4, background: 'var(--accent-teal)',
                border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                color: 'var(--bg-editor)', fontSize: 11, fontWeight: 700,
                fontFamily: 'var(--font)', opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? <Loader size={11} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Check size={11} />}
              Accept
            </button>
            <button
              onClick={reject}
              disabled={busy}
              style={{
                padding: '6px 10px', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                cursor: 'pointer', color: 'var(--text-muted)',
                fontSize: 11, fontFamily: 'var(--font)',
              }}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
