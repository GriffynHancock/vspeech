/**
 * server/crypto.ts
 * Runs VectorSpeech Python engine as a subprocess.
 * Supports Wikipedia (default) and custom corpus modes.
 *
 * Python resolution order:
 *   1. $PYTHON env var
 *   2. ./venv/bin/python3
 *   3. ./.venv/bin/python3
 *   4. python3 (system)
 */
import path from 'path';
import fs   from 'fs';
import { log } from './logger';

const ENGINE_DIR    = process.cwd();
const ENGINE_SCRIPT = path.join(ENGINE_DIR, 'vectorspeech_engine_fixed.py');
const CORPUS_SCRIPT = path.join(ENGINE_DIR, 'vectorspeech_corpus_helper.py');
const OUTPUT_DIR    = path.join(ENGINE_DIR, 'output');
const TEMP_DIR      = path.join(ENGINE_DIR, 'temp');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(TEMP_DIR,   { recursive: true });

function resolvePython(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  for (const p of [
    path.join(ENGINE_DIR, 'venv',  'bin', 'python3'),
    path.join(ENGINE_DIR, '.venv', 'bin', 'python3'),
    path.join(ENGINE_DIR, 'venv',  'Scripts', 'python.exe'),
    path.join(ENGINE_DIR, '.venv', 'Scripts', 'python.exe'),
  ]) {
    if (fs.existsSync(p)) { log.info('python:using-venv', { path: p }); return p; }
  }
  return 'python3';
}

const PYTHON_BIN = resolvePython();

export interface EncodeResult {
  vector: number[]; iteration: number; version: number;
  security_level: string; message_length: number; timestamp: string;
}

async function runPython(
  script: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exit: number }> {
  log.debug('python:spawn', { script: path.basename(script), args: args.slice(0, 6) });
  const proc = Bun.spawn([PYTHON_BIN, script, ...args], {
    cwd: ENGINE_DIR, stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env },
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exit !== 0 || stderr.trim()) {
    log.warn('python:stderr', { exit, tail: stderr.trim().split('\n').slice(-5).join(' | ') });
  }
  return { stdout, stderr, exit };
}

export async function encodeMessage(
  text:       string,
  seed:       string,
  iteration:  number,
  security:   string  = 'medium',
  corpusFile: string | null = null,
): Promise<EncodeResult> {
  const useCustom = !!corpusFile && fs.existsSync(CORPUS_SCRIPT);
  const script    = useCustom ? CORPUS_SCRIPT : ENGINE_SCRIPT;
  const args      = [
    '--send', text, '--seed', seed,
    '--iteration', String(iteration),
    '--security',  security,
    ...(useCustom && corpusFile ? ['--corpus-file', corpusFile] : []),
  ];

  const { stdout, stderr, exit } = await runPython(script, args);
  if (exit !== 0) {
    throw new Error(`Encoding failed (exit ${exit}):\n${stderr.trim().split('\n').slice(-5).join('\n')}`);
  }

  // The engine writes output/message_{iteration}.json
  const outputPath = path.join(OUTPUT_DIR, `message_${iteration}.json`);
  let raw: string;
  try { raw = await Bun.file(outputPath).text(); }
  catch { throw new Error(`Engine did not produce output at ${outputPath}.\nstdout:\n${stdout.slice(-400)}`); }
  try { return JSON.parse(raw) as EncodeResult; }
  catch { throw new Error(`Engine output not valid JSON: ${raw.slice(0, 200)}`); }
}

export async function decodeMessage(
  vector:     number[],
  seed:       string,
  iteration:  number,
  security:   string = 'medium',
  corpusFile: string | null = null,
): Promise<string> {
  const uid     = `${iteration}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tmpPath = path.join(OUTPUT_DIR, `recv_${uid}.json`);

  await Bun.write(tmpPath, JSON.stringify({
    vector, iteration, version: 1, security_level: security,
    message_length: vector.length, timestamp: new Date().toISOString(),
  }, null, 2));

  const useCustom = !!corpusFile && fs.existsSync(CORPUS_SCRIPT);
  const script    = useCustom ? CORPUS_SCRIPT : ENGINE_SCRIPT;
  const args      = [
    '--receive', tmpPath, '--seed', seed,
    '--iteration', String(iteration),
    '--security',  security,
    ...(useCustom && corpusFile ? ['--corpus-file', corpusFile] : []),
  ];

  let pyResult: { stdout: string; stderr: string; exit: number } | undefined;
  try {
    pyResult = await runPython(script, args);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (!pyResult) throw new Error('Python process produced no result');
  const { stdout, stderr, exit } = pyResult;

  if (exit !== 0) {
    throw new Error(`Decoding failed (exit ${exit}):\n${stderr.trim().split('\n').slice(-5).join('\n')}`);
  }

  const match = stdout.match(/^MESSAGE:\s*(.+?)(?:\n={10,}|$)/ms);
  if (match) return match[1].trim();
  const lines  = stdout.split('\n');
  const msgIdx = lines.findIndex(l => l.startsWith('MESSAGE:'));
  if (msgIdx !== -1) return lines[msgIdx].replace(/^MESSAGE:\s*/, '').trim();
  throw new Error(`Could not parse decoded message.\nstdout:\n${stdout.slice(-400)}`);
}

export async function checkEngine(): Promise<{ ok: boolean; message: string; python: string }> {
  try {
    const proc = Bun.spawn(
      [PYTHON_BIN, '-c', 'import sentencepiece, requests; print("ok")'],
      { cwd: ENGINE_DIR, stdout: 'pipe', stderr: 'pipe', env: { ...process.env } }
    );
    const [out, err, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exit === 0 && out.includes('ok')) {
      return { ok: true, message: 'Python engine ready', python: PYTHON_BIN };
    }
    return { ok: false, message: `Missing Python deps: ${err.trim().split('\n').slice(-2).join(' | ')}`, python: PYTHON_BIN };
  } catch (e: any) {
    return { ok: false, message: `python not found: ${e?.message}`, python: PYTHON_BIN };
  }
}
