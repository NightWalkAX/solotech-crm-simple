// Bridges the UI chat to the local Claude Code CLI (`claude -p`, stream-json), with the CRM MCP server attached.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, insertRow, updateRow, getRow, changed, DB_PATH } from './db.js';
import { today } from './domain.js';
import { currentRate, lastRate } from './fx.js';
import { jobsConfig } from './jobs.js';
import { CLAUDE } from './claude-bin.js';
import { owner } from './owner.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = os.homedir();
const MCP_CONFIG = path.join(path.dirname(DB_PATH), 'mcp.json');
const mcpConfig = () => JSON.stringify({
  mcpServers: {
    crm: {
      command: process.execPath,
      args: [path.join(ROOT, 'server', 'mcp.js')],
      env: { CRM_DB: DB_PATH, CRM_API_PORT: process.env.CRM_API_PORT || '4100' },
    },
  },
}, null, 2);
fs.writeFileSync(MCP_CONFIG, mcpConfig());

const ALLOWED_TOOLS = ['mcp__crm', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'Skill', 'Agent', 'TodoWrite'];
// build: CRM data + code tools + web. edit: only the CRM data tools (+ web search), no code tools, no other MCP servers.
const EDIT_TOOLS = ['WebSearch', 'WebFetch'];
const MODES = {
  build: { model: 'claude-opus-5-5', args: () => ['--allowedTools', ALLOWED_TOOLS.join(',')] },
  edit: { model: 'claude-sonnet-5-5', args: () => ['--tools', EDIT_TOOLS.join(','), '--strict-mcp-config', '--allowedTools', ['mcp__crm', ...EDIT_TOOLS].join(',')] },
};
export const HOSTED = process.env.CRM_HOSTED === '1';
const running = new Map(); // chat id -> Run

// Where things the owner tells you belong (both modes).
const knowledgePrompt = () => [
  'SAVING WHAT THE OWNER TELLS YOU: put each piece where it belongs, search first so you update instead of duplicating, and confirm in one line where you saved it.',
  '- Facts about a client (contact, sector, how they work, what they need, pains) → crm_update_client (characterization, pain_points, notes; append, never wipe existing text). Something that happened with them (call, meeting, agreement) → crm_add_interaction.',
  '- Something to do or deliver, with or without date → crm_add_action, with effort quick | medium | big (rough size for the Tasks tab, never exact times).',
  '- Know-how for a specific client (how to deliver, their process, access details without passwords) → crm_save_note kind "methodology" with client_id.',
  '- Ideas for the business (services, pricing, marketing, products) → crm_save_note kind "idea". General information or references → kind "info" / "reference".',
  '- New client or prospect on their request → crm_search_clients first (name, phone), then crm_create_client.',
  '- Scope of Work / terms / acceptance documents for a quote → crm_save_sow (signed with the saved signature, kept in Contratos y Acuerdos), never crm_make_report. Regenerating the same quote + phase replaces the file; when the client returns it signed, attach the signed copy to that row and set signed_on.',
  'Never store passwords or card numbers; tell them to keep those elsewhere.',
  'SCHEDULING (Programados tab): when the owner asks for something at a time or on a schedule, use crm_schedule_job; times are Guyana local (UTC-4). Kinds: reminder = a message to them (title + optional text; no Claude run); briefing = a summary/plan; task = any other job Claude should do at that time. One-shot: run_at "YYYY-MM-DD HH:MM"; recurring: cron "min hour day month weekday" in Guyana time (e.g. "0 19 * * *" every day 7 pm, "0 9 * * 6" Saturdays 9 am). prompt = the full self-contained instruction for that future run (it starts without this conversation). Results go to their WhatsApp line by default (deliver "panel" = only the CRM). After creating it, confirm in one line: what, when (day + local time) and where it will arrive. List/pause/cancel/change with crm_list_jobs and crm_update_job.',
].join('\n');
const availabilityPrompt = () => `OWNER'S TIME (use it when planning, proposing dates or scheduling; editable in Programados): ${jobsConfig().availability}`;
const turnHooks = new Set(); // fn({ chat, text, error, files }) after every finished turn (wa-prompts.js replies on WhatsApp)
export const onTurnDone = fn => turnHooks.add(fn);
export const isRunning = chatId => running.has(chatId);

// Turns of chats.origin = 'whatsapp' come from the owner's phone and the final text goes back to WhatsApp.
const WHATSAPP_PROMPT = [
  'WHATSAPP LINE: this chat is the owner writing from their phone. Voice notes arrive transcribed automatically (marked 🎙️) and may contain transcription errors: interpret them sensibly and ask one short question only if it is truly ambiguous.',
  'Your final text is sent to them as a WhatsApp message: keep it short (a few lines), plain text with WhatsApp formatting (*bold*, _italic_, "- " lists), no tables, no markdown headings, no links to localhost.',
  'When they ask for a report, list, summary of numbers or anything long or tabular, build it with crm_make_report (pdf to read, xlsx when they want the data to filter or edit) and in your text say in one line what it contains; the file is sent to them automatically after your reply.',
  'Documents: they can ask you to create and issue quotes, invoices and receipts (crm_create_document, crm_invoice_from_quote, crm_record_payment) and to send them any document (crm_document_pdf: the PDF goes to them automatically). Issued numbers are final, so before issuing repeat client, lines, currency and total in one short message and wait for their OK, unless the message already gave every detail and said to issue it. After issuing, always attach the PDF.',
  'Messaging rules still apply: never message clients on WhatsApp; this line only talks to the owner. The default mode is set in Integraciones; the owner switches it for a while with the commands "modo build" / "modo edit" (see WHATSAPP MODE).',
].join('\n');

function systemPrompt(chat, mode, extra) {
  return [modePrompt(chat, mode), knowledgePrompt(), availabilityPrompt(), chat.origin === 'whatsapp' ? WHATSAPP_PROMPT : '', extra || '']
    .filter(Boolean).join('\n');
}

const DATA_TOOLS = 'CRM data: use the mcp__crm__* tools (crm_today, crm_search_clients, crm_get_client, crm_create_client, crm_update_client, crm_add_interaction, crm_log_messages, crm_add_action, crm_update_action, crm_create_document, crm_invoice_from_quote, crm_record_payment, crm_batch, crm_query, finance and debt tools (crm_save_debt / crm_add_debt_payment), taxes (crm_taxes / crm_tax_payment: NIS/GRA estimates, calendar, payments, tax reserve), budget (crm_budget / crm_save_budget_line / crm_owner_move for salary and tax reserve), recurring client plans: crm_list_plans / crm_save_plan / crm_invoice_plan, external invoices: crm_list_external_invoices / crm_external_invoice_paid). When the owner pastes a real chat, log the messages with crm_log_messages so it shows in the Inbox (crm_delete_messages removes duplicates) and add at most a short summary interaction. For several writes at once (filling data, imports, many updates) use crm_batch in a single call. Every write is audited and the owner can undo it from the chat; the UI refreshes by itself.';

function modePrompt(chat, mode) {
  const client = chat.client_id ? getRow('clients', chat.client_id) : null;
  const { name, business } = owner();
  const who = `You are running inside the chat panel of the CRM of ${business} (local web app), talking to its owner${name === 'the owner' ? '' : `, ${name}`}. Talk to them in Spanish unless they write in another language.`;
  const context = client ? `Context: the owner opened this chat from the client "${client.company}" (id ${client.id}). "This client" means id ${client.id}.` : '';
  if (mode === 'edit') return [
    `${who} You are in EDIT mode.`,
    `Today is ${today()} (Guyana, UTC-4).`,
    DATA_TOOLS,
    'You also have WebSearch/WebFetch to look things up. You cannot edit code or files here; if the owner asks for that, tell them to switch to Build mode (button above the send arrow).',
    'Issued document numbers are final: never reuse or renumber them. Never send messages or emails to clients. Keep answers short; summarize what you changed.',
    context,
  ].filter(Boolean).join('\n');
  return [
    who,
    `Today is ${today()} (Guyana, UTC-4).`,
    DATA_TOOLS,
    'Issued document numbers are final: never reuse or renumber them.',
    `CRM source code: ${ROOT} (read its CLAUDE.md before changing code). The UI runs on Vite with hot reload and the API restarts on file changes, so code edits show up without the owner doing anything. Add DB changes as new files in server/migrations.`,
    'Never send messages or emails to clients or publish anything without the owner explicitly asking for it in this chat. Keep answers short; summarize what you changed.',
    context,
  ].filter(Boolean).join('\n');
}

/** Chats not deleted, newest first (the WhatsApp prompt line runs in the background, not listed; scheduled runs are); `all` lifts the 50 limit (session manager) and adds message count and cost. */
export function listChats({ all = false } = {}) {
  return db.prepare(`SELECT ch.*, c.company,
      (SELECT count(*) FROM chat_messages m WHERE m.chat_id = ch.id) AS message_count,
      (SELECT sum(cost_usd) FROM chat_messages m WHERE m.chat_id = ch.id) AS cost_usd
    FROM chats ch LEFT JOIN clients c ON c.id = ch.client_id
    WHERE ch.deleted_at IS NULL AND coalesce(ch.origin, '') NOT IN ('whatsapp') ORDER BY ch.updated_at DESC ${all ? '' : 'LIMIT 50'}`).all()
    .map(ch => ({ ...ch, running: running.has(ch.id) }));
}

/** Stop and hide chats; messages stay so their token cost remains in Finanzas. Undoable from the audit log. */
export function deleteChats(ids, actor = 'ui') {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let n = 0;
  for (const chatId of ids) {
    stopChat(chatId);
    if (updateRow('chats', chatId, { deleted_at: now }, actor)) n++;
  }
  return { deleted: n };
}

export function getMessages(chatId) {
  return db.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id').all(chatId)
    .map(m => ({ ...m, tools: JSON.parse(m.tools), audit_ids: JSON.parse(m.audit_ids) }));
}

export function stopChat(chatId) {
  const run = running.get(chatId);
  run?.stop();
  return !!run;
}

function describeTool(name, input = {}) {
  const short = name.replace(/^mcp__crm__/, '');
  const hint = input.file_path || input.command || input.query || input.pattern || input.sql || input.company || input.title || input.summary || input.url || input.skill || '';
  return { name: short, hint: String(hint).slice(0, 140) };
}

// Each turn runs detached (in its own systemd scope on Linux, outside the CRM service's cgroup), with stdout going to a
// file: restarting the CRM (or this worker) neither kills nor loses it. The worker only tails the file and,
// after a restart, resumeRuns() picks up the turns still in data/chat-runs/<chat id>/.
const RUNS_DIR = path.join(path.dirname(DB_PATH), 'chat-runs');
// systemd-run only where a user systemd session exists (Linux desktops/servers); on macOS the turn is a plain detached process.
const userBus = process.env.XDG_RUNTIME_DIR && fs.existsSync(path.join(process.env.XDG_RUNTIME_DIR, 'bus'));
const LAUNCHER = fs.existsSync('/usr/bin/systemd-run') && userBus ? ['/usr/bin/systemd-run', '--user', '--scope', '--quiet', '--collect'] : [];
const SCRIPT = '"$0" "$@" < "$RUN_DIR/in.txt" > "$RUN_DIR/out.ndjson" 2> "$RUN_DIR/err.txt" & echo $! > "$RUN_DIR/pid"; wait $!; echo $? > "$RUN_DIR/exit"';

/** Tokens and USD of one turn from the final `result` event; modelUsage also counts subagents. */
function resultUsage(ev) {
  const models = Object.values(ev.modelUsage ?? {});
  const sum = k => models.reduce((s, m) => s + (m[k] || 0), 0);
  const u = ev.usage ?? {};
  return models.length ? {
    input_tokens: sum('inputTokens'), output_tokens: sum('outputTokens'),
    cache_read_tokens: sum('cacheReadInputTokens'), cache_write_tokens: sum('cacheCreationInputTokens'),
    cost_usd: ev.total_cost_usd ?? sum('costUSD'),
  } : {
    input_tokens: u.input_tokens ?? null, output_tokens: u.output_tokens ?? null,
    cache_read_tokens: u.cache_read_input_tokens ?? null, cache_write_tokens: u.cache_creation_input_tokens ?? null,
    cost_usd: ev.total_cost_usd ?? null,
  };
}

const read = (f, fallback = null) => { try { return fs.readFileSync(f, 'utf8'); } catch { return fallback; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

class Run {
  constructor(chatId) {
    this.chatId = chatId;
    this.dir = path.join(RUNS_DIR, String(chatId));
    this.meta = JSON.parse(read(path.join(this.dir, 'meta.json')));
    this.text = '';
    this.tools = [];
    this.files = []; // report files built in this turn (crm_make_report)
    this.offset = 0;
    this.buf = '';
    this.resultError = null;
    this.listeners = new Set();
    running.set(chatId, this);
    this.timer = setInterval(() => this.poll(), 250);
    currentRate().catch(() => {}); // fresh USD→GYD for this turn's cost
  }

  emit(ev) { for (const fn of this.listeners) fn(ev); }

  poll() {
    let fd;
    try { fd = fs.openSync(path.join(this.dir, 'out.ndjson'), 'r'); } catch { fd = null; }
    if (fd != null) {
      const chunk = Buffer.alloc(1 << 16);
      let n;
      while ((n = fs.readSync(fd, chunk, 0, chunk.length, this.offset)) > 0) {
        this.offset += n;
        this.buf += chunk.toString('utf8', 0, n); // stream-json lines are ASCII-escaped, no split code points
      }
      fs.closeSync(fd);
      let nl;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl).trim();
        this.buf = this.buf.slice(nl + 1);
        if (line) this.handle(line);
      }
    }
    const exit = read(path.join(this.dir, 'exit'));
    const pid = Number(read(path.join(this.dir, 'pid')));
    const lost = exit == null && (pid ? !alive(pid) : Date.now() - this.meta.started > 30_000);
    if (exit != null || lost) this.finish(lost ? null : Number(exit));
  }

  handle(line) {
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    const chat = getRow('chats', this.chatId);
    if (ev.session_id && chat && ev.session_id !== chat.session_id) updateRow('chats', chat.id, { session_id: ev.session_id }, 'system');
    if (ev.type === 'stream_event' && ev.parent_tool_use_id == null) {
      const e = ev.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') this.addText(e.delta.text);
      else if (e?.type === 'content_block_start' && e.content_block?.type === 'text' && this.text && !this.text.endsWith('\n')) this.addText('\n\n');
    } else if (ev.type === 'assistant' && ev.parent_tool_use_id == null) {
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'tool_use') {
          const t = describeTool(block.name, block.input);
          this.tools.push(t);
          this.emit({ type: 'tool', ...t });
        }
      }
    } else if (ev.type === 'user' && ev.parent_tool_use_id == null) {
      for (const block of ev.message?.content ?? []) {
        if (block.type !== 'tool_result' || block.is_error) continue;
        const raw = typeof block.content === 'string' ? block.content : (block.content ?? []).map(c => c.text ?? '').join('');
        try {
          const r = JSON.parse(raw);
          if (r?.report_file && !this.files.some(f => f.file === r.report_file)) this.files.push({ file: r.report_file, name: r.name });
        } catch { /* not JSON */ }
      }
    } else if (ev.type === 'result') {
      if (ev.is_error) this.resultError = ev.result || ev.subtype;
      this.usage = resultUsage(ev);
    }
  }

  addText(delta) { this.text += delta; this.emit({ type: 'text', delta }); }

  finish(code) {
    clearInterval(this.timer);
    running.delete(this.chatId);
    const { text, tools } = this;
    const stderr = (read(path.join(this.dir, 'err.txt'), '') || '').trim();
    const error = this.resultError || (code == null ? (text ? null : 'El proceso de Claude terminó sin responder (¿se apagó la computadora?).')
      : code !== 0 && code !== 130 && !text ? stderr.slice(-500) || `claude exited with ${code}` : null);
    const fx = this.usage?.cost_usd != null ? lastRate()?.sell ?? null : null;
    const auditIds = db.prepare("SELECT id FROM audit_log WHERE id > ? AND actor = 'claude' ORDER BY id").pluck().all(this.meta.auditStart);
    const msg = getRow('chats', this.chatId) && insertRow('chat_messages', {
      chat_id: this.chatId, role: 'assistant', text: text || (error ? `⚠️ ${error}` : ''),
      tools: JSON.stringify(tools), audit_ids: JSON.stringify(auditIds), ...this.usage,
      mode: this.meta.mode, fx_rate: fx, cost_gyd: fx ? Math.round(this.usage.cost_usd * fx) : null,
    }, 'system');
    db.prepare("UPDATE chats SET updated_at = datetime('now') WHERE id = ?").run(this.chatId);
    changed('chats', this.chatId);
    fs.rmSync(this.dir, { recursive: true, force: true });
    const chat = getRow('chats', this.chatId);
    for (const fn of turnHooks) {
      Promise.resolve().then(() => fn({ chat, text, error, files: this.files })).catch(e => console.error('[chat] turn hook', e));
    }
    this.emit(error && !text ? { type: 'error', error } : { type: 'done', message: msg && { ...msg, tools, audit_ids: auditIds } });
    this.listeners.clear();
  }

  stop() {
    const pid = Number(read(path.join(this.dir, 'pid')));
    if (pid && alive(pid)) process.kill(pid, 'SIGINT');
  }
}

/** Pick up turns that were running when the worker (re)started. */
export function resumeRuns() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  for (const name of fs.readdirSync(RUNS_DIR)) {
    const chatId = Number(name);
    if (!chatId || running.has(chatId)) continue;
    if (!getRow('chats', chatId) || !fs.existsSync(path.join(RUNS_DIR, name, 'meta.json'))) {
      fs.rmSync(path.join(RUNS_DIR, name), { recursive: true, force: true });
      continue;
    }
    new Run(chatId);
  }
}

/** Follow a running turn: `fn` gets a snapshot, then text/tool events, then done/error. Returns unsubscribe, or null if idle. */
export function follow(chatId, fn) {
  const run = running.get(chatId);
  if (!run) return null;
  fn({ type: 'snapshot', text: run.text, tools: run.tools });
  run.listeners.add(fn);
  return () => run.listeners.delete(fn);
}

/** Start one turn in the background; returns the chat id right away. */
/** extraPrompt: appended to the system prompt of this turn only (scheduler.js: scheduled-job context). */
export function runTurn({ chatId, message, clientId, mode = 'build', origin, title, extraPrompt }) {
  if (!MODES[mode]) mode = 'build';
  // Hosted (CRM_HOSTED=1, cloud server): never give the AI Bash/Edit/Write on the server, only the CRM data tools.
  if (HOSTED) mode = 'edit';
  let chat = chatId ? getRow('chats', chatId) : null;
  if (!chat || chat.deleted_at) {
    chat = insertRow('chats', { title: title || message.slice(0, 60), client_id: clientId ?? null, origin: origin ?? null }, 'system');
  }
  if (running.has(chat.id)) throw new Error('Esta conversación ya está trabajando; espera o detenla.');
  insertRow('chat_messages', { chat_id: chat.id, role: 'user', text: message }, 'system');

  const dir = path.join(RUNS_DIR, String(chat.id));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'in.txt'), message);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    mode, started: Date.now(), auditStart: db.prepare('SELECT coalesce(max(id), 0) FROM audit_log').pluck().get(),
  }));

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--mcp-config', MCP_CONFIG, '--permission-mode', 'acceptEdits',
    '--model', MODES[mode].model, ...MODES[mode].args(),
    '--append-system-prompt', systemPrompt(chat, mode, extraPrompt),
  ];
  if (chat.session_id) args.push('--resume', chat.session_id);

  // cwd = home so the chat shares the owner's Claude memory and skills with their terminal sessions.
  const [cmd, ...pre] = [...LAUNCHER, '/bin/sh', '-c', SCRIPT, CLAUDE, ...args];
  spawn(cmd, pre, { cwd: HOME, env: { ...process.env, CRM_CHAT: '1', RUN_DIR: dir }, detached: true, stdio: 'ignore' }).unref();
  new Run(chat.id);
  changed('chats', chat.id);
  return chat.id;
}

/** Revert one audited write (used to undo what Claude changed). */
export function undoAudit(auditId) {
  const a = getRow('audit_log', auditId);
  if (!a) throw new Error('audit entry not found');
  if (a.undone_at) return { already: true };
  const before = a.before ? JSON.parse(a.before) : null;
  db.transaction(() => {
    if (a.action === 'insert' && a.tbl === 'documents') {
      // Issued numbers are final: an undone document is voided, never deleted.
      db.prepare("UPDATE documents SET status = 'void' WHERE id = ?").run(a.row_id);
    } else if (a.action === 'insert') {
      db.prepare(`DELETE FROM ${a.tbl} WHERE id = ?`).run(a.row_id);
    } else if (a.action === 'update') {
      const keys = Object.keys(before).filter(k => k !== 'id');
      db.prepare(`UPDATE ${a.tbl} SET ${keys.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run(before);
    } else if (a.action === 'delete') {
      const keys = Object.keys(before);
      db.prepare(`INSERT INTO ${a.tbl} (${keys.join(', ')}) VALUES (${keys.map(k => '@' + k).join(', ')})`).run(before);
    }
    db.prepare("UPDATE audit_log SET undone_at = datetime('now') WHERE id = ?").run(auditId);
  })();
  changed(a.tbl, a.row_id);
  return { ok: true };
}

/** Undo everything Claude wrote during one assistant turn, newest first. */
export function undoMessage(messageId) {
  const m = getRow('chat_messages', messageId);
  if (!m) throw new Error('message not found');
  const ids = JSON.parse(m.audit_ids).sort((a, b) => b - a);
  for (const id of ids) undoAudit(id);
  return { undone: ids.length };
}
