import type { Message } from '../types';

interface Props {
  message: Message;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

// Token vector preview string
function tokenPreview(raw: string | null): string {
  if (!raw) return '';
  try {
    const v = JSON.parse(raw) as number[];
    const head = v.slice(0, 12).join(' ');
    return v.length > 12 ? `${head} … [${v.length} tokens]` : `[${v.length} tokens] ${head}`;
  } catch { return raw.slice(0, 60); }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABEL: Record<string, string> = {
  queued:    'queued',
  encoding:  'encoding…',
  sending:   'sending…',
  sent:      'sent',
  delivered: '✓✓',
  received:  'received',
  decoding:  'decoding…',
  decoded:   '✓',
  undecoded: 'no key',
  failed:    'failed',
};

function StatusIcon({ status }: { status: string }) {
  const showSpinner = ['encoding', 'decoding', 'sending', 'queued'].includes(status);
  return (
    <span className={`bubble-status status-${status}`}>
      {showSpinner && <span className="spinner" />}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export default function MessageBubble({ message, selectionMode, selected, onToggleSelect }: Props) {
  const isSent        = message.direction === 'sent';
  const isDecoded     = message.status === 'decoded' || (isSent && !!message.plaintext);
  const hasVector     = !!message.token_vector;
  const showVector    = !isDecoded && hasVector;
  // Selection (re-decode) only makes sense for received messages that have a stored vector
  const canSelect     = selectionMode && !isSent && hasVector;

  return (
    <div className={`msg-row ${isSent ? 'sent' : 'received'} ${canSelect ? 'selection-mode' : ''}`}>
      {/* Checkbox — only visible in selection mode for received messages */}
      {canSelect && (
        <div className="msg-checkbox-wrap">
          <input
            type="checkbox"
            className="msg-checkbox"
            checked={selected}
            onChange={() => onToggleSelect(message.id)}
          />
        </div>
      )}

      <div
        className={`bubble ${isSent ? 'sent' : 'received'}`}
        style={selected ? { outline: '2px solid var(--accent-teal)', outlineOffset: 2 } : undefined}
        onClick={canSelect ? () => onToggleSelect(message.id) : undefined}
        role={canSelect ? 'button' : undefined}
      >
        {/* Main content */}
        {message.plaintext
          ? <span className="bubble-text">{message.plaintext}</span>
          : <span className="bubble-encoded">
              <span style={{ opacity: 0.5 }}>🔒</span>
              {message.status === 'failed' && message.error_message
                ? <span style={{ color: 'var(--status-error)' }}>
                    {message.error_message.slice(0, 80)}
                  </span>
                : <span>
                    {message.status === 'decoding'  && 'Decoding…'}
                    {message.status === 'encoding'  && 'Encoding…'}
                    {message.status === 'undecoded' && 'Set a key to decode this message'}
                    {message.status === 'received'  && 'Waiting to decode…'}
                    {!['decoding','encoding','undecoded','received','failed'].includes(message.status) && 'Encoded message'}
                  </span>
              }
            </span>
        }

        {/* Token vector preview for received/undecoded messages */}
        {showVector && (
          <div className="token-preview">
            {tokenPreview(message.token_vector)}
          </div>
        )}

        {/* Metadata row */}
        <div className="bubble-meta">
          <span className="bubble-time">{formatTime(message.created_at)}</span>
          {isSent
            ? <StatusIcon status={message.status} />
            : message.status !== 'decoded' && <StatusIcon status={message.status} />
          }
        </div>
      </div>
    </div>
  );
}
