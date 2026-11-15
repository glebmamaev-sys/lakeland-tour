// Продольный профиль дорожек. По каждой линии сети: рельеф вдоль оси (шаг 0,5 м) сглаживается (±1,5 м), концы
// привязаны к площадкам домов, уклон ограничен 1:2 в обе стороны (двухпроходный ограничитель). Участки положе
// 1:8 (12 %) — пандус, круче — уличная лестница: подступёнок ≈ 15 см, проступь = длина участка / число ступеней
// (на пологих местах — широкие садовые ступени). Рельеф в коридоре дорожки (±1,5 м) фиксируется на 6 см ниже
// профиля (лента лежит на +10 см), полоса рядом релаксируется вместе с газоном — дорожка «врезана» в склон, а не
// повторяет его складки. Ступени — каменные плиты стопкой над пандусом (игрок и персонажи идут по пандусу).
import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Vector3 } from 'three';
import type { PathNet } from './Paths';
import { hexa, finish, type Grid, type Tri } from './Terraces';

export type Step = { line: number; x: number; z: number; dir: [number, number]; len: number; width: number; top: number; base: number; c: [number, number][] }; // c — 4 угла проступи по кривой (лев/прав в начале, прав/лев в конце)
export type Graded = { fixed: Uint8Array; h: Float32Array; steps: Step[]; flights: number; folds: number; corridor: Uint8Array; ribbons: BufferGeometry[] };

const DS = 0.5, SLOPE_WALK = 0.12, SLOPE_MAX = 0.5, RISER = 0.15, HALF = 1.5, LIFT = -0.06, SMOOTH = 1.5, NODE = 0.6, SLOPE_STAIR = 0.5;

/** padAt — отметка мощения модели дома под точкой (или null): конец дорожки, пришедший на такое мощение, встаёт на его
 *  уровень, а не на рельеф под ним (рельеф участка местами ниже рельефа Revit на 0,3–0,9 м). */
export function gradePaths(net: PathNet, g: Grid, fixed: Uint8Array, width = 2.6, padAt?: (x: number, z: number) => number | null): Graded {
  const { h, x0, z0, step, nx, nz } = g; const N = nx * nz;
  const sample = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / step)), fz = Math.max(0, Math.min(nz - 1.001, (z - z0) / step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (h[j * nx + i] * (1 - tx) + h[j * nx + i + 1] * tx) * (1 - tz) + (h[(j + 1) * nx + i] * (1 - tx) + h[(j + 1) * nx + i + 1] * tx) * tz;
  };
  const fx = Uint8Array.from(fixed), ht = Float32Array.from(h), best = new Float32Array(N).fill(Infinity), corridor = new Uint8Array(N);
  const steps: Step[] = []; let flights = 0, folds = 0; const ribbons: BufferGeometry[] = [];
  // Стыки дорожек — площадки. Марш одной дорожки не должен заходить в полотно другой: иначе посреди чужой ленты
  // стоит обрубок ступени (у виллы 3 так торчали три ступени ответвления к вилле 1.5). Поэтому у каждого стыка
  // профиль держится ровным на полуширину ленты + 0,3 м: и на конце примыкающей дорожки, и на сквозной дорожке
  // по обе стороны от места примыкания. Отметка площадки общая для всех дорожек стыка (nodeH). На коротких крутых
  // ответвлениях площадка сжимается (f), чтобы лестница уложилась в уклон SLOPE_STAIR.
  const KEEP = width / 2 + 0.3;
  const lines: typeof net.lines = [];
  for (const raw of net.lines) {
    // вершины сети несут разную высоту (узлы — 0, точки маршрута — рельеф): кривая по ним уходит вверх-вниз, и точки,
    // равномерные по её длине, в плане сбиваются в кучу — лента собирается веером. Профиль считаем по плоской кривой.
    const l = raw.filter((p, i) => !i || Math.hypot(p.x - raw[i - 1].x, p.z - raw[i - 1].z) > 0.05).map((p) => new Vector3(p.x, 0, p.z)); // сдвоенные вершины ломают кривую
    // крайний отрезок короче полуширины ленты (хвостик у входа) сминает её конец в «звезду» — ведём прямо в конечную точку
    const seg = (a: number, b: number) => Math.hypot(l[a].x - l[b].x, l[a].z - l[b].z);
    while (l.length > 2 && seg(l.length - 1, l.length - 2) < width / 2) l.splice(l.length - 2, 1);
    while (l.length > 2 && seg(0, 1) < width / 2) l.splice(1, 1);
    // на изломе круче 60° лента шириной 2,6 м складывается веером — режем линию в этой вершине на две прямые части
    let from = 0;
    for (let i = 1; i < l.length - 1; i++) { const ax = l[i].x - l[i - 1].x, az = l[i].z - l[i - 1].z, bx = l[i + 1].x - l[i].x, bz = l[i + 1].z - l[i].z; if ((ax * bx + az * bz) / ((Math.hypot(ax, az) || 1) * (Math.hypot(bx, bz) || 1)) < 0.5) { lines.push(l.slice(from, i + 1)); from = i; } }
    lines.push(l.slice(from));
  }
  const shape = lines.map((l) => { if (l.length < 2) return null; const curve = new CatmullRomCurve3(l, false, 'centripetal'); const L = curve.getLength(); const n = Math.max(2, Math.ceil(L / (L < 6 ? DS / 2 : DS))); return { curve, L, n, ds: L / n, pts: curve.getSpacedPoints(n) }; }); // короткие ответвления — с шагом 0,25 м: площадка у стыка и лестница на 2–3 м должны уложиться точно
  const nodeH: { x: number; z: number; y: number }[] = [];
  const nodeAt = (x: number, z: number) => nodeH.find((q) => Math.hypot(q.x - x, q.z - z) < NODE);
  // концы на мощении модели: отметка конца — уровень мощения (лента вровень с ним). Короткое ответвление от стыка к
  // такому мощению (2,4 м к плиточной дорожке виллы 1.x) должно уложить лестницу за площадкой стыка: если перепад
  // для этого велик, отметка самого стыка подтягивается к мощению — и главная дорожка проходит стык на этой отметке
  const isJ = (li0: number, x: number, z: number) => shape.some((o, oi) => o && oi !== li0 && o.pts.some((q) => Math.hypot(q.x - x, q.z - z) < NODE));
  const padEnd: (number | null)[][] = shape.map((sh, li0) => { if (!sh) return [null, null]; return [0, sh.n].map((e) => { const p = sh.pts[e]; if (!padAt || isJ(li0, p.x, p.z)) return null; const y = padAt(p.x, p.z); return y !== null && Math.abs(y - sample(p.x, p.z)) < 1.2 ? y - 0.13 : null; }); });
  shape.forEach((sh, li0) => { if (!sh || sh.L >= 6) return; for (const [je, pe] of [[0, 1], [1, 0]]) { const py = padEnd[li0][pe]; if (py === null) continue; const p = sh.pts[je ? sh.n : 0]; if (!isJ(li0, p.x, p.z)) continue;
    const a = SLOPE_MAX * Math.max(0, sh.L - KEEP), t0 = nodeAt(p.x, p.z)?.y ?? sample(p.x, p.z), y = Math.max(py - a, Math.min(py + a, t0)); if (Math.abs(y - t0) < 0.01) continue;
    const had = nodeAt(p.x, p.z); if (had) had.y = y; else nodeH.push({ x: p.x, z: p.z, y }); } });
  let li = -1;
  for (const sh of shape) {
    li++; if (!sh) continue;
    const lift = 0.1 + (li % 8) * 0.004; // ленты пересекающихся дорожек — на разной высоте (±3 см), иначе на стыках z-fighting
    const { curve, L, n, ds, pts } = sh; const t = pts.map((p) => sample(p.x, p.z));
    const w = Math.round(SMOOTH / ds); const gp = t.map((_, i) => { let a = 0, c = 0; for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j <= n) { a += t[j]; c++; } } return a / c; });
    gp[0] = padEnd[li][0] ?? t[0]; gp[n] = padEnd[li][1] ?? t[n]; // концы — на отметках площадок/дорог, куда дорожка приходит
    const pin = new Uint8Array(n + 1); pin[0] = pin[n] = 1;
    { const land: { i: number; y: number; k: number }[] = [];
      const tan = (o: NonNullable<typeof sh>, i: number): [number, number] => { const a = o.pts[Math.max(0, i - 1)], b = o.pts[Math.min(o.n, i + 1)]; const d = Math.hypot(b.x - a.x, b.z - a.z) || 1; return [(b.x - a.x) / d, (b.z - a.z) / d]; };
      const near = (o: NonNullable<typeof sh>, x: number, z: number) => { let bi = -1, bd = NODE; for (let i = 0; i <= o.n; i++) { const d = Math.hypot(o.pts[i].x - x, o.pts[i].z - z); if (d < bd) { bd = d; bi = i; } } return bi; };
      // длина площадки вдоль дорожки зависит от угла примыкания: чем острее, тем дальше тянется чужое полотно
      const keep = (a: [number, number], b: [number, number]) => { const sin = Math.abs(a[0] * b[1] - a[1] * b[0]), cos = Math.abs(a[0] * b[0] + a[1] * b[1]); return sin < 0.5 ? KEEP : Math.max(KEEP, Math.min(2 * KEEP, (width / 2 + (width + 0.4) / 2 * cos) / sin + 0.2)); };
      for (const e of [0, n]) { const p = pts[e]; let k = 0; shape.forEach((o, oi) => { if (!o || oi === li) return; const j = near(o, p.x, p.z); if (j >= 0) k = Math.max(k, keep(tan(sh, e), tan(o, j))); }); if (k) land.push({ i: e, y: nodeAt(p.x, p.z)?.y ?? gp[e], k }); }
      shape.forEach((o, oi) => { if (!o || oi === li) return; for (const e of [0, o.n]) { const q = o.pts[e]; const i = near(sh, q.x, q.z); if (i <= 0 || i >= n) continue; const k = keep(tan(sh, i), tan(o, e)); const had = land.find((a) => Math.abs(a.i - i) * ds < KEEP); if (had) had.k = Math.max(had.k, k); else land.push({ i, y: nodeAt(q.x, q.z)?.y ?? gp[i], k }); } });
      if (land.length) {
        const total = land.reduce((a, b) => a + (b.i > 0 && b.i < n ? 2 * b.k : b.k), 0); const f = Math.max(0, Math.min(1, (L - Math.abs(gp[n] - gp[0]) / SLOPE_STAIR) / total));
        // хвостик короче площадки с лестницей (1,5 м к газону у виллы 2.3): ступени встали бы прямо в стыке —
        // делаем его ровным карманом на отметке стыка
        const flat = f < 0.6 && land.length === 1 && (land[0].i === 0 || land[0].i === n);
        for (const a of land) { for (let i = 0; i <= n; i++) if (flat || i === a.i || Math.abs(i - a.i) * ds <= a.k * f + 1e-6) { gp[i] = a.y; pin[i] = 1; } if (!nodeAt(pts[a.i].x, pts[a.i].z)) nodeH.push({ x: pts[a.i].x, z: pts[a.i].z, y: a.y }); }
      } }
    // ограничитель уклона: закреплённые точки (концы и площадки стыков) не двигаются, остальные подтягиваются к ним
    { const md = SLOPE_MAX * ds; const pins: number[] = []; for (let i = 0; i <= n; i++) if (pin[i]) pins.push(i);
      for (let i = 0; i <= n; i++) { if (pin[i]) continue; let lo = -Infinity, hi = Infinity; for (const j of pins) { const d = Math.abs(i - j) * md; lo = Math.max(lo, gp[j] - d); hi = Math.min(hi, gp[j] + d); } gp[i] = Math.max(lo, Math.min(hi, gp[i])); }
      for (let i = 1; i <= n; i++) if (!pin[i]) gp[i] = Math.max(gp[i - 1] - md, Math.min(gp[i - 1] + md, gp[i]));
      for (let i = n - 1; i >= 0; i--) if (!pin[i]) gp[i] = Math.max(gp[i + 1] - md, Math.min(gp[i + 1] + md, gp[i])); }
    // лестничные марши: подряд идущие участки круче SLOPE_WALK одного знака
    const flightsS: [number, number][] = []; // диапазоны маршей по длине (м) — лента дорожки там не рисуется
    let i = 1;
    while (i <= n) {
      const sl = (gp[i] - gp[i - 1]) / ds;
      if (Math.abs(sl) <= SLOPE_WALK) { i++; continue; }
      const sign = Math.sign(sl); let j = i;
      while (j <= n && Math.sign(gp[j] - gp[j - 1]) === sign && Math.abs(gp[j] - gp[j - 1]) / ds > SLOPE_WALK) j++;
      const a = i - 1, b = j - 1; const dh = gp[b] - gp[a], len = (b - a) * ds;
      if (Math.abs(dh) >= 0.3 && len >= 0.9) {
        const ns = Math.max(2, Math.round(Math.abs(dh) / RISER)); const tread = len / ns, riser = dh / ns; flights++; flightsS.push([a * ds, b * ds]);
        const side = (s0: number) => { const u = Math.min(1, s0 / L); const p = curve.getPointAt(u), tg = curve.getTangentAt(u); const dl = Math.hypot(tg.x, tg.z) || 1; const nx0 = -tg.z / dl, nz0 = tg.x / dl; const w2 = (width + 0.4) / 2; return { p, t: [tg.x / dl, tg.z / dl] as [number, number], L: [p.x - nx0 * w2, p.z - nz0 * w2] as [number, number], R: [p.x + nx0 * w2, p.z + nz0 * w2] as [number, number] }; };
        for (let k = 0; k < ns; k++) {
          const sA = a * ds + k * tread, sB = sA + tread; const A = side(sA), B = side(sB);
          const gA = gp[a] + k * riser, gB = gp[a] + (k + 1) * riser; const top = Math.max(gA, gB) + 0.1; // верх ступени — высокий край, вровень с лентой дорожки на концах марша
          steps.push({ line: li, x: (A.p.x + B.p.x) / 2, z: (A.p.z + B.p.z) / 2, dir: B.t, len: tread, width: width + 0.4, top, base: Math.min(gA, gB) - 0.35, c: [A.L, A.R, B.R, B.L] });
        }
      }
      i = Math.max(j, i + 1);
    }
    // лента дорожки по своему профилю: ровная поперёк (без крена на косогоре), на +10 см над профилем
    { const P: number[] = [], U: number[] = [], Nn: number[] = [], idx: number[] = []; let v = 0;
      let prevIdx = -1; // индекс предыдущей добавленной пары вершин (лента рвётся на маршах — там ступени)
      for (let s = 0; s <= n; s++) {
        const sm = s * ds; const inFlight = flightsS.some(([f0, f1]) => sm > f0 + 0.01 && sm < f1 - 0.01);
        if (inFlight) { prevIdx = -1; continue; }
        const p = pts[s]; const tg = curve.getTangentAt(Math.min(1, sm / L)); const tl = Math.hypot(tg.x, tg.z) || 1; const sx = (-tg.z / tl) * width / 2, sz = (tg.x / tl) * width / 2;
        if (s) v += ds / width;
        const cur = P.length / 3;
        P.push(p.x - sx, gp[s] + lift, p.z - sz, p.x + sx, gp[s] + lift, p.z + sz); U.push(0, v, 1, v); Nn.push(0, 1, 0, 0, 1, 0);
        if (prevIdx >= 0) { idx.push(prevIdx, prevIdx + 1, cur, prevIdx + 1, cur + 1, cur);
          // складка: на крутом повороте внутренняя кромка ленты идёт назад — лента сминается (проверяется автотестом)
          for (const o of [0, 3]) if ((P[cur * 3 + o] - P[prevIdx * 3 + o]) * tg.x + (P[cur * 3 + o + 2] - P[prevIdx * 3 + o + 2]) * tg.z < 0) { folds++; break; } }
        prevIdx = cur;
      }
      const rg = new BufferGeometry(); rg.setAttribute('position', new Float32BufferAttribute(P, 3)); rg.setAttribute('uv', new Float32BufferAttribute(U, 2)); rg.setAttribute('normal', new Float32BufferAttribute(Nn, 3)); rg.setIndex(idx); ribbons.push(rg); }
    // коридор: каждой клетке — отметка ближайшей точки оси
    // Внутри одной дорожки клетка берёт отметку именно ближайшей точки оси. Раньше бралась самая низкая из точек в
    // радиусе 1,85 м: под маршем земля ложилась на уровень его низа, и мощение дома у верха ответвления висело над ней.
    const R = HALF + 0.35; const own = new Map<number, [number, number]>();
    for (let s = 0; s <= n; s++) {
      const p = pts[s];
      const i0 = Math.max(0, Math.floor((p.x - R - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((p.x + R - x0) / step));
      const j0 = Math.max(0, Math.floor((p.z - R - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((p.z + R - z0) / step));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const k = j * nx + ii; const d = Math.hypot(x0 + ii * step - p.x, z0 + j * step - p.z);
        if (d <= R) { const e = own.get(k); if (!e || d < e[0]) own.set(k, [d, gp[s] + LIFT]); }
      }
    }
    for (const [k, [d, v]] of own) { if (best[k] === Infinity) ht[k] = v; else ht[k] = Math.min(ht[k], v); best[k] = Math.min(best[k], d); } // на пересечениях дорожек — ниже из двух: обе ленты над землёй
  }
  // зафиксированные клетки (площадки у двери магазина, кромки площадок домов) коридор тоже срезает, если они выше профиля —
  // иначе газон торчит сквозь ленту; ниже профиля — оставляем (лента их накрывает)
  for (let k = 0; k < N; k++) { if (best[k] <= HALF && (!fixed[k] || h[k] > ht[k] + 0.08)) { fx[k] = 1; corridor[k] = 1; } else if (best[k] <= HALF) ht[k] = h[k]; else if (best[k] < Infinity) ht[k] = h[k]; }
  return { fixed: fx, h: ht, steps, flights, folds, corridor, ribbons };
}

/** Ступени: каменные плиты стопкой; верх каждой — её высокий край, низ заглублён в пандус. */
export function stepGeometry(steps: Step[]): BufferGeometry | null {
  const T: Tri = { P: [], U: [] };
  for (const s of steps) {
    const [c0, c1, c2, c3] = s.c; const at = (c: [number, number], y: number) => [c[0], y, c[1]];
    hexa(T, [at(c0, s.base), at(c1, s.base), at(c2, s.base), at(c3, s.base)], [at(c0, s.top), at(c1, s.top), at(c2, s.top), at(c3, s.top)]);
  }
  return finish(T);
}
