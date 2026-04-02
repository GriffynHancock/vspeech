/**
 * server/logger.ts
 * Simple structured logger. Writes to stdout AND to logs/server.log.
 * Rotates at 5 MB; keeps the last 3 files.
 */
import fs from 'fs';
import path from 'path';

const LOG_DIR  = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');
const MAX_BYTES   = 5 * 1024 * 1024; // 5 MB
const MAX_BACKUPS = 3;

// Ensure log directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// Open (or create) the log file in append mode
let logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function rotate() {
  try {
    logStream.end();
    // Shift existing backups: .2 → .3, .1 → .2, '' → .1
    for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      const to   = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (fs.existsSync(LOG_FILE)) fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch { /* best-effort */ }
}

function checkRotate() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_BYTES) rotate();
  } catch { /* file not yet created */ }
}

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_COLOUR: Record<Level, string> = {
  DEBUG: '\x1b[90m',   // grey
  INFO:  '\x1b[36m',   // cyan
  WARN:  '\x1b[33m',   // yellow
  ERROR: '\x1b[31m',   // red
};
const RESET = '\x1b[0m';

function write(level: Level, msg: string, extra?: object) {
  checkRotate();

  const ts   = new Date().toISOString();
  const line = extra
    ? `[${ts}] [${level}] ${msg} ${JSON.stringify(extra)}`
    : `[${ts}] [${level}] ${msg}`;

  // Coloured stdout
  const colour = LEVEL_COLOUR[level];
  process.stdout.write(`${colour}${line}${RESET}\n`);

  // Plain file
  logStream.write(line + '\n');
}

export const log = {
  debug: (msg: string, extra?: object) => write('DEBUG', msg, extra),
  info:  (msg: string, extra?: object) => write('INFO',  msg, extra),
  warn:  (msg: string, extra?: object) => write('WARN',  msg, extra),
  error: (msg: string, extra?: object) => write('ERROR', msg, extra),

  /** Log an unhandled/async error with full stack */
  exception: (msg: string, err: unknown) => {
    const e = err instanceof Error ? err : new Error(String(err));
    write('ERROR', `${msg}: ${e.message}`, { stack: e.stack?.split('\n').slice(0, 6).join(' | ') });
  },

  /** Path to the current log file, for display */
  filePath: LOG_FILE,
};
