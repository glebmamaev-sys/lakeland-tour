// Светильники вдоль дорожек: столбик 0,7 м со светящейся головкой через ≈ 7 м, по очереди с двух сторон дорожки.
// Вечером головки горят, а на земле под каждым — тёплое пятно света (накладка с радиальным градиентом, сложение
// цветов). Настоящих источников света нет: сотня точечных огней стоила бы дороже всей сцены.
import { useEffect, useMemo } from 'react';
import { AdditiveBlending, BufferGeometry, CanvasTexture, CatmullRomCurve3, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, type Vector3 } from 'three';
import * as F from './Furniture';
import { onEve } from './DayTime';

export type Lamps = { posts: BufferGeometry | null; heads: BufferGeometry | null; pools: BufferGeometry | null; count: number };

export function buildPathLamps(lines: Vector3[][], hAt: (x: number, z: number) => number | null, ok: (x: number, z: number) => boolean, extra: [number, number][] = []): Lamps {
  const pts: [number, number, number][] = [];
  const add = (x: number, z: number) => { if (!ok(x, z) || pts.some((p) => Math.hypot(p[0] - x, p[2] - z) < 4)) return; const y = hAt(x, z); if (y !== null) pts.push([x, y, z]); };
  for (const [x, z] of extra) add(x, z);
  let side = 1;
  for (const line of lines) {
    if (line.length < 2) continue; const cv = new CatmullRomCurve3(line, false, 'catmullrom', 0.3); const L = cv.getLength(); const n = Math.max(1, Math.round(L / 7));
    for (let i = 0; i < n; i++) { const u = (i + 0.5) / n; const q = cv.getPointAt(u), tg = cv.getTangentAt(u); side = -side; add(q.x - tg.z * 1.75 * side, q.z + tg.x * 1.75 * side); }
  }
  if (!pts.length) return { posts: null, heads: null, pools: null, count: 0 };
  const posts = F.merge(pts.map(([x, y, z]) => F.box(0.1, 0.62, 0.1, F.C.charcoal, x, y - 0.05, z, 0.02)));
  const heads = F.merge(pts.map(([x, y, z]) => F.box(0.15, 0.11, 0.15, '#fff3d6', x, y + 0.57, z, 0.0)));
  // пятно света: сетка 4 × 4 по рельефу радиусом 3,2 м, чуть выше земли
  const P: number[] = [], U: number[] = [], idx: number[] = []; const R = 3.2, N = 4;
  for (const [x, y, z] of pts) { const b = P.length / 3;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const px = x - R + (2 * R * i) / N, pz = z - R + (2 * R * j) / N; P.push(px, (hAt(px, pz) ?? y) + 0.09, pz); U.push(i / N, j / N); }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = b + j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2); } }
  const pools = new BufferGeometry(); pools.setAttribute('position', new Float32BufferAttribute(P, 3)); pools.setAttribute('uv', new Float32BufferAttribute(U, 2)); pools.setIndex(idx);
  return { posts, heads, pools, count: pts.length };
}

export function PathLamps({ lamps }: { lamps: Lamps }) {
  const mats = useMemo(() => {
    const post = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    const head = new MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffcf86', emissiveIntensity: 0.25, roughness: 0.6 });
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#9a9a9a'); gr.addColorStop(0.6, '#2c2c2c'); gr.addColorStop(1, '#000000'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const pool = new MeshBasicMaterial({ map: new CanvasTexture(c), color: '#ffb866', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, fog: false, visible: false });
    return { post, head, pool };
  }, []);
  useEffect(() => { onEve((k) => { mats.head.emissiveIntensity = 0.25 + 5.5 * k; mats.pool.opacity = 0.55 * k; mats.pool.visible = k > 0.01; }); }, [mats]);
  return (
    <>
      {lamps.posts && <mesh geometry={lamps.posts} material={mats.post} castShadow />}
      {lamps.heads && <mesh geometry={lamps.heads} material={mats.head} />}
      {lamps.pools && <mesh geometry={lamps.pools} material={mats.pool} renderOrder={3} userData={{ noCollide: true }} />}
    </>
  );
}
