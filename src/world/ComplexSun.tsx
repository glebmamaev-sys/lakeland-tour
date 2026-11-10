// Солнце комплекса: одна направленная тень. Пешком карта теней (4096) следит за игроком и покрывает квадрат
// ±38 м — тени у ног чёткие; с дрона — весь участок (±170 м), мягче. Цель света — отдельный объект в сцене.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DirectionalLight, Object3D, Vector3 } from 'three';
import { day } from './DayTime';

/** Вечернее солнце: низко на западе, тёплое и слабое. */
const SUN_EVE = new Vector3(-0.82, 0.17, 0.42).normalize(), C_DAY = new Color('#fff1d8'), C_EVE = new Color('#ff9a5a');
import { SUN } from './SkyDome';
import { playerState } from '../Player';

export function ComplexSun({ walk, mobile }: { walk: boolean; mobile: boolean }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const tmp = useMemo(() => new Vector3(), []);
  const mode = useRef<'near' | 'far' | ''>(''); const dir = useMemo(() => new Vector3().copy(SUN), []); const lastK = useRef(-1);
  useEffect(() => { mode.current = ''; }, [walk]);
  useFrame(() => {
    const l = light.current; if (!l) return;
    const P = playerState.pos; const near = walk && !!P;
    if (day.k !== lastK.current) { lastK.current = day.k; const s = day.k * day.k * (3 - 2 * day.k); dir.copy(SUN).lerp(SUN_EVE, s).normalize(); l.color.copy(C_DAY).lerp(C_EVE, s); l.intensity = 2.8 - 2.1 * s; if (mode.current === 'far') mode.current = ''; }
    const cam = l.shadow.camera;
    if (near) {
      const R = mobile ? 28 : 38;
      tmp.set(P!.x, P!.y, P!.z); target.position.copy(tmp); l.position.copy(tmp).addScaledVector(dir, 160);
      if (mode.current !== 'near') { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 20; cam.far = 400; cam.updateProjectionMatrix(); mode.current = 'near'; }
      // шаг квантования, чтобы тени не «кипели» при движении
      const q = (2 * R) / (mobile ? 1536 : 2048) * 4; target.position.x = Math.round(target.position.x / q) * q; target.position.z = Math.round(target.position.z / q) * q; target.position.y = Math.round(target.position.y / 0.5) * 0.5;
      l.position.copy(target.position).addScaledVector(dir, 160);
    } else if (mode.current !== 'far') {
      target.position.set(0, 8, 0); l.position.set(dir.x * 220, dir.y * 220 + 8, dir.z * 220);
      cam.left = -170; cam.right = 170; cam.top = 170; cam.bottom = -170; cam.near = 20; cam.far = 700; cam.updateProjectionMatrix(); mode.current = 'far';
    }
    target.updateMatrixWorld();
  });
  return (
    <>
      <directionalLight ref={light} target={target} position={[SUN.x * 220, SUN.y * 220, SUN.z * 220]} color="#fff1d8" intensity={2.8} castShadow
        shadow-bias={-0.0003} shadow-normalBias={0.05} shadow-mapSize={mobile ? [1536, 1536] : [2048, 2048]}
        shadow-camera-left={-170} shadow-camera-right={170} shadow-camera-top={170} shadow-camera-bottom={-170} shadow-camera-near={20} shadow-camera-far={700} />
      <primitive object={target} />
    </>
  );
}
