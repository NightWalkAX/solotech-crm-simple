// AI reply options for a client conversation. Generated once per (client, channel, last inbound message) and cached.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { db, insertRow, getRow, updateRow } from './db.js';
import { owner } from './owner.js';
import { CLAUDE } from './claude-bin.js';

const pending = new Map(); // cache key -> Promise (avoid generating twice on double click)

function lastInbound(client_id, channel) {
  return db.prepare("SELECT * FROM messages WHERE client_id = ? AND channel = ? AND direction = 'in' ORDER BY sent_at DESC, id DESC LIMIT 1").get(client_id, channel);
}

export function cachedSuggestions(client_id, channel) {
  const last = lastInbound(client_id, channel);
  const row = db.prepare(`SELECT * FROM reply_suggestions WHERE client_id = ? AND channel = ? AND for_message_id IS ? ORDER BY id DESC LIMIT 1`)
    .get(client_id, channel, last?.id ?? null);
  return { for_message_id: last?.id ?? null, suggestion: row ? { ...row, options: JSON.parse(row.options) } : null };
}

// No message from the owner yet in this channel → the next one breaks the ice.
const isOpening = messages => !messages.some(m => m.direction === 'out');

function buildPrompt(client, channel, messages, instructions) {
  const me = owner();
  const convo = messages.map(m => `[${m.sent_at} UTC] ${m.direction === 'in' ? (m.sender || 'Client') : me.short}: ${m.subject ? `(subject: ${m.subject}) ` : ''}${m.body}`).join('\n');
  const notes = db.prepare('SELECT occurred_at, channel, summary FROM interactions WHERE client_id = ? ORDER BY occurred_at DESC LIMIT 8').all(client.id)
    .map(i => `- ${i.occurred_at.slice(0, 10)} ${i.channel}: ${i.summary}`).join('\n');
  return `You draft ${channel === 'email' ? 'email' : 'WhatsApp'} replies for ${me.who} to a client/prospect.
Follow the owner's saved messaging rules from your memory if there are any. Friendly, human and patient; business value in plain language; never pushy.

CLIENT
Company: ${client.company}
Contact: ${client.contact_name || 'unknown'}
Stage: ${client.stage}
What they do: ${client.characterization || '—'}
Pain points: ${JSON.parse(client.pain_points || '[]').join(' | ') || '—'}
Recent notes:
${notes || '—'}

CONVERSATION (oldest first)
${convo || '(no messages yet — write an opening message)'}

${instructions ? `THE OWNER'S INSTRUCTIONS FOR THIS REPLY: ${instructions}\n` : ''}
Write 3 distinct reply options in the language the client uses (English by default), as ${me.name} would send them${channel === 'whatsapp' ? ' on WhatsApp: short, natural, no markdown' : ': include a subject line'}.
HARD RULE: each option asks AT MOST ONE question (one "?" in the whole message, and never two questions joined with "and"/"or"). Keep every option under 45 words.
${isOpening(messages) ? `THIS IS THE ICEBREAKER (the owner has not written to them yet): each option is 1-2 short sentences, MAX 30 words in total. Shape: greeting + who is writing in a few words + one simple, optional question. No fake compliments, no link, no prices, no hard selling. The 3 options differ in tone or angle.` : 'Make them genuinely different (e.g. answer + one question / move to a call or visit / propose the next step) and only promise what the business actually offers.'}
Return ONLY JSON, no prose, no code fences:
{"options":[{"label":"2-4 word Spanish label for the owner","text":"the message"${channel === 'email' ? ',"subject":"..."' : ''}}]}`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ['-p', '--output-format', 'json', '--tools', ''], { cwd: os.homedir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      try {
        const result = JSON.parse(out);
        if (result.is_error) throw new Error(result.result || 'claude error');
        const text = String(result.result).replace(/^```(?:json)?\s*|\s*```$/g, '');
        const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (!Array.isArray(json.options) || !json.options.length) throw new Error('no options returned');
        resolve(json.options.slice(0, 3));
      } catch (e) {
        reject(new Error(code ? err.slice(-300) || e.message : e.message));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Return cached options, or generate (force = regenerate even if cached). */
export async function suggestReplies({ client_id, channel = 'whatsapp', instructions, force = false }) {
  const client = getRow('clients', client_id);
  if (!client) throw new Error('client not found');
  const cached = cachedSuggestions(client_id, channel);
  if (cached.suggestion && !force && !instructions) return cached.suggestion;
  const key = `${client_id}|${channel}|${cached.for_message_id}|${instructions || ''}`;
  if (!pending.has(key)) {
    const messages = db.prepare('SELECT * FROM messages WHERE client_id = ? AND channel = ? ORDER BY sent_at DESC, id DESC LIMIT 30').all(client_id, channel).reverse();
    pending.set(key, runClaude(buildPrompt(client, channel, messages, instructions))
      .then(options => {
        const row = insertRow('reply_suggestions', {
          client_id, channel, for_message_id: cached.for_message_id, options: JSON.stringify(options), instructions: instructions || null,
        }, 'system');
        return { ...row, options };
      })
      .finally(() => pending.delete(key)));
  }
  return pending.get(key);
}

export function markSuggestionUsed(id, index) {
  return updateRow('reply_suggestions', id, { used_index: index }, 'system');
}
