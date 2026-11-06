// Дорожки комплекса: сеть по генплану (въезд у магазина → проезд между 2.x → дорога вдоль ряда 1.x → вилла 3),
// ответвления к каждому дому. Ленты по рельефу с UV вдоль длины; узлы пригодятся для маршрутов персонажей.
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

export type HouseLite = { id: string; model: string; matrix: Matrix4 };
export type PathNet = { lines: Vector3[][]; nodes: Vector3[] };

const L = (h: HouseLite, x: number, z: number) => new Vector3(x, 0, z).applyMatrix4(h.matrix);

/** Сеть дорожек в мировых координатах (y = 0, высота берётся при построении ленты). */
export function buildPathNetwork(houses: HouseLite[], entrance: [number, number]): PathNet {
  const H = (id: string) => houses.find((h) => h.id === id)!;
  const lines: Vector3[][] = [];
  const E = new Vector3(entrance[0], 0, entrance[1]);
  // дорога вдоль северной стороны ряда 1.x (у бассейнов): локальная (2.5, -29) каждого дома
  const row1 = ['1.1', '1.2', '1.3', '1.4', '1.5'].map((id) => L(H(id), 2.5, -29.5));
  // проезд от въезда между 2.1/2.2 (запад) и 2.3 (восток) до дороги ряда 1.x
  const p21 = L(H('2.1'), 8, 17), p22 = L(H('2.2'), 8, 17), p23 = L(H('2.3'), 8, 17);
  const mid1 = p21.clone().add(p23).multiplyScalar(0.5), mid2 = p22.clone().add(p23).multiplyScalar(0.5);
  const main = [E, mid1, mid2, row1[1]];
  lines.push(main);
  lines.push(row1);
  // к вилле 3: от конца ряда к её северной террасе
  const v3 = L(H('3'), 0, -14);
  lines.push([row1[4], v3]);
  // ответвление от проезда к 2.4 и 2.5 и дальше к вилле 3 (северная дорога)
  const p24 = L(H('2.4'), 8, 17), p25 = L(H('2.5'), 8, 17);
  lines.push([mid1, p24, p25, v3]);
  // короткие подъезды к домам 2.x (южная сторона, где старт одиночной прогулки) и к вилле 2.2
  lines.push([mid1, p21]); lines.push([mid2, p22]); lines.push([mid1, p23]);
  // пешеходные спуски вдоль ряда 1.x к террасам (восточная сторона каждого дома)
  for (const id of ['1.1', '1.2', '1.3', '1.4', '1.5']) { const h = H(id); lines.push([L(h, 11.5, -29.5), L(h, 11.5, -6), L(h, 11.5, 4)]); }
  const nodes: Vector3[] = []; for (const l of lines) for (const p of l) if (!nodes.some((n) => n.distanceTo(p) < 0.5)) nodes.push(p.clone());
  return { lines, nodes };
}

/** Лента дорожки по сглаженной кривой, прилегает к рельефу (+lift), UV: u поперёк 0..1, v вдоль (м / width). */
export function pathRibbon(line: Vector3[], width: number, heightAt: (x: number, z: number) => number | null, lift = 0.06): BufferGeometry | null {
  if (line.length < 2) return null;
  const curve = new CatmullRomCurve3(line, false, 'catmullrom', 0.3);
  const len = curve.getLength(); const n = Math.max(2, Math.ceil(len / 1.0));
  const pts = curve.getSpacedPoints(n);
  const P: number[] = [], U: number[] = [], N: number[] = []; const idx: number[] = [];
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const d = (i < pts.length - 1 ? pts[i + 1].clone().sub(p) : p.clone().sub(pts[i - 1])); d.y = 0; d.normalize();
    const side = new Vector3(-d.z, 0, d.x).multiplyScalar(width / 2);
    if (i) v += p.distanceTo(pts[i - 1]) / width;
    for (const s of [-1, 1]) {
      const x = p.x + side.x * s, z = p.z + side.z * s; const y = (heightAt(x, z) ?? p.y) + lift;
      P.push(x, y, z); U.push(s < 0 ? 0 : 1, v); N.push(0, 1, 0);
    }
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } // нормаль вверх (против часовой при взгляде сверху)
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(P, 3)); g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3)); g.setIndex(idx); return g;
}

/** Расстояние от точки до ближайшей линии сети (для «не сажать кусты на дорожке»). */
export function distToPaths(net: PathNet, x: number, z: number): number {
  let best = Infinity;
  for (const l of net.lines) for (let i = 0; i < l.length - 1; i++) {
    const a = l[i], b = l[i + 1]; const dx = b.x - a.x, dz = b.z - a.z; const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2)) : 0;
    const px = a.x + t * dx - x, pz = a.z + t * dz - z; best = Math.min(best, px * px + pz * pz);
  }
  return Math.sqrt(best);
}
