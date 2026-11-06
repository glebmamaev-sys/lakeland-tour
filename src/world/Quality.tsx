// Сторож качества: если после загрузки кадр в среднем дольше 45 мс в течение 3 с (и вкладка видима), отключаем
// траву и постобработку (quality.low = true). Сбрасывается перезагрузкой; ?nograss / ?nopost — ручные флаги.
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';

export const quality = { low: false, listeners: new Set<(low: boolean) => void>() };
export function setLowQuality(v: boolean) { if (quality.low === v) return; quality.low = v; quality.listeners.forEach((l) => l(v)); console.info('[quality]', v ? 'низкое: трава и постобработка выключены' : 'обычное'); }
export function useQuality() {
  const [low, setLow] = useState(quality.low);
  useEffect(() => { quality.listeners.add(setLow); return () => { quality.listeners.delete(setLow); }; }, []);
  return low;
}
/** Ставится внутри Canvas; active — измерять (после загрузки сцены). */
export function QualityWatch({ active }: { active: boolean }) {
  const acc = useRef({ t: 0, n: 0, slow: 0 });
  useFrame((_, dt) => {
    if (!active || quality.low || document.hidden) return;
    const a = acc.current; a.t += dt; a.n++;
    if (a.t >= 1) { const avg = a.t / a.n; a.slow = avg > 0.045 ? a.slow + 1 : 0; a.t = 0; a.n = 0; if (a.slow >= 3) setLowQuality(true); }
  });
  return null;
}
