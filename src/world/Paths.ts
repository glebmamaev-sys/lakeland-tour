// Дорожки комплекса: сеть по генплану (въезд у магазина → проезд между 2.x → дорога вдоль ряда 1.x → вилла 3),
// ответвления к каждому дому. Ленты по рельефу с UV вдоль длины; узлы пригодятся для маршрутов персонажей.
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

export type HouseLite = { id: string; model: string; matrix: Matrix4; fp?: [number, number, number, number] };
export type PathNet = { lines: Vector3[][]; nodes: Vector3[] };

const L = (h: HouseLite, x: number, z: number) => new Vector3(x, 0, z).applyMatrix4(h.matrix);

/** Среда для прокладки маршрутов: что занято (дома, бассейны), где участок, высота рельефа, габарит сетки. */
export type RouteEnv = { blocked: (x: number, z: number) => boolean; inside: (x: number, z: number) => boolean; height: (x: number, z: number) => number | null; bbox: [number, number, number, number] };
/** Поиск маршрута по сетке участка (A*, 8 направлений, шаг 0,75 м): занятые клетки раздуваются на clear (полуширина
 *  дорожки + зазор), крутые участки дороже ровных, итог спрямляется по прямой видимости. Раньше отрезок, задевший дом,
 *  просто обрезался — дорога вдоль ряда 1.x и северная улица пропадали целиком, а входы оставались без подхода. */
function makeRouter(env: RouteEnv, clear = 1.7, S = 0.75) {
  const [bx0, bz0, bx1, bz1] = env.bbox; const NX = Math.ceil((bx1 - bx0) / S) + 1, NZ = Math.ceil((bz1 - bz0) / S) + 1;
  const bad = new Uint8Array(NX * NZ), hgt = new Float32Array(NX * NZ); const R = Math.ceil(clear / S);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = bx0 + i * S, z = bz0 + j * S, k = j * NX + i; const h = env.height(x, z); hgt[k] = h ?? 0;
    if (h === null || !env.inside(x, z)) { bad[k] = 1; continue; }
    if (!env.blocked(x, z)) continue;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || Math.hypot(di, dj) * S > clear) continue; bad[jj * NX + ii] = 1; }
  }
  const cell = (x: number, z: number) => { const i = Math.round((x - bx0) / S), j = Math.round((z - bz0) / S); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i; };
  const isBad = (x: number, z: number) => { const k = cell(x, z); return k < 0 || !!bad[k]; };
  /** Прямая свободна (в раздутой сетке). */
  const free = (a: Vector3, b: Vector3) => { const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.4)); for (let k = 0; k <= n; k++) { const t = k / n; if (isBad(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; } return true; };
  const snap = (x: number, z: number) => { const k0 = cell(x, z); if (k0 >= 0 && !bad[k0]) return k0; const i0 = Math.round((x - bx0) / S), j0 = Math.round((z - bz0) / S); let best = -1, bd = Infinity; const r = Math.ceil(6 / S);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= NX || j >= NZ || bad[j * NX + i]) continue; const d = Math.hypot(di, dj); if (d < bd) { bd = d; best = j * NX + i; } } return best; };
  const stepCost = (ka: number, kb: number, d: number) => { const slope = Math.abs(hgt[kb] - hgt[ka]) / d; return d * (1 + 10 * Math.max(0, slope - 0.1)); };
  const segCost = (a: Vector3, b: Vector3) => { const n = Math.max(1, Math.ceil(a.distanceTo(b) / S)); let c = 0, pk = cell(a.x, a.z); for (let k = 1; k <= n; k++) { const t = k / n; const kk = cell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t); if (kk < 0 || pk < 0) return Infinity; c += stepCost(pk, kk, a.distanceTo(b) / n); pk = kk; } return c; };
  const route = (a: Vector3, b: Vector3): Vector3[] | null => {
    const s = snap(a.x, a.z), g = snap(b.x, b.z); if (s < 0 || g < 0) return null;
    const gi = g % NX, gj = (g - gi) / NX; const G = new Float32Array(NX * NZ).fill(Infinity), from = new Int32Array(NX * NZ).fill(-1), done = new Uint8Array(NX * NZ);
    const heap: [number, number][] = []; const push = (f: number, k: number) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    G[s] = 0; push(0, s);
    while (heap.length) {
      const [, k] = pop(); if (done[k]) continue; done[k] = 1; if (k === g) break; const i = k % NX, j = (k - i) / NX;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue; const kk = jj * NX + ii; if (bad[kk] || done[kk]) continue;
        const c = G[k] + stepCost(k, kk, Math.hypot(di, dj) * S); if (c < G[kk]) { G[kk] = c; from[kk] = k; push(c + Math.hypot(ii - gi, jj - gj) * S, kk); } }
    }
    if (!Number.isFinite(G[g])) return null;
    const cells: number[] = []; for (let k = g; k >= 0; k = from[k]) { cells.push(k); if (k === s) break; } cells.reverse();
    const pts = cells.map((k) => new Vector3(bx0 + (k % NX) * S, 0, bz0 + Math.floor(k / NX) * S));
    if (!isBad(a.x, a.z)) pts[0] = a.clone(); else pts.unshift(a.clone()); if (!isBad(b.x, b.z)) pts[pts.length - 1] = b.clone(); else pts.push(b.clone());
    // спрямление: от точки i — к самой дальней j, до которой прямая свободна и не заметно круче пройденного пути
    const out: Vector3[] = [pts[0]]; let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1; let acc: number[] = [0]; for (let q = i + 1; q < pts.length; q++) acc.push(acc[q - i - 1] + (cell(pts[q - 1].x, pts[q - 1].z) >= 0 && cell(pts[q].x, pts[q].z) >= 0 ? stepCost(cell(pts[q - 1].x, pts[q - 1].z), cell(pts[q].x, pts[q].z), pts[q].distanceTo(pts[q - 1]) || S) : pts[q].distanceTo(pts[q - 1])));
      for (; j > i + 1; j--) { if (pts[i].distanceTo(pts[j]) > 28) continue; if (!free(pts[i], pts[j])) continue; if (segCost(pts[i], pts[j]) <= acc[j - i] * 1.15 + 0.5) break; }
      out.push(pts[j]); i = j;
    }
    return out;
  };
  return { route, free, isBad };
}
const polyLen = (l: Vector3[]) => { let L = 0; for (let i = 1; i < l.length; i++) L += l[i].distanceTo(l[i - 1]); return L; };

/** Сеть дорожек в мировых координатах (y = 0, высота берётся при построении ленты). */
export function buildPathNetwork(houses: HouseLite[], entrance: [number, number], avoid?: { x: number; z: number; r: number; toward: [number, number] }, entries: { x: number; z: number; yaw: number }[] = [], blocked?: (x: number, z: number) => boolean, env?: RouteEnv, gateIn?: [number, number]): PathNet {
  const H = (id: string) => houses.find((h) => h.id === id)!;
  const lines: Vector3[][] = [];
  const E = new Vector3(entrance[0], 0, entrance[1]);
  const router = env ? makeRouter(env) : null;
  // отрезки магистралей, задевающие дома или бассейны, заменяются маршрутом в обход
  const link = (pts: Vector3[], name: string): Vector3[] => {
    if (!router) return pts; const out: Vector3[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) { const a = out[out.length - 1], b = pts[i];
      if (router.free(a, b)) { out.push(b); continue; }
      const r = router.route(a, b); if (r) { out.push(...r.slice(1)); console.info('[path]', name, 'отрезок', i, 'в обход:', r.length, 'точек,', +polyLen(r).toFixed(1), 'м вместо', +a.distanceTo(b).toFixed(1)); } else { out.push(b); console.info('[path]', name, 'отрезок', i, 'обход не найден'); } }
    return out;
  };
  // дорога вдоль северной стороны ряда 1.x: у каждого дома точка севернее бассейна (2.5, -29.5) и точка напротив его
  // входной лестницы у северо-восточного угла (12, -29.4); от неё — короткий подход к площадке лестницы (12, -27.0)
  const ids1 = ['1.1', '1.2', '1.3', '1.4', '1.5'].filter((id) => houses.some((h) => h.id === id));
  const rowA = ids1.map((id) => L(H(id), 2.5, -29.5)), rowR = ids1.map((id) => L(H(id), 12, -29.4)), rowT = ids1.map((id) => L(H(id), 12, -27.0));
  const row1 = rowA; // совместимость: узлы ряда
  const rowPts: Vector3[] = []; ids1.forEach((_, i) => { if (i) rowPts.push(rowA[i]); rowPts.push(rowR[i]); });
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
  lines.push(link(main, 'проезд'));
  lines.push(link(rowPts, 'ряд 1.x'));
  rowR.forEach((r, i) => lines.push([r.clone(), rowT[i]]));
  // к вилле 3: от конца ряда к её северной террасе
  const v3 = L(H('3'), 0, -14);
  lines.push(link([rowR[rowR.length - 1], v3], 'к вилле 3'));
  // северная улица: от проезда между 2.3 и 2.4 к 2.5 (парадный вход 2.5 смотрит на неё; 2.4 — подходом от проезда)
  const p25 = L(H('2.5'), 8, 17);
  lines.push(link([mid1, p25], 'северная улица'));
  // парадные входы вилл 2.x: площадка перед крыльцом (локальная (2, 3.8), крыльцо «Entrance» плана — с южной стороны).
  // Подход — от той точки сети, от которой маршрут в обход домов короче. Раньше тропинка шла «от точки телепорта
  // против взгляда» и приводила к бассейну или в обход дома на 30–40 м
  const attach = (P: Vector3, name: string) => {
    if (!router) return false; const cands: Vector3[] = [];
    for (const l of lines) { let best: Vector3 | null = null, bd = Infinity; for (let si = 0; si < l.length - 1; si++) { const a = l[si], b = l[si + 1]; const dx = b.x - a.x, dz = b.z - a.z; const L2 = dx * dx + dz * dz || 1; const tt = Math.max(0, Math.min(1, ((P.x - a.x) * dx + (P.z - a.z) * dz) / L2)); const q = new Vector3(a.x + dx * tt, 0, a.z + dz * tt); const d = q.distanceTo(P); if (d < bd) { bd = d; best = q; } } if (best) cands.push(best); }
    cands.sort((a, b) => a.distanceTo(P) - b.distanceTo(P)); let bestR: Vector3[] | null = null, bl = Infinity;
    for (const q of cands.slice(0, 4)) { if (q.distanceTo(P) > bl) break; const r = router.free(q, P) ? [q.clone(), P] : router.route(q, P); if (!r) continue; const len = polyLen(r); if (len < bl) { bl = len; bestR = r; } }
    if (!bestR) { console.info('[entry]', name, 'подход не найден'); return false; }
    if (bl < 1.5) { console.info('[entry]', name, 'у дорожки'); return true; }
    const q = bestR[0]; for (const l of lines) { let done = false; for (let si = 0; si < l.length - 1 && !done; si++) { const a = l[si], b = l[si + 1]; const d = a.distanceTo(b) || 1; const tt = ((q.x - a.x) * (b.x - a.x) + (q.z - a.z) * (b.z - a.z)) / (d * d); if (tt > 0.02 && tt < 0.98 && Math.hypot(a.x + (b.x - a.x) * tt - q.x, a.z + (b.z - a.z) * tt - q.z) < 0.05 && q.distanceTo(a) > 0.5 && q.distanceTo(b) > 0.5) { l.splice(si + 1, 0, q.clone()); done = true; } } if (done) break; } // узел на дорожке
    lines.push(bestR); console.info('[entry]', name, 'подход', +bl.toFixed(1), 'м,', bestR.length, 'точек'); return true;
  };
  const fronted = new Set<string>(ids1);
  for (const h of houses) if (h.model === 'villa21' || h.model === 'villa22') { if (attach(L(h, 2.0, 3.8), h.id)) fronted.add(h.id); }
  // от ворот участка (точка в 0,8 м внутри границы — дорожка начинается прямо в створе) — к ближайшей дорожке в обход магазина и домов
  if (gateIn) attach(new Vector3(gateIn[0], 0, gateIn[1]), 'ворота');
  // тропинка к каждому входу: от ближайшей точки сети до точки в 2,2 м перед дверью (yaw — взгляд внутрь дома)
  const invAll = houses.map((h) => ({ m: h.matrix.clone().invert(), fp: h.fp, cx: h.matrix.elements[12], cz: h.matrix.elements[14] })); const lq = new Vector3();
  // «внутри дома»: по маске стен/комнат с запасом 0,6 м, если она передана; иначе — по габариту с полями
  const blockedAt = (x: number, z: number) => !!blocked && (blocked(x, z) || blocked(x + 0.6, z) || blocked(x - 0.6, z) || blocked(x, z + 0.6) || blocked(x, z - 0.6));
  const houseAt = (x: number, z: number, own: { m: Matrix4; fp?: [number, number, number, number] } | null, ownMg: number, mg: number) => {
    if (blocked) { if (!blockedAt(x, z)) return null; let best = invAll[0], bd = Infinity; for (const hh of invAll) { const d = Math.hypot(hh.cx - x, hh.cz - z); if (d < bd) { bd = d; best = hh; } } return best; }
    return invAll.find((hh) => insideFp(x, z, hh, hh === own ? ownMg : mg)) ?? null;
  };
  const insideFp = (x: number, z: number, hh: { m: Matrix4; fp?: [number, number, number, number] }, mg: number) => { if (!hh.fp) return false; lq.set(x, 0, z).applyMatrix4(hh.m); return lq.x > hh.fp[0] - mg && lq.x < hh.fp[2] + mg && lq.z > hh.fp[1] - mg && lq.z < hh.fp[3] + mg; };
  for (let ei = 0; ei < entries.length; ei++) {
    const e = entries[ei]; if (houses[ei] && fronted.has(houses[ei].id)) continue; // подход уже проложен к парадному входу
    // точка входа задана внутри дома: идём от неё наружу (против взгляда внутрь), пока не выйдем из габарита дома, и ещё 1,5 м
    const own = invAll.find((hh) => insideFp(e.x, e.z, hh, -1.2)) ?? null; let t = 0.5;
    if (blocked) { while (t < 14 && blockedAt(e.x - Math.sin(e.yaw) * t, e.z - Math.cos(e.yaw) * t)) t += 0.25; }
    else if (own) while (t < 14 && insideFp(e.x - Math.sin(e.yaw) * t, e.z - Math.cos(e.yaw) * t, own, -1.2)) t += 0.25;
    t += 1.5;
    const P = new Vector3(e.x - Math.sin(e.yaw) * t, 0, e.z - Math.cos(e.yaw) * t);
    // ближайшая точка сети к точке S; возвращает линию/сегмент для вставки узла
    const nearest = (S: Vector3) => { let best: { d: number; li: number; si: number; q: Vector3 } | null = null;
      for (let li = 0; li < lines.length; li++) { const l = lines[li]; for (let si = 0; si < l.length - 1; si++) {
        const a = l[si], b = l[si + 1]; const dx = b.x - a.x, dz = b.z - a.z; const L2 = dx * dx + dz * dz || 1; const tt = Math.max(0, Math.min(1, ((S.x - a.x) * dx + (S.z - a.z) * dz) / L2));
        const q = new Vector3(a.x + dx * tt, 0, a.z + dz * tt); const d = q.distanceTo(S); if (!best || d < best.d) best = { d, li, si, q }; } }
      return best; };
    const crosses = (A: Vector3, B: Vector3) => { const n = Math.max(2, Math.ceil(A.distanceTo(B) / 0.5));
      for (let si = 0; si <= n; si++) { const tt = si / n; const x = A.x + (B.x - A.x) * tt, z = A.z + (B.z - A.z) * tt; if (houseAt(x, z, own, -1.2, -0.6)) return true; } return false; }; // чужой дом: не ближе 0,6 м к его габариту (виллы 1.x стоят в 2–3 м друг от друга)
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
  // дорожки не заходят в дома: линия обрезается за 1 м до входа в габарит любого дома (+0,3 м)
  const segCrosses = (A: Vector3, B: Vector3) => { const n = Math.max(1, Math.ceil(A.distanceTo(B) / 0.25)); for (let k = 1; k < n; k++) { const tt = k / n; const x = A.x + (B.x - A.x) * tt, z = A.z + (B.z - A.z) * tt; const hh = houseAt(x, z, null, -0.9, -0.9); if (hh) return { hh, x, z }; } return null; };
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li]; const out: Vector3[] = [l[0]]; let cut = false;
    for (let si = 0; si < l.length - 1 && !cut; si++) {
      const a = out[out.length - 1], b = l[si + 1]; const hit = segCrosses(a, b);
      if (!hit) { out.push(b); continue; }
      // отрезок входит в дом: обход через угол его габарита (+1 м), если оба плеча свободны; иначе — обрезаем за 1 м до дома
      let routed = false;
      if (hit.hh.fp) {
        const fwd = hit.hh.m.clone().invert(); const [fx0, fz0, fx1, fz1] = hit.hh.fp; let best: { w: Vector3; len: number } | null = null;
        for (const [cx, cz] of [[fx0 - 0.2, fz0 - 0.2], [fx1 + 0.2, fz0 - 0.2], [fx1 + 0.2, fz1 + 0.2], [fx0 - 0.2, fz1 + 0.2]]) {
          const w = new Vector3(cx, 0, cz).applyMatrix4(fwd); w.y = 0; if (segCrosses(a, w) || segCrosses(w, b)) continue;
          const len = a.distanceTo(w) + w.distanceTo(b); if (!best || len < best.len) best = { w, len };
        }
        if (best) { out.push(best.w, b); routed = true; console.info('[path]', 'линия', li, 'обходит дом через угол', [+best.w.x.toFixed(1), +best.w.z.toFixed(1)]); }
      }
      if (!routed) { const d = a.distanceTo(b) || 1; const tb = Math.max(0, (Math.hypot(hit.x - a.x, hit.z - a.z) - 1) / d); out.push(new Vector3(a.x + (b.x - a.x) * tb, 0, a.z + (b.z - a.z) * tb)); cut = true; console.info('[path]', 'линия', li, 'обрезана у дома в', [+hit.x.toFixed(1), +hit.z.toFixed(1)]); }
    }
    lines[li] = out;
  }
  for (let li = lines.length - 1; li >= 0; li--) { const l = lines[li]; let L = 0; for (let i = 1; i < l.length; i++) L += l[i].distanceTo(l[i - 1]); if (l.length < 2 || L < 2) lines.splice(li, 1); }
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
