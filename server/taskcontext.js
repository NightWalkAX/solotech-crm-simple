// "Contexto" on a task: gathers everything the CRM knows around an action item (the task, its client, recent messages and
// interactions, client notes, the chat turn where the task was created) and asks Sonnet (claude -p, no tools) to explain
// in plain Spanish what it is about and what the owner has to do. Result cached in action_contexts by input signature.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { db, changed, updateRow } from './db.js';
import { today } from './domain.js';
import { owner } from './owner.js';
import { CLAUDE } from './claude-bin.js';

const MODEL = process.env.TASKCONTEXT_MODEL || 'claude-sonnet-5-5';
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');

function gather(actionId) {
  const a = db.prepare('SELECT * FROM action_items WHERE id = ?').get(actionId);
  if (!a) return null;
  const client = a.client_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(a.client_id) : null;
  const msgs = client ? db.prepare('SELECT * FROM messages WHERE client_id = ? ORDER BY sent_at DESC, id DESC LIMIT 30').all(client.id).reverse() : [];
  const ints = client ? db.prepare('SELECT * FROM interactions WHERE client_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 15').all(client.id).reverse() : [];
  const notes = client ? db.prepare('SELECT kind, title, body FROM notes WHERE client_id = ? ORDER BY updated_at DESC LIMIT 6').all(client.id) : [];
  const siblings = db.prepare(`SELECT title, due_date, status FROM action_items WHERE id <> ? AND ${client ? 'client_id = ?' : 'client_id IS NULL AND status = \'open\''}
    ORDER BY status, due_date IS NULL, due_date LIMIT 12`).all(...(client ? [a.id, client.id] : [a.id]));
  // The chat turn that created the task: its audit insert id is listed in chat_messages.audit_ids.
  const ins = db.prepare("SELECT id FROM audit_log WHERE tbl = 'action_items' AND row_id = ? AND action = 'insert' ORDER BY id LIMIT 1").get(a.id);
  let origin = [];
  if (ins) {
    const turn = db.prepare('SELECT m.* FROM chat_messages m, json_each(m.audit_ids) j WHERE j.value = ? LIMIT 1').get(ins.id);
    if (turn) origin = db.prepare('SELECT role, text, created_at FROM chat_messages WHERE chat_id = ? AND id <= ? ORDER BY id DESC LIMIT 4')
      .all(turn.chat_id, turn.id).reverse();
  }
  return { a, client, msgs, ints, notes, siblings, origin };
}

function signature(g) {
  const { a, client, msgs, ints } = g;
  const parts = [a.title, a.notes, a.due_date, a.status, client?.updated_at, msgs.at(-1)?.id, ints.at(-1)?.id];
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

function buildPrompt({ a, client, msgs, ints, notes, siblings, origin }) {
  const me = owner();
  const convo = msgs.map(m => `[${m.sent_at} UTC · ${m.channel}] ${m.direction === 'in' ? (m.sender || 'Cliente') : me.short}: ${cut(m.body, 800)}`).join('\n');
  const log = ints.map(i => `- ${i.occurred_at.slice(0, 16)} ${i.channel}: ${i.summary}${i.body ? ` — ${cut(i.body, 500)}` : ''}`).join('\n');
  return `${me.name === 'the owner' ? 'El dueño del negocio' : me.name} abrió una tarea de su CRM y se siente perdido.
Explícale, en español, claro y calmado, de qué se trata y qué tiene que hacer. Usa SOLO el contexto de abajo; si falta algo, dilo ("no hay registro de…") en vez de inventar.
Hoy es ${today()} (Guyana, UTC-4).

Formato (markdown corto, sin títulos grandes, máximo ~180 palabras):
**De qué va:** 1-3 frases (quién, qué pasó antes, por qué existe la tarea).
**Qué hacer ahora:** 1-4 pasos numerados, concretos y pequeños (el primero debe poder hacerse en 5 minutos).
**Lo que necesitas a mano:** viñetas con datos útiles del contexto (borrador de mensaje si existe, nombres, enlaces, cifras). Omite la sección si no hay nada.
Recordatorio: el dueño envía los mensajes él mismo; no sugieras presionar al cliente.

TAREA
Título: ${a.title}
Tipo: ${a.kind} · Estado: ${a.status} · Vence: ${a.due_date || 'sin fecha'} · Creada: ${a.created_at}
Notas: ${cut(a.notes, 2500) || '—'}

${client ? `CLIENTE
Empresa: ${client.company} · Contacto: ${client.contact_name || '—'} · Etapa: ${client.stage}
Qué hacen: ${cut(client.characterization, 1200) || '—'}
Dolores: ${(() => { try { return JSON.parse(client.pain_points || '[]').join(' | '); } catch { return client.pain_points; } })() || '—'}
Notas del cliente: ${cut(client.notes, 1200) || '—'}

MENSAJES (más antiguos primero)
${convo || '(ninguno)'}

INTERACCIONES
${log || '(ninguna)'}

NOTAS GUARDADAS
${notes.map(n => `- [${n.kind}] ${n.title}: ${cut(n.body, 500)}`).join('\n') || '(ninguna)'}
` : 'CLIENTE: ninguno (tarea interna)\n'}
OTRAS TAREAS ${client ? 'DEL MISMO CLIENTE' : 'SIN CLIENTE ABIERTAS'}
${siblings.map(s => `- ${s.status === 'done' ? '[hecha] ' : ''}${s.title} (${s.due_date || 'sin fecha'})`).join('\n') || '(ninguna)'}

CONVERSACIÓN DEL CHAT DONDE SE CREÓ LA TAREA
${origin.map(m => `${m.role === 'user' ? me.short : 'Asistente'} (${m.created_at}): ${cut(m.text, 1500)}`).join('\n') || '(no se creó desde el chat o no hay registro)'}`;
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
        resolve(String(result.result).trim());
      } catch (e) {
        reject(new Error(code ? err.slice(-300) || e.message : e.message));
      }
    });
    child.stdin.end(prompt);
  });
}

const upsert = db.prepare(`INSERT INTO action_contexts (action_id, body, signature, error, created_at)
  VALUES (@action_id, @body, @signature, @error, datetime('now'))
  ON CONFLICT(action_id) DO UPDATE SET body = excluded.body, signature = excluded.signature, error = excluded.error, created_at = excluded.created_at`);
const running = new Map();

/** Cached explanation of a task; `stale` = the task or its client changed since it was written. */
export function getContext(actionId) {
  const g = gather(actionId);
  if (!g) return null;
  const row = db.prepare('SELECT * FROM action_contexts WHERE action_id = ?').get(actionId);
  return { ...row, stale: !!row && row.signature !== signature(g), running: running.has(actionId) };
}

/** Ask Sonnet now (one run per task at a time). A failure keeps the previous text and records the error. */
export function explainTask(actionId) {
  if (running.has(actionId)) return running.get(actionId);
  const g = gather(actionId);
  if (!g) return Promise.resolve(null);
  const sig = signature(g);
  const prev = db.prepare('SELECT body FROM action_contexts WHERE action_id = ?').get(actionId);
  const p = runClaude(buildPrompt(g))
    .then(body => upsert.run({ action_id: actionId, body, signature: sig, error: null }))
    .catch(e => {
      console.error('[taskcontext]', actionId, e.message);
      upsert.run({ action_id: actionId, body: prev?.body ?? null, signature: sig, error: String(e.message).slice(0, 300) });
    })
    .then(() => { running.delete(actionId); changed('action_contexts', actionId); return getContext(actionId); });
  running.set(actionId, p);
  return p;
}

// Tasks tab "Estimar con IA": Sonnet sizes open tasks without effort in chunks of 40 (one claude -p per chunk, in parallel).
// Only rough buckets on purpose (exact numbers overwhelm). Writes are audited, so they can be undone.
let estimating = null;
const EFFORTS = new Set(['quick', 'medium', 'big']);

function effortPrompt(tasks) {
  return `Clasifica cada tarea del dueño del negocio por el esfuerzo aproximado que le llevará, sin tiempos exactos:
- quick: un momento (responder un mensaje, una llamada, confirmar algo, revisar un dato).
- medium: una sentada tranquila (preparar una cotización, un documento, una revisión, un arreglo acotado).
- big: una sesión larga o varias (un proyecto, una entrega grande, investigaciones grandes).
Si dudas entre dos, elige la mayor. Responde SOLO con JSON: {"<id>": "quick|medium|big", ...}

${tasks.map(t => `${t.id}: ${t.title}${t.notes ? ` — ${cut(t.notes.replace(/\s+/g, ' '), 240)}` : ''}${t.company ? ` (cliente: ${t.company})` : ''}`).join('\n')}`;
}

export function estimateEfforts(actor = 'ui') {
  if (estimating) return estimating;
  const tasks = db.prepare(`SELECT a.id, a.title, a.notes, c.company FROM action_items a LEFT JOIN clients c ON c.id = a.client_id
    WHERE a.status = 'open' AND a.effort IS NULL ORDER BY a.id`).all();
  const chunks = [];
  for (let i = 0; i < tasks.length; i += 40) chunks.push(tasks.slice(i, i + 40));
  estimating = Promise.allSettled(chunks.map(chunk => runClaude(effortPrompt(chunk)).then(text => {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    let n = 0;
    for (const t of chunk) {
      const effort = json[t.id];
      // Skip tasks the owner sized or closed while Sonnet was thinking.
      const now = db.prepare('SELECT effort, status FROM action_items WHERE id = ?').get(t.id);
      if (EFFORTS.has(effort) && now && !now.effort && now.status === 'open') { updateRow('action_items', t.id, { effort }, actor); n++; }
    }
    return n;
  }))).then(results => {
    estimating = null;
    const failed = results.filter(r => r.status === 'rejected');
    failed.forEach(r => console.error('[estimate]', r.reason?.message));
    return { updated: results.reduce((n, r) => n + (r.value || 0), 0), pending: tasks.length, failed: failed.length };
  });
  return estimating;
}
