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

import { ROOT, DIST, sleep, serveDist, launchChrome, cdp } from './lib-headless.mjs';
const BASELINE = path.join(ROOT, 'scripts', 'smoke-baseline.json');
const UPDATE = process.argv.includes('--update');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT ?? 240) * 1000;

/** Показатели сцены — выполняется в странице. */
const COLLECT = `(() => {
  const c = window.__complex, R = window.__rooms || {}, F = window.__floors || {}; const rooms = {};
  const dup = []; for (const v of Object.keys(R)) { const seen = new Set(); for (const r of R[v]) { const k = r.kind + '@' + r.level + ' ' + r.rect.join(','); if (seen.has(k)) dup.push(v + ': ' + k); seen.add(k); } }
  for (const v of Object.keys(R).sort()) rooms[v] = R[v].map((r) => r.kind + '@' + r.level + ' ' + (r.rect[2] - r.rect[0]).toFixed(1) + '×' + (r.rect[3] - r.rect[1]).toFixed(1) + ' — ' + r.placed + ' предм.' + (r.note ? ' ' + r.note : '')).sort(); // по алфавиту: появление новой комнаты не сдвигает остальные строки
  const floors = {}; for (const k of Object.keys(F).sort()) floors[k] = +F[k].topo.toFixed(2);
  let renderer = ''; try { const gl = window.__gl.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); renderer = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; } catch {}
  return { buildings: c.data.buildings.map((b) => b.id + ':' + b.model), houses: c.houses.length, floors, rooms, path: c.pathCheck, pathLines: c.pathLines,
    flights: c.graded ? c.graded.flights : null, steps: c.graded ? c.graded.steps : null, walls: c.terraces ? c.terraces.walls.length : null, lotus: c.lotus, renderer, dup, gate: c.gate ?? null, lamps: c.lamps ?? 0, village: c.village ?? 0, roadsKm: c.roadsKm ?? 0, trees: c.trees ?? 0, evening: typeof window.__setEvening === 'function', arrive: c.arrive ? [+c.arrive.x.toFixed(1), +c.arrive.z.toFixed(1)] : null, arriveLand: c.arrive ? c.heightAt(c.arrive.x, c.arrive.z) !== null : false,
    perf: window.__gl ? { tris: window.__gl.info.render.triangles, calls: window.__gl.info.render.calls } : null };
})()`;

/** Проверка прогулки — выполняется в странице: включить «Пешком», убедиться, что игрок стоит на покрытии парковки,
 *  что подпорная стенка его держит (идём в середину самой длинной стенки с нижней стороны) и что жители на месте. */
const WALKCHECK = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const B = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Пешком'); if (!B) return null; B.click();
  const t0 = Date.now(); while (!window.__tour && Date.now() - t0 < 20000) await sleep(300); if (!window.__tour) return { tour: false }; await sleep(4500);
  const c = window.__complex, T = window.__tour, S = window.__npcs; const g0 = c.heightAt(T.pos.x, T.pos.z); const stand = g0 === null ? null : +(T.pos.y - g0).toFixed(2);
  let wall = null; const ws = c.terraces ? c.terraces.walls : [];
  if (ws.length) { const len = (w) => w.pts.reduce((s, q, k) => (k ? s + Math.hypot(q[0] - w.pts[k - 1][0], q[1] - w.pts[k - 1][1]) : 0), 0); const w = ws.slice().sort((a, b) => len(b) - len(a))[0];
    const n = w.pts.length, i = Math.floor(n / 2), a = w.pts[Math.max(0, i - 1)], b = w.pts[Math.min(n - 1, i + 1)], p = w.pts[i]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const nx = (-(b[1] - a[1]) / L) * w.low, nz = ((b[0] - a[0]) / L) * w.low;
    const sx = p[0] + nx * 1.6, sz = p[1] + nz * 1.6, gy = c.heightAt(sx, sz);
    if (gy !== null) { T.input.teleport = [sx, gy + 0.5, sz]; T.input.yaw = Math.atan2(nx, nz); T.input.fwd = 0; await sleep(800); T.input.fwd = 1; await sleep(2600); T.input.fwd = 0; await sleep(200); wall = +(-((T.pos.x - p[0]) * nx + (T.pos.z - p[1]) * nz)).toFixed(2); } }
  return { tour: true, stand, wall, walkers: S ? S.walkers.length : 0, sunbathers: S ? S.sunbathers.length : 0, gardener: !!(S && S.gardener), standing: S ? S.standing.length : 0 };
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
    const walk = built ? await tab.evaluate(WALKCHECK).catch(() => null) : null;

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
      residents: walk ? { walkers: walk.walkers, sunbathers: walk.sunbathers, gardener: walk.gardener } : null,
      lotus: data.lotus, gate: data.gate, arrive: data.arrive, lamps: data.lamps, village: data.village, roadsKm: data.roadsKm, trees: data.trees, entries, strips: Object.fromEntries(Object.entries(strips).sort()), pads };
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
      // бюджет кадра с дрона (вид по умолчанию, вместе с проходом теней): до оптимизации 10.11 было 7,9 млн и 1 110 вызовов
      const pf = data.perf; check(`нагрузка кадра с дрона в бюджете (${pf ? (pf.tris / 1e6).toFixed(2) + ' млн треугольников, ' + pf.calls + ' вызовов' : 'нет данных'})`, !!pf && pf.tris <= 3.5e6 && pf.calls <= 700, 'бюджет: 3,5 млн треугольников и 700 вызовов отрисовки');
      check(`вечерний режим и светильники дорожек на месте (${data.lamps} шт.)`, data.evening && data.lamps >= 15, 'нет переключателя вечера или мало светильников');
      check(`окружение на месте (домов ${data.village}, дорог ${data.roadsKm} км, деревьев ${data.trees})`, data.village >= 100 && data.roadsKm >= 10 && data.trees >= 500, 'нет деревни, дорог или рощ за границей участка');
      check(`прогулка: игрок стоит на парковке, стенка его держит${walk ? ` (над землёй ${walk.stand} м, за стенку ${walk.wall} м)` : ''}`, !!walk && walk.tour && walk.stand !== null && walk.stand > -0.1 && walk.stand < 0.9 && (walk.wall === null || walk.wall < 0.3), walk ? 'игрок провалился, завис или перешёл стенку' : 'режим «Пешком» не включился');
      check(`жители на месте${walk ? ` (гуляют ${walk.walkers}, загорают ${walk.sunbathers}, стоят и сидят ${walk.standing}, садовник ${walk.gardener ? 'есть' : 'нет'})` : ''}`, !!walk && walk.walkers >= 6 && walk.sunbathers >= 3 && walk.gardener && walk.standing >= 5, 'нет гостей, загорающих или садовника');
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
