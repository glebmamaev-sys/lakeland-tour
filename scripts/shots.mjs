#!/usr/bin/env node
// Кадры сцены «Комплекс» без окна браузера: собранный dist/ открывается в безголовом Chrome (как в smoke.mjs),
// камера дрона ставится в заданные точки, кадр снимается штатным захватом (window.__capture.shot) — без интерфейса.
//
//   node scripts/shots.mjs spec.json out/      →  out/<name>.jpg по одному на вид
//
// spec.json: { "size": [960, 600], "mobile": false, "pre": "js до съёмки", "views": [
//   { "name": "kitchen", "house": "2.1", "p": [6.6, 1.6, -0.9], "t": [0.6, 0.7, -5.2], "fov": 75, "pre": "js", "wait": 400 } ] }
// house — координаты p и t заданы в системе виллы (x, высота от её пола, z); без house — мировые.
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DIST, sleep, serveDist, launchChrome, openTab, openComplex } from './lib-headless.mjs';

const [specPath, outDir] = process.argv.slice(2);
if (!specPath || !outDir) { console.error('использование: node scripts/shots.mjs spec.json папка'); process.exit(2); }
const spec = JSON.parse(await readFile(specPath, 'utf8')); const [W, H] = spec.size ?? [960, 600];
if (!existsSync(path.join(DIST, 'index.html'))) { console.error('нет dist/index.html — сначала npm run build'); process.exit(2); }
const { srv, port } = await serveDist(); const profile = await mkdtemp(path.join(tmpdir(), 'lakeland-shots-')); let chrome = null, tab = null, code = 0;
try {
  chrome = await launchChrome(profile, spec.mobile ? [390, 844] : [1280, 800]);
  tab = await openTab(chrome.port, null);
  if (spec.mobile) { await tab.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); }
  const errors = []; tab.on((m) => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  await tab.send('Page.navigate', { url: `http://127.0.0.1:${port}/${spec.query ?? ''}` });
  if (!(await openComplex(tab))) throw new Error('сцена не собралась');
  if (spec.pre) { await tab.evaluate(`(async () => { ${spec.pre} })()`); await sleep(600); }
  await mkdir(outDir, { recursive: true });
  for (const v of spec.views) {
    const b64 = await tab.evaluate(`(async () => {
      ${v.pre ?? ''};
      const c = window.__complex; let p = ${JSON.stringify(v.p)}, t = ${JSON.stringify(v.t)};
      ${v.house ? `{ const h = c.houses.find((x) => x.id === ${JSON.stringify(v.house)}); const e = h.matrix.elements; const M = (q) => [e[0]*q[0]+e[4]*q[1]+e[8]*q[2]+e[12], e[1]*q[0]+e[5]*q[1]+e[9]*q[2]+e[13], e[2]*q[0]+e[6]*q[1]+e[10]*q[2]+e[14]]; p = M(p); t = M(t); }` : ''}
      const d = [t[0]-p[0], t[1]-p[1], t[2]-p[2]]; const L = Math.hypot(...d) || 1, k = Math.max(9, L); // OrbitControls держит камеру не ближе 8 м к цели
      window.__drone.set(p, [p[0]+d[0]/L*k, p[1]+d[1]/L*k, p[2]+d[2]/L*k]);
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => setTimeout(r, ${v.wait ?? 350}));
      let blob = null; const oc = URL.createObjectURL, ok = HTMLAnchorElement.prototype.click; URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; HTMLAnchorElement.prototype.click = function () {};
      try { await window.__capture.shot({ width: ${W}, height: ${H}, fov: ${v.fov ?? 70} }); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ok; }
      if (!blob) return '';
      const bm = await createImageBitmap(blob); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; cv.getContext('2d').drawImage(bm, 0, 0);
      return cv.toDataURL('image/jpeg', 0.9).split(',')[1];
    })()`);
    if (!b64) { console.error('✗', v.name, 'кадр не получен'); code = 1; continue; }
    await writeFile(path.join(outDir, v.name + '.jpg'), Buffer.from(b64, 'base64')); console.log('✓', v.name);
  }
  if (errors.length) console.error('ошибки страницы:', errors.slice(0, 3).join(' | '));
} catch (e) { console.error('✗', e.message); code = 2; } finally {
  try { tab?.close(); } catch { /* закрыт */ } try { chrome?.proc.kill(); } catch { /* завершён */ } srv.close(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(code);
