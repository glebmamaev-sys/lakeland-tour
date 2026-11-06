// Солнце комплекса: одна направленная тень. Пешком карта теней (4096) следит за игроком и покрывает квадрат
// ±38 м — тени у ног чёткие; с дрона — весь участок (±170 м), мягче. Цель света — отдельный объект в сцене.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DirectionalLight, Object3D, Vector3 } from 'three';
import { SUN } from './SkyDome';
import { playerState } from '../Player';

export function ComplexSun({ walk, mobile }: { walk: boolean; mobile: boolean }) {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const tmp = useMemo(() => new Vector3(), []);
  const mode = useRef<'near' | 'far' | ''>('');
  useEffect(() => { mode.current = ''; }, [walk]);
  useFrame(() => {
    const l = light.current; if (!l) return;
    const P = playerState.pos; const near = walk && !!P;
    const cam = l.shadow.camera;
    if (near) {
      const R = mobile ? 28 : 38;
      tmp.set(P!.x, P!.y, P!.z); target.position.copy(tmp); l.position.copy(tmp).addScaledVector(SUN, 160);
      if (mode.current !== 'near') { cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 20; cam.far = 400; cam.updateProjectionMatrix(); mode.current = 'near'; }
      // шаг квантования, чтобы тени не «кипели» при движении
      const q = (2 * R) / (mobile ? 2048 : 4096) * 4; target.position.x = Math.round(target.position.x / q) * q; target.position.z = Math.round(target.position.z / q) * q;
      l.position.copy(target.position).addScaledVector(SUN, 160);
    } else if (mode.current !== 'far') {
      target.position.set(0, 8, 0); l.position.set(SUN.x * 220, SUN.y * 220 + 8, SUN.z * 220);
      cam.left = -170; cam.right = 170; cam.top = 170; cam.bottom = -170; cam.near = 20; cam.far = 700; cam.updateProjectionMatrix(); mode.current = 'far';
    }
    target.updateMatrixWorld();
  });
  return (
    <>
      <directionalLight ref={light} target={target} position={[SUN.x * 220, SUN.y * 220, SUN.z * 220]} color="#fff1d8" intensity={2.8} castShadow
        shadow-bias={-0.0003} shadow-normalBias={0.05} shadow-mapSize={mobile ? [2048, 2048] : [4096, 4096]}
        shadow-camera-left={-170} shadow-camera-right={170} shadow-camera-top={170} shadow-camera-bottom={-170} shadow-camera-near={20} shadow-camera-far={700} />
      <primitive object={target} />
    </>
  );
}
