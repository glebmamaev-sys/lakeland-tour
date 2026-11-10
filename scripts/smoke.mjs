#!/usr/bin/env node
// Автопроверка собранного тура перед выкладкой. Без зависимостей: раздаёт dist/ встроенным http-сервером, открывает
// его в безголовом Chrome (установленный в системе, протокол DevTools через WebSocket Node), включает режим
// «Комплекс», ждёт сборки сцены и снимает показатели: отметки полов, мебель по комнатам, оси дорожек, что вырезано
// из моделей Revit. Жёсткие правила (кровать в каждой спальне, дорожки не через дома и бассейны, ноль ошибок) и
// сравнение с эталоном scripts/smoke-baseline.json: любое расхождение останавливает выкладку, пока его не примут.
//
//   npm run build && npm run smoke            проверить
//   npm run smoke -- --update                 принять текущее состояние как эталон (жёсткие правила всё равно действуют)
//   CHROME=/путь/к/chrome SMOKE_TIMEOUT=300   свой браузер / таймаут сборки сцены, с
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BASELINE = path.join(ROOT, 'scripts', 'smoke-baseline.json');
const UPDATE = process.argv.includes('--update');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT ?? 240) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2' };

function serveDist() {
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

async function launchChrome(profile) {
  const proc = spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,800', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error('Chrome не открыл порт отладки за 20 с')), 20000);
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`Chrome завершился с кодом ${code}`)); });
  });
  return { proc, port };
}

function cdp(wsUrl) {
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

/** Показатели сцены — выполняется в странице. */
const COLLECT = `(() => {
  const c = window.__complex, R = window.__rooms || {}, F = window.__floors || {}; const rooms = {};
  const dup = []; for (const v of Object.keys(R)) { const seen = new Set(); for (const r of R[v]) { const k = r.kind + '@' + r.level + ' ' + r.rect.join(','); if (seen.has(k)) dup.push(v + ': ' + k); seen.add(k); } }
  for (const v of Object.keys(R).sort()) rooms[v] = R[v].map((r) => r.kind + '@' + r.level + ' ' + (r.rect[2] - r.rect[0]).toFixed(1) + '×' + (r.rect[3] - r.rect[1]).toFixed(1) + ' — ' + r.placed + ' предм.' + (r.note ? ' ' + r.note : '')).sort(); // по алфавиту: появление новой комнаты не сдвигает остальные строки
  const floors = {}; for (const k of Object.keys(F).sort()) floors[k] = +F[k].topo.toFixed(2);
  let renderer = ''; try { const gl = window.__gl.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); renderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; } catch {}
  return { buildings: c.data.buildings.map((b) => b.id + ':' + b.model), houses: c.houses.length, floors, rooms, path: c.pathCheck, pathLines: c.pathLines,
    flights: c.graded ? c.graded.flights : null, steps: c.graded ? c.graded.steps : null, walls: c.terraces ? c.terraces.walls.length : null, lotus: c.lotus, renderer, dup, gate: c.gate ?? null, arrive: c.arrive ? [+c.arrive.x.toFixed(1), +c.arrive.z.toFixed(1)] : null, arriveLand: c.arrive ? c.heightAt(c.arrive.x, c.arrive.z) !== null : false };
})()`;

/** Плоский список расхождений двух значений (эталон → сейчас). */
function diff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return [`${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]; const out = [];
  for (const k of keys) out.push(...diff(a[k], b[k], at ? `${at}.${k}` : k));
  return out;
}

async function main() {
  if (!existsSync(path.join(DIST, 'index.html'))) throw new Error('нет dist/index.html — сначала npm run build');
  const { srv, port } = await serveDist();
  const profile = await mkdtemp(path.join(tmpdir(), 'lakeland-smoke-'));
  let chrome = null, tab = null; const logs = [], errors = [];
  try {
    chrome = await launchChrome(profile);
    let target = null; for (let i = 0; i < 40 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* ещё не готов */ } if (!target) await sleep(250); }
    if (!target) throw new Error('Chrome не дал вкладку');
    tab = cdp(target.webSocketDebuggerUrl); await tab.ready;
    tab.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled') {
        const text = m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description ?? '')).join(' ');
        if (m.params.type === 'error') errors.push('console.error: ' + text.slice(0, 300)); else logs.push(text);
      } else if (m.method === 'Runtime.exceptionThrown') errors.push('исключение: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
      else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.source}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`.slice(0, 300));
    });
    await tab.send('Runtime.enable'); await tab.send('Log.enable'); await tab.send('Page.enable');
    const t0 = Date.now();
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    // режим «Комплекс»
    let clicked = false;
    while (!clicked && Date.now() - t0 < 60000) { clicked = await tab.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Комплекс'); if (b) b.click(); return !!b; })()`).catch(() => false); if (!clicked) await sleep(500); }
    if (!clicked) throw new Error('кнопка «Комплекс» не появилась за 60 с');
    let stage = ''; while (Date.now() - t0 < TIMEOUT) { stage = await tab.evaluate('window.__stage || ""').catch(() => ''); if (stage === 'terrain:done') break; await sleep(1000); }
    const built = stage === 'terrain:done'; const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (built) await sleep(1500); // дорисовать кадр и собрать поздние ошибки
    const data = built ? await tab.evaluate(COLLECT) : null;

    // показатели из журнала сцены (последняя запись по каждому ключу: эффекты React в разработке срабатывают дважды)
    const entries = {}, strips = {}; let pads = null;
    for (const l of logs) {
      let m;
      // «[entry] x z тропинка…» (вход по точке телепорта) или «[entry] 2.1 подход 17.1 м, 3 точек» (парадный вход, ворота)
      if ((m = l.match(/^\[entry\] (\S+) (\S+) (.*)$/))) { if (/^-?[\d.]+$/.test(m[2])) entries[`${m[1]},${m[2]}`] = m[3].replace(/[\d.]+ м/, '').trim(); else entries[m[1]] = (m[2] + ' ' + m[3]).replace(/[\d.]+ м,? ?/, '').replace(/\d+ точек/, '').trim(); }
      else if ((m = l.match(/^\[(stairs|bath|beds)\] (villa\w+) убрано компонентов: (\d+) из мешей: (\d+)/))) strips[`${m[2]}.${m[1]}.компонентов`] = Number(m[3]);
      else if ((m = l.match(/^\[(bath|beds)\] (villa\w+) срезано треугольников[^:]*: (\d+)/))) strips[`${m[2]}.${m[1]}.срезано`] = Number(m[3]);
      else if ((m = l.match(/^\[pads\] .*: (\d+)$/))) pads = Number(m[1]);
    }
    const snapshot = data && { floors: data.floors, rooms: data.rooms, path: data.path, pathLines: data.pathLines, flights: data.flights, steps: data.steps, walls: data.walls,
      lotus: data.lotus, gate: data.gate, arrive: data.arrive, entries, strips: Object.fromEntries(Object.entries(strips).sort()), pads };
    const baseline = existsSync(BASELINE) ? JSON.parse(await readFile(BASELINE, 'utf8')) : null;

    // жёсткие правила
    const checks = [];
    const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
    check(`сцена собралась (${secs} с${data?.renderer ? ', ' + data.renderer : ''})`, built, built ? '' : `этап «${stage || 'нет'}» за ${TIMEOUT / 1000} с`);
    check('ошибок в консоли нет', errors.length === 0, errors.slice(0, 6).join('\n      '));
    if (data) {
      check('на месте 12 зданий, 11 домов собраны', data.buildings.length === 12 && data.houses === 11, `зданий ${data.buildings.length}, домов ${data.houses}`);
      const all = Object.entries(data.rooms).flatMap(([v, list]) => list.map((r) => `${v}: ${r}`));
      const noBed = all.filter((r) => / bedroom@/.test(r) && !/ bed[@~]/.test(r));
      check(`кровать в каждой спальне (${all.filter((r) => / bedroom@/.test(r)).length})`, noBed.length === 0, noBed.join('\n      '));
      const noWay = Object.entries(entries).filter(([, v]) => /не найден|не провести/.test(v)).map(([k, v]) => `${k}: ${v}`);
      check('ко всем входам и к воротам проложен подход', !!data.gate && noWay.length === 0, data.gate ? noWay.join('\n      ') : 'ворот нет');
      check('старт прогулки — на парковке у ворот, на суше', !!data.arrive && data.arriveLand, data.arrive ? 'точка старта над водой' : 'точки прибытия нет');
      check('нет комнат-дублей (одна комната не обставлена дважды)', (data.dup ?? []).length === 0, (data.dup ?? []).join('\n      '));
      check(`оси дорожек не идут через дома и бассейны (${data.path?.pts ?? 0} точек)`, !!data.path && data.path.inHouse === 0 && data.path.inPool === 0, data.path ? `в домах ${data.path.inHouse}, в бассейнах ${data.path.inPool}` : 'нет данных');
      if (baseline && !UPDATE) {
        const emptied = [];
        // по каждой вилле и виду комнаты на уровне: обставленных комнат не должно стать меньше, чем в эталоне
        const furnished = (list) => { const m = {}; for (const r of list ?? []) { const k = r.split(' ')[0]; if (!/ — 0 предм\./.test(r)) m[k] = (m[k] ?? 0) + 1; } return m; };
        for (const [v, list] of Object.entries(baseline.rooms ?? {})) { const was = furnished(list), now = furnished(data.rooms[v]); for (const k of Object.keys(was)) if ((now[k] ?? 0) < was[k]) emptied.push(`${v}: ${k} — обставлено ${now[k] ?? 0} из ${was[k]}`); }
        check('обставленные комнаты не опустели', emptied.length === 0, emptied.join('\n      '));
      }
    }
    const changes = baseline && snapshot ? diff(baseline, snapshot) : [];

    await mkdir(path.join(ROOT, 'captures'), { recursive: true });
    if (process.env.SMOKE_DEBUG && built) await writeFile(path.join(ROOT, 'captures', 'smoke-debug.json'), JSON.stringify({ logs, rooms: await tab.evaluate('JSON.stringify(window.__rooms)').then((t) => JSON.parse(t)).catch(() => null) }, null, 1));
    await writeFile(path.join(ROOT, 'captures', 'smoke-last.json'), JSON.stringify({ at: new Date().toISOString(), checks, changes, snapshot, errors }, null, 2));

    console.log('\nАвтопроверка сцены');
    for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}${!c.ok && c.detail ? '\n      ' + c.detail : ''}`);
    const hardFail = checks.some((c) => !c.ok);
    if (UPDATE) {
      if (hardFail || !snapshot) { console.log('\n✗ Эталон не обновлён: жёсткие правила не выполнены.'); return 1; }
      await writeFile(BASELINE, JSON.stringify(snapshot, null, 2) + '\n');
      console.log(changes.length ? `\nЭталон обновлён, принято изменений: ${changes.length}` : baseline ? '\nЭталон без изменений.' : '\nЭталон создан.');
      for (const c of changes.slice(0, 40)) console.log('  • ' + c);
      return 0;
    }
    if (!baseline) { console.log('\n✗ Нет эталона scripts/smoke-baseline.json. Создать: npm run smoke -- --update'); return 1; }
    if (changes.length) {
      console.log(`\n  ✗ расхождения с эталоном: ${changes.length}`);
      for (const c of changes.slice(0, 40)) console.log('      ' + c);
      if (changes.length > 40) console.log(`      … и ещё ${changes.length - 40} (полный список: captures/smoke-last.json)`);
      console.log('\n    Если изменения ожидаемые, примите их: npm run smoke -- --update');
    } else console.log('  ✓ совпадает с эталоном');
    const ok = !hardFail && changes.length === 0;
    console.log(ok ? '\n✓ Автопроверка пройдена.' : '\n✗ Автопроверка не пройдена.');
    return ok ? 0 : 1;
  } finally {
    try { tab?.close(); } catch { /* уже закрыт */ }
    if (chrome) { chrome.proc.removeAllListeners('exit'); chrome.proc.kill('SIGKILL'); }
    srv.close(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().then((code) => process.exit(code), (e) => { console.error('\n✗ Автопроверка не выполнена: ' + e.message); process.exit(2); });
