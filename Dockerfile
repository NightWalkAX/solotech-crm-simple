# Solo Tech CRM (simple) — server image. The repo itself is mounted at /app (docker-compose.yml) so Build mode can edit
# the code live; the image provides Node, Chromium, the Claude CLI and a node_modules seed for the volume.
FROM node:24-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CRM_HOSTED=1 \
    WHISPER_PYTHON=/opt/whisper/bin/python \
    WHISPER_MODEL=small \
    HF_HOME=/app/data/whisper-models \
    TZ=America/Guyana

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv make g++ ca-certificates curl tini sqlite3 git \
    && rm -rf /var/lib/apt/lists/*

# Voice notes: faster-whisper on CPU (server/transcribe.js). Model downloads on first use into data/ (persists);
# WHISPER_MODEL=base in .env for 2 GB instances, small (default) needs 4 GB.
RUN python3 -m venv /opt/whisper && /opt/whisper/bin/pip install --no-cache-dir faster-whisper 'av<16'

# Claude Code CLI: the chat and the AI helpers run `claude -p` (CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY).
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev && sha1sum package-lock.json | cut -c1-40 > node_modules/.lock-hash
# Chromium for the PDFs (quotes, invoices, receipts, SOWs, reports).
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright

COPY . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/deploy/start-hosted.sh"]
