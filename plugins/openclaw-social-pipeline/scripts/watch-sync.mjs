import { watch, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(SRC, 'dist');
const SYNC = path.join(SRC, 'scripts/sync-extension.sh');

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

let pending = null;
let running = false;

function runSync() {
  if (running) {
    pending = Date.now();
    return;
  }
  running = true;
  const p = spawn('bash', [SYNC], { stdio: 'inherit' });
  p.on('exit', () => {
    running = false;
    if (pending) {
      pending = null;
      setTimeout(runSync, 100);
    }
  });
}

watch(DIST, { recursive: true }, () => {
  if (!pending) {
    pending = setTimeout(() => {
      pending = null;
      runSync();
    }, 300);
  }
});

console.log(`[watch-sync] watching ${DIST}`);
