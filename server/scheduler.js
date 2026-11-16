// Programados: runs scheduled_jobs when they are due. Lives in the chat worker (not file-watched, owns runTurn and WhatsApp).
// reminder → text to the owner, no Claude
// briefing / task → a Claude turn in a new chat (origin 'scheduled'); the final text (+ report files) goes to the owner
// Every output is also written to the panel. Delivery 'whatsapp' = the owner's own number (wa-prompts line), within Meta's 24 h window.
import { db, insertRow, updateRow, getRow, setSetting, getSetting, changed } from './db.js';
import { runTurn, isRunning, onTurnDone } from './chat.js';
import { nextRun, toUtc, fromUtc, utcToLocal } from './cron.js';
import { jobsConfig } from './jobs.js';
import { notifyOwner } from './connectors/wa-prompts.js';
import { notify, plain } from './push.js';

const TICK_MS = 30e3;
// How late a run may start (the CRM was off at the due time). Recurring ones past this are skipped to the next slot.
const GRACE_MS = { reminder: Infinity, recurring: 3 * 3600e3, once: 24 * 3600e3 };


const now = () => toUtc(new Date());
const setRun = (id, patch) => updateRow('scheduled_runs', id, patch, 'system');

/** Panel record of non-Claude runs (reminders): one shared "⏰ Programados" chat. */
function postToPanel(text) {
  const c = jobsConfig();
  let chat = c.inbox_chat_id ? getRow('chats', c.inbox_chat_id) : null;
  if (!chat || chat.deleted_at) {
    chat = insertRow('chats', { title: '⏰ Programados', origin: 'scheduled' }, 'system');
    setSetting('jobs', { ...getSetting('jobs', {}), inbox_chat_id: chat.id });
  }
  insertRow('chat_messages', { chat_id: chat.id, role: 'assistant', text, tools: '[]', audit_ids: '[]' }, 'system');
  db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(chat.id);
  changed('chats', chat.id);
  return chat.id;
}

/** Every output also goes out as a push notification (any delivery); WhatsApp only when job.deliver = 'whatsapp'. */
async function deliver(job, text, files = [], chatId = null) {
  notify('jobs', { title: `⏰ ${job.title}`, body: plain(text), url: chatId ? `/?chat=${chatId}` : '/jobs', tag: `job-${job.id}` });
  if (job.deliver !== 'whatsapp') return null;
  try { await notifyOwner(text, files); return null; } catch (e) { return `WhatsApp: ${e.message}`; }
}

// System prompt added to scheduled Claude turns.
function scheduledPrompt(job) {
  const local = utcToLocal(now());
  return [
    `SCHEDULED JOB #${job.id} (${job.kind}, "${job.title}"${job.cron ? `, cron "${job.cron}" local time` : ''}). It started automatically at ${local} local time; the owner is NOT watching and cannot answer now.`,
    'Do the task end to end without asking questions; if something is ambiguous take the most reasonable option and say so in one line. Never send messages to clients and never deploy or publish; you may write to the CRM (it is audited and undoable).',
    job.kind === 'briefing' ? 'BRIEFING (plan with OWNER\'S TIME): base it on real CRM data (crm_today, crm_query over audit_log, interactions, messages, action_items, documents, scheduled_runs, chat_messages for the period). Evening = what moved today (new prospects, replies, documents, payments, tasks done) and what is pending; morning = today\'s plan sized to the time the owner really has today, top 3 priorities first, money first (unpaid invoices, hot leads, quotes waiting), then follow-ups due. Be concrete: client names, amounts, which message to send. No filler.' : '',
    job.deliver === 'whatsapp'
      ? 'Your final text is sent to the owner as a WhatsApp message: a few lines, WhatsApp formatting (*bold*, _italic_, "- " lists), no tables, no markdown headings, no localhost links. Anything long or tabular goes in a crm_make_report PDF, which is sent to them automatically after your reply.'
      : 'Your final text stays in the CRM chat panel for the owner to read later.',
  ].filter(Boolean).join('\n');
}

const MODES = { briefing: () => 'edit', task: () => 'edit' };

/** Start one run of a job. `slot` = the due time it belongs to (UTC) or null for a manual run. */
async function runJob(job, slot = null) {
  const run = insertRow('scheduled_runs', { job_id: job.id, due_at: slot }, 'system');
  const finishJob = (status, error = null, chatId = job.last_chat_id) => {
    setRun(run.id, { status, error, finished_at: now(), chat_id: chatId });
    updateRow('scheduled_jobs', job.id, { last_status: status, last_error: error, last_chat_id: chatId }, 'system');
  };
  updateRow('scheduled_jobs', job.id, { last_run_at: now(), run_count: job.run_count + 1 }, 'system');

  try {
    if (job.kind === 'reminder') {
      const text = `⏰ *Recordatorio:* ${job.title}${job.prompt ? `\n${job.prompt}` : ''}`;
      const chatId = postToPanel(text);
      const err = await deliver(job, text, [], chatId);
      setRun(run.id, { output: text });
      return finishJob(err ? 'error' : 'done', err, chatId);
    }

    const chatId = runTurn({
      message: job.prompt || job.title, mode: job.mode || MODES[job.kind]?.() || 'edit', origin: 'scheduled',
      clientId: job.client_id, title: `⏰ ${job.title} · ${utcToLocal(now()).slice(0, 10)}`, extraPrompt: scheduledPrompt(job),
    });
    setRun(run.id, { chat_id: chatId });
    updateRow('scheduled_jobs', job.id, { last_chat_id: chatId, last_status: 'running', last_error: null }, 'system');
  } catch (e) {
    finishJob('error', e.message);
    await deliver(job, `⚠️ Falló el programado "${job.title}": ${e.message}`);
  }
}

// Claude runs finish here: store the output and send it to the owner.
async function turnDone({ chat, text, error, files }) {
  if (chat?.origin !== 'scheduled') return;
  const run = db.prepare("SELECT * FROM scheduled_runs WHERE chat_id = ? AND status = 'running' ORDER BY id DESC LIMIT 1").get(chat.id);
  if (!run) return;
  const job = getRow('scheduled_jobs', run.job_id);
  const failed = !!error && !text;
  const sendErr = job ? await deliver(job, failed ? `⚠️ "${job.title}" falló: ${error}` : text, files, chat.id) : null;
  const status = failed || sendErr ? 'error' : 'done';
  setRun(run.id, { status, output: text?.slice(0, 4000) || null, error: failed ? error : sendErr, finished_at: now() });
  if (job) updateRow('scheduled_jobs', job.id, { last_status: status, last_error: failed ? error : sendErr }, 'system');
}

/** Advance the job past `slot` (recurring → next cron slot; one-shot → done). */
function advance(job) {
  const patch = job.cron ? { next_run_at: nextRun(job.cron) } : { next_run_at: null, status: 'done' };
  return updateRow('scheduled_jobs', job.id, patch, 'system');
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = db.prepare("SELECT * FROM scheduled_jobs WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at").all(now());
    for (const job of due) {
      const slot = job.next_run_at;
      const late = Date.now() - fromUtc(slot).getTime();
      advance(job); // first, so a slow run or a crash never runs the same slot twice
      const grace = job.kind === 'reminder' ? GRACE_MS.reminder : job.cron ? GRACE_MS.recurring : GRACE_MS.once;
      if (late > grace) {
        insertRow('scheduled_runs', { job_id: job.id, due_at: slot, status: 'missed', finished_at: now(), error: 'el CRM estaba apagado a esa hora' }, 'system');
        updateRow('scheduled_jobs', job.id, { last_status: 'missed', last_error: `no corrió a las ${utcToLocal(slot)} (CRM apagado)` }, 'system');
        if (!job.cron) await deliver(job, `⚠️ El programado "${job.title}" de las ${utcToLocal(slot)} no corrió porque el CRM estaba apagado. Dime si lo hago ahora.`);
        continue;
      }
      await runJob(getRow('scheduled_jobs', job.id), slot);
    }
  } catch (e) {
    console.error('[scheduler]', e);
  } finally {
    ticking = false;
  }
}

/** Run a job right now (button in Programados); does not move its schedule. */
export async function runNow(id) {
  const job = getRow('scheduled_jobs', id);
  if (!job) throw new Error('job not found');
  if (job.last_chat_id && isRunning(job.last_chat_id) && job.last_status === 'running') throw new Error('Ese programado ya está corriendo');
  await runJob(job);
  return getRow('scheduled_jobs', id);
}

export function start() {
  onTurnDone(turnDone); // before resumeRuns, so a turn that finishes right after a restart is still recorded
  setTimeout(() => {
    // Runs left 'running' by a restart whose turn no longer exists.
    for (const r of db.prepare("SELECT id, chat_id FROM scheduled_runs WHERE status = 'running'").all()) {
      if (!r.chat_id || !isRunning(r.chat_id)) setRun(r.id, { status: 'error', error: 'se interrumpió (reinicio del CRM)', finished_at: now() });
    }
    tick();
  }, 5000).unref();
  setInterval(() => tick(), TICK_MS).unref();
}
