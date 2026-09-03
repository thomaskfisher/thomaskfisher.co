/**
 * Minimal CDP driver: launch Chrome headless, load a page, capture console and
 * exceptions, run a script of actions, screenshot.
 *
 * Usage: node cdp.mjs <url> <outPng> [actionsJsonFile]
 *
 * Actions: {"eval"}, {"wait": ms}, {"waitFor": expr}, {"offline"}, {"navigate"},
 * {"seedSave": {...}}. Prefer `waitFor` over `wait` — level generation runs on a
 * worker and its timing varies by level and machine.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [url, outPng, actionsFile] = process.argv.slice(2);
const PORT = 9333;

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  '--mute-audio',
  `--remote-debugging-port=${PORT}`,
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll an expression until it is truthy. Generation happens on a worker, so a
 * fixed sleep is either flaky or slow; a deep level can take seconds.
 */
async function waitFor(expression, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    try {
      const res = await send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (!res.exceptionDetails && res.result?.value) return true;
    } catch { /* page mid-navigation */ }
  }
  return false;
}

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not expose a debugging port');
}

const ws = new WebSocket(await getWsUrl());
await new Promise((resolve) => ws.addEventListener('open', resolve));

let nextId = 1;
const pending = new Map();
const logs = [];
let sessionId = null;

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
    logs.push(`[${msg.params.type}] ${text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${d.text} ${d.exception?.description ?? ''}`);
  }
  if (msg.method === 'Log.entryAdded') {
    logs.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
});

function send(method, params = {}, useSession = true) {
  const id = nextId++;
  const payload = { id, method, params };
  if (useSession && sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

// Attach to a real page target.
const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, false));

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});

await send('Page.navigate', { url });
await sleep(2500);

if (actionsFile) {
  const actions = JSON.parse(await (await import('node:fs/promises')).readFile(actionsFile, 'utf8'));
  for (const action of actions) {
    if (action.eval) {
      try {
        const res = await send('Runtime.evaluate', {
          expression: action.eval, awaitPromise: true, returnByValue: true,
        });
        if (res.exceptionDetails) {
          logs.push(`[eval THREW] ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
        } else {
          logs.push(`[eval] ${action.eval.slice(0, 60)} => ${JSON.stringify(res.result?.value)}`);
        }
      } catch (err) {
        logs.push(`[eval FAILED] ${err.message}`);
      }
    }
    if (action.offline !== undefined) {
      await send('Network.enable');
      await send('Network.emulateNetworkConditions', {
        offline: action.offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
      });
      logs.push(`[net] offline=${action.offline}`);
    }
    if (action.navigate) {
      await send('Page.navigate', { url: action.navigate });
      logs.push(`[nav] ${action.navigate}`);
    }
    if (action.waitFor) {
      const ok = await waitFor(action.waitFor, action.timeout ?? 40000);
      logs.push(`[waitFor] ${action.waitFor.slice(0, 60)} => ${ok ? 'ready' : 'TIMED OUT'}`);
    }
    if (action.seedSave) {
      const { game, level, ...rest } = action.seedSave;
      // The IndexedDB copy must go, or storage.ts prefers whichever record is
      // newer and the seeded localStorage mirror is ignored.
      const expr = `(async () => {
        await new Promise((res) => {
          const r = indexedDB.deleteDatabase('tf-games');
          r.onsuccess = r.onerror = r.onblocked = () => res();
        });
        localStorage.setItem('tf-games:save:${game}', JSON.stringify({
          updatedAt: Date.now(),
          data: Object.assign({
            v: 1, game: '${game}', seed: 'a1b2c3d4e5f60718', level: ${level},
            difficultyOffset: 0, recentOutcomes: [], inProgress: null,
            settings: { colorBlindShapes: false, theme: 'dark', sound: false },
            stats: { levelsCleared: 0, totalUndos: 0, totalHints: 0, totalRestarts: 0 },
          }, ${JSON.stringify(rest)}),
        }));
        return 'seeded';
      })()`;
      const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      logs.push(`[seedSave] ${game} level ${level} => ${res.exceptionDetails ? 'FAILED' : 'ok'}`);
      // Only takes effect on the next load: the running app has its save already.
      await send('Page.navigate', { url: action.seedSave.url ?? url });
      await sleep(1200);
    }
    if (action.wait) await sleep(action.wait);
  }
}

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(outPng, Buffer.from(data, 'base64'));

console.log(logs.join('\n') || '(no console output)');

ws.close();
chrome.kill();
process.exit(0);
