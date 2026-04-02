import { Elysia, t, error as elysiaError } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { cors } from '@elysiajs/cors';
import os   from 'os';
import fs   from 'fs';
import path from 'path';
import * as db from './db';
import { encodeMessage, decodeMessage, checkEngine } from './crypto';
import { buildUrlCorpus, buildLocalCorpus }          from './corpus';
import { log } from './logger';
import { isSetup, setupPassword, verifyPassword, getSessionKey, invalidateSession, sessionCount } from './auth';

// ─────────────────────────────────────────────
// WebSocket broadcast
// ─────────────────────────────────────────────
const wsClients = new Set<any>();
function broadcast(event: object) {
  const p = JSON.stringify(event);
  for (const ws of wsClients) {
    try { ws.send(p); } catch { wsClients.delete(ws); }
  }
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

function getAdvertisedIp(): string {
  return db.getSetting('public_ip') || getMyIp();
}

function tokenFromRequest(req: Request): string {
  // Support both header formats for resilience
  return (
    req.headers.get('x-session-token') ??
    req.headers.get('X-Session-Token') ??
    ''
  );
}

/**
 * Auth guard — returns { error, status } on failure, null on success.
 * NOTE: In Elysia 1.x, returning a plain Response from a handler can be
 * swallowed. We instead return a typed error descriptor and let callers
 * use it with elysiaError() or a plain-object 401.
 */
function requireAuth(request: Request): { ok: false; status: 401; body: { error: string } } | null {
  const token = tokenFromRequest(request);
  if (!token) {
    log.warn('auth:missing-token', { path: new URL(request.url).pathname });
    return { ok: false, status: 401, body: { error: 'Unauthenticated' } };
  }
  const key = getSessionKey(token);
  if (!key) {
    log.warn('auth:invalid-token', { path: new URL(request.url).pathname });
    return { ok: false, status: 401, body: { error: 'Session expired — please log in again' } };
  }
  db.setEncryptionKey(key);
  return null;
}

// Elysia-compatible guard (use inside handlers)
function guard(request: Request, set: any): boolean {
  const failure = requireAuth(request);
  if (failure) {
    set.status = 401;
    return false;
  }
  return true;
}

const PORT    = Number(process.env.PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const TEMP_DIR = path.join(process.cwd(), 'temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─────────────────────────────────────────────
// Corpus cache
// ─────────────────────────────────────────────
async function getCorpusFile(convo: any, hashValue: Buffer)
  : Promise<{ file: string | null; fingerprint: string | null }> {
  if (!convo.corpus_type || convo.corpus_type === 'wikipedia') return { file: null, fingerprint: null };

  const security      = convo.security_level ?? 'medium';
  const presetsNum    = { low: 5, medium: 10, high: 20 } as Record<string, number>;
  const presetsWords  = { low: 80, medium: 100, high: 150 } as Record<string, number>;
  const numFiles      = presetsNum[security]   ?? 10;
  const wordsPerFile  = presetsWords[security] ?? 100;

  let result;
  if (convo.corpus_type === 'url') {
    result = await buildUrlCorpus(convo.corpus_source, hashValue, numFiles, wordsPerFile);
  } else {
    result = buildLocalCorpus(convo.corpus_source, hashValue, numFiles, wordsPerFile);
  }

  const tmpFile = path.join(TEMP_DIR, `corpus_custom_${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, result.text, 'utf8');
  return { file: tmpFile, fingerprint: result.fingerprint };
}

// ─────────────────────────────────────────────
// Async encode/decode workflows
// ─────────────────────────────────────────────
async function encodeAndSend(msgId: string, text: string, convo: any, contact: any, sentIteration: number) {
  log.info('encode:start', { msgId, sentIteration, corpusType: convo.corpus_type });
  let corpusFile: string | null = null;

  try {
    db.updateMessage(msgId, { status: 'encoding' });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });

    const crypto_ = await import('node:crypto');
    const seed    = convo.current_key;
    let   hash    = crypto_.createHash('sha256').update(seed).digest();
    for (let i = 0; i < sentIteration; i++) {
      hash = crypto_.createHash('sha256').update(seed + hash.toString('hex')).digest();
    }

    let corpusFp: string | null = null;
    ({ file: corpusFile, fingerprint: corpusFp } = await getCorpusFile(convo, hash));

    const result = await encodeMessage(text, convo.current_key, sentIteration, convo.security_level, corpusFile);
    log.info('encode:done', { msgId, tokens: result.vector.length });

    db.updateMessage(msgId, { token_vector: JSON.stringify(result.vector), status: 'sending' });
    broadcast({ type: 'message_update', message: db.getMessage(msgId) });

    const peerUrl = `http://${contact.ip}:${contact.port}/api/p2p/receive`;
    const res = await fetch(peerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector:             result.vector,
        security_level:     convo.security_level,
        corpus_type:        convo.corpus_type   ?? 'wikipedia',
        corpus_source:      convo.corpus_source ?? '',
        corpus_fingerprint: corpusFp ?? '',
        from_ip:            getAdvertisedIp(),
        from_port:          PORT,
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
// Wiki index helpers
// ─────────────────────────────────────────────
function getIndexStatus() {
  const candidates = [
    { level: 4, path: path.join(process.cwd(), 'vital_articles_v4.json') },
    { level: 3, path: path.join(process.cwd(), 'vital_articles_v3.json') },
    { level: 1, path: path.join(process.cwd(), 'vital_articles_v1.json') },
    { level: 4, path: path.join(process.cwd(), 'vital_articles_demo.json') },
  ];

  for (const { level, path: p } of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const meta = data.metadata ?? {};
      const n    = (data.index ?? []).length;
      const isDemo    = p.includes('demo');
      const isPartial = meta.partial === true;
      const status    = isDemo ? 'demo' : isPartial ? 'partial' : n > 0 ? 'ready' : 'missing';
      return { status, path: p, articles: n, level: meta.version ?? level,
               date: meta.snapshot_date ?? null, checksum: meta.checksum ?? null };
    } catch { continue; }
  }
  return { status: 'missing', path: null, articles: 0, level: null, date: null, checksum: null };
}

let buildProcess: ReturnType<typeof Bun.spawn> | null = null;
let buildAborted = false;

// ─────────────────────────────────────────────
// App
// ─────────────────────────────────────────────
const app = new Elysia();

if (IS_PROD) {
  app.use(staticPlugin({ assets: path.join(process.cwd(), 'dist'), prefix: '/' }));
}

app.use(cors({
  origin: true,
  // Explicitly allow our custom auth header
  allowedHeaders: ['Content-Type', 'X-Session-Token', 'x-session-token'],
}));

app.onRequest(({ request }) =>
  log.debug(`→ ${request.method} ${new URL(request.url).pathname}`)
);

// ── WebSocket ──
app.ws('/ws', {
  open(ws)  { wsClients.add(ws);    log.debug('ws:open',  { n: wsClients.size }); },
  close(ws) { wsClients.delete(ws); log.debug('ws:close', { n: wsClients.size }); },
  message() {},
});

// ── Auth ──
app.get('/api/auth/status', () => ({
  setup:    isSetup(),
  sessions: sessionCount(),
}));

app.post('/api/auth/setup',
  ({ body, set }) => {
    if (isSetup()) {
      set.status = 409;
      return { error: 'Already set up — use /api/auth/login' };
    }
    try {
      setupPassword((body as any).password);
      const token = verifyPassword((body as any).password)!;
      db.setEncryptionKey(getSessionKey(token)!);
      log.info('auth:setup-complete');
      return { token };
    } catch (e: any) {
      set.status = 400;
      return { error: e.message };
    }
  },
  { body: t.Object({ password: t.String({ minLength: 8 }) }) }
);

app.post('/api/auth/login',
  ({ body, set }) => {
    const token = verifyPassword((body as any).password);
    if (!token) {
      set.status = 401;
      return { error: 'Incorrect password' };
    }
    db.setEncryptionKey(getSessionKey(token)!);
    log.info('auth:login-ok');
    return { token };
  },
  { body: t.Object({ password: t.String() }) }
);

app.post('/api/auth/logout', ({ request, set }) => {
  const token = tokenFromRequest(request);
  if (token) invalidateSession(token);
  db.clearEncryptionKey();
  return { ok: true };
});

// Session probe — lets the frontend check if its token is still valid
// without triggering a full data load
app.get('/api/auth/check', ({ request, set }) => {
  const failure = requireAuth(request);
  if (failure) { set.status = 401; return failure.body; }
  return { ok: true, sessions: sessionCount() };
});

// ── Settings ──
app.get('/api/settings', ({ request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return db.getAllSettings();
});

app.put('/api/settings',
  ({ body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    for (const [k, v] of Object.entries(body as Record<string, string>)) {
      db.setSetting(k, String(v));
    }
    log.info('settings:updated', { keys: Object.keys(body as object) });
    return db.getAllSettings();
  },
  { body: t.Record(t.String(), t.String()) }
);

// ── System ──
app.get('/api/system', async ({ request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  const engine = await checkEngine();
  return {
    myIp:         getMyIp(),
    advertisedIp: getAdvertisedIp(),
    port:         PORT,
    engine,
    version:      '1.0.0',
    logFile:      log.filePath,
    wikiIndex:    getIndexStatus(),
  };
});

// ── Contacts ──
app.get('/api/contacts', ({ request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return db.getContacts();
});

app.post('/api/contacts',
  ({ body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    const existing = db.getContactByIp((body as any).ip);
    if (existing) { set.status = 409; return { error: 'IP already exists' }; }
    return db.addContact(body as any);
  },
  { body: t.Object({ name: t.String({ minLength: 1 }), ip: t.String({ minLength: 7 }), port: t.Optional(t.Number()) }) }
);

app.patch('/api/contacts/:id',
  ({ params, body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    const updated = db.updateContact(params.id, body as any);
    broadcast({ type: 'contact_update', contact: updated });
    return updated;
  },
  { body: t.Object({ name: t.Optional(t.String()), ip: t.Optional(t.String()), port: t.Optional(t.Number()) }) }
);

app.delete('/api/contacts/:id', ({ params, request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  db.deleteContact(params.id);
  return { ok: true };
});

// ── Conversations ──
app.get('/api/contacts/:contactId/conversation', ({ params, request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return db.getOrCreateConversation(params.contactId);
});

app.put('/api/conversations/:id/key',
  ({ params, body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    db.updateConversationKey(params.id, (body as any).key);
    broadcast({ type: 'conversation_update', conversation: db.getConversation(params.id) });
    return db.getConversation(params.id);
  },
  { body: t.Object({ key: t.String() }) }
);

app.put('/api/conversations/:id/security',
  ({ params, body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    db.updateConversationSecurity(params.id, (body as any).level);
    return db.getConversation(params.id);
  },
  { body: t.Object({ level: t.String() }) }
);

app.put('/api/conversations/:id/corpus',
  async ({ params, body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    const { corpus_type, corpus_source } = body as any;

    let fingerprint = '';
    if (corpus_type === 'url' && corpus_source) {
      try {
        const { buildUrlCorpus } = await import('./corpus');
        const dummyHash = Buffer.alloc(32, 0);
        const r = await buildUrlCorpus(corpus_source, dummyHash, 1, 10);
        fingerprint = r.fingerprint;
      } catch (e: any) {
        set.status = 400;
        return { error: `Corpus URL error: ${e.message}` };
      }
    } else if (corpus_type === 'local' && corpus_source) {
      try {
        const { buildLocalCorpus } = await import('./corpus');
        const dummyHash = Buffer.alloc(32, 0);
        const r = buildLocalCorpus(corpus_source, dummyHash, 1, 10);
        fingerprint = r.fingerprint;
      } catch (e: any) {
        set.status = 400;
        return { error: `Corpus path error: ${e.message}` };
      }
    }

    db.updateConversationCorpus(params.id, corpus_type, corpus_source);
    return { ...db.getConversation(params.id), corpus_fingerprint: fingerprint };
  },
  { body: t.Object({ corpus_type: t.String(), corpus_source: t.String() }) }
);

// ── Messages ──
app.get('/api/conversations/:id/messages', ({ params, request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return db.getMessages(params.id);
});

app.get('/api/conversations/:id/message-count', ({ params, request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return { count: db.getMessageCount(params.id) };
});

app.post('/api/messages/send',
  async ({ body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    const { conversation_id, text } = body as any;
    const convo = db.getConversation(conversation_id);
    if (!convo)             { set.status = 404; return { error: 'Conversation not found' }; }
    if (!convo.current_key) { set.status = 400; return { error: 'No key set for this conversation' }; }

    const contact      = db.getContact(convo.contact_id);
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
  async ({ body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    const { message_ids, conversation_id } = body as any;
    const convo = db.getConversation(conversation_id);
    if (!convo)             { set.status = 404; return { error: 'Conversation not found' }; }
    if (!convo.current_key) { set.status = 400; return { error: 'No key set' }; }

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
app.get('/api/friend-requests', ({ request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return db.getPendingFriendRequests();
});

app.post('/api/friend-requests/:requestId/accept',
  async ({ params, body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    const fr = db.getFriendRequest(params.requestId);
    if (!fr) { set.status = 404; return { error: 'Request not found' }; }

    const displayName = (body as any).display_name || fr.from_name;
    const existing = db.getContactByIp(fr.from_ip);
    if (!existing) {
      db.addContact({ name: displayName, ip: fr.from_ip, port: fr.from_port });
    }

    db.updateFriendRequestStatus(params.requestId, 'accepted');

    try {
      await fetch(`http://${fr.from_ip}:${fr.from_port}/api/p2p/friend-accepted`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: params.requestId,
          my_name:    db.getSetting('display_name') || 'VectorSpeech User',
          my_ip:      getAdvertisedIp(),
          my_port:    PORT,
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

app.post('/api/friend-requests/:requestId/reject', ({ params, request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  db.updateFriendRequestStatus(params.requestId, 'rejected');
  broadcast({ type: 'friend_request_update', requestId: params.requestId, status: 'rejected' });
  return { ok: true };
});

// ── Friend request send (OUTBOUND — requires auth) ──
app.post('/api/friend-requests/send',
  async ({ body, request, set }) => {
    // Auth check first — this was the source of the "Unauthenticated" bug
    // when sessions expired after server restart
    const f = requireAuth(request);
    if (f) {
      log.warn('friend-request:send:unauthenticated');
      set.status = 401;
      return f.body;
    }

    const { target_ip, target_port } = body as any;
    const requestId  = (await import('node:crypto')).randomUUID();
    const myName     = db.getSetting('display_name') || 'VectorSpeech User';
    const myIp       = getAdvertisedIp();

    log.info('friend-request:sending', { to: target_ip, port: target_port, myIp });

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
      set.status = 502;
      return { error: `Could not reach ${target_ip}:${target_port ?? 3000} — ${e.message}` };
    }
  },
  { body: t.Object({ target_ip: t.String(), target_port: t.Optional(t.Number()) }) }
);

// ── P2P inbound receive (no auth — called by peer machines) ──
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
    const recvIteration = db.consumeRecvIteration(convo.id);

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

// ── P2P friend request inbound ──
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

// ── Wiki index management ──
app.get('/api/wiki-index/status', ({ request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  return getIndexStatus();
});

app.post('/api/wiki-index/build',
  async ({ body, request, set }) => {
    const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
    if (buildProcess) {
      set.status = 409;
      return { error: 'A build is already running' };
    }

    const level   = (body as any).level ?? 4;
    const resume  = (body as any).resume ?? false;
    const outFile = path.join(process.cwd(), `vital_articles_v${level}.json`);
    const pyBin   = process.env.PYTHON ?? 'python3';
    const script  = path.join(process.cwd(), 'build_wiki_index.py');

    if (!fs.existsSync(script)) {
      set.status = 404;
      return { error: 'build_wiki_index.py not found in project root' };
    }

    log.info('wiki-index:build:start', { level, resume, out: outFile });
    buildAborted = false;

    const args = [
      script, '--level', String(level), '--out', outFile, '--progress-json',
      ...(resume ? ['--resume'] : []),
    ];

    buildProcess = Bun.spawn([pyBin, ...args], {
      cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe', env: { ...process.env },
    });

    broadcast({ type: 'wiki_index_started', level });

    ;(async () => {
      const reader = buildProcess!.stdout.getReader();
      const dec = new TextDecoder();
      let buf = '';
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
              if (parsed.type === 'done') log.info('wiki-index:build:done', { articles: parsed.articles });
            } catch {
              broadcast({ type: 'wiki_index_progress', type: 'info', message: trimmed });
            }
          }
        }
      } finally {
        const exitCode = await buildProcess!.exited;
        buildProcess   = null;
        broadcast({ type: 'wiki_index_finished', exitCode, status: getIndexStatus() });
        if (exitCode !== 0 && !buildAborted) log.warn('wiki-index:build:failed', { exitCode });
      }
    })();

    return { ok: true, level, out: outFile };
  },
  { body: t.Object({ level: t.Optional(t.Number()), resume: t.Optional(t.Boolean()) }) }
);

app.post('/api/wiki-index/cancel', ({ request, set }) => {
  const f = requireAuth(request); if (f) { set.status = 401; return f.body; }
  if (buildProcess) {
    buildAborted = true;
    buildProcess.kill('SIGTERM');
    log.info('wiki-index:build:cancelled');
    broadcast({ type: 'wiki_index_finished', exitCode: -1, status: getIndexStatus() });
    return { ok: true };
  }
  return { ok: false, message: 'No build running' };
});

// ── SPA fallback (production) ──
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
console.log(`   Log file           →  ${log.filePath}`);
console.log(`   Reset tool         →  ./reset.sh\n`);
