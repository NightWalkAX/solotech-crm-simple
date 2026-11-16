// Programados (scheduled jobs): settings, validation and listing for the API. Execution lives in scheduler.js (chat worker).
import { db, insertRow, updateRow, getRow, getSetting, setSetting } from './db.js';
import { parseCron, nextRun, localToUtc, utcToLocal, toUtc } from './cron.js';

export const KINDS = ['reminder', 'briefing', 'task'];
export const DEFAULT_AVAILABILITY = 'Not set yet: ask the owner which days and hours they work on the business before planning around them.';

export const jobsConfig = () => ({ availability: DEFAULT_AVAILABILITY, inbox_chat_id: null, ...getSetting('jobs', {}) });
export function saveJobsConfig({ availability }) {
  const next = { ...getSetting('jobs', {}) };
  if (availability != null) next.availability = availability.trim() || DEFAULT_AVAILABILITY;
  setSetting('jobs', next);
  return jobsConfig();
}

const out = j => j && {
  ...j, run_at_local: utcToLocal(j.run_at), next_run_local: utcToLocal(j.next_run_at), last_run_local: utcToLocal(j.last_run_at),
};

/** The owner has seen the draft: a message from them (not a scheduled run) after its last change. */
export function draftApproved(draft) {
  return !!db.prepare(`SELECT 1 FROM chat_messages m JOIN chats c ON c.id = m.chat_id
    WHERE m.role = 'user' AND c.origin IS NOT 'scheduled' AND m.created_at > ?`).get(draft.updated_at);
}

export function listJobs({ status } = {}) {
  return db.prepare(`SELECT j.*, c.company
    FROM scheduled_jobs j LEFT JOIN clients c ON c.id = j.client_id
    WHERE (@status IS NULL OR j.status = @status)
    ORDER BY j.status = 'active' DESC, j.next_run_at IS NULL, j.next_run_at, j.id DESC LIMIT 200`).all({ status: status ?? null }).map(out);
}

export const jobRuns = id => db.prepare('SELECT * FROM scheduled_runs WHERE job_id = ? ORDER BY id DESC LIMIT 30').all(id)
  .map(r => ({ ...r, started_local: utcToLocal(r.started_at), due_local: utcToLocal(r.due_at) }));

/**
 * Create (id null) or update a job. Times from Claude/UI are Guyana local: run_at "YYYY-MM-DD HH:MM"; cron in Guyana time.
 * status: active | paused | cancelled. Changing schedule or status recomputes next_run_at.
 */
export function saveJob(id, b, actor = 'ui') {
  const prev = id ? getRow('scheduled_jobs', id) : null;
  if (id && !prev) throw new Error('job not found');
  const row = {};
  for (const k of ['title', 'prompt', 'client_id']) if (k in b) row[k] = b[k] === '' ? null : b[k];
  if ('kind' in b) {
    if (!KINDS.includes(b.kind)) throw new Error(`kind inválido (${KINDS.join(', ')})`);
    row.kind = b.kind;
  }
  if ('deliver' in b) {
    if (!['whatsapp', 'panel'].includes(b.deliver)) throw new Error('deliver: whatsapp | panel');
    row.deliver = b.deliver;
  }
  if ('mode' in b) {
    if (b.mode != null && !['edit', 'build'].includes(b.mode)) throw new Error('mode: edit | build');
    row.mode = b.mode ?? null;
  }
  const j = { ...prev, ...row };
  if (!j.kind) throw new Error('Falta kind');
  if (!j.title?.trim()) throw new Error('Falta title');
  if (j.kind !== 'reminder' && !j.prompt?.trim()) throw new Error('Falta prompt: la instrucción completa para esa ejecución');

  // Schedule: exactly one of cron (recurring) or run_at (one-shot).
  let rescheduled = !prev;
  if (b.cron) {
    parseCron(b.cron);
    Object.assign(row, { cron: b.cron.trim(), run_at: null });
    rescheduled = true;
  } else if (b.run_at) {
    Object.assign(row, { run_at: localToUtc(b.run_at), cron: null });
    rescheduled = true;
  }
  Object.assign(j, row);
  if (!j.cron && !j.run_at) throw new Error('Falta cuándo: run_at "YYYY-MM-DD HH:MM" (hora de Guyana) o cron');

  const status = b.status ?? prev?.status ?? 'active';
  if (!['active', 'paused', 'cancelled', 'done'].includes(status)) throw new Error('status: active | paused | cancelled');
  row.status = status;
  const now = toUtc(new Date());
  if (status !== 'active') {
    if (status === 'cancelled') row.next_run_at = null;
  } else if (rescheduled || prev?.status !== 'active' || !prev?.next_run_at) {
    if (j.cron) row.next_run_at = nextRun(j.cron);
    else if (j.run_at > now) row.next_run_at = j.run_at;
    else if (rescheduled) throw new Error(`Esa hora ya pasó (${utcToLocal(j.run_at)} en Guyana)`);
    else Object.assign(row, { next_run_at: null, status: 'done' }); // reactivating a one-shot that already ran
  }
  return out(prev ? updateRow('scheduled_jobs', id, row, actor) : insertRow('scheduled_jobs', row, actor));
}
