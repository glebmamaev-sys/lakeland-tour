// Фоновый звук лагуны в режиме «Комплекс»: петля public/audio/lagoon.mp3 (сгенерирована нейросетью, Higgsfield),
// громкость 0,35, стартует после первого клика/клавиши (браузер не даёт автозапуск), кнопка «звук» запоминается.
import { useEffect, useState } from 'react';
import { asset } from './assets';

const KEY = 'lakeland-sound';
export function useAmbient(active: boolean) {
  const [on, setOn] = useState(() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } });
  useEffect(() => {
    if (!active || !on) return;
    const a = new Audio(asset('audio/lagoon.mp3')); a.loop = true; a.volume = 0.35; a.preload = 'auto';
    let started = false;
    const start = () => { if (started) return; a.play().then(() => { started = true; off(); }).catch(() => { /* ждём жест */ }); };
    const evs = ['pointerdown', 'keydown', 'touchstart'] as const;
    const off = () => evs.forEach((e) => window.removeEventListener(e, start));
    start(); evs.forEach((e) => window.addEventListener(e, start));
    return () => { off(); a.pause(); a.src = ''; };
  }, [active, on]);
  const toggle = () => setOn((v) => { const n = !v; try { localStorage.setItem(KEY, n ? 'on' : 'off'); } catch { /* приватный режим */ } return n; });
  return { on, toggle };
}
