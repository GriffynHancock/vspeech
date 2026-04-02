/**
 * server/auth.ts
 *
 * Security design decisions (explained to user in README/UI):
 *
 * Key derivation — scrypt(N=2^16, r=8, p=1):
 *   Uses ~64 MB RAM and ~0.3s on modern hardware per attempt. This makes
 *   brute-force attacks expensive even with GPUs. Argon2id would be slightly
 *   better but requires a native module; scrypt is built into Node/Bun.
 *
 * Encryption — AES-256-GCM:
 *   Authenticated encryption — detects if the ciphertext has been tampered
 *   with (the auth tag will fail). 256-bit key. Random 96-bit IV per field
 *   per write, so identical plaintexts produce different ciphertexts.
 *
 * What IS encrypted on disk:
 *   contacts.name, conversations.current_key,
 *   messages.plaintext, messages.token_vector, messages.key_used,
 *   messages.error_message
 *
 * What is NOT encrypted (metadata):
 *   IDs, timestamps, IP addresses, ports, iteration numbers, status fields,
 *   security_level. This leaks communication metadata but not content.
 *   Full-DB encryption would require SQLCipher (a native module not available
 *   in plain Bun). For a LAN tool this is an acceptable trade-off.
 *
 * Session model:
 *   On login, scrypt derives a 32-byte key. That key is stored only in the
 *   server process memory (a Map). The browser receives a random UUID token
 *   which maps to the key. Token is stored in sessionStorage (cleared on tab
 *   close). Server restart invalidates all sessions — user must re-login.
 *   No expiry beyond that: this is a local, single-user app.
 *
 * Master password change:
 *   Not implemented — would require re-encrypting every field. Wipe the DB
 *   and auth.json to start fresh if needed.
 */

import crypto from 'node:crypto';
import fs     from 'node:fs';
import path   from 'node:path';
import { log } from './logger';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const AUTH_FILE = path.join(process.cwd(), 'auth.json');

// Encrypted field prefix — lets us detect unencrypted legacy values
export const ENC_PREFIX = 'enc:v1:';

// scrypt params: N=65536 (2^16), r=8, p=1  →  ~64 MB RAM, ~0.3s per attempt
const SCRYPT_PARAMS = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;
const KEY_LEN = 32; // AES-256

// ─────────────────────────────────────────────
// In-memory session store
// ─────────────────────────────────────────────
interface Session {
  key:       Buffer;
  createdAt: Date;
}
const sessions = new Map<string, Session>();

// ─────────────────────────────────────────────
// Password setup / verification
// ─────────────────────────────────────────────
interface AuthFile {
  salt:     string;   // 32 bytes, hex
  verifier: string;   // HMAC-SHA256(derivedKey, 'vectorspeech-auth-v1'), hex
}

export function isSetup(): boolean {
  return fs.existsSync(AUTH_FILE);
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
}

export function setupPassword(password: string): void {
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const salt     = crypto.randomBytes(32);
  const key      = deriveKey(password, salt);
  const verifier = crypto.createHmac('sha256', key)
                         .update('vectorspeech-auth-v1')
                         .digest('hex');

  fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt: salt.toString('hex'), verifier } satisfies AuthFile));
  log.info('auth:setup', { saltLen: 32 });
}

/**
 * Verify a password. Returns a session token on success, null on failure.
 * Deliberately constant-time to resist timing attacks.
 */
export function verifyPassword(password: string): string | null {
  if (!isSetup()) return null;

  const data: AuthFile = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  const salt = Buffer.from(data.salt, 'hex');

  let key: Buffer;
  try {
    key = deriveKey(password, salt);
  } catch {
    return null;
  }

  const expected = crypto.createHmac('sha256', key).update('vectorspeech-auth-v1').digest();
  const actual   = Buffer.from(data.verifier, 'hex');

  // Constant-time comparison — no early exit on wrong byte
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    log.warn('auth:failed-login');
    return null;
  }

  const token = crypto.randomUUID();
  sessions.set(token, { key, createdAt: new Date() });
  log.info('auth:login-ok', { sessions: sessions.size });
  return token;
}

export function getSessionKey(token: string): Buffer | null {
  return sessions.get(token)?.key ?? null;
}

export function invalidateSession(token: string): void {
  sessions.delete(token);
  log.info('auth:logout', { sessions: sessions.size });
}

export function sessionCount(): number {
  return sessions.size;
}

// ─────────────────────────────────────────────
// AES-256-GCM field encryption
// ─────────────────────────────────────────────

/**
 * Encrypt a string with AES-256-GCM.
 * Output: "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 * Each call uses a fresh random 12-byte IV so identical inputs differ on disk.
 */
export function encryptField(key: Buffer, plaintext: string): string {
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return ENC_PREFIX + [iv, tag, enc].map(b => b.toString('hex')).join(':');
}

/**
 * Decrypt a field produced by encryptField().
 * Returns the original plaintext or throws on wrong key / tampered data.
 * If the value doesn't start with ENC_PREFIX it is returned as-is
 * (handles unencrypted rows in an existing DB).
 */
export function decryptField(key: Buffer, ciphertext: string): string {
  if (!ciphertext.startsWith(ENC_PREFIX)) return ciphertext; // legacy plain value
  const parts = ciphertext.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted field');
  const [ivHex, tagHex, dataHex] = parts;
  const iv  = Buffer.from(ivHex,  'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const enc = Buffer.from(dataHex, 'hex');
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return dec.update(enc).toString('utf8') + dec.final('utf8');
}

/** Encrypt if key present and value non-empty, else return as-is */
export function maybeEncrypt(key: Buffer | null, value: string | null | undefined): string | null {
  if (!value || !key) return value ?? null;
  return encryptField(key, value);
}

/** Decrypt if key present and value non-empty, else return as-is */
export function maybeDecrypt(key: Buffer | null, value: string | null | undefined): string | null {
  if (!value || !key) return value ?? null;
  try { return decryptField(key, value); }
  catch { return '[decryption error]'; }
}
