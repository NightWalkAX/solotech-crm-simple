// Voice-note transcription with faster-whisper (local, CPU). One long-lived Python process (scripts/transcribe.py)
// keeps the model loaded; it exits after IDLE_MS without work to give the RAM back.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PYTHON = process.env.WHISPER_PYTHON || path.join(os.homedir(), '.venvs', 'whisper', 'bin', 'python');
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcribe.py');
const IDLE_MS = 10 * 60e3;
const TIMEOUT_MS = 10 * 60e3; // first use downloads the model (~500 MB)

let proc = null;
let idleTimer = null;
const pending = new Map(); // path -> { resolve, reject, timer }
export const state = { status: 'off', error: null }; // off | loading | ready

function start() {
  state.status = 'loading';
  proc = spawn(PYTHON, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, WHISPER_MODEL: process.env.WHISPER_MODEL || 'small' } });
  let stderr = '';
  proc.stderr.on('data', d => { stderr = (stderr + d).slice(-2000); });
  readline.createInterface({ input: proc.stdout }).on('line', line => {
    let r;
    try { r = JSON.parse(line); } catch { return; }
    if (r.ready) { state.status = 'ready'; state.error = null; return; }
    const p = pending.get(r.path);
    if (!p) return;
    pending.delete(r.path);
    clearTimeout(p.timer);
    r.error ? p.reject(new Error(r.error)) : p.resolve(r);
    armIdle();
  });
  proc.on('exit', code => {
    proc = null;
    state.status = 'off';
    if (code) state.error = stderr.trim().split('\n').pop() || `transcriber exited with ${code}`;
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(state.error || 'transcriber stopped')); }
    pending.clear();
  });
  proc.on('error', e => { state.error = e.message; });
}

function armIdle() {
  clearTimeout(idleTimer);
  if (!pending.size) idleTimer = setTimeout(() => proc?.stdin.end(), IDLE_MS).unref();
}

/** Transcribe one audio file; resolves { text, segments: [[start, text]], language, duration }. */
export function transcribe(file, { timeoutMs = TIMEOUT_MS } = {}) {
  if (!proc) start();
  clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(file); reject(new Error('La transcripción tardó demasiado')); armIdle(); }, timeoutMs);
    pending.set(file, { resolve, reject, timer });
    proc.stdin.write(file + '\n');
  });
}
