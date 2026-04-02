import { useState } from 'react';
import { Lock, Eye, EyeOff, ShieldCheck, AlertCircle } from 'lucide-react';

interface Props {
  mode:      'setup' | 'login';
  onSuccess: (token: string) => void;
  expired?:  boolean;
}

export default function LoginScreen({ mode, onSuccess, expired = false }: Props) {
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [show,     setShow]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const isSetup = mode === 'setup';

  const handleSubmit = async () => {
    setError('');
    if (isSetup) {
      if (password.length < 8)   { setError('Password must be at least 8 characters'); return; }
      if (password !== confirm)   { setError('Passwords do not match'); return; }
    }
    if (!password)                { setError('Enter your password'); return; }

    setLoading(true);
    try {
      const endpoint = isSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Authentication failed'); return; }
      onSuccess(data.token);
    } catch {
      setError('Could not reach server — is it running?');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-editor)',
    }}>
      <div style={{
        width: 380, padding: '36px 32px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
      }}>
        {/* Icon + title */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'var(--bg-active)', border: '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 14,
          }}>
            <Lock size={24} style={{ color: 'var(--accent-teal)' }} />
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-bright)', marginBottom: 6 }}>
            VectorSpeech
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {isSetup
              ? 'Create a master password to protect your data'
              : 'Enter your master password to unlock'}
          </div>
        </div>

        {/* Session-expired banner */}
        {expired && !isSetup && (
          <div style={{
            padding: '8px 12px', marginBottom: 16,
            background: 'rgba(220,220,170,0.08)',
            border: '1px solid var(--accent-yellow)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12, color: 'var(--accent-yellow)',
            display: 'flex', gap: 8, alignItems: 'flex-start',
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Session expired — the server was restarted.
              Please log in again to continue.
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 16,
            background: 'rgba(244,135,113,0.1)',
            border: '1px solid var(--status-error)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 12, color: 'var(--status-error)',
          }}>
            {error}
          </div>
        )}

        {/* Password field */}
        <div style={{ marginBottom: 12 }}>
          <label style={{
            display: 'block', fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            color: 'var(--text-secondary)', marginBottom: 6,
          }}>
            {isSetup ? 'New password (min 8 characters)' : 'Password'}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              className="modal-input"
              type={show ? 'text' : 'password'}
              placeholder={isSetup ? 'Choose a strong password…' : 'Enter your password…'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isSetup && handleSubmit()}
              autoFocus
              style={{ width: '100%', paddingRight: 40 }}
            />
            <button onClick={() => setShow(s => !s)} style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', display: 'flex', padding: 0,
            }}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Confirm (setup only) */}
        {isSetup && (
          <div style={{ marginBottom: 12 }}>
            <label style={{
              display: 'block', fontSize: 10, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--text-secondary)', marginBottom: 6,
            }}>
              Confirm password
            </label>
            <input
              className="modal-input"
              type={show ? 'text' : 'password'}
              placeholder="Repeat password…"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {/* Submit */}
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', marginTop: 8, padding: '11px 0', fontSize: 13 }}
        >
          {loading
            ? (isSetup ? 'Creating password…' : 'Unlocking…')
            : (isSetup ? 'Create password & unlock' : 'Unlock')}
        </button>

        {/* Recovery hint */}
        {!isSetup && (
          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
            Forgot password?{' '}
            <span style={{ color: 'var(--accent-teal)' }}>
              Run <code>./reset.sh --password</code> in the project directory
            </span>
          </div>
        )}

        {/* Security note */}
        <div style={{
          marginTop: 20, padding: '10px 12px',
          background: 'var(--bg-editor)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.7,
          display: 'flex', gap: 8,
        }}>
          <ShieldCheck size={13} style={{ color: 'var(--accent-teal)', flexShrink: 0, marginTop: 1 }} />
          <span>
            {isSetup
              ? 'Your password is never stored. It derives an AES-256 key via scrypt that encrypts message content, contact names, and keys on disk.'
              : 'Data is decrypted in memory only. The database remains encrypted at rest. Sessions are invalidated on server restart.'}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-muted)' }}>
        VectorSpeech Chat · end-to-end encrypted
      </div>
    </div>
  );
}
