// Террасирование склонов. Где уклон сглаженного газона круче SLOPE_MAX, склон разбивается на уступы подпорными
// стенками из бута по горизонталям, а на пересечении стенки с дорожкой ставится лестница (подступёнок 15 см,
// проступь 30 см, щёки из того же камня). Инженерная логика:
//  • газон круче 1:3 не косится и сползает в муссон — такие участки террасируем;
//  • стенка до WALL_MAX = 1,2 м — гравитационная, из местного камня (гранитный бут / латерит), без расчёта
//    и армирования; выше — разбиваем перепад на несколько стенок;
//  • между стенками остаётся полка с остаточным уклоном (стенка берёт ~80 % перепада) — водоотвод с полки;
//  • стенка «растворяется» в газоне на концах (высота сходит к нулю за TAPER м), а у лестницы — полная высота.
// Пятно домов, вода и дальние окрестности не трогаются; дорожки проходят через разрывы стенок по лестницам.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { PathNet } from './Paths';

export type Grid = { h: Float32Array; x0: number; z0: number; step: number; nx: number; nz: number };
export type Wall = { pts: [number, number][]; level: number; hw: number; taper: [number, number]; low: 1 | -1 }; // taper: длина сведения высоты к нулю на концах, м (0 — без) // low: сторона нижнего газона относительно хода полилинии (+1 = слева)
export type Stair = { x: number; z: number; dir: [number, number]; level: number; hw: number; run: number; width: number }; // x,z — верхняя кромка (линия стенки), dir — вниз по склону
export type Terraces = { walls: Wall[]; stairs: Stair[]; fixed: Uint8Array; mask: Uint8Array; h: Float32Array; shift: Float32Array; blobs: number }; // shift: сдвиг вершин сетки (x,z) к граням стенок

export const SLOPE_MAX = 0.30; // круче 1:3,3 — террасируем
export const WALL_MAX = 1.3;   // м, гравитационная стенка без расчёта
export const WALL_T = 0.7;     // толщина стенки (гравитационная, бут)
export const STAIR_W = 3.0;    // ширина лестницы (дорожка 2,6 м)
const RISER = 0.15, TAPER = 3.0, TAPER_CUT = 1.5, MIN_CELLS = 80, MIN_LEN = 4.0, GAP = STAIR_W / 2 + 0.5;

function hAt(g: Grid, x: number, z: number): number { const i = Math.max(0, Math.min(g.nx - 1, Math.round((x - g.x0) / g.step))), j = Math.max(0, Math.min(g.nz - 1, Math.round((z - g.z0) / g.step))); return g.h[j * g.nx + i]; }

/** Ближайший отрезок дорожки: направление и расстояние. */
function nearestPath(net: PathNet, x: number, z: number): { d: number; dir: [number, number] } {
  let best = Infinity, dir: [number, number] = [1, 0];
  for (const l of net.lines) for (let i = 0; i < l.length - 1; i++) {
    const a = l[i], b = l[i + 1]; const dx = b.x - a.x, dz = b.z - a.z; const L2 = dx * dx + dz * dz; if (L2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const px = a.x + t * dx - x, pz = a.z + t * dz - z; const d2 = px * px + pz * pz;
    if (d2 < best) { best = d2; const L = Math.sqrt(L2); dir = [dx / L, dz / L]; }
  }
  return { d: Math.sqrt(best), dir };
}

/** Горизонтали уровня level внутри маски (marching squares по квадратам сетки, концы сшиты по рёбрам). */
function contours(g: Grid, mask: Uint8Array, level: number): [number, number][][] {
  const { h, x0, z0, step, nx, nz } = g;
  // ключ ребра: горизонтальное (i,j)-(i+1,j) → 2*(j*nx+i), вертикальное (i,j)-(i,j+1) → 2*(j*nx+i)+1
  const pt = new Map<number, [number, number]>(); const adj = new Map<number, number[]>();
  const edgePt = (key: number, ka: number, kb: number, xa: number, za: number, xb: number, zb: number) => {
    if (!pt.has(key)) { const t = (level - h[ka]) / (h[kb] - h[ka] || 1e-9); pt.set(key, [xa + (xb - xa) * t, za + (zb - za) * t]); }
    return key;
  };
  const link = (a: number, b: number) => { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k00 = j * nx + i, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
    if (!mask[k00] || !mask[k10] || !mask[k01] || !mask[k11]) continue;
    const c = (h[k00] >= level ? 1 : 0) | (h[k10] >= level ? 2 : 0) | (h[k11] >= level ? 4 : 0) | (h[k01] >= level ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const x = x0 + i * step, z = z0 + j * step;
    const eB = () => edgePt(2 * k00, k00, k10, x, z, x + step, z);           // нижнее ребро (j)
    const eT = () => edgePt(2 * k01, k01, k11, x, z + step, x + step, z + step); // верхнее ребро (j+1)
    const eL = () => edgePt(2 * k00 + 1, k00, k01, x, z, x, z + step);       // левое ребро (i)
    const eR = () => edgePt(2 * k10 + 1, k10, k11, x + step, z, x + step, z + step); // правое ребро (i+1)
    switch (c) {
      case 1: case 14: link(eL(), eB()); break;
      case 2: case 13: link(eB(), eR()); break;
      case 3: case 12: link(eL(), eR()); break;
      case 4: case 11: link(eR(), eT()); break;
      case 6: case 9: link(eB(), eT()); break;
      case 7: case 8: link(eL(), eT()); break;
      case 5: link(eL(), eB()); link(eR(), eT()); break; // седло — две дуги
      case 10: link(eB(), eR()); link(eL(), eT()); break;
    }
  }
  // сшивка в полилинии
  const used = new Set<number>(); const out: [number, number][][] = [];
  const walk = (start: number) => {
    const line: number[] = [start]; used.add(start); let cur = start, prev = -1;
    for (;;) { const nb = (adj.get(cur) ?? []).filter((n) => n !== prev && !used.has(n)); if (!nb.length) break; prev = cur; cur = nb[0]; used.add(cur); line.push(cur); }
    return line;
  };
  for (const [key, nb] of adj) { if (used.has(key) || nb.length !== 1) continue; out.push(walk(key).map((k) => pt.get(k)!)); } // сначала открытые дуги с концов
  for (const key of adj.keys()) { if (used.has(key)) continue; const line = walk(key); line.push(line[0]); out.push(line.map((k) => pt.get(k)!)); } // замкнутые
  return out;
}

function lineLength(p: [number, number][]) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
function smooth(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p; const q = p.map((v) => [v[0], v[1]] as [number, number]);
  for (let i = 1; i < p.length - 1; i++) { q[i][0] = (p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4; q[i][1] = (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4; }
  return q;
}

/** План террас: стенки, лестницы, зафиксированные клетки и их отметки для повторной релаксации газона. */
export function planTerraces(g: Grid, fixed: Uint8Array, skip: (x: number, z: number) => boolean, net: PathNet, withStairs = true): Terraces {
  const { h, x0, z0, step, nx, nz } = g; const N = nx * nz;
  // 1) уклон (центральные разности), сглаженный 3×3; крутые клетки вне площадок, воды и за границей
  const grad = new Float32Array(N);
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; grad[k] = Math.hypot((h[k + 1] - h[k - 1]) / (2 * step), (h[k + nx] - h[k - nx]) / (2 * step)); }
  const steep = new Uint8Array(N);
  for (let j = 2; j < nz - 2; j++) for (let i = 2; i < nx - 2; i++) {
    const k = j * nx + i; let a = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) a += grad[k + dj * nx + di];
    if (a / 9 > SLOPE_MAX && !fixed[k] && !skip(x0 + i * step, z0 + j * step)) steep[k] = 1;
  }
  // морфологическое замыкание (1 клетка): узкие щели между крутыми клетками закрываются
  const dil = new Uint8Array(N), clo = new Uint8Array(N);
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; dil[k] = steep[k] || steep[k - 1] || steep[k + 1] || steep[k - nx] || steep[k + nx] ? 1 : 0; }
  for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const k = j * nx + i; clo[k] = dil[k] && dil[k - 1] && dil[k + 1] && dil[k - nx] && dil[k + nx] ? 1 : 0; if (fixed[k]) clo[k] = 0; }
  // 2) связные пятна
  const comp = new Int32Array(N).fill(-1); const blobs: { cells: number[]; lo: number; hi: number }[] = [];
  for (let s = 0; s < N; s++) {
    if (!clo[s] || comp[s] >= 0) continue;
    const cells: number[] = [s]; comp[s] = blobs.length;
    for (let q = 0; q < cells.length; q++) {
      const k = cells[q]; const i = k % nx;
      for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) { if (n < 0 || n >= N || !clo[n] || comp[n] >= 0) continue; comp[n] = blobs.length; cells.push(n); }
    }
    if (cells.length < MIN_CELLS) { for (const k of cells) comp[k] = -2; continue; }
    const hs = cells.map((k) => h[k]).sort((a, b) => a - b); const lo = hs[Math.floor(hs.length * 0.03)], hi = hs[Math.floor(hs.length * 0.97)];
    blobs.push({ cells, lo, hi });
  }
  // 3) горизонтали внутри каждого пятна (+1 клетка запаса), уровни — равномерно по перепаду, стенка ≤ WALL_MAX
  const walls: Wall[] = []; const stairs: Stair[] = [];
  const mask = new Uint8Array(N);
  blobs.forEach((b, bi) => {
    mask.fill(0);
    for (const k of b.cells) { const i = k % nx; mask[k] = 1; if (i > 0) mask[k - 1] = 1; if (i < nx - 1) mask[k + 1] = 1; if (k >= nx) mask[k - nx] = 1; if (k + nx < N) mask[k + nx] = 1; }
    for (const k of b.cells) if (comp[k] !== bi) mask[k] = 0;
    const range = b.hi - b.lo; if (range < 0.7) return;
    const n = Math.max(1, Math.round(range / 1.7)); const DH = range / n; const hw = Math.min(WALL_MAX, 0.8 * DH); // ярусы ~1,7 м: стенка 1,3 м + остаточный уклон полки
    for (let q = 0; q < n; q++) {
      const level = b.lo + (q + 0.5) * DH;
      for (const raw of contours(g, mask, level)) {
        const line = smooth(raw); if (lineLength(line) < MIN_LEN) continue;
        // сторона нижнего газона относительно хода линии
        let low: 1 | -1 = 1;
        { const m = Math.floor(line.length / 2); const a = line[Math.max(0, m - 1)], c = line[Math.min(line.length - 1, m + 1)]; const tx = c[0] - a[0], tz = c[1] - a[1]; const L = Math.hypot(tx, tz) || 1; const nxv = -tz / L, nzv = tx / L; low = hAt(g, line[m][0] + nxv, line[m][1] + nzv) < hAt(g, line[m][0] - nxv, line[m][1] - nzv) ? 1 : -1; }
        // разрезка по дорожкам: участки ближе GAP к дорожке выпадают, в середине разрыва — лестница
        const near = line.map(([x, z]) => nearestPath(net, x, z));
        let i = 0;
        while (i < line.length) {
          if (near[i].d < GAP) { // разрыв
            let j = i; let best = i; while (j < line.length && near[j].d < GAP) { if (near[j].d < near[best].d) best = j; j++; }
            const gapLen = lineLength(line.slice(i, j));
            if (withStairs && gapLen < 7 && near[best].d < 1.5) {
              const [x, z] = line[best]; let [dx, dz] = near[best].dir;
              if (hAt(g, x + dx * 1.5, z + dz * 1.5) > hAt(g, x - dx * 1.5, z - dz * 1.5)) { dx = -dx; dz = -dz; }
              stairs.push({ x, z, dir: [dx, dz], level, hw, run: 2 * hw, width: STAIR_W });
            }
            i = j; continue;
          }
          let j = i; while (j < line.length && near[j].d >= GAP) j++;
          const seg = line.slice(i, j);
          if (lineLength(seg) >= 2.5) walls.push({ pts: seg, level, hw, taper: [i === 0 ? TAPER : TAPER_CUT, j === line.length ? TAPER : TAPER_CUT], low }); // у дорожки стенка сходит на нет за 1,5 м
          i = j;
        }
      }
    }
  });
  // 4) растеризация: полосы по обе стороны стенки на отметках верха/низа, лестницы — пандус 1:2 под ступенями
  const fixedT = Uint8Array.from(fixed), ht = Float32Array.from(h), wmask = new Uint8Array(N), shift = new Float32Array(N * 2);
  const cellsNear = (ax: number, az: number, bx: number, bz: number, R: number, fn: (k: number, x: number, z: number, t: number, d: number) => void) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + R - x0) / step));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + R - z0) / step));
    const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = x0 + i * step, z = z0 + j * step; const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      const d = Math.hypot(ax + t * dx - x, az + t * dz - z); if (d <= R) fn(j * nx + i, x, z, t, d);
    }
  };
  for (const w of walls) {
    const cum = [0]; for (let i = 1; i < w.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
    const total = cum[cum.length - 1];
    const hwAt = (s: number) => w.hw * Math.min(1, w.taper[0] ? s / w.taper[0] : 1, w.taper[1] ? (total - s) / w.taper[1] : 1);
    for (let i = 1; i < w.pts.length; i++) {
      const [ax, az] = w.pts[i - 1], [bx, bz] = w.pts[i];
      const tx = bx - ax, tz = bz - az; const L = Math.hypot(tx, tz) || 1; const nlx = (-tz / L) * w.low, nlz = (tx / L) * w.low; // нормаль к нижнему газону
      cellsNear(ax, az, bx, bz, 0.9, (k, x, z, t, d) => {
        wmask[k] = 1; if (d > 0.75 || fixed[k]) return;
        const s = cum[i - 1] + t * (cum[i] - cum[i - 1]); const side = (x - ax) * nlx + (z - az) * nlz > 0 ? -1 : 1;
        ht[k] = w.level + side * hwAt(s) / 2; fixedT[k] = 1;
        // вершина сетки прижимается к грани стенки со своей стороны — уступ рельефа совпадает со стенкой, без клиньев газона
        const qx = ax + t * tx, qz = az + t * tz; const sx = qx - nlx * side * WALL_T / 2 - x, sz = qz - nlz * side * WALL_T / 2 - z;
        if (Math.hypot(sx, sz) <= 0.6) { shift[k * 2] = sx; shift[k * 2 + 1] = sz; }
      });
    }
  }
  for (const s of stairs) {
    const [dx, dz] = s.dir; const lx = -dz, lz = dx; const R = s.width / 2 + 0.3;
    const ex = s.x + dx * (s.run + 1.5), ez = s.z + dz * (s.run + 1.5), sx = s.x - dx * 0.4, sz = s.z - dz * 0.4;
    cellsNear(sx, sz, ex, ez, R, (k, x, z) => {
      const along = (x - s.x) * dx + (z - s.z) * dz, lat = Math.abs((x - s.x) * lx + (z - s.z) * lz); if (lat > R || fixed[k]) return;
      const u = Math.max(0, Math.min(1, along / s.run)); const sink = along < 0 ? 0 : along < s.run ? 0.08 : 0.08 * Math.max(0, 1 - (along - s.run) / 1.5);
      ht[k] = s.level + s.hw / 2 - s.hw * u - sink; fixedT[k] = 1; wmask[k] = 1; shift[k * 2] = 0; shift[k * 2 + 1] = 0;
    });
  }
  return { walls, stairs, fixed: fixedT, mask: wmask, h: ht, shift, blobs: blobs.length };
}

// ——— геометрия ———
export type Tri = { P: number[]; U: number[] };
function quad(T: Tri, a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
  T.P.push(...a, ...b, ...c, ...a, ...c, ...d); T.U.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
}
export function finish(T: Tri): BufferGeometry | null {
  if (!T.P.length) return null;
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(T.P, 3)); g.setAttribute('uv', new Float32BufferAttribute(T.U, 2)); g.computeVertexNormals(); return g;
}
/** Параллелепипед по 8 углам: низ b0..b3 и верх t0..t3 (против часовой сверху), UV в метрах. */
export function hexa(T: Tri, b: number[][], t: number[][]) {
  // обход углов — против часовой при взгляде сверху (нормаль верха вверх); иначе переворачиваем порядок
  const ny = (t[1][0] - t[0][0]) * (t[2][2] - t[0][2]) - (t[1][2] - t[0][2]) * (t[2][0] - t[0][0]);
  if (ny > 0) { b = [b[0], b[3], b[2], b[1]]; t = [t[0], t[3], t[2], t[1]]; }
  const du = Math.hypot(t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]), dv = Math.hypot(t[3][0] - t[0][0], t[3][1] - t[0][1], t[3][2] - t[0][2]);
  quad(T, t[0], t[1], t[2], t[3], [0, 0], [du, 0], [du, dv], [0, dv]); // верх (UV в метрах)
  quad(T, b[0], b[3], b[2], b[1], [0, 0], [dv, 0], [dv, du], [0, du]); // низ
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; const L = Math.hypot(b[j][0] - b[i][0], b[j][2] - b[i][2]); quad(T, b[i], b[j], t[j], t[i], [0, b[i][1]], [L, b[j][1]], [L, t[j][1]], [0, t[i][1]]); }
}

/** Подпорные стенки: толщина WALL_T, лицо к нижнему газону, верх +0,08 над верхним газоном, низ заглублён на 0,6 м. */
export function wallGeometry(walls: Wall[]): BufferGeometry | null {
  const T: Tri = { P: [], U: [] };
  for (const w of walls) {
    const n = w.pts.length; if (n < 2) continue;
    const cum = [0]; for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
    const total = cum[n - 1];
    const hwAt = (s: number) => w.hw * Math.min(1, w.taper[0] ? s / w.taper[0] : 1, w.taper[1] ? (total - s) / w.taper[1] : 1);
    const F: number[][] = [], B: number[][] = [], yT: number[] = [], yB: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = w.pts[Math.max(0, i - 1)], c = w.pts[Math.min(n - 1, i + 1)]; const tx = c[0] - a[0], tz = c[1] - a[1]; const L = Math.hypot(tx, tz) || 1;
      const nxv = (-tz / L) * w.low, nzv = (tx / L) * w.low; // нормаль к нижнему газону
      const hw = hwAt(cum[i]); yT.push(w.level + hw / 2 + 0.08); yB.push(w.level - hw / 2 - 0.6);
      F.push([w.pts[i][0] + nxv * WALL_T / 2, 0, w.pts[i][1] + nzv * WALL_T / 2]); B.push([w.pts[i][0] - nxv * WALL_T / 2, 0, w.pts[i][1] - nzv * WALL_T / 2]);
    }
    const at = (p: number[], y: number) => [p[0], y, p[2]];
    for (let i = 1; i < n; i++) {
      const u0 = cum[i - 1], u1 = cum[i];
      quad(T, at(F[i - 1], yB[i - 1]), at(F[i], yB[i]), at(F[i], yT[i]), at(F[i - 1], yT[i - 1]), [u0, yB[i - 1]], [u1, yB[i]], [u1, yT[i]], [u0, yT[i - 1]]); // лицо
      quad(T, at(B[i], yB[i]), at(B[i - 1], yB[i - 1]), at(B[i - 1], yT[i - 1]), at(B[i], yT[i]), [u1, yB[i]], [u0, yB[i - 1]], [u0, yT[i - 1]], [u1, yT[i]]); // тыл
      quad(T, at(F[i - 1], yT[i - 1]), at(F[i], yT[i]), at(B[i], yT[i]), at(B[i - 1], yT[i - 1]), [u0, 0], [u1, 0], [u1, WALL_T], [u0, WALL_T]); // верх
    }
    quad(T, at(B[0], yB[0]), at(F[0], yB[0]), at(F[0], yT[0]), at(B[0], yT[0]), [0, yB[0]], [WALL_T, yB[0]], [WALL_T, yT[0]], [0, yT[0]]); // торцы
    quad(T, at(F[n - 1], yB[n - 1]), at(B[n - 1], yB[n - 1]), at(B[n - 1], yT[n - 1]), at(F[n - 1], yT[n - 1]), [0, yB[n - 1]], [WALL_T, yB[n - 1]], [WALL_T, yT[n - 1]], [0, yT[n - 1]]);
  }
  return finish(T);
}

/** Лестницы: ступени (каменные плиты, стопкой) и боковые щёки из бута. */
export function stairGeometry(stairs: Stair[]): { treads: BufferGeometry | null; cheeks: BufferGeometry | null } {
  const TT: Tri = { P: [], U: [] }, TC: Tri = { P: [], U: [] };
  for (const s of stairs) {
    const [dx, dz] = s.dir; const lx = -dz, lz = dx; const w2 = s.width / 2;
    const P = (a: number, l: number, y: number) => [s.x + dx * a + lx * l, y, s.z + dz * a + lz * l];
    const n = Math.max(2, Math.round(s.hw / RISER)); const r = s.hw / n, t = s.run / n; const base = s.level - s.hw / 2 - 0.35;
    for (let k = 0; k < n; k++) {
      const yk = s.level - s.hw / 2 + (k + 1) * r, a1 = s.run - k * t;
      hexa(TT, [P(0, -w2, base), P(a1, -w2, base), P(a1, w2, base), P(0, w2, base)], [P(0, -w2, yk), P(a1, -w2, yk), P(a1, w2, yk), P(0, w2, yk)]);
    }
    const yTop = s.level + s.hw / 2 + 0.3, yBot = s.level - s.hw / 2 + 0.3;
    for (const sd of [-1, 1]) {
      const l0 = sd * w2, l1 = sd * (w2 + 0.3);
      hexa(TC, [P(-0.3, l0, base), P(s.run + 0.3, l0, base), P(s.run + 0.3, l1, base), P(-0.3, l1, base)], [P(-0.3, l0, yTop), P(s.run + 0.3, l0, yBot), P(s.run + 0.3, l1, yBot), P(-0.3, l1, yTop)]);
    }
  }
  return { treads: finish(TT), cheeks: finish(TC) };
}
