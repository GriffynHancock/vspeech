import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import path from 'path';
import { maybeEncrypt, maybeDecrypt } from './auth';

const DB_PATH = path.join(process.cwd(), 'vectorspeech.db');
const db = new Database(DB_PATH, { create: true });

db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA synchronous = NORMAL');
db.run('PRAGMA foreign_keys = ON');

// ─────────────────────────────────────────────
// Runtime encryption key (set after login)
// ─────────────────────────────────────────────
let _encKey: Buffer | null = null;
export function setEncryptionKey(key: Buffer)  { _encKey = key; }
export function clearEncryptionKey()           { _encKey = null; }

// ─────────────────────────────────────────────
// Schema + migrations
// ─────────────────────────────────────────────
db.run(`CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)`);

db.run(`
  CREATE TABLE IF NOT EXISTS contacts (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    ip         TEXT NOT NULL,
    port       INTEGER NOT NULL DEFAULT 3000,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    contact_id      TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    current_key     TEXT NOT NULL DEFAULT '',
    next_iteration  INTEGER NOT NULL DEFAULT 1,
    security_level  TEXT NOT NULL DEFAULT 'medium',
    corpus_type     TEXT NOT NULL DEFAULT 'wikipedia',
    corpus_source   TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    direction       TEXT NOT NULL CHECK(direction IN ('sent','received')),
    plaintext       TEXT,
    token_vector    TEXT,
    iteration       INTEGER NOT NULL,
    key_used        TEXT NOT NULL DEFAULT '',
    security_level  TEXT NOT NULL DEFAULT 'medium',
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Settings table (key-value, for public_ip etc.)
db.run(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )
`);

// Friend requests table
db.run(`
  CREATE TABLE IF NOT EXISTS friend_requests (
    id           TEXT PRIMARY KEY,
    request_id   TEXT NOT NULL UNIQUE,
    from_name    TEXT NOT NULL,
    from_ip      TEXT NOT NULL,
    from_port    INTEGER NOT NULL DEFAULT 3000,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// ── Migrations ───────────────────────────────
function hasMigration(id: number): boolean {
  return !!(db.query('SELECT id FROM _migrations WHERE id = ?').get(id));
}
function markMigration(id: number) {
  db.run('INSERT OR IGNORE INTO _migrations (id) VALUES (?)', [id]);
}

// Migration 1: add separate recv_iteration to conversations
if (!hasMigration(1)) {
  try {
    db.run('ALTER TABLE conversations ADD COLUMN recv_iteration INTEGER NOT NULL DEFAULT 1');
  } catch { /* column already exists */ }
  markMigration(1);
}

// Migration 2: add corpus columns
if (!hasMigration(2)) {
  for (const col of ['corpus_type TEXT NOT NULL DEFAULT \'wikipedia\'', 'corpus_source TEXT NOT NULL DEFAULT \'\'']) {
    try { db.run(`ALTER TABLE conversations ADD COLUMN ${col}`); } catch { /* exists */ }
  }
  markMigration(2);
}

db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_conv_contact  ON conversations(contact_id)`);

// ─────────────────────────────────────────────
// Decrypt helpers
// ─────────────────────────────────────────────
function decContact(row: any): any {
  if (!row) return row;
  return { ...row, name: maybeDecrypt(_encKey, row.name) };
}
function decConversation(row: any): any {
  if (!row) return row;
  return { ...row, current_key: maybeDecrypt(_encKey, row.current_key) };
}
function decMessage(row: any): any {
  if (!row) return row;
  return {
    ...row,
    plaintext:     maybeDecrypt(_encKey, row.plaintext),
    token_vector:  maybeDecrypt(_encKey, row.token_vector),
    key_used:      maybeDecrypt(_encKey, row.key_used),
    error_message: maybeDecrypt(_encKey, row.error_message),
  };
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────
export function getSetting(key: string): string {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row?.value ?? '';
}
export function setSetting(key: string, value: string) {
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}
export function getAllSettings(): Record<string, string> {
  const rows = db.query('SELECT key, value FROM settings').all() as any[];
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ─────────────────────────────────────────────
// Contacts
// ─────────────────────────────────────────────
export function getContacts() {
  const rows = db.query(`
    SELECT c.*,
      conv.id as conversation_id,
      conv.current_key,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = conv.id) as message_count,
      (SELECT m2.plaintext  FROM messages m2 WHERE m2.conversation_id = conv.id ORDER BY m2.created_at DESC LIMIT 1) as last_message,
      (SELECT m3.created_at FROM messages m3 WHERE m3.conversation_id = conv.id ORDER BY m3.created_at DESC LIMIT 1) as last_message_at
    FROM contacts c
    LEFT JOIN conversations conv ON conv.contact_id = c.id
    ORDER BY COALESCE(last_message_at, c.created_at) DESC
  `).all();
  return rows.map((r: any) => {
    const d = decContact(r) as any;
    d.current_key  = maybeDecrypt(_encKey, d.current_key);
    d.last_message = maybeDecrypt(_encKey, d.last_message);
    return d;
  });
}

export function getContactByIp(ip: string) {
  return decContact(db.query('SELECT * FROM contacts WHERE ip = ?').get(ip));
}
export function getContact(id: string) {
  return decContact(db.query('SELECT * FROM contacts WHERE id = ?').get(id));
}

export function addContact(data: { name: string; ip: string; port?: number }) {
  const id      = randomUUID();
  const encName = maybeEncrypt(_encKey, data.name) ?? data.name;
  db.run('INSERT INTO contacts (id, name, ip, port) VALUES (?, ?, ?, ?)',
    [id, encName, data.ip, data.port ?? 3000]);
  const convId = randomUUID();
  db.run('INSERT INTO conversations (id, contact_id) VALUES (?, ?)', [convId, id]);
  return getContact(id);
}

export function updateContact(id: string, data: { name?: string; ip?: string; port?: number }) {
  const sets: string[] = [];
  const vals: any[]    = [];
  if (data.name !== undefined) { sets.push('name = ?'); vals.push(maybeEncrypt(_encKey, data.name) ?? data.name); }
  if (data.ip   !== undefined) { sets.push('ip = ?');   vals.push(data.ip); }
  if (data.port !== undefined) { sets.push('port = ?'); vals.push(data.port); }
  if (!sets.length) return getContact(id);
  db.run(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`, [...vals, id]);
  return getContact(id);
}

export function deleteContact(id: string) {
  db.run('DELETE FROM contacts WHERE id = ?', [id]);
}

// ─────────────────────────────────────────────
// Conversations
// ─────────────────────────────────────────────
export function getConversationByContact(contactId: string) {
  return decConversation(db.query('SELECT * FROM conversations WHERE contact_id = ?').get(contactId));
}
export function getConversation(id: string) {
  return decConversation(db.query('SELECT * FROM conversations WHERE id = ?').get(id));
}
export function getOrCreateConversation(contactId: string) {
  let c = getConversationByContact(contactId);
  if (!c) {
    const id = randomUUID();
    db.run('INSERT INTO conversations (id, contact_id) VALUES (?, ?)', [id, contactId]);
    c = getConversation(id);
  }
  return c;
}
export function updateConversationKey(id: string, key: string) {
  const encKey = maybeEncrypt(_encKey, key) ?? key;
  db.run("UPDATE conversations SET current_key = ?, updated_at = datetime('now') WHERE id = ?", [encKey, id]);
}
export function updateConversationSecurity(id: string, level: string) {
  db.run("UPDATE conversations SET security_level = ?, updated_at = datetime('now') WHERE id = ?", [level, id]);
}
export function updateConversationCorpus(id: string, type: string, source: string) {
  db.run("UPDATE conversations SET corpus_type = ?, corpus_source = ?, updated_at = datetime('now') WHERE id = ?",
    [type, source, id]);
}

/**
 * Consume the SENT iteration counter (for encoding outbound messages).
 * Increments sent counter (next_iteration), returns the value before increment.
 */
export function consumeSentIteration(conversationId: string): number {
  const c = getConversation(conversationId);
  const n = (c.next_iteration as number) || 1;
  db.run("UPDATE conversations SET next_iteration = next_iteration + 1, updated_at = datetime('now') WHERE id = ?",
    [conversationId]);
  return n;
}

/**
 * Consume the RECV iteration counter (for decoding inbound messages).
 * Increments recv counter, returns the value before increment.
 */
export function consumeRecvIteration(conversationId: string): number {
  const c = db.query('SELECT recv_iteration FROM conversations WHERE id = ?').get(conversationId) as any;
  const n = (c?.recv_iteration as number) || 1;
  db.run("UPDATE conversations SET recv_iteration = recv_iteration + 1, updated_at = datetime('now') WHERE id = ?",
    [conversationId]);
  return n;
}

// ─────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────
export function getMessages(conversationId: string) {
  return db.query('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId).map(decMessage);
}
export function getMessageCount(conversationId: string): number {
  return ((db.query('SELECT COUNT(*) as n FROM messages WHERE conversation_id = ?').get(conversationId) as any)?.n ?? 0);
}
export function getMessage(id: string) {
  return decMessage(db.query('SELECT * FROM messages WHERE id = ?').get(id));
}
export function addMessage(data: {
  conversation_id: string; direction: 'sent' | 'received';
  plaintext?: string | null; token_vector?: string | null;
  iteration: number; key_used: string; security_level: string; status: string;
}) {
  const id = randomUUID();
  db.run(
    `INSERT INTO messages (id, conversation_id, direction, plaintext, token_vector, iteration, key_used, security_level, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.conversation_id, data.direction,
     maybeEncrypt(_encKey, data.plaintext ?? null),
     maybeEncrypt(_encKey, data.token_vector ?? null),
     data.iteration,
     maybeEncrypt(_encKey, data.key_used) ?? '',
     data.security_level, data.status]
  );
  return getMessage(id);
}
export function updateMessage(id: string, updates: Partial<{
  plaintext: string; token_vector: string; status: string;
  error_message: string; key_used: string;
}>) {
  const enc: Record<string, any> = { ...updates };
  if (updates.plaintext     !== undefined) enc.plaintext     = maybeEncrypt(_encKey, updates.plaintext);
  if (updates.token_vector  !== undefined) enc.token_vector  = maybeEncrypt(_encKey, updates.token_vector);
  if (updates.key_used      !== undefined) enc.key_used      = maybeEncrypt(_encKey, updates.key_used);
  if (updates.error_message !== undefined) enc.error_message = maybeEncrypt(_encKey, updates.error_message);
  const fields = Object.keys(enc).map(k => `${k} = ?`).join(', ');
  if (!fields) return getMessage(id);
  db.run(`UPDATE messages SET ${fields} WHERE id = ?`, [...Object.values(enc), id]);
  return getMessage(id);
}

// ─────────────────────────────────────────────
// Friend requests
// ─────────────────────────────────────────────
export function addFriendRequest(data: {
  request_id: string; from_name: string; from_ip: string; from_port: number;
}) {
  const id = randomUUID();
  // Upsert — duplicate request_id just updates name/port
  db.run(`INSERT OR REPLACE INTO friend_requests (id, request_id, from_name, from_ip, from_port)
          VALUES (?, ?, ?, ?, ?)`,
    [id, data.request_id, data.from_name, data.from_ip, data.from_port]);
  return getFriendRequest(data.request_id);
}
export function getFriendRequest(requestId: string) {
  return db.query('SELECT * FROM friend_requests WHERE request_id = ?').get(requestId) as any;
}
export function getPendingFriendRequests() {
  return db.query("SELECT * FROM friend_requests WHERE status = 'pending' ORDER BY created_at DESC").all();
}
export function updateFriendRequestStatus(requestId: string, status: 'accepted' | 'rejected') {
  db.run("UPDATE friend_requests SET status = ? WHERE request_id = ?", [status, requestId]);
}
