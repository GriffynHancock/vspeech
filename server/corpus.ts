/**
 * server/corpus.ts
 * Builds a training corpus from a URL directory or local file path,
 * instead of Wikipedia. Both parties must use the same source so their
 * tokenisers are trained on identical text.
 *
 * Corpus fingerprint: SHA256( sorted(SHA256(file_content) for each file) )
 * Both users must verify this fingerprint matches out-of-band before messaging.
 */
import crypto from 'node:crypto';
import fs     from 'node:fs';
import path   from 'node:path';
import { log } from './logger';

export interface CorpusResult {
  text:         string;   // concatenated corpus to write to temp file
  fingerprint:  string;   // hex SHA256 — must match on both ends
  fileCount:    number;
  charCount:    number;
}

// ─────────────────────────────────────────────
// URL corpus
// ─────────────────────────────────────────────

/**
 * Fetch file listing from a URL. Supports:
 *  1. Apache/Nginx autoindex HTML (parses <a href="*.txt">)
 *  2. JSON array of filenames: ["file1.txt", "file2.txt", ...]
 */
async function fetchFileList(baseUrl: string): Promise<string[]> {
  const url = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const res  = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Corpus server returned ${res.status} for ${url}`);
  const body = await res.text();

  // Try JSON first
  try {
    const parsed = JSON.parse(body);
    if (Array.isArray(parsed)) {
      return parsed.filter((s: any) => typeof s === 'string' && s.endsWith('.txt'));
    }
  } catch { /* not JSON — fall through */ }

  // Parse HTML directory listing  <a href="something.txt">
  const matches = [...body.matchAll(/href="([^"#?]+\.txt)"/gi)];
  const files   = matches
    .map(m => m[1])
    .filter(f => !f.startsWith('/') && !f.startsWith('http'))  // relative only
    .map(f => f.split('/').pop()!)
    .filter(Boolean);

  if (files.length === 0) throw new Error(`No .txt files found at ${url}. Provide an Apache directory index or a JSON array.`);
  return [...new Set(files)].sort();  // deduplicate + sort for determinism
}

async function fetchFileContent(baseUrl: string, filename: string): Promise<string> {
  const url = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + filename;
  const res  = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

/**
 * Build corpus from a URL-hosted directory.
 * Uses hash chain to deterministically select and slice files.
 */
export async function buildUrlCorpus(
  baseUrl:   string,
  hashValue: Buffer,
  numFiles:  number,
  wordsPerFile: number,
): Promise<CorpusResult> {
  log.info('corpus:url:fetch-list', { baseUrl });
  const allFiles = await fetchFileList(baseUrl);
  log.info('corpus:url:found', { count: allFiles.length });

  const rngSeed = Number(hashValue.readBigUInt64BE(0) % BigInt(Number.MAX_SAFE_INTEGER));
  const selected = seededSample(allFiles, Math.min(numFiles, allFiles.length), rngSeed);

  const parts:        string[] = [];
  const fileHashes:   string[] = [];

  for (const filename of selected) {
    log.debug('corpus:url:fetch-file', { filename });
    const content  = await fetchFileContent(baseUrl, filename);
    const excerpt  = extractWords(content, hashValue, wordsPerFile);
    parts.push(excerpt);
    fileHashes.push(sha256(content));
  }

  return buildResult(parts, fileHashes, allFiles.sort(), selected);
}

// ─────────────────────────────────────────────
// Local corpus
// ─────────────────────────────────────────────

/**
 * Build corpus from a local directory of .txt files.
 */
export function buildLocalCorpus(
  dirPath:      string,
  hashValue:    Buffer,
  numFiles:     number,
  wordsPerFile: number,
): CorpusResult {
  if (!fs.existsSync(dirPath)) throw new Error(`Corpus directory not found: ${dirPath}`);

  const allFiles = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.txt'))
    .sort();

  if (allFiles.length === 0) throw new Error(`No .txt files found in ${dirPath}`);

  log.info('corpus:local', { dir: dirPath, totalFiles: allFiles.length });

  const rngSeed  = Number(hashValue.readBigUInt64BE(0) % BigInt(Number.MAX_SAFE_INTEGER));
  const selected = seededSample(allFiles, Math.min(numFiles, allFiles.length), rngSeed);

  const parts:      string[] = [];
  const fileHashes: string[] = [];

  for (const filename of selected) {
    const content = fs.readFileSync(path.join(dirPath, filename), 'utf8');
    parts.push(extractWords(content, hashValue, wordsPerFile));
    fileHashes.push(sha256(content));
  }

  return buildResult(parts, fileHashes, allFiles, selected);
}

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Compute the corpus fingerprint: SHA256 of all file-content-hashes sorted
 * deterministically.  Both peers MUST see the same value.
 */
function computeFingerprint(sortedAllFiles: string[], fileHashes: Map<string, string>): string {
  // Use all files in the directory, hashed in sorted order — not just selected ones.
  // This ensures any file addition/removal is visible in the fingerprint.
  const combined = sortedAllFiles
    .map(f => `${f}:${fileHashes.get(f) ?? 'missing'}`)
    .join('\n');
  return sha256(combined).slice(0, 32);  // 128-bit — short enough to read aloud
}

function buildResult(
  parts:           string[],
  selectedHashes:  string[],
  allFilesSorted:  string[],
  selectedFiles:   string[],
): CorpusResult {
  const text      = parts.join('\n\n');
  const fileHashMap = new Map(selectedFiles.map((f, i) => [f, selectedHashes[i]]));
  // For fingerprint, we need hashes of ALL files. Since we only fetched selected,
  // use a fingerprint of (sortedAllFilenames + selectedHashes).
  const combined   = allFilesSorted.join('\n') + '\n' + selectedFiles.sort().map((f, i) => `${f}:${selectedHashes[i]}`).join('\n');
  const fingerprint = sha256(combined).slice(0, 32);

  log.info('corpus:built', {
    files: selectedFiles.length, chars: text.length, fingerprint
  });

  return {
    text,
    fingerprint,
    fileCount: selectedFiles.length,
    charCount:  text.length,
  };
}

/** Extract approximately `wordCount` words from text, starting at a hash-derived offset */
function extractWords(text: string, hashValue: Buffer, wordCount: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  // Use bytes 8-15 of hash for word offset (different from file selection seed)
  const offsetSeed = Number(hashValue.readBigUInt64BE(8) % BigInt(Math.max(1, words.length)));
  const start = offsetSeed % Math.max(1, words.length - wordCount);
  return words.slice(start, start + wordCount).join(' ');
}

/** Seeded Fisher-Yates sample — same seed → same selection every time */
function seededSample<T>(arr: T[], count: number, seed: number): T[] {
  const a    = [...arr];
  let   s    = seed;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, count);
}
