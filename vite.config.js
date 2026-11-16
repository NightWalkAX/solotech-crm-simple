import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CRM_WEB_PORT || 4000),
    strictPort: true,
    // Remote access through Tailscale Serve (https://<pc>.<tailnet>.ts.net).
    allowedHosts: ['.ts.net'],
    proxy: {
      // Chat lives in its own process (see server/chat-worker.js); everything else is the API.
      '^/api/(chat|chats|chat-messages|demos|suggestions|integrations|scheduler)([/?]|$)': { target: `http://127.0.0.1:${process.env.CRM_CHAT_PORT || 4101}` },
      '/api': { changeOrigin: false, target: `http://127.0.0.1:${process.env.CRM_API_PORT || 4100}` },
    },
    watch: { ignored: ['**/data/**'] },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
