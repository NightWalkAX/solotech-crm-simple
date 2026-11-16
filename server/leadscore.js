// Lead temperature from what the conversation says (WhatsApp + email messages and logged interactions), not from how
// many messages there are: 8 short polite replies with no buying interest are not "hot". Runs in the chat worker:
// every TICK_MS it rescores, one client at a time, the open leads whose conversation or stage changed since the last
// score (plus a re-check every RECHECK_DAYS so silence cools them down). Result in lead_scores; domain.js
// autoTemperature uses it, the owner's manual override (clients.temperature) still wins.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { db, changed } from './db.js';
import { today } from './domain.js';
import { owner } from './owner.js';
import { CLAUDE } from './claude-bin.js';

const MODEL = process.env.LEADSCORE_MODEL || 'claude-sonnet-5-5';
const TICK_MS = 60e3;
const RECHECK_DAYS = 3;
const SKIP_STAGES = ['won', 'delivered', 'maintenance', 'lost', 'discarded']; // their temperature comes from the stage
let busy = false;

// Open leads with any conversation, and the signature of what they'd be scored on now.
const CANDIDATES = `
  SELECT c.id, c.stage,
    (SELECT max(id) FROM messages m WHERE m.client_id = c.id) AS last_msg,
    (SELECT max(id) FROM interactions i WHERE i.client_id = c.id AND i.channel <> 'system') AS last_int,
    s.signature, s.scored_at, s.temperature, s.error
  FROM clients c LEFT JOIN lead_scores s ON s.client_id = c.id
  WHERE c.stage NOT IN (${SKIP_STAGES.map(() => '?').join(',')})`;
const signature = r => `${r.last_msg ?? 0}|${r.last_int ?? 0}|${r.stage}`;

function due() {
  return db.prepare(CANDIDATES).all(...SKIP_STAGES).filter(r => {
    if (r.last_msg == null && r.last_int == null) return false;
    if (r.signature !== signature(r)) return true;
    const age = (Date.now() - new Date(r.scored_at.replace(' ', 'T') + 'Z').getTime()) / 86400e3;
    // Re-check so silence counts; failed scores retry after an hour; cold stays cold until something new happens.
    return r.error ? age > 1 / 24 : r.temperature !== 'cold' && age > RECHECK_DAYS;
  });
}

function buildPrompt(client) {
  const msgs = db.prepare('SELECT * FROM messages WHERE client_id = ? ORDER BY sent_at DESC, id DESC LIMIT 60').all(client.id).reverse();
  const ints = db.prepare("SELECT * FROM interactions WHERE client_id = ? AND channel <> 'system' ORDER BY occurred_at DESC LIMIT 20").all(client.id).reverse();
  const me = owner();
  const convo = msgs.map(m => `[${m.sent_at} UTC · ${m.channel}] ${m.direction === 'in' ? (m.sender || 'Client') : me.short}: ${m.subject ? `(subject: ${m.subject}) ` : ''}${m.body.slice(0, 1500)}`).join('\n');
  const log = ints.map(i => `- ${i.occurred_at.slice(0, 16)} ${i.channel}${i.direction ? ` (${i.direction === 'in' ? 'from them' : `from ${me.short}`})` : ''}: ${i.summary}${i.body ? ` — ${i.body.slice(0, 600)}` : ''}`).join('\n');
  return `You rate how warm a sales lead is for ${me.who}. Judge the CONTENT of the conversation, not the number of messages.

Signals that raise it: they ask price, timeline or how to pay; ask for more information; give their name or the decision maker's; propose a meeting, call or visit; share details about their business or workflow; answer fast and in full sentences; write again without being prompted.
Signals that lower it: one-word or purely polite replies ("ok", "thanks", "will check"); they correct or reject the premise (e.g. "we don't rent anymore"); more than 3 days of silence after an offer or quote; "later", "I'll see"; only the owner is talking.

Today is ${today()} (Guyana, UTC-4). Timestamps below are UTC.

LEAD
Company: ${client.company}
Contact: ${client.contact_name || 'unknown'}
Stage in CRM: ${client.stage}
What they do: ${client.characterization || '—'}
Pain points noted: ${JSON.parse(client.pain_points || '[]').join(' | ') || '—'}

MESSAGES (oldest first)
${convo || '(none)'}

LOGGED INTERACTIONS (calls, meetings, emails, notes; oldest first)
${log || '(none)'}

Return ONLY JSON, no prose, no code fences:
{"temperature":"hot|warm|cold","score":0-100,"reason":"one line in Spanish citing the concrete evidence (quote or paraphrase what they said, with the date)","tip":"one line in Spanish: what the owner's next message should do"}`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ['-p', '--output-format', 'json', '--model', MODEL, '--tools', ''], { cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 180e3);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out);
        if (result.is_error) throw new Error(result.result || 'claude error');
        const text = String(result.result);
        const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (!['hot', 'warm', 'cold'].includes(json.temperature)) throw new Error(`temperatura inválida: ${json.temperature}`);
        resolve({
          temperature: json.temperature,
          score: Math.max(0, Math.min(100, Math.round(Number(json.score) || 0))),
          reason: String(json.reason || '').trim().slice(0, 400),
          tip: json.tip ? String(json.tip).trim().slice(0, 300) : null,
        });
      } catch (e) {
        reject(new Error(code ? err.slice(-300) || e.message : e.message));
      }
    });
    child.stdin.end(prompt);
  });
}

const upsert = db.prepare(`INSERT INTO lead_scores (client_id, temperature, score, reason, tip, signature, error, scored_at)
  VALUES (@client_id, @temperature, @score, @reason, @tip, @signature, @error, datetime('now'))
  ON CONFLICT(client_id) DO UPDATE SET temperature = excluded.temperature, score = excluded.score, reason = excluded.reason,
    tip = excluded.tip, signature = excluded.signature, error = excluded.error, scored_at = excluded.scored_at`);

/** Score one client now (also used by the tick). A failure keeps the previous score and records the error. */
export async function scoreClient(id) {
  const row = db.prepare(`${CANDIDATES} AND c.id = ?`).get(...SKIP_STAGES, id);
  if (!row) return null;
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  const prev = db.prepare('SELECT * FROM lead_scores WHERE client_id = ?').get(id);
  try {
    const r = await runClaude(buildPrompt(client));
    upsert.run({ client_id: id, ...r, signature: signature(row), error: null });
  } catch (e) {
    upsert.run({
      client_id: id, temperature: prev?.temperature ?? null, score: prev?.score ?? null, reason: prev?.reason ?? null,
      tip: prev?.tip ?? null, signature: signature(row), error: String(e.message).slice(0, 300),
    });
    console.error('[leadscore]', client.company, e.message);
  }
  changed('lead_scores', id);
  return db.prepare('SELECT * FROM lead_scores WHERE client_id = ?').get(id);
}

async function tick() {
  if (busy) return;
  busy = true;
  try {
    for (const r of due()) await scoreClient(r.id);
  } finally {
    busy = false;
  }
}

export function start() {
  setTimeout(() => tick().catch(e => console.error('[leadscore]', e)), 10e3).unref();
  setInterval(() => tick().catch(e => console.error('[leadscore]', e)), TICK_MS).unref();
}
