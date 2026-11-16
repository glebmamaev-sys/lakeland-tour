#!/usr/bin/env node
// Кадры режима «Панорамы» без окна браузера: собранный dist/ открывается в безголовом Chrome, панорама выбирается
// параметром ?pano=, обзор ставится через window.__pano, кадр — снимок страницы (то, что видит посетитель).
//
//   node scripts/pano-shots.mjs p5_roof out/ [villa1]
//
// Снимает шесть видов: вход, сад, лагуна, назад (стык краёв панорамы), вверх, вниз.
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sleep, serveDist, launchChrome, openTab } from './lib-headless.mjs';
const [pano, outDir, villa = 'villa1'] = process.argv.slice(2);
if (!pano || !outDir) { console.error('использование: node scripts/pano-shots.mjs <панорама> <папка> [вилла]'); process.exit(2); }
const VIEWS = [['start', null, 0, 75], ['left', -90, -4, 75], ['front', 0, -4, 75], ['right', 90, -4, 75], ['back', 180, -4, 75], ['up', 0, 80, 85], ['down', 0, -80, 85], ['zoom', -85, -8, 40]];
const { srv, port } = await serveDist(); const profile = await mkdtemp(path.join(tmpdir(), 'lakeland-pano-')); let chrome = null, tab = null, code = 0;
try {
  chrome = await launchChrome(profile, [1440, 900]); tab = await openTab(chrome.port, `http://127.0.0.1:${port}/?villa=${villa}&pano=${pano}`);
  const errors = []; tab.on((m) => { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
  let ok = false; for (let i = 0; i < 80 && !ok; i++) { ok = await tab.evaluate(`!!window.__pano && !!document.querySelector('canvas')`).catch(() => false); if (!ok) await sleep(250); }
  if (!ok) throw new Error('режим панорам не открылся');
  await sleep(6000); // обычная панорама и догрузка 8К
  const info = await tab.evaluate(`(() => { const c = document.querySelector('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); return { max: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0, files: performance.getEntriesByType('resource').filter((r) => /panos\\//.test(r.name)).map((r) => r.name.split('/').pop()) }; })()`);
  console.log('текстура до', info.max, 'px; загружены:', info.files.join(', '));
  await mkdir(outDir, { recursive: true });
  for (const [name, yaw, pitch, fov] of VIEWS) {
    if (yaw !== null) await tab.evaluate(`(() => { const p = window.__pano; p.yaw = Math.PI / 2 - ${yaw} * Math.PI / 180; p.pitch = ${pitch} * Math.PI / 180; p.fov = ${fov}; })()`);
    await sleep(500); const r = await tab.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
    await writeFile(path.join(outDir, name + '.jpg'), Buffer.from(r.data, 'base64')); console.log('✓', name);
  }
  if (errors.length) { console.error('ошибки страницы:', errors.slice(0, 3).join(' | ')); code = 1; }
} catch (e) { console.error('✗', e.message); code = 2; } finally { try { tab?.close(); } catch { /* закрыт */ } try { chrome?.proc.kill(); } catch { /* завершён */ } srv.close(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {}); }
process.exit(code);
