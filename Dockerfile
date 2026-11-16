# Solo Tech CRM (simple) — production image: built UI + API + chat worker + gateway on :8080.
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CRM_HOSTED=1 \
    TZ=America/Guyana

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl tini sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI: the chat and the AI helpers run `claude -p`; auth with ANTHROPIC_API_KEY (the client's own key).
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
# Chromium for the PDFs (quotes, invoices, receipts, SOWs, reports).
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright

COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 8080
VOLUME ["/app/data", "/home/node/.claude"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
