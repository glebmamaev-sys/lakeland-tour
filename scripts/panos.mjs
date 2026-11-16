#!/usr/bin/env node
// Панорамы 360° сцены «Комплекс» без окна браузера (как shots.mjs, но штатным захватом window.__capture.pano).
//
//   node scripts/panos.mjs spec.json out/      →  out/<name>.jpg, равнопромежуточная проекция 2:1
//
// spec.json: { "face": 2048, "query": "", "pre": "js до съёмки", "views": [
//   { "name": "roof", "house": "1.3", "p": [4.75, 11.52, -13], "pre": "js", "wait": 400 } ] }
// face — грань куба, итог face*2 × face. house — p задана в системе виллы (x, высота от её пола, z); без house — мировая.
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DIST, sleep, serveDist, launchChrome, openTab, openComplex } from './lib-headless.mjs';

const [specPath, outDir] = process.argv.slice(2);
if (!specPath || !outDir) { console.error('использование: node scripts/panos.mjs spec.json папка'); process.exit(2); }
const spec = JSON.parse(await readFile(specPath, 'utf8')); const face = spec.face ?? 2048;
if (!existsSync(path.join(DIST, 'index.html'))) { console.error('нет dist/index.html — сначала npm run build'); process.exit(2); }
const { srv, port } = await serveDist(); const profile = await mkdtemp(path.join(tmpdir(), 'lakeland-panos-')); let chrome = null, tab = null, code = 0;
try {
  chrome = await launchChrome(profile, [1280, 800]); tab = await openTab(chrome.port, null);
  const errors = []; tab.on((m) => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  await tab.send('Page.navigate', { url: `http://127.0.0.1:${port}/${spec.query ?? ''}` });
  if (!(await openComplex(tab))) throw new Error('сцена не собралась');
  if (spec.pre) { await tab.evaluate(`(async () => { ${spec.pre} })()`); await sleep(600); }
  await mkdir(outDir, { recursive: true });
  for (const v of spec.views) {
    // кадр отдаётся частями: строка base64 на 8К не проходит одним ответом CDP
    const n = await tab.evaluate(`(async () => {
      ${v.pre ?? ''};
      const c = window.__complex; let p = ${JSON.stringify(v.p)};
      ${v.house ? `{ const h = c.houses.find((x) => x.id === ${JSON.stringify(v.house)}); const e = h.matrix.elements; p = [e[0]*p[0]+e[4]*p[1]+e[8]*p[2]+e[12], e[1]*p[0]+e[5]*p[1]+e[9]*p[2]+e[13], e[2]*p[0]+e[6]*p[1]+e[10]*p[2]+e[14]]; }` : ''}
      window.__drone.set(p, [p[0], p[1], p[2] - 9]);
      for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => setTimeout(r, ${v.wait ?? 500}));
      let blob = null; const oc = URL.createObjectURL, ok = HTMLAnchorElement.prototype.click; URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; HTMLAnchorElement.prototype.click = function () {};
      try { await window.__capture.pano({ size: ${face} }); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ok; }
      if (!blob) return 0;
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      window.__panoB64 = btoa(s); return window.__panoB64.length;
    })()`);
    if (!n) { console.error('✗', v.name, 'панорама не получена'); code = 1; continue; }
    let b64 = ''; const CH = 1 << 20; for (let o = 0; o < n; o += CH) b64 += await tab.evaluate(`window.__panoB64.slice(${o}, ${o + CH})`);
    await writeFile(path.join(outDir, v.name + '.jpg'), Buffer.from(b64, 'base64')); console.log('✓', v.name, face * 2 + '×' + face);
  }
  if (errors.length) console.error('ошибки страницы:', errors.slice(0, 3).join(' | '));
} catch (e) { console.error('✗', e.message); code = 2; } finally {
  try { tab?.close(); } catch { /* закрыт */ } try { chrome?.proc.kill(); } catch { /* завершён */ } srv.close(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(code);
