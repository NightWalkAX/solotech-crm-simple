// Chat runner, separate from the API: the API restarts whenever Claude edits server code,
// and that must not kill the Claude process doing the editing. Not file-watched on purpose.
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { stream } from 'hono/streaming';
import { migrate } from './db.js';
import { cachedSuggestions, suggestReplies, markSuggestionUsed } from './suggest.js';
import * as wa from './connectors/whatchimp.js';
import * as waPrompts from './connectors/wa-prompts.js';
import * as scheduler from './scheduler.js';
import * as leadscore from './leadscore.js';
import { listChats, deleteChats, getMessages, runTurn, stopChat, undoMessage, follow, resumeRuns, onTurnDone } from './chat.js';
import { notify, plain } from './push.js';

migrate();
waPrompts.start(); // registers the WhatsApp reply hook before resumed turns can finish
scheduler.start(); // same for scheduled runs (Programados)
leadscore.start(); // lead temperature from the conversation's content
// Panel chats: push when Claude finishes (WhatsApp turns reply on WhatsApp; scheduled ones notify from scheduler.js).
onTurnDone(({ chat, text, error }) => {
  if (!chat || ['whatsapp', 'scheduled'].includes(chat.origin)) return;
  notify('chat', { title: `🤖 ${chat.title || 'Claude terminó'}`, body: plain(text) || (error ? `⚠️ ${error}` : 'Listo'), url: `/?chat=${chat.id}`, tag: `chat-${chat.id}` });
});
resumeRuns();
const app = new Hono().basePath('/api');
const id = c => Number(c.req.param('id'));
app.onError((err, c) => c.json({ error: err.message }, 400));

app.get('/chats', c => c.json(listChats({ all: c.req.query('all') === '1' })));
app.get('/chats/:id/messages', c => c.json(getMessages(id(c))));
app.delete('/chats/:id', c => c.json(deleteChats([id(c)])));
app.post('/chats/delete', async c => c.json(deleteChats(((await c.req.json()).ids ?? []).map(Number))));
app.post('/chats/:id/stop', c => c.json({ ok: stopChat(id(c)) }));
app.post('/chat-messages/:id/undo', c => c.json(undoMessage(id(c))));

// Reply suggestions live here too: generating takes ~15 s and must survive API restarts.
app.get('/suggestions', c => c.json(cachedSuggestions(Number(c.req.query('client_id')), c.req.query('channel') || 'whatsapp')));
app.post('/suggestions', async c => c.json(await suggestReplies(await c.req.json())));
app.post('/suggestions/:id/used', async c => c.json(markSuggestionUsed(id(c), (await c.req.json()).index)));

// WhatsApp via WhatChimp
app.get('/integrations/whatsapp', c => c.json(wa.status()));
app.post('/integrations/whatsapp/config', async c => c.json(await wa.configure(await c.req.json())));
app.post('/integrations/whatsapp/sync', async c => c.json(await wa.sync()));
app.post('/integrations/whatsapp/backfill', async c => c.json(await wa.backfill((await c.req.json()).phone)));
app.get('/integrations/whatsapp/window', c => c.json(wa.windowInfo(Number(c.req.query('client_id')))));
app.post('/integrations/whatsapp/send', async c => c.json(await wa.send(await c.req.json())));
app.get('/integrations/whatsapp/prompts', c => c.json(waPrompts.status()));
app.post('/integrations/whatsapp/prompts', async c => c.json(waPrompts.configure(await c.req.json())));

// Programados: run a job now (its schedule doesn't move).
app.post('/scheduler/jobs/:id/run', async c => c.json(await scheduler.runNow(id(c))));

// Turns run in the background (see chat.js); the UI starts one here and follows it with /chats/:id/stream.
app.post('/chat', async c => {
  const { chat_id, message, client_id, mode } = await c.req.json();
  if (!message?.trim()) return c.json({ error: 'empty message' }, 400);
  return c.json({ chat_id: runTurn({ chatId: chat_id, message: message.trim(), clientId: client_id, mode }) });
});

app.get('/chats/:id/stream', c => {
  c.header('content-type', 'application/x-ndjson');
  const chatId = id(c);
  return stream(c, async s => {
    await new Promise(resolve => {
      let unsubscribe = null;
      const emit = ev => {
        s.write(JSON.stringify(ev) + '\n').catch(() => { unsubscribe?.(); resolve(); });
        if (ev.type === 'done' || ev.type === 'error') { unsubscribe?.(); resolve(); }
      };
      s.onAbort(() => { unsubscribe?.(); resolve(); });
      unsubscribe = follow(chatId, emit);
      if (!unsubscribe) emit({ type: 'done' });
    });
  });
});

wa.startPolling();

const port = Number(process.env.CRM_CHAT_PORT || 4101);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`[chat] http://127.0.0.1:${port}/api`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
