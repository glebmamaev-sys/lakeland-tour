#!/usr/bin/env node
// Выполнить скрипт в собранной сцене «Комплекс» (безголовый Chrome) и напечатать результат — для разборов без окна
// браузера: node scripts/eval-scene.mjs файл.js   (файл — тело async-функции, должен вернуть сериализуемое значение)
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sleep, serveDist, launchChrome, openTab, openComplex } from './lib-headless.mjs';
const body = await readFile(process.argv[2], 'utf8'); const { srv, port } = await serveDist(); const profile = await mkdtemp(path.join(tmpdir(), 'lakeland-eval-')); let chrome = null, tab = null, code = 0;
try {
  chrome = await launchChrome(profile); tab = await openTab(chrome.port, `http://127.0.0.1:${port}/${process.argv[3] ?? ''}`);
  if (!(await openComplex(tab))) throw new Error('сцена не собралась');
  const r = await tab.evaluate(`(async () => { ${body} })()`); console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
} catch (e) { console.error('✗', e.message); code = 2; } finally { try { tab?.close(); } catch { /* закрыт */ } try { chrome?.proc.kill(); } catch { /* завершён */ } srv.close(); await sleep(300); await rm(profile, { recursive: true, force: true }).catch(() => {}); }
process.exit(code);
