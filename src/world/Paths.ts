// Дорожки комплекса: сеть по генплану (въезд у магазина → проезд между 2.x → дорога вдоль ряда 1.x → вилла 3),
// ответвления к каждому дому. Ленты по рельефу с UV вдоль длины; узлы пригодятся для маршрутов персонажей.
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

export type HouseLite = { id: string; model: string; matrix: Matrix4; fp?: [number, number, number, number] };
export type PathNet = { lines: Vector3[][]; nodes: Vector3[] };

const L = (h: HouseLite, x: number, z: number) => new Vector3(x, 0, z).applyMatrix4(h.matrix);

/** Сеть дорожек в мировых координатах (y = 0, высота берётся при построении ленты). */
export function buildPathNetwork(houses: HouseLite[], entrance: [number, number], avoid?: { x: number; z: number; r: number; toward: [number, number] }, entries: { x: number; z: number; yaw: number }[] = []): PathNet {
  const H = (id: string) => houses.find((h) => h.id === id)!;
  const lines: Vector3[][] = [];
  const E = new Vector3(entrance[0], 0, entrance[1]);
  // дорога вдоль северной стороны ряда 1.x (у бассейнов): локальная (2.5, -29) каждого дома
  const row1 = ['1.1', '1.2', '1.3', '1.4', '1.5'].map((id) => L(H(id), 2.5, -29.5));
  // проезд от въезда между 2.1/2.2 (запад) и 2.3 (восток) до дороги ряда 1.x
  const p21 = L(H('2.1'), 8, 17), p22 = L(H('2.2'), 8, 17), p23 = L(H('2.3'), 8, 17);
  const mid1 = p21.clone().add(p23).multiplyScalar(0.5), mid2 = p22.clone().add(p23).multiplyScalar(0.5);
  // от двери магазина: если прямая к проезду задевает сам магазин — обход вдоль его стены (со стороны старта прогулки)
  const main = [E];
  if (avoid) {
    const dx = mid1.x - E.x, dz = mid1.z - E.z; const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((avoid.x - E.x) * dx + (avoid.z - E.z) * dz) / L2));
    const cx = E.x + dx * t, cz = E.z + dz * t;
    if (Math.hypot(cx - avoid.x, cz - avoid.z) < avoid.r) {
      const L = Math.sqrt(L2); let nx = -dz / L, nz = dx / L;
      if (nx * (avoid.toward[0] - avoid.x) + nz * (avoid.toward[1] - avoid.z) < 0) { nx = -nx; nz = -nz; }
      main.push(new Vector3(avoid.x + nx * (avoid.r + 1.5), 0, avoid.z + nz * (avoid.r + 1.5)));
    }
  }
  main.push(mid1, mid2, row1[1]);
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
  // спусков вдоль восточной стороны вилл 1.x больше нет: полоса x=11,5 — внутри пятна дома (его собственные террасы и лестницы)
  // тропинка к каждому входу: от ближайшей точки сети до точки в 2,2 м перед дверью (yaw — взгляд внутрь дома)
  const invAll = houses.map((h) => ({ m: h.matrix.clone().invert(), fp: h.fp })); const lq = new Vector3();
  const insideFp = (x: number, z: number, hh: { m: Matrix4; fp?: [number, number, number, number] }, mg: number) => { if (!hh.fp) return false; lq.set(x, 0, z).applyMatrix4(hh.m); return lq.x > hh.fp[0] - mg && lq.x < hh.fp[2] + mg && lq.z > hh.fp[1] - mg && lq.z < hh.fp[3] + mg; };
  for (const e of entries) {
    // точка входа задана внутри дома: идём от неё наружу (против взгляда внутрь), пока не выйдем из габарита дома, и ещё 1,5 м
    const own = invAll.find((hh) => insideFp(e.x, e.z, hh, -1.2)) ?? null; let t = 0.5;
    if (own) while (t < 14 && insideFp(e.x - Math.sin(e.yaw) * t, e.z - Math.cos(e.yaw) * t, own, -1.2)) t += 0.25;
    t += 1.5;
    const P = new Vector3(e.x - Math.sin(e.yaw) * t, 0, e.z - Math.cos(e.yaw) * t);
    // ближайшая точка сети к точке S; возвращает линию/сегмент для вставки узла
    const nearest = (S: Vector3) => { let best: { d: number; li: number; si: number; q: Vector3 } | null = null;
      for (let li = 0; li < lines.length; li++) { const l = lines[li]; for (let si = 0; si < l.length - 1; si++) {
        const a = l[si], b = l[si + 1]; const dx = b.x - a.x, dz = b.z - a.z; const L2 = dx * dx + dz * dz || 1; const tt = Math.max(0, Math.min(1, ((S.x - a.x) * dx + (S.z - a.z) * dz) / L2));
        const q = new Vector3(a.x + dx * tt, 0, a.z + dz * tt); const d = q.distanceTo(S); if (!best || d < best.d) best = { d, li, si, q }; } }
      return best; };
    const crosses = (A: Vector3, B: Vector3) => { const n = Math.max(2, Math.ceil(A.distanceTo(B) / 0.5));
      for (let si = 0; si <= n; si++) { const tt = si / n; const x = A.x + (B.x - A.x) * tt, z = A.z + (B.z - A.z) * tt; for (const hh of invAll) if (insideFp(x, z, hh, hh === own ? -1.2 : -0.6)) return true; } return false; }; // чужой дом: не ближе 0,6 м к его габариту (виллы 1.x стоят в 2–3 м друг от друга)
    const direct = nearest(P); if (!direct) continue;
    if (direct.d < 3) { console.info('[entry]', +e.x.toFixed(1), +e.z.toFixed(1), 'рядом с дорожкой', +direct.d.toFixed(1)); continue; }
    let route: { q: typeof direct; via: Vector3 | null; len: number } | null = null;
    if (!crosses(direct.q, P)) route = { q: direct, via: null, len: direct.d };
    else if (own && own.fp) {
      // обход вокруг своего дома: через угол габарита (+2 м), от которого прямая к сети не задевает дома
      const fwd = own.m.clone().invert(); const [fx0, fz0, fx1, fz1] = own.fp;
      for (const [cx, cz] of [[fx0 - 0.8, fz0 - 0.8], [fx1 + 0.8, fz0 - 0.8], [fx1 + 0.8, fz1 + 0.8], [fx0 - 0.8, fz1 + 0.8]]) {
        const Wp = new Vector3(cx, 0, cz).applyMatrix4(fwd); Wp.y = 0; const nq = nearest(Wp); if (!nq) continue;
        if (crosses(Wp, P) || crosses(nq.q, Wp)) continue;
        const len = nq.d + Wp.distanceTo(P); if (!route || len < route.len) route = { q: nq, via: Wp, len };
      }
    }
    if (!route) { console.info('[entry]', +e.x.toFixed(1), +e.z.toFixed(1), 'тропинку не провести (пересекает дома)'); continue; }
    const l = lines[route.q.li]; if (route.q.q.distanceTo(l[route.q.si]) > 0.5 && route.q.q.distanceTo(l[route.q.si + 1]) > 0.5) l.splice(route.q.si + 1, 0, route.q.q); // узел на основной дорожке
    lines.push(route.via ? [route.q.q.clone(), route.via, P] : [route.q.q.clone(), P]);
    console.info('[entry]', +e.x.toFixed(1), +e.z.toFixed(1), route.via ? 'тропинка в обход дома' : 'тропинка', +route.len.toFixed(1), 'м');
  }
  const nodes: Vector3[] = []; for (const l of lines) for (const p of l) if (!nodes.some((n) => n.distanceTo(p) < 0.5)) nodes.push(p.clone());
  return { lines, nodes };
}

/** Лента дорожки по сглаженной кривой, прилегает к рельефу (+lift), UV: u поперёк 0..1, v вдоль (м / width). */
export function pathRibbon(line: Vector3[], width: number, heightAt: (x: number, z: number) => number | null, lift = 0.1): BufferGeometry | null {
  if (line.length < 2) return null;
  const curve = new CatmullRomCurve3(line, false, 'catmullrom', 0.3);
  const len = curve.getLength(); const n = Math.max(2, Math.ceil(len / 0.5)); // шаг 0,5 м = шаг сетки рельефа: газон не проступает между опорными точками
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
