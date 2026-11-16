# Solo Tech CRM (simple)

CRM for a small service business: clients and pipeline, WhatsApp inbox, tasks, notes, quotes → invoices → receipts,
contracts/SOWs, finances, debts, recurring plans, scheduled jobs and an AI chat (Claude Code CLI) that works on the CRM data.
UI in Spanish, client documents in English. The owner's name and business come from Integraciones → Emisor y firma
(server/owner.js) and are used in every AI prompt.

## Run
- Dev: `npm run dev` → API :4100 (`node --watch`), chat worker :4101, Vite :4000 (HMR, proxies /api).
- Production: `npm start` → API + chat worker + `server/gateway.js` on :8080 (see below).
- DB: `data/crm.sqlite` (SQLite, WAL). Override with `CRM_DB`. Never commit `data/`.

## Architecture
```
server/index.js        Hono API; every write goes through db.js insertRow/updateRow/deleteRow (audit_log + change event)
server/db.js           connection, migrations (server/migrations/NNNN_*.sql, applied in order on load, IMMEDIATE transaction so
                       API + worker can start together), audit, settings, data_version watcher
server/domain.js       stages, auto temperature, Today board, document numbering
server/leadscore.js    lead temperature from the conversation content (claude -p, no tools), chat worker, every 60 s
server/documents.js    quotes → invoices → receipts, payments; server/pdf.js renders PDFs with Playwright
server/chat.js         `claude -p --output-format stream-json` per turn, output in data/chat-runs/<chat>/; modes build (all tools)
                       and edit (CRM MCP + web only); per-turn undo. CRM_HOSTED=1: build only from the web panel (chat without origin),
                       WhatsApp/scheduled/any origin always edit; cwd = repo
server/chat-worker.js  chat HTTP endpoints, lead scoring, scheduler (scheduled jobs) and connector polling in their own process
server/mcp.js          MCP tools crm_* used by Claude from the chat (writes via the API with x-actor: claude → undoable)
server/messages.js     Inbox: threads per client/number, WhatsApp export import, client matching by phone
server/connectors/     whatchimp.js (WhatsApp inbox sync), wa-prompts.js (owner's own number as a prompt line)
server/finance.js      income, expenses (fixed/variable), subscriptions; fx.js USD→GYD rate
server/taxes.js, budget.js  tax estimate and monthly budget
server/contracts.js, sow.js  signed contracts and Scope of Work documents
server/debts.js, plans.js    receivables/payables, recurring client plans and external invoices
server/jobs.js, scheduler.js, cron.js  Programados: reminders, briefings and tasks on a schedule
server/push.js         PWA + Web Push
server/reports.js      PDF/XLSX reports for the chat
server/taskcontext.js, suggest.js  AI helpers (task context, suggestions)
server/gateway.js      server entry :8080: proxies /api to API/worker and the UI to Vite (CRM_UI=vite, HMR websocket) or serves dist/;
                       strips x-actor, /healthz, Cloudflare Access JWT check on requests and websockets
web/src                React + React Query + Tailwind v4; lib/live.js listens to /api/events (SSE) and invalidates all queries
```

## Production / cloud (deploy/README.md)
- `Dockerfile` + `docker-compose.yml` (crm + cloudflared with `TUNNEL_TOKEN`), `.env` from `deploy/env.example`.
- The repo is mounted at /app and `deploy/start-hosted.sh` runs it like dev (API --watch, worker, Vite HMR, gateway), so
  Build mode from the panel edits the server's code live and commits in that checkout (node_modules in a volume,
  reinstalled when package-lock changes). The server checkout can diverge from GitHub: `git pull` may need a merge.
- With `CF_ACCESS_TEAM` + `CF_ACCESS_AUD` every request needs a valid Cloudflare Access JWT.
- Claude CLI auth: `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`, Claude subscription) or `ANTHROPIC_API_KEY`.
- `deploy/cloudshell.sh`: creates the Lightsail instance from AWS CloudShell and starts everything.

## Rules
- Live updates: any DB write triggers SSE → UI refetch. Don't add manual refresh buttons.
- Schema changes: add a new migration file; never edit an applied one.
- Document numbers (QUO/INV/REC-000000) are final: never reuse, renumber or delete issued documents — void them.
- Money is stored as whole units of the document currency (GYD default). VAT: exempt by default, 14% standard.
- Never message clients, send email, deploy or publish without the owner asking in the chat.
