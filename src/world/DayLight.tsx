// Рассеянный свет, небо и туман комплекса с плавным переходом день ↔ вечер (см. DayTime.ts). Ставится внутри Canvas.
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, type AmbientLight, type FogExp2, type HemisphereLight, type PointLight } from 'three';
import { applyEve, day, setEvening } from './DayTime';

export function useEvening(): [boolean, (v: boolean) => void] {
  const [eve, setEve] = useState(day.evening);
  useEffect(() => { day.listeners.add(setEve); return () => { day.listeners.delete(setEve); }; }, []);
  return [eve, setEvening];
}

const FOG_DAY = new Color('#dbe7ee'), FOG_EVE = new Color('#2c3646'), SKY_DAY = new Color('#cfe3f5'), SKY_EVE = new Color('#56607c'), GND_DAY = new Color('#b9b39f'), GND_EVE = new Color('#5b4a3c');
export function DayLight() {
  const hemi = useRef<HemisphereLight>(null), amb = useRef<AmbientLight>(null), fill = useRef<PointLight>(null);
  const { scene, camera } = useThree(); const last = useRef(-1);
  useEffect(() => { (window as unknown as { __setEvening: unknown }).__setEvening = (v: boolean, instant = false) => { setEvening(v); if (instant) applyEve(v ? 1 : 0); };
    return () => { setEvening(false); applyEve(0); scene.backgroundIntensity = 1; scene.environmentIntensity = 0.55; }; }, [scene]);
  useFrame((_, dt) => {
    const target = day.evening ? 1 : 0; let k = day.k; if (k !== target) { k += Math.sign(target - k) * Math.min(Math.abs(target - k), dt / 1.5); applyEve(k); }
    if (fill.current) { fill.current.position.copy(camera.position); fill.current.position.y += 0.6; }
    const s = k * k * (3 - 2 * k);
    // небо — каждый кадр: HDRI догружается позже сцены, и <Environment> при появлении ставит свои яркости заново
    scene.backgroundIntensity = 1 - 0.82 * s; scene.environmentIntensity = 0.55 - 0.4 * s;
    if (k === last.current) return; last.current = k;
    const fog = scene.fog as FogExp2 | null; if (fog) fog.color.copy(FOG_DAY).lerp(FOG_EVE, s);
    if (hemi.current) { hemi.current.intensity = 0.9 - 0.62 * s; hemi.current.color.copy(SKY_DAY).lerp(SKY_EVE, s); hemi.current.groundColor.copy(GND_DAY).lerp(GND_EVE, s); }
    if (amb.current) amb.current.intensity = 0.35 - 0.2 * s;
    if (fill.current) fill.current.intensity = 9 * s; // тёплая «лампа» рядом с наблюдателем: комнаты, в которые входишь, освещены
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={['#cfe3f5', '#b9b39f', 0.9]} />
      <ambientLight ref={amb} intensity={0.35} />
      <pointLight ref={fill} color="#ffc98a" intensity={0} distance={16} decay={1.6} />
    </>
  );
}
