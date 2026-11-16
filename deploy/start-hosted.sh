#!/bin/sh
# Container entry: runs the repo mounted at /app like the owner's local CRM (API with --watch, chat worker, Vite with HMR)
# behind server/gateway.js on :8080, so Build mode's code edits go live. CRM_UI=dist serves the built UI instead.
set -e
cd /app

# node_modules lives in a Docker volume: reinstall only when package-lock.json changes.
h=$(sha1sum package-lock.json | cut -c1-40)
if [ "$(cat node_modules/.lock-hash 2>/dev/null)" != "$h" ]; then
  npm ci --include=dev && echo "$h" > node_modules/.lock-hash
fi

# Build mode commits its own changes in the mounted repo.
git config --global --add safe.directory /app
git config --global user.name >/dev/null || git config --global user.name "CRM Build mode"
git config --global user.email >/dev/null || git config --global user.email "crm@localhost"

if [ "${CRM_UI:-vite}" = vite ]; then
  export CRM_UI=vite
  exec npx concurrently -k -n api,chat,web,gw \
    "node --watch-path=server server/index.js" "node server/chat-worker.js" "npx vite" "node server/gateway.js"
fi
npm run build
exec npm start
