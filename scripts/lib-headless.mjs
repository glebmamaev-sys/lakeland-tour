// Общие части автопроверки (smoke.mjs) и съёмки кадров (shots.mjs): раздача dist/ встроенным http-сервером, запуск
// установленного в системе Chrome без окна и протокол DevTools через WebSocket Node. Без зависимостей.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = path.join(ROOT, 'dist');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2' };

export function serveDist() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (rel.endsWith('/')) rel += 'index.html';
        const file = path.join(DIST, rel); if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
      } catch { res.writeHead(404).end('not found'); }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function findChrome() {
  const cands = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const hit = cands.find((p) => existsSync(p)); if (!hit) throw new Error('Chrome не найден. Укажите путь: CHROME=/путь/к/chrome npm run smoke');
  return hit;
}

export async function launchChrome(profile, size = [1280, 800], extra = []) {
  const proc = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${size[0]},${size[1]}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...extra, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error('Chrome не открыл порт отладки за 20 с')), 20000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`Chrome завершился с кодом ${code}`)); });
  });
  return { proc, port };
}

export function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map(); const handlers = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
    else for (const h of handlers) h(m);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { ready: new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('нет связи с Chrome'))); }), send, evaluate, on: (h) => handlers.push(h), close: () => ws.close() };
}


/** Открыть вкладку Chrome на адресе и вернуть сеанс DevTools. */
export async function openTab(chromePort, url) {
  let target = null; for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${chromePort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* ещё не готов */ } if (!target) await sleep(250); }
  if (!target) throw new Error('Chrome не дал вкладку');
  const tab = cdp(target.webSocketDebuggerUrl); await tab.ready;
  await tab.send('Runtime.enable'); await tab.send('Log.enable'); await tab.send('Page.enable');
  if (url) await tab.send('Page.navigate', { url });
  return tab;
}
/** Включить режим «Комплекс» и дождаться сборки сцены; возвращает true, если сцена собралась. */
export async function openComplex(tab, timeoutMs = 240000) {
  const t0 = Date.now(); let clicked = false;
  while (!clicked && Date.now() - t0 < 60000) { clicked = await tab.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Комплекс'); if (b) b.click(); return !!b; })()`).catch(() => false); if (!clicked) await sleep(500); }
  if (!clicked) throw new Error('кнопка «Комплекс» не появилась за 60 с');
  while (Date.now() - t0 < timeoutMs) { if ((await tab.evaluate('window.__stage || ""').catch(() => '')) === 'terrain:done') { await sleep(1500); return true; } await sleep(1000); }
  return false;
}
