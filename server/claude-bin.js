// Claude Code CLI used by the chat and the small AI helpers: CLAUDE_BIN, else the native installer's path, else Homebrew,
// else whatever `claude` is on PATH (npm global install).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE = process.env.CLAUDE_BIN
  || [path.join(os.homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(f => fs.existsSync(f))
  || 'claude';
