// Небо комплекса: солнце (общее для неба и света), дымка, облака-спрайты из процедурной текстуры.
// (drei <Clouds> с текстурой-data-URL подвешивал загрузку всей сцены, поэтому облака свои.)
import { useMemo } from 'react';
import { Environment, Sky } from '@react-three/drei';
import { CanvasTexture, SpriteMaterial, Vector3 } from 'three';
import { makeCloudCanvas } from './textures';
import { asset } from '../assets';

/** HDRI-небо Poly Haven (CC0, public/hdri/sky_2k.hdr): фон и отражения в стекле/воде. ?prosky — старое процедурное. */
const HDRI = !new URLSearchParams(location.search).has('prosky');

/** Положение солнца: юго-запад, ~32° над горизонтом — тёплый предвечерний свет, длинные тени. */
export const SUN = new Vector3(-0.55, 0.62, 0.55).normalize();
/** Поворот HDRI, чтобы солнце панорамы совпало с направлением SUN (подобрано по кадру). */
const SKY_ROT = 2.35;

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export function SkyDome() {
  const { mats, puffs } = useMemo(() => {
    const tex = new CanvasTexture(makeCloudCanvas(256));
    const mats = [0.5, 0.65, 0.8].map((o) => new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: o, color: '#fbfbfa', fog: true }));
    const r = rng(17); const puffs: { pos: [number, number, number]; s: [number, number]; m: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2, d = 600 + r() * 2200, y = 380 + r() * 260, w = 160 + r() * 260;
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d; const n = 5 + Math.floor(r() * 5);
      for (let k = 0; k < n; k++) {
        const ox = (r() - 0.5) * w, oz = (r() - 0.5) * w * 0.5, oy = (r() - 0.5) * 40;
        const sw = w * (0.35 + r() * 0.45); puffs.push({ pos: [cx + ox, y + oy, cz + oz], s: [sw, sw * (0.45 + r() * 0.25)], m: Math.floor(r() * 3) });
      }
    }
    return { mats, puffs };
  }, []);
  return (
    <>
      {HDRI
        ? <Environment files={asset('hdri/sky_2k.hdr')} background backgroundBlurriness={0} backgroundIntensity={1.0} environmentIntensity={0.55} backgroundRotation={[0, SKY_ROT, 0]} environmentRotation={[0, SKY_ROT, 0]} />
        : <Sky distance={45000} sunPosition={[SUN.x * 100, SUN.y * 100, SUN.z * 100]} turbidity={3.5} rayleigh={1.6} mieCoefficient={0.004} mieDirectionalG={0.86} />}
      <fogExp2 attach="fog" args={['#dbe7ee', 0.00038]} />
      {!HDRI && puffs.map((p, i) => <sprite key={i} position={p.pos} scale={[p.s[0], p.s[1], 1]} material={mats[p.m]} renderOrder={-1} />)}
    </>
  );
}
