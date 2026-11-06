// Трава: инстансированные травинки вокруг игрока/камеры (десктоп ~110 тыс., телефон ~25 тыс.), колышутся на ветру,
// градиент цвета от тёмного основания к светлому кончику. Пересеиваются, когда камера ушла дальше RESEED м от
// центра последнего посева. Не растут на дорожках, в воде, под домами и на магазине.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DoubleSide, InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { playerState } from '../Player';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export type GrassProps = {
  heightAt: (x: number, z: number) => number | null;
  ok: (x: number, z: number) => boolean; // можно ли сеять здесь (участок, не дорожка, не дом)
  count?: number; radius?: number;
};

const RESEED = 9;

export function Grass({ heightAt, ok, count = 110_000, radius = 36 }: GrassProps) {
  const { camera } = useThree();
  const mesh = useRef<InstancedMesh>(null);
  const centre = useRef(new Vector3(NaN, 0, NaN));
  const geom = useMemo(() => {
    // травинка: узкая полоска 3 сегмента по высоте, сужается к верху; изгиб — в шейдере по uv.y
    const g = new PlaneGeometry(0.045, 0.34, 1, 3); g.translate(0, 0.17, 0);
    const pos = g.getAttribute('position'); const uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) { const t = uv.getY(i); pos.setX(i, pos.getX(i) * (1 - t * 0.85)); }
    return g;
  }, []);
  const mat = useMemo(() => {
    const m = new MeshStandardMaterial({ color: '#7ea05a', roughness: 0.95, side: DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; varying float vT; varying float vShade;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vT = uv.y;
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.35 + ip.z * 0.27;
          float sway = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.4;
          float bend = uv.y * uv.y;
          transformed.x += bend * (0.12 * sway + 0.08);
          transformed.z += bend * 0.05 * sin(uTime * 1.1 + ph * 0.6);
          vShade = fract(sin(ph * 12.9898) * 43758.5453);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vT; varying float vShade;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 base = vec3(0.22, 0.34, 0.15); vec3 tip = vec3(0.52, 0.68, 0.31);
          vec3 c = mix(base, tip, vT * vT) * (0.85 + 0.3 * vShade);
          diffuseColor.rgb = c;`);
    };
    return m;
  }, []);
  const tmpM = useMemo(() => new Matrix4(), []); const tmpQ = useMemo(() => new Quaternion(), []); const tmpP = useMemo(() => new Vector3(), []); const tmpS = useMemo(() => new Vector3(), []);
  const up = useMemo(() => new Vector3(0, 1, 0), []);

  const reseed = (cx: number, cz: number) => {
    const im = mesh.current; if (!im) return;
    const r = rng((Math.abs((cx * 73 + cz * 31) | 0) % 2000000) + 11); // seed > 0, иначе rng даёт отрицательные числа и NaN
    let n = 0;
    for (let i = 0; i < count; i++) {
      // равномерно по кругу, гуще у центра (там игрок смотрит под ноги)
      const a = r() * Math.PI * 2, d = radius * Math.sqrt(r()) * (0.55 + 0.45 * r());
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const y = ok(x, z) ? heightAt(x, z) : null;
      if (y === null) { tmpS.setScalar(0); tmpM.compose(tmpP.set(0, -100, 0), tmpQ.identity(), tmpS); im.setMatrixAt(i, tmpM); continue; }
      tmpQ.setFromAxisAngle(up, r() * Math.PI); const s = 0.65 + r() * 0.6;
      tmpS.set(s, s * (0.75 + r() * 0.5), s); tmpM.compose(tmpP.set(x, y - 0.02, z), tmpQ, tmpS); im.setMatrixAt(i, tmpM); n++;
    }
    im.instanceMatrix.needsUpdate = true; im.count = count;
    centre.current.set(cx, 0, cz);
    (window as unknown as { __grass: unknown }).__grass = { placed: n, centre: [cx, cz] };
  };

  useEffect(() => () => { geom.dispose(); mat.dispose(); }, [geom, mat]);
  useFrame((_, dt) => {
    const u = (mat as MeshStandardMaterial & { userData: { shader?: { uniforms: { uTime: { value: number } } } } });
    void u; void dt;
    const sh = (mat as unknown as { __sh?: { uniforms: { uTime: { value: number } } } }).__sh;
    if (sh) sh.uniforms.uTime.value = performance.now() / 1000;
    // точка посева: игрок (пешком) или проекция камеры (дрон); с дрона выше 70 м трава не нужна
    const P = playerState.pos; const cx = P ? P.x : camera.position.x, cz = P ? P.z : camera.position.z;
    const ground = heightAt(cx, cz) ?? 0; const visible = (P ? P.y : camera.position.y) - ground < 70;
    if (mesh.current) mesh.current.visible = visible;
    if (!visible) return;
    const c = centre.current; if (Number.isNaN(c.x) || Math.hypot(cx - c.x, cz - c.z) > RESEED) reseed(cx, cz);
  });
  // ссылка на шейдер для uTime
  useEffect(() => { const prev = mat.onBeforeCompile; mat.onBeforeCompile = (sh, r) => { prev(sh, r); (mat as unknown as { __sh: unknown }).__sh = sh; }; mat.needsUpdate = true; }, [mat]);
  return <instancedMesh ref={mesh} args={[geom, mat, count]} frustumCulled={false} receiveShadow />;
}

export const GRASS_TINT = new Color('#7ea05a');
