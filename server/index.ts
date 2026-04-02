import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { cors } from '@elysiajs/cors';
import os   from 'os';
import fs   from 'fs';
import path from 'path';
import * as db from './db';
import { encodeMessage, decodeMessage, checkEngine } from './crypto';
import { buildUrlCorpus, buildLocalCorpus }          from './corpus';
import { log } from './logger';
import { isSetup, setupPassword, verifyPassword, getSessionKey, invalidateSession } from './auth';

// ─────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────
const wsClients = new Set<any>();
function broadcast(event: object) {
  const p = JSON.stringify(event);
  for (const ws of wsClients) { try { ws.send(p); } catch { wsClients.delete(ws); } }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getMyIp(): string {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

/** The IP we advertise to peers — user-configurable, falls back to auto-detect */
function getAdvertisedIp(): string {
  return db.getSetting('public_ip') || getMyIp();
}

function tokenFromRequest(req: Request): string {
  return req.headers.get('x-session-token') ?? '';
}
function requireAuth(request: Request): Response | null {
  const key = getSessionKey(tokenFromRequest(request));
  if (!key) return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
  db.setEncryptionKey(key);
  return null;
}

const PORT    = Number(process.env.PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const TEMP_DIR = path.join(process.cwd(), 'temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─────────────────────────────────────────────
// Corpus cache — write corpus to temp file, reuse within same iteration
// ─────────────────────────────────────────────
interface CachedCorpus { file: string; fingerprint: string }
const corpusCache = new Map<string, CachedCorpus>(); // key: `${convId}:${iteration}`

async function getCorpusFile(
  convo: any,
  hashValue: Buffer,
): Promise<{ file: string | null; fingerprint: string | null }> {
  if (!convo.corpus_type || convo.corpus_type === 'wikipedia') return { file: null, fingerprint: null };

  const security    = convo.security_level ?? 'medium';
  const presetsNum  = { low: 5, medium: 10, high: 20 } as Record<string, number>;
  const presetsWords = { low: 80, medium: 100, high: 150 } as Record<string, number>;
  const numFiles    = presetsNum[security]   ?? 10;
  const wordsPerFile = presetsWords[security] ?? 100;

  let result;
  if (convo.corpus_type === 'url') {
    result = await buildUrlCorpus(convo.corpus_source, hashValue, numFiles, wordsPerFile);
  } else {
    result = buildLocalCorpus(convo.corpus_source, hashValue, numFiles, wordsPerFile);
  }

  // Write corpus to a temp file for the Python engine
  const tmpFile = path.join(TEMP_DIR, `corpus_custom_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, result.text, 'utf8');

  return { file: tmpFile, fingerprint: result.fingerprint };
}

// ─────────────────────────────────────────────
// Async workflows
// ─────────────────────────────────────────────
async function encodeAndSend(msgId: string, text: string, convo: any, contact: any, sentIteration: number) {
  log.info('encode:start', { msgId, sentIteration, corpusType: convo.corpus_type });
  let corpusFile: string | null = null;
  let corpusFp:   string | null = null;

  try {
    db.updateMessage(msgId, { status: 'encoding' });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });

    // Generate hash for this iteration (used for corpus selection)
    const crypto_ = await import('node:crypto');
    const seed    = convo.current_key;
    let   hash    = crypto_.createHash('sha256').update(seed).digest();
    for (let i = 0; i < sentIteration; i++) {
      hash = crypto_.createHash('sha256').update(seed + hash.toString('hex')).digest();
    }

    // Build custom corpus if needed
    ({ file: corpusFile, fingerprint: corpusFp } = await getCorpusFile(convo, hash));

    const result = await encodeMessage(text, convo.current_key, sentIteration, convo.security_level, corpusFile);
    log.info('encode:done', { msgId, tokens: result.vector.length });

    db.updateMessage(msgId, { token_vector: JSON.stringify(result.vector), status: 'sending' });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });

    // P2P payload — NOTE: iteration is NOT sent (security: receiver uses own counter)
    const peerUrl = `http://${contact.ip}:${contact.port}/api/p2p/receive`;
    const res = await fetch(peerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector:           result.vector,
        security_level:   convo.security_level,
        corpus_type:      convo.corpus_type   ?? 'wikipedia',
        corpus_source:    convo.corpus_source ?? '',
        corpus_fingerprint: corpusFp ?? '',
        from_ip:          getAdvertisedIp(),   // user-configurable — fixes Tailscale routing
        from_port:        PORT,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    log.info('p2p:sent', { to: contact.ip, status: res.status });
    db.updateMessage(msgId, { status: res.ok ? 'delivered' : 'sent' });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });
  } catch (err: any) {
    log.exception('encode:failed', err);
    db.updateMessage(msgId, { status: 'failed', error_message: err?.message ?? String(err) });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });
  } finally {
    // Clean up temp corpus file
    if (corpusFile) { try { fs.unlinkSync(corpusFile); } catch { /* ok */ } }
  }
}

async function decodeAsync(
  msgId: string, vector: number[], key: string,
  recvIteration: number, security: string,
  corpusType: string, corpusSource: string
) {
  log.info('decode:start', { msgId, recvIteration });
  let corpusFile: string | null = null;

  try {
    db.updateMessage(msgId, { status: 'decoding', key_used: key });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });

    if (corpusType !== 'wikipedia' && corpusSource) {
      const crypto_ = await import('node:crypto');
      let hash = crypto_.createHash('sha256').update(key).digest();
      for (let i = 0; i < recvIteration; i++) {
        hash = crypto_.createHash('sha256').update(key + hash.toString('hex')).digest();
      }
      const presetsNum   = { low: 5, medium: 10, high: 20 }   as Record<string, number>;
      const presetsWords = { low: 80, medium: 100, high: 150 } as Record<string, number>;
      const cf = corpusType === 'url'
        ? await buildUrlCorpus(corpusSource, hash, presetsNum[security] ?? 10, presetsWords[security] ?? 100)
        : buildLocalCorpus(corpusSource, hash, presetsNum[security] ?? 10, presetsWords[security] ?? 100);
      corpusFile = path.join(TEMP_DIR, `corpus_custom_recv_${Date.now()}.txt`);
      fs.writeFileSync(corpusFile, cf.text, 'utf8');
    }

    const plaintext = await decodeMessage(vector, key, recvIteration, security, corpusFile);
    log.info('decode:done', { msgId, chars: plaintext.length });

    db.updateMessage(msgId, { plaintext, status: 'decoded' });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });
  } catch (err: any) {
    log.exception('decode:failed', err);
    db.updateMessage(msgId, { status: 'failed', error_message: err?.message ?? String(err) });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });
  } finally {
    if (corpusFile) { try { fs.unlinkSync(corpusFile); } catch { /* ok */ } }
  }
}

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
const app = new Elysia();

if (IS_PROD) {
  app.use(staticPlugin({ assets: path.join(process.cwd(), 'dist'), prefix: '/' }));
}
app.use(cors({ origin: true }));
app.onRequest(({ request }) => log.debug(`→ ${request.method} ${new URL(request.url).pathname}`));

// ── WebSocket ──
app.ws('/ws', {
  open(ws)  { wsClients.add(ws);    log.debug('ws:open',  { n: wsClients.size }); },
  close(ws) { wsClients.delete(ws); log.debug('ws:close', { n: wsClients.size }); },
  message() {},
});

// ── Auth ──
app.get('/api/auth/status', () => ({ setup: isSetup() }));

app.post('/api/auth/setup',
  ({ body }) => {
    if (isSetup()) return new Response(JSON.stringify({ error: 'Already set up' }), { status: 409 });
    try {
      setupPassword((body as any).password);
      const token = verifyPassword((body as any).password)!;
      db.setEncryptionKey(getSessionKey(token)!);
      return { token };
    } catch (e: any) { return new Response(JSON.stringify({ error: e.message }), { status: 400 }); }
  },
  { body: t.Object({ password: t.String({ minLength: 8 }) }) }
);

app.post('/api/auth/login',
  ({ body }) => {
    const token = verifyPassword((body as any).password);
    if (!token) return new Response(JSON.stringify({ error: 'Incorrect password' }), { status: 401 });
    db.setEncryptionKey(getSessionKey(token)!);
    return { token };
  },
  { body: t.Object({ password: t.String() }) }
);

app.post('/api/auth/logout', ({ request }) => {
  invalidateSession(tokenFromRequest(request));
  db.clearEncryptionKey();
  return { ok: true };
});

// ── Settings (my public IP, display name, etc.) ──
app.get('/api/settings', ({ request }) => {
  const g = requireAuth(request); if (g) return g;
  return db.getAllSettings();
});

app.put('/api/settings',
  ({ body, request }) => {
    const g = requireAuth(request); if (g) return g;
    for (const [k, v] of Object.entries(body as Record<string, string>)) {
      db.setSetting(k, String(v));
    }
    log.info('settings:updated', { keys: Object.keys(body as object) });
    return db.getAllSettings();
  },
  { body: t.Record(t.String(), t.String()) }
);

// ── System ──
app.get('/api/system', async ({ request }) => {
  const g = requireAuth(request); if (g) return g;
  const engine = await checkEngine();
  return {
    myIp:         getMyIp(),
    advertisedIp: getAdvertisedIp(),
    port:         PORT,
    engine,
    version:      '1.0.0',
    logFile:      log.filePath,
  };
});

// ── Contacts ──
app.get('/api/contacts', ({ request }) => {
  const g = requireAuth(request); if (g) return g;
  return db.getContacts();
});

app.post('/api/contacts',
  ({ body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const existing = db.getContactByIp((body as any).ip);
    if (existing) return new Response(JSON.stringify({ error: 'IP already exists' }), { status: 409 });
    return db.addContact(body as any);
  },
  { body: t.Object({ name: t.String({ minLength: 1 }), ip: t.String({ minLength: 7 }), port: t.Optional(t.Number()) }) }
);

app.patch('/api/contacts/:id',
  ({ params, body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const updated = db.updateContact(params.id, body as any);
    broadcast({ type: 'contact_update', contact: updated });
    return updated;
  },
  { body: t.Object({ name: t.Optional(t.String()), ip: t.Optional(t.String()), port: t.Optional(t.Number()) }) }
);

app.delete('/api/contacts/:id', ({ params, request }) => {
  const g = requireAuth(request); if (g) return g;
  db.deleteContact(params.id);
  return { ok: true };
});

// ── Conversations ──
app.get('/api/contacts/:contactId/conversation', ({ params, request }) => {
  const g = requireAuth(request); if (g) return g;
  return db.getOrCreateConversation(params.contactId);
});

app.put('/api/conversations/:id/key',
  ({ params, body, request }) => {
    const g = requireAuth(request); if (g) return g;
    db.updateConversationKey(params.id, (body as any).key);
    broadcast({ type: 'conversation_update', conversation: db.getConversation(params.id) });
    return db.getConversation(params.id);
  },
  { body: t.Object({ key: t.String() }) }
);

app.put('/api/conversations/:id/security',
  ({ params, body, request }) => {
    const g = requireAuth(request); if (g) return g;
    db.updateConversationSecurity(params.id, (body as any).level);
    return db.getConversation(params.id);
  },
  { body: t.Object({ level: t.String() }) }
);

app.put('/api/conversations/:id/corpus',
  async ({ params, body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const { corpus_type, corpus_source } = body as any;

    // Validate URL-based corpus by fetching its file list
    let fingerprint = '';
    if (corpus_type === 'url' && corpus_source) {
      try {
        const { buildUrlCorpus } = await import('./corpus');
        // Quick fingerprint check: fetch list only
        const dummyHash = Buffer.alloc(32, 0);
        const r = await buildUrlCorpus(corpus_source, dummyHash, 1, 10);
        fingerprint = r.fingerprint;
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Corpus URL error: ${e.message}` }), { status: 400 });
      }
    } else if (corpus_type === 'local' && corpus_source) {
      const { buildLocalCorpus } = await import('./corpus');
      try {
        const dummyHash = Buffer.alloc(32, 0);
        const r = buildLocalCorpus(corpus_source, dummyHash, 1, 10);
        fingerprint = r.fingerprint;
      } catch (e: any) {
        return new Response(JSON.stringify({ error: `Corpus path error: ${e.message}` }), { status: 400 });
      }
    }

    db.updateConversationCorpus(params.id, corpus_type, corpus_source);
    return { ...db.getConversation(params.id), corpus_fingerprint: fingerprint };
  },
  { body: t.Object({ corpus_type: t.String(), corpus_source: t.String() }) }
);

// ── Messages ──
app.get('/api/conversations/:id/messages', ({ params, request }) => {
  const g = requireAuth(request); if (g) return g;
  return db.getMessages(params.id);
});

app.get('/api/conversations/:id/message-count', ({ params, request }) => {
  const g = requireAuth(request); if (g) return g;
  return { count: db.getMessageCount(params.id) };
});

app.post('/api/messages/send',
  async ({ body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const { conversation_id, text } = body as any;
    const convo = db.getConversation(conversation_id);
    if (!convo)            return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    if (!convo.current_key) return new Response(JSON.stringify({ error: 'No key set' }),            { status: 400 });

    const contact      = db.getContact(convo.contact_id);
    // Use SENT counter — not transmitted to peer
    const sentIteration = db.consumeSentIteration(conversation_id);

    const msg = db.addMessage({
      conversation_id, direction: 'sent', plaintext: text, token_vector: null,
      iteration: sentIteration, key_used: convo.current_key,
      security_level: convo.security_level, status: 'queued',
    });

    broadcast({ type: 'message_update', message: msg, conversation_id });
    encodeAndSend(msg.id, text, convo, contact, sentIteration);
    return msg;
  },
  { body: t.Object({ conversation_id: t.String(), text: t.String({ minLength: 1 }) }) }
);

app.post('/api/messages/reprocess',
  async ({ body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const { message_ids, conversation_id } = body as any;
    const convo = db.getConversation(conversation_id);
    if (!convo)             return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404 });
    if (!convo.current_key) return new Response(JSON.stringify({ error: 'No key set' }),             { status: 400 });

    let queued = 0;
    for (const id of message_ids) {
      const msg = db.getMessage(id);
      if (!msg?.token_vector) continue;
      decodeAsync(id, JSON.parse(msg.token_vector), convo.current_key,
        msg.iteration, msg.security_level, convo.corpus_type, convo.corpus_source);
      queued++;
    }
    return { ok: true, queued };
  },
  { body: t.Object({ message_ids: t.Array(t.String()), conversation_id: t.String() }) }
);

// ── Friend requests ──
app.get('/api/friend-requests', ({ request }) => {
  const g = requireAuth(request); if (g) return g;
  return db.getPendingFriendRequests();
});

app.post('/api/friend-requests/:requestId/accept',
  async ({ params, body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const fr = db.getFriendRequest(params.requestId);
    if (!fr) return new Response(JSON.stringify({ error: 'Request not found' }), { status: 404 });

    const displayName = (body as any).display_name || fr.from_name;

    // Create contact using the preferred IP from the request
    const existing = db.getContactByIp(fr.from_ip);
    if (!existing) {
      db.addContact({ name: displayName, ip: fr.from_ip, port: fr.from_port });
    }

    db.updateFriendRequestStatus(params.requestId, 'accepted');

    // Send acceptance back to requester
    try {
      await fetch(`http://${fr.from_ip}:${fr.from_port}/api/p2p/friend-accepted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id:   params.requestId,
          my_name:      db.getSetting('display_name') || 'VectorSpeech User',
          my_ip:        getAdvertisedIp(),
          my_port:      PORT,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      log.warn('friend-request:accept-callback-failed', { to: fr.from_ip });
    }

    broadcast({ type: 'friend_request_update', requestId: params.requestId, status: 'accepted' });
    broadcast({ type: 'contacts_changed' });
    return { ok: true };
  },
  { body: t.Object({ display_name: t.Optional(t.String()) }) }
);

app.post('/api/friend-requests/:requestId/reject', ({ params, request }) => {
  const g = requireAuth(request); if (g) return g;
  db.updateFriendRequestStatus(params.requestId, 'rejected');
  broadcast({ type: 'friend_request_update', requestId: params.requestId, status: 'rejected' });
  return { ok: true };
});

// ── P2P receive (no auth — peer machines call this) ──
app.post('/api/p2p/receive',
  async ({ body, request }) => {
    const {
      vector, security_level,
      corpus_type, corpus_source, corpus_fingerprint,
      from_ip, from_port,
    } = body as any;

    const senderIp   = from_ip || request.headers.get('x-forwarded-for') || '0.0.0.0';
    const senderPort = from_port ?? 3000;
    log.info('p2p:receive', { from: senderIp, tokens: vector.length });

    let contact = db.getContactByIp(senderIp);
    if (!contact) {
      contact = db.addContact({ name: senderIp, ip: senderIp, port: senderPort });
      broadcast({ type: 'new_contact', contact });
    }

    const convo = db.getOrCreateConversation(contact.id);

    // Use RECV counter — not sent by peer; stays in sync if no messages are dropped
    const recvIteration = db.consumeRecvIteration(convo.id);

    // Inherit corpus settings from the peer's payload (so both sides agree)
    const effectiveCorpusType   = corpus_type   || convo.corpus_type   || 'wikipedia';
    const effectiveCorpusSource = corpus_source || convo.corpus_source || '';
    if (effectiveCorpusType !== convo.corpus_type || effectiveCorpusSource !== convo.corpus_source) {
      db.updateConversationCorpus(convo.id, effectiveCorpusType, effectiveCorpusSource);
    }

    const msg = db.addMessage({
      conversation_id: convo.id, direction: 'received', plaintext: null,
      token_vector: JSON.stringify(vector),
      iteration: recvIteration,
      key_used: convo.current_key,
      security_level: security_level ?? 'medium',
      status: convo.current_key ? 'received' : 'undecoded',
    });

    broadcast({ type: 'new_message', message: msg, conversation_id: convo.id, contact,
      corpus_fingerprint: corpus_fingerprint ?? '' });

    if (convo.current_key) {
      decodeAsync(msg.id, vector, convo.current_key, recvIteration,
        security_level ?? 'medium', effectiveCorpusType, effectiveCorpusSource);
    }
    return { ok: true };
  },
  { body: t.Object({
    vector:             t.Array(t.Number()),
    security_level:     t.Optional(t.String()),
    corpus_type:        t.Optional(t.String()),
    corpus_source:      t.Optional(t.String()),
    corpus_fingerprint: t.Optional(t.String()),
    from_ip:            t.Optional(t.String()),
    from_port:          t.Optional(t.Number()),
  }) }
);

// ── P2P friend request (receive a request from a peer) ──
app.post('/api/p2p/friend-request',
  ({ body }) => {
    const { request_id, from_name, from_ip, from_port } = body as any;
    const fr = db.addFriendRequest({ request_id, from_name, from_ip, from_port });
    log.info('p2p:friend-request', { from: from_ip, name: from_name });
    broadcast({ type: 'friend_request', request: fr });
    return { ok: true };
  },
  { body: t.Object({
    request_id: t.String(), from_name: t.String(),
    from_ip: t.String(), from_port: t.Optional(t.Number()),
  }) }
);

// ── P2P friend accepted callback ──
app.post('/api/p2p/friend-accepted',
  ({ body }) => {
    const { request_id, my_name, my_ip, my_port } = body as any;
    log.info('p2p:friend-accepted', { from: my_ip, name: my_name });

    // Create contact with the peer's preferred IP
    const existing = db.getContactByIp(my_ip);
    if (!existing) {
      const contact = db.addContact({ name: my_name, ip: my_ip, port: my_port ?? 3000 });
      broadcast({ type: 'new_contact', contact });
    }
    broadcast({ type: 'contacts_changed' });
    return { ok: true };
  },
  { body: t.Object({
    request_id: t.String(), my_name: t.String(),
    my_ip: t.String(), my_port: t.Optional(t.Number()),
  }) }
);

// ── Friend request outbound (initiate) ──
app.post('/api/friend-requests/send',
  async ({ body, request }) => {
    const g = requireAuth(request); if (g) return g;
    const { target_ip, target_port } = body as any;

    const requestId  = (await import('node:crypto')).randomUUID();
    const myName     = db.getSetting('display_name') || 'VectorSpeech User';
    const myIp       = getAdvertisedIp();

    try {
      const res = await fetch(`http://${target_ip}:${target_port ?? 3000}/api/p2p/friend-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          from_name:  myName,
          from_ip:    myIp,
          from_port:  PORT,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Peer returned ${res.status}`);
      log.info('friend-request:sent', { to: target_ip, requestId });
      return { ok: true, request_id: requestId };
    } catch (e: any) {
      log.warn('friend-request:send-failed', { to: target_ip, err: e.message });
      return new Response(JSON.stringify({ error: `Could not reach ${target_ip}: ${e.message}` }), { status: 502 });
    }
  },
  { body: t.Object({ target_ip: t.String(), target_port: t.Optional(t.Number()) }) }
);

// ─────────────────────────────────────────────
// Wikipedia index management
// ─────────────────────────────────────────────

/** Return status of the Wikipedia index file(s) */
function getIndexStatus(): {
  status: 'missing' | 'demo' | 'partial' | 'ready';
  path: string | null;
  articles: number;
  level: number | null;
  date: string | null;
  checksum: string | null;
} {
  const candidates = [
    { level: 4, path: path.join(process.cwd(), 'vital_articles_v4.json') },
    { level: 3, path: path.join(process.cwd(), 'vital_articles_v3.json') },
    { level: 1, path: path.join(process.cwd(), 'vital_articles_v1.json') },
    { level: 4, path: path.join(process.cwd(), 'vital_articles_demo.json') },
  ];

  for (const { level, path: p } of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw  = fs.readFileSync(p, 'utf8');
      const data = JSON.parse(raw);
      const meta = data.metadata ?? {};
      const n    = (data.index ?? []).length;
      const isDemo    = p.includes('demo');
      const isPartial = meta.partial === true;
      const status    = isDemo ? 'demo' : isPartial ? 'partial' : n > 0 ? 'ready' : 'missing';
      return {
        status,
        path:     p,
        articles: n,
        level:    meta.version ?? level,
        date:     meta.snapshot_date ?? null,
        checksum: meta.checksum ?? null,
      };
    } catch { continue; }
  }
  return { status: 'missing', path: null, articles: 0, level: null, date: null, checksum: null };
}

app.get('/api/wiki-index/status', ({ request }) => {
  const g = requireAuth(request); if (g) return g;
  return getIndexStatus();
});

// Active build process (only one at a time)
let buildProcess: ReturnType<typeof Bun.spawn> | null = null;
let buildLevel   = 4;
let buildAborted = false;

app.post('/api/wiki-index/build',
  async ({ body, request }) => {
    const g = requireAuth(request); if (g) return g;
    if (buildProcess) {
      return new Response(JSON.stringify({ error: 'A build is already running' }), { status: 409 });
    }

    const level   = (body as any).level ?? 4;
    const resume  = (body as any).resume ?? false;
    const outFile = path.join(process.cwd(), `vital_articles_v${level}.json`);
    const pyBin   = process.env.PYTHON ?? 'python3';
    const script  = path.join(process.cwd(), 'build_wiki_index.py');

    if (!fs.existsSync(script)) {
      return new Response(JSON.stringify({ error: 'build_wiki_index.py not found in project root' }), { status: 404 });
    }

    log.info('wiki-index:build:start', { level, resume, out: outFile });
    buildLevel   = level;
    buildAborted = false;

    const args = [
      script,
      '--level',         String(level),
      '--out',           outFile,
      '--progress-json',
      ...(resume ? ['--resume'] : []),
    ];

    buildProcess = Bun.spawn([pyBin, ...args], {
      cwd:    process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env:    { ...process.env },
    });

    broadcast({ type: 'wiki_index_started', level });

    // Stream progress lines from the Python script to all WS clients
    ;(async () => {
      const reader = buildProcess!.stdout.getReader();
      const dec    = new TextDecoder();
      let   buf    = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value);
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              broadcast({ type: 'wiki_index_progress', ...parsed });
              if (parsed.type === 'done') {
                log.info('wiki-index:build:done', { articles: parsed.articles });
              }
            } catch {
              // Plain text line — wrap it
              broadcast({ type: 'wiki_index_progress', type_: 'info', message: trimmed });
            }
          }
        }
      } finally {
        const exitCode = await buildProcess!.exited;
        buildProcess   = null;
        broadcast({ type: 'wiki_index_finished', exitCode, status: getIndexStatus() });
        if (exitCode !== 0 && !buildAborted) {
          log.warn('wiki-index:build:failed', { exitCode });
        }
      }
    })();

    return { ok: true, level, out: outFile };
  },
  { body: t.Object({ level: t.Optional(t.Number()), resume: t.Optional(t.Boolean()) }) }
);

app.post('/api/wiki-index/cancel', ({ request }) => {
  const g = requireAuth(request); if (g) return g;
  if (buildProcess) {
    buildAborted = true;
    buildProcess.kill('SIGTERM');
    log.info('wiki-index:build:cancelled');
    broadcast({ type: 'wiki_index_finished', exitCode: -1, status: getIndexStatus() });
    return { ok: true };
  }
  return { ok: false, message: 'No build running' };
});

// ── SPA fallback ──
if (IS_PROD) {
  app.get('/*', ({ set }) => {
    set.headers['content-type'] = 'text/html';
    return Bun.file(path.join(process.cwd(), 'dist', 'index.html'));
  });
}

app.listen({ port: PORT });
log.info('server:start', { port: PORT, ip: getMyIp(), advertised: getAdvertisedIp() });
console.log(`\n🔐 VectorSpeech Chat  →  http://localhost:${PORT}`);
console.log(`   LAN / VPN address  →  http://${getAdvertisedIp()}:${PORT}`);
console.log(`   P2P endpoint       →  http://${getAdvertisedIp()}:${PORT}/api/p2p/receive`);
console.log(`   Log file           →  ${log.filePath}\n`);
