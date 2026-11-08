// Маска «внутри дома» по планам этажей: стены (wallPolys) и стеклянные стены модели растеризуются на сетке 0,1 м,
// расширяются на 0,5 м (закрывают дверные проёмы), снаружи пускается заливка; всё, куда заливка не дошла, после
// обратного сужения на 0,5 м — интерьер вместе со стенами до наружной грани. Объединение по всем уровням; для каждой
// клетки запоминается нижний уровень пола. «Green zone» (посадки внутри пятна дома) из маски исключаются.
// Применение: рельеф участка внутри маски не рисуется (discard в шейдере) и не засевается травой, а в глубине
// (≥ 0,5 м от грани) опущен на 5 см ниже пола — у наружных стен газон остаётся на отметке площадки до самой грани.
import type { Box3 } from 'three';
import type { Plan } from '../plan';

export type IndoorMask = { data: Uint8Array; floor: Float32Array; green: Uint8Array; greenFloor: Float32Array; x0: number; z0: number; step: number; nx: number; nz: number }; // green: посадки внутри пятна — газон на отметке своего уровня
const STEP = 0.1, GROW = 0.5;

export function buildIndoor(plan: Plan, glass: Box3[]): IndoorMask {
  const [bx0, bz0, bx1, bz1] = plan.bbox; const x0 = bx0 - 1.5, z0 = bz0 - 1.5;
  const nx = Math.ceil((bx1 + 1.5 - x0) / STEP) + 1, nz = Math.ceil((bz1 + 1.5 - z0) / STEP) + 1; const N = nx * nz;
  const data = new Uint8Array(N), floor = new Float32Array(N).fill(Infinity), green = new Uint8Array(N), greenFloor = new Float32Array(N).fill(Infinity);
  const g = Math.round(GROW / STEP);
  const dilate = (src: Uint8Array) => { const out = new Uint8Array(N); for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { if (!src[j * nx + i]) continue; for (let dj = -g; dj <= g; dj++) for (let di = -g; di <= g; di++) { if (di * di + dj * dj > g * g) continue; const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) out[jj * nx + ii] = 1; } } return out; };
  const erode = (src: Uint8Array) => { const inv = new Uint8Array(N); for (let k = 0; k < N; k++) inv[k] = src[k] ? 0 : 1; const d = dilate(inv); const out = new Uint8Array(N); for (let k = 0; k < N; k++) out[k] = d[k] ? 0 : 1; return out; };
  for (const l of plan.levels) {
    const wall = new Uint8Array(N);
    const rect = (ax: number, az: number, bx: number, bz: number) => {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - x0) / STEP)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) - x0) / STEP));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - z0) / STEP)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) - z0) / STEP));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) wall[j * nx + i] = 1;
    };
    for (const poly of l.wallPolys ?? []) { let ax = Infinity, az = Infinity, bx = -Infinity, bz = -Infinity; for (let k = 0; k < poly.length; k += 2) { ax = Math.min(ax, poly[k]); bx = Math.max(bx, poly[k]); az = Math.min(az, poly[k + 1]); bz = Math.max(bz, poly[k + 1]); } rect(ax, az, bx, bz); }
    if (!(l.wallPolys ?? []).length) for (const [x1, z1, x2, z2] of l.walls) rect(Math.min(x1, x2) - 0.12, Math.min(z1, z2) - 0.12, Math.max(x1, x2) + 0.12, Math.max(z1, z2) + 0.12);
    for (const b of glass) if (b.max.y > l.level + 0.5 && b.min.y < l.level + 2.4) rect(b.min.x, b.min.z, b.max.x, b.max.z);
    const big = dilate(wall);
    // заливка снаружи
    const reached = new Uint8Array(N); const q: number[] = [];
    for (let i = 0; i < nx; i++) { q.push(i, (nz - 1) * nx + i); } for (let j = 0; j < nz; j++) { q.push(j * nx, j * nx + nx - 1); }
    for (const k of q) if (!big[k]) reached[k] = 1;
    for (let qi = 0; qi < q.length; qi++) { const k = q[qi]; if (!reached[k]) continue; const i = k % nx; for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) { if (n < 0 || n >= N || reached[n] || big[n]) continue; reached[n] = 1; q.push(n); } }
    const inside = new Uint8Array(N); for (let k = 0; k < N; k++) inside[k] = reached[k] ? 0 : 1;
    const lvl = erode(inside);
    // зелёные зоны внутри пятна — не интерьер (газон на отметке пола)
    for (const r of l.rooms) if (/green/i.test(r.name) && r.area) { const hh = Math.sqrt(r.area) / 2 * 1.05; const i0 = Math.max(0, Math.floor((r.x - hh - x0) / STEP)), i1 = Math.min(nx - 1, Math.ceil((r.x + hh - x0) / STEP)), j0 = Math.max(0, Math.floor((r.z - hh - z0) / STEP)), j1 = Math.min(nz - 1, Math.ceil((r.z + hh - z0) / STEP)); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { lvl[j * nx + i] = 0; green[j * nx + i] = 1; greenFloor[j * nx + i] = Math.min(greenFloor[j * nx + i], l.level); } }
    for (let k = 0; k < N; k++) if (lvl[k]) { data[k] = 1; floor[k] = Math.min(floor[k], l.level); }
  }
  return { data, floor, green, greenFloor, x0, z0, step: STEP, nx, nz };
}

/** Значение маски и пол в точке (локальные координаты плана); вне сетки — снаружи. */
export function indoorAt(m: IndoorMask, x: number, z: number): { inside: boolean; floor: number; green: boolean; greenFloor: number } {
  const i = Math.round((x - m.x0) / m.step), j = Math.round((z - m.z0) / m.step);
  if (i < 0 || j < 0 || i >= m.nx || j >= m.nz) return { inside: false, floor: NaN, green: false, greenFloor: NaN };
  const k = j * m.nx + i; return { inside: m.data[k] === 1, floor: m.floor[k], green: m.green[k] === 1, greenFloor: m.greenFloor[k] };
}
