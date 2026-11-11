// «Дизайнер» интерьеров: по планам этажей (public/plans/<villa>.json) и стеклу модели расставляет процедурную
// мебель (Furniture.ts) по правилам стайл-гайда: кровать изголовьем к глухой стене, диван лицом к остеклению,
// ничего в дверных проёмах. Результат — Group в координатах виллы (как в прогулке), 3 меша на виллу.
import { Box3, BufferGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type Texture } from 'three';
import type { Seg, Plan, PlanLevel } from '../plan';
import type { Passage } from '../models';
import { labelComponents } from '../materials';
import * as F from './Furniture';
import { onEve } from './DayTime';
import { applyDetailMaps, makeZelligeTexture, type DetailMaps } from './textures';
import { RepeatWrapping } from 'three';
let zellige: Texture | null = null;

type Rect = { x0: number; z0: number; x1: number; z1: number };
type Side = 'px' | 'nx' | 'pz' | 'nz';
type RoomInfo = { name: string; kind: Kind; y: number; rect: Rect; cx: number; cz: number; glass: Record<Side, number>; area: number | null; leaked?: boolean; label?: [number, number] }; // leaked: контур заливкой «утёк», взята коробка вокруг метки
type Kind = 'bedroom' | 'living' | 'dining' | 'bath' | 'wc' | 'laundry' | 'open' | 'terrace' | 'kitchen' | 'skip';

const SIDES: Side[] = ['px', 'nx', 'pz', 'nz'];
/** Нормаль стороны внутрь комнаты. */
const inward = (s: Side) => (s === 'px' ? new Vector3(-1, 0, 0) : s === 'nx' ? new Vector3(1, 0, 0) : s === 'pz' ? new Vector3(0, 0, -1) : new Vector3(0, 0, 1));
const opposite = (s: Side): Side => (s === 'px' ? 'nx' : s === 'nx' ? 'px' : s === 'pz' ? 'nz' : 'pz');

function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (n.includes('bedroom')) return 'bedroom';
  if (n.includes('dining')) return 'dining';
  if (n.includes('recreation')) return 'living';
  if (n.includes('toilet & bath')) return 'bath';
  if (n.includes('toilet')) return 'wc'; // гостевой туалет: унитаз и умывальник, без ванны
  if (n.includes('laundry')) return 'laundry';
  if (n.includes('terrace') || n.includes('balcony')) return 'terrace';
  if (n.includes('kitchen')) return 'kitchen';
  return 'skip';
}

/** Границы комнаты заливкой по растру 0,2 м: стены (wallPolys), проёмы дверей и стеклянные стены — препятствия,
 *  для террас ещё и кромки плит; при открытой планировке разлив ограничен площадью комнаты из плана (×1,6). */
function floodGrid(l: PlanLevel, bbox: [number, number, number, number], glass: Box3[], passages: Passage[], terrace: boolean, thinDoors = false) {
  const S = 0.2; const gx0 = bbox[0] - 1, gz0 = bbox[1] - 1; const NX = Math.ceil((bbox[2] - bbox[0] + 2) / S), NZ = Math.ceil((bbox[3] - bbox[1] + 2) / S);
  const blocked = new Uint8Array(NX * NZ);
  const fillRect = (x0: number, z0: number, x1: number, z1: number) => {
    const i0 = Math.max(0, Math.floor((x0 - gx0) / S)), i1 = Math.min(NX - 1, Math.ceil((x1 - gx0) / S)), j0 = Math.max(0, Math.floor((z0 - gz0) / S)), j1 = Math.min(NZ - 1, Math.ceil((z1 - gz0) / S));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * NX + i] = 1;
  };
  for (const poly of l.wallPolys ?? []) { // стены — осевые прямоугольники: bbox полигона
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < poly.length; k += 2) { x0 = Math.min(x0, poly[k]); x1 = Math.max(x1, poly[k]); z0 = Math.min(z0, poly[k + 1]); z1 = Math.max(z1, poly[k + 1]); }
    fillRect(x0, z0, x1, z1);
  }
  for (const [x1, z1, x2, z2] of l.walls) fillRect(Math.min(x1, x2) - 0.05, Math.min(z1, z2) - 0.05, Math.max(x1, x2) + 0.05, Math.max(z1, z2) + 0.05);
  for (const p of passages) if (p.min[1] < l.level + 2.2 && p.max[1] > l.level + 0.2) {
    if (!thinDoors) { fillRect(p.min[0], p.min[2], p.max[0], p.max[2]); continue; }
    // тонкая полоса по оси стены (короткая сторона коробки проёма — поперёк стены): прямоугольник комнаты доходит до стены
    if (p.max[0] - p.min[0] <= p.max[2] - p.min[2]) { const m = (p.min[0] + p.max[0]) / 2; fillRect(m - 0.12, p.min[2], m + 0.12, p.max[2]); }
    else { const m = (p.min[2] + p.max[2]) / 2; fillRect(p.min[0], m - 0.12, p.max[0], m + 0.12); }
  }
  for (const b of glass) if (b.min.y < l.level + 2.6 && b.max.y > l.level + 0.4) fillRect(b.min.x - 0.08, b.min.z - 0.08, b.max.x + 0.08, b.max.z + 0.08);
  if (terrace) for (const [x1, z1, x2, z2] of l.slabs) fillRect(Math.min(x1, x2) - 0.05, Math.min(z1, z2) - 0.05, Math.max(x1, x2) + 0.05, Math.max(z1, z2) + 0.05);
  return { S, gx0, gz0, NX, NZ, blocked };
}
function roomRect(l: PlanLevel, bbox: [number, number, number, number], cx: number, cz: number, area: number | null, glass: Box3[], passages: Passage[], terrace: boolean): Rect {
  const { S, gx0, gz0, NX, NZ, blocked } = floodGrid(l, bbox, glass, passages, terrace);
  // старт: клетка марки или ближайшая свободная в радиусе 1,2 м
  const si = Math.round((cx - gx0) / S), sj = Math.round((cz - gz0) / S);
  let start = -1;
  for (let r = 0; r <= 6 && start < 0; r++) for (let dj = -r; dj <= r && start < 0; dj++) for (let di = -r; di <= r; di++) { const i = si + di, j = sj + dj; if (i >= 0 && j >= 0 && i < NX && j < NZ && !blocked[j * NX + i]) { start = j * NX + i; break; } }
  if (start < 0) return { x0: cx - 1.5, x1: cx + 1.5, z0: cz - 1.5, z1: cz + 1.5 };
  const limit = Math.ceil(((area && area > 3 ? area : 20) * 1.6) / (S * S));
  const seen = new Uint8Array(NX * NZ); const q = [start]; seen[start] = 1; let n = 0;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  while (q.length && n < limit) {
    const k = q.shift()!; n++; const i = k % NX, j = (k - i) / NX; const x = gx0 + i * S, z = gz0 + j * S;
    if (Math.hypot(x - cx, z - cz) > 9) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue; const kk = jj * NX + ii; if (seen[kk] || blocked[kk]) continue; seen[kk] = 1; q.push(kk); }
  }
  return { x0: x0 - S / 2, x1: x1 + S / 2, z0: z0 - S / 2, z1: z1 + S / 2 };
}

/** Открытая планировка (кухня-гостиная): заливка от метки без лимита площади и наибольший прямоугольник свободных
 *  клеток, содержащий метку. Проёмы дверей — тонкой полосой по оси стены. has(x,z) — точка в той же залитой области. */
function openRect(l: PlanLevel, bbox: [number, number, number, number], cx: number, cz: number, glass: Box3[], passages: Passage[]): { rect: Rect; has: (x: number, z: number) => boolean } | null {
  const { S, gx0, gz0, NX, NZ, blocked } = floodGrid(l, bbox, glass, passages, false, true);
  const si = Math.round((cx - gx0) / S), sj = Math.round((cz - gz0) / S);
  if (si < 0 || sj < 0 || si >= NX || sj >= NZ || blocked[sj * NX + si]) return null;
  const seen = new Uint8Array(NX * NZ); const q = [sj * NX + si]; seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!; const i = k % NX, j = (k - i) / NX;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue; const kk = jj * NX + ii; if (seen[kk] || blocked[kk] || Math.hypot((ii - si) * S, (jj - sj) * S) > 10) continue; seen[kk] = 1; q.push(kk); }
  }
  // наибольший прямоугольник с меткой внутри; допускается до 3 % незалитых клеток (но не больше 26, ≈1 м²): короткий
  // простенок-выступ (0,2 × 0,8 м у кухни вилл 2) не должен отрезать от комнаты метровую полосу. Перебор всех
  // прямоугольников в габарите заливки по таблице сумм — ~10⁶ вариантов.
  let mi0 = NX, mi1 = 0, mj0 = NZ, mj1 = 0; for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) if (seen[j * NX + i]) { mi0 = Math.min(mi0, i); mi1 = Math.max(mi1, i); mj0 = Math.min(mj0, j); mj1 = Math.max(mj1, j); }
  const SW = NX + 1; const sat = new Int32Array(SW * (NZ + 1)); // число незалитых клеток в [0,i)×[0,j)
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) sat[(j + 1) * SW + i + 1] = (seen[j * NX + i] ? 0 : 1) + sat[j * SW + i + 1] + sat[(j + 1) * SW + i] - sat[j * SW + i];
  const bad = (i0: number, j0: number, i1: number, j1: number) => sat[(j1 + 1) * SW + i1 + 1] - sat[j0 * SW + i1 + 1] - sat[(j1 + 1) * SW + i0] + sat[j0 * SW + i0];
  let best = 0, bi0 = si, bi1 = si, bj0 = sj, bj1 = sj;
  for (let j0 = mj0; j0 <= sj; j0++) for (let j1 = sj; j1 <= mj1; j1++) for (let i0 = mi0; i0 <= si; i0++) {
    if ((mi1 - i0 + 1) * (j1 - j0 + 1) <= best) break; // шире уже не станет
    for (let i1 = mi1; i1 >= si; i1--) {
      const a = (i1 - i0 + 1) * (j1 - j0 + 1); if (a <= best) break;
      if (bad(i0, j0, i1, j1) <= Math.min(26, a * 0.03)) { best = a; bi0 = i0; bi1 = i1; bj0 = j0; bj1 = j1; break; }
    }
  }
  const has = (x: number, z: number) => { const i = Math.round((x - gx0) / S), j = Math.round((z - gz0) / S); return i >= 0 && j >= 0 && i < NX && j < NZ && !!seen[j * NX + i]; };
  return { rect: { x0: gx0 + bi0 * S - S / 2, x1: gx0 + bi1 * S + S / 2, z0: gz0 + bj0 * S - S / 2, z1: gz0 + bj1 * S + S / 2 }, has };
}
type WallDist = (x: number, y: number, z: number, nx: number, nz: number) => number | null;
/** Контур комнаты — по растру 0,2 м, реальная стена бывает на 0,1–0,4 м дальше: мебель «у стены» стояла с зазором или
 *  не находила стену лучом. Каждая сторона сдвигается к стене модели: медиана расстояний пяти лучей (от точки в 0,5 м
 *  внутри контура), если стена в пределах −0,3…+0,5 м от контура и её видят хотя бы два луча. */
function snapRect(rect: Rect, y: number, dist: WallDist): Rect {
  const out = { ...rect };
  for (const s of SIDES) {
    const n = inward(s); const L = sideLen(rect, s); const gaps: number[] = [];
    for (const f of [0.15, 0.3, 0.5, 0.7, 0.85]) { const w = nearWall(rect, s, 0.5, (f - 0.5) * L); const d = dist(w.x, y, w.z, -n.x, -n.z); if (d !== null && d - 0.5 > -0.3 && d - 0.5 < 0.5) gaps.push(d - 0.5); }
    if (gaps.length < 2) continue; gaps.sort((a, b) => a - b); const g = gaps[gaps.length >> 1] - 0.02;
    if (s === 'px') out.x1 += g; else if (s === 'nx') out.x0 -= g; else if (s === 'pz') out.z1 += g; else out.z0 -= g;
  }
  return out;
}

/** Доля стороны, занятая стеклом (боксы компонентов стекла модели, координаты виллы). */
function glassOnSide(rect: Rect, y: number, side: Side, glass: Box3[]): number {
  const wallX = side === 'px' ? rect.x1 : side === 'nx' ? rect.x0 : null, wallZ = side === 'pz' ? rect.z1 : side === 'nz' ? rect.z0 : null;
  let covered = 0; const len = wallX !== null ? rect.z1 - rect.z0 : rect.x1 - rect.x0;
  for (const b of glass) {
    if (b.max.y < y + 0.4 || b.min.y > y + 2.6) continue;
    if (wallX !== null) { if (b.min.x > wallX + 0.6 || b.max.x < wallX - 0.6) continue; covered += Math.max(0, Math.min(b.max.z, rect.z1) - Math.max(b.min.z, rect.z0)); }
    else { if (b.min.z > wallZ! + 0.6 || b.max.z < wallZ! - 0.6) continue; covered += Math.max(0, Math.min(b.max.x, rect.x1) - Math.max(b.min.x, rect.x0)); }
  }
  return len > 0 ? Math.min(1, covered / len) : 0;
}

/** Боксы связных компонентов всех стеклянных мешей шаблона (координаты виллы). */
export function glassBoxes(root: Object3D): Box3[] {
  const out: Box3[] = []; const w = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as Mesh; if (!m.isMesh || m.userData.role !== 'glass') return;
    const { pos, find } = labelComponents(m.geometry); const boxes = new Map<number, Box3>();
    for (let i = 0; i < pos.count; i++) { const r = find(i); let b = boxes.get(r); if (!b) { b = new Box3(); boxes.set(r, b); } b.expandByPoint(w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld)); }
    for (const b of boxes.values()) if (b.max.x - b.min.x > 0.4 || b.max.z - b.min.z > 0.4) out.push(b);
  });
  return out;
}

const yawTo = (d: Vector3) => Math.atan2(d.x, d.z);

/** Набор предметов с проверкой: внутри комнаты (с запасом) и не в проёме двери. */
class Placer {
  matte: BufferGeometry[] = []; shade: BufferGeometry[] = []; art: BufferGeometry[] = []; glassParts: BufferGeometry[] = []; tile: BufferGeometry[] = [];
  private room: RoomInfo; private passages: Passage[]; private blocked: Rect[]; private support: ((x: number, y: number, z: number) => boolean) | null; private obsH: ((x: number, y: number, z: number) => number | null) | null;
  constructor(room: RoomInfo, passages: Passage[], blocked: Rect[] = [], support: ((x: number, y: number, z: number) => boolean) | null = null, obsH: ((x: number, y: number, z: number) => number | null) | null = null) { this.room = room; this.passages = passages; this.blocked = blocked; this.support = support; this.obsH = obsH; }
  wallProbe: ((x: number, y: number, z: number, nx: number, nz: number) => boolean) | null = null;
  /** Есть ли стена у стороны комнаты в точке (x,z) (n — нормаль внутрь комнаты): луч в сторону стены. Без пробы — считаем, что есть. */
  wallAt(x: number, z: number, n: Vector3) { return this.wallProbe ? this.wallProbe(x, this.room.y, z, -n.x, -n.z) : true; }
  /** Препятствие выше 45 см над полом (низкие платформы и ковры модели не мешают). */
  private obstacle(x: number, y: number, z: number) { const h = this.obsH ? this.obsH(x, y, z) : null; return h !== null && h > y + 0.45; }
  /** Габарит низких предметов модели в комнате (верх 15–60 см над полом): платформы кроватей Revit. */
  lowBox(hmin = 0.15, hmax = 0.6): Rect | null {
    if (!this.obsH) return null; const r = this.room.rect, y = this.room.y; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, n = 0;
    for (let x = r.x0 + 0.15; x <= r.x1 - 0.15; x += 0.25) for (let z = r.z0 + 0.15; z <= r.z1 - 0.15; z += 0.25) { const h = this.obsH(x, y, z); if (h === null || h < y + hmin || h > y + hmax) continue; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return n >= 12 ? { x0: x0 - 0.12, z0: z0 - 0.12, x1: x1 + 0.12, z1: z1 + 0.12 } : null;
  }
  /** Поставить без проверки препятствий модели (на платформу Revit). */
  putForce(g: BufferGeometry, x: number, z: number, yaw: number, w: number, d: number) { const o = this.obsH; this.obsH = null; const ok = this.put(g, x, z, yaw, w, d); this.obsH = o; return ok; }
  lastWhy = '';
  /** Лестницы и служебные зоны: кадки не ближе 2,5 м (остальные занятые площади — только без наложения). */
  far: Rect[] = [];
  /** Стекло модели (коробки компонентов) — для проверки «стена глухая в этой точке». */
  glassB: Box3[] = [];
  /** Вода этого уровня (бассейны) — для шезлонгов на террасах. */
  water: Rect[] = [];
  /** Отступ внутренней сетки проверки препятствий от края предмета, м; 0 — сетка выключена (только центр и углы). */
  dense = 0;
  /** Горизонтальный луч: расстояние до ближайшей поверхности модели (до 2 м) или null. Высота луча — y + 1,3 м. */
  cross: WallDist | null = null;
  /** Под точкой мощёная поверхность (плита, плитка), а не газон или рельеф; без пробы — считаем, что да. */
  paved: ((x: number, y: number, z: number) => boolean) | null = null;
  onPaving(x: number, z: number, yaw: number, w: number, d: number) { if (!this.paved) return true; const b = boxAt(x, z, yaw, w, d), y = this.room.y; return [[x, z], [b.x0 + 0.15, b.z0 + 0.15], [b.x1 - 0.15, b.z0 + 0.15], [b.x0 + 0.15, b.z1 - 0.15], [b.x1 - 0.15, b.z1 - 0.15]].every(([px, pz]) => this.paved!(px, y, pz)); }
  /** Рядом с точкой (в пределах pad) есть остекление от пола (витрина, стеклянная стена). */
  glassAt(x: number, z: number, pad = 0.7) { const y = this.room.y; return this.glassB.some((b) => b.max.y > y + 0.6 && b.min.y < y + 1.0 && x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad); }
  /** Проходы от дверей этой комнаты: коробка проёма, вытянутая на 1,5 м поперёк стены (короткая сторона коробки — поперёк). */
  doorways(): Rect[] {
    const R = this.room.rect, y = this.room.y; const out: Rect[] = [];
    for (const q of this.passages) {
      if (q.max[1] < y + 0.2 || q.min[1] > y + 2.2) continue;
      if (q.max[0] < R.x0 - 0.6 || q.min[0] > R.x1 + 0.6 || q.max[2] < R.z0 - 0.6 || q.min[2] > R.z1 + 0.6) continue;
      if (q.max[0] - q.min[0] <= q.max[2] - q.min[2]) out.push({ x0: q.min[0] - 1.5, x1: q.max[0] + 1.5, z0: q.min[2], z1: q.max[2] });
      else out.push({ x0: q.min[0], x1: q.max[0], z0: q.min[2] - 1.5, z1: q.max[2] + 1.5 });
    }
    return out;
  }
  /** Остекление от пола в самой стене side на отметке along: стекло не дальше 0,6 м от линии стены и вытянуто вдоль неё
   *  (перпендикулярная витрина в углу — не в счёт, у неё вдоль этой стены только толщина). */
  glassOnWall(side: Side, along: number) {
    const R = this.room.rect, y = this.room.y; const xAxis = side === 'pz' || side === 'nz'; // стена идёт вдоль x
    const line = side === 'px' ? R.x1 : side === 'nx' ? R.x0 : side === 'pz' ? R.z1 : R.z0; const a = (xAxis ? (R.x0 + R.x1) / 2 : (R.z0 + R.z1) / 2) + along;
    return this.glassB.some((b) => { if (b.max.y < y + 0.6 || b.min.y > y + 1.0) return false; const lo = xAxis ? b.min.x : b.min.z, hi = xAxis ? b.max.x : b.max.z, p0 = xAxis ? b.min.z : b.min.x, p1 = xAxis ? b.max.z : b.max.x; return hi - lo >= 0.4 && a > lo - 0.15 && a < hi + 0.15 && p1 > line - 0.6 && p0 < line + 0.6; });
  }
  /** Занять площадь (проход, зона стола): предметы после этого сюда не ставятся. */
  reserve(r: Rect) { this.blocked.push(r); }
  private ok(x: number, z: number, w: number, d: number, yaw: number, margin = 0.15) {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    const r = this.room.rect; if (x - hw < r.x0 - margin || x + hw > r.x1 + margin || z - hd < r.z0 - margin || z + hd > r.z1 + margin) { this.lastWhy = 'bounds'; return false; }
    // площадь, уже занятая другой (меньшей) комнатой того же уровня — например «открытая терраса» внутри «крытой»
    for (const b of this.blocked) if (x + hw > b.x0 + 0.05 && x - hw < b.x1 - 0.05 && z + hd > b.z0 + 0.05 && z - hd < b.z1 - 0.05) { this.lastWhy = 'blocked'; return false; }
    const y = this.room.y;
    for (const p of this.passages) {
      if (p.max[1] < y + 0.2 || p.min[1] > y + 2.2) continue;
      if (x + hw > p.min[0] - 0.15 && x - hw < p.max[0] + 0.15 && z + hd > p.min[2] - 0.15 && z - hd < p.max[2] + 0.15) { this.lastWhy = 'passage'; return false; }
    }
    return true;
  }
  placed: { x: number; z: number; yaw: number; w: number; d: number; fail?: boolean; soft?: boolean; why?: string }[] = [];
  /** Проверка места без установки: '' — можно; иначе причина (bounds, blocked, passage, overlap, support, obstacle). */
  check(x: number, z: number, yaw: number, w: number, d: number, margin = 0.15, soft = false): string {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    if (!this.ok(x, z, w, d, yaw, margin)) return this.lastWhy;
    if (!soft) for (const it of this.placed) {
      if (it.fail || it.soft) continue;
      const ic = Math.abs(Math.cos(it.yaw)), is = Math.abs(Math.sin(it.yaw)); const ihw = (it.w * ic + it.d * is) / 2, ihd = (it.w * is + it.d * ic) / 2;
      if (Math.abs(it.x - x) < hw + ihw - 0.02 && Math.abs(it.z - z) < hd + ihd - 0.02) return 'overlap';
    }
    const y = this.room.y; const pts: [number, number][] = [[x, z], [x - hw + 0.1, z - hd + 0.1], [x + hw - 0.1, z - hd + 0.1], [x - hw + 0.1, z + hd - 0.1], [x + hw - 0.1, z + hd - 0.1]];
    // пол под центром и четырьмя углами (чуть внутрь), иначе предмет висел бы в воздухе
    if (this.support) for (const [px, pz] of pts) if (!this.support(px, y, pz)) return 'support';
    // в модели здесь уже что-то стоит (мебель Revit: тумбы, вазы) — не ставим поверх
    for (const [px, pz] of pts) if (this.obstacle(px, y, pz)) return 'obstacle';
    // террасы и кухня-гостиная: ещё внутренняя сетка с шагом ≤ 0,3 м — тонкая колонна террасы оказывалась между пятью
    // точками и проходила сквозь стол. В спальнях не включаем: остатки ножек Revit-кроватей скрыты под новой кроватью
    const iw = 2 * hw - 2 * this.dense, id = 2 * hd - 2 * this.dense;
    if (this.dense && (iw > 0.3 || id > 0.3)) { const nx = Math.max(1, Math.ceil(Math.max(iw, 0) / 0.3)), nz = Math.max(1, Math.ceil(Math.max(id, 0) / 0.3)); for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) if (this.obstacle(x - Math.max(iw, 0) / 2 + Math.max(iw, 0) * (i / nx), y, z - Math.max(id, 0) / 2 + Math.max(id, 0) * (j / nz))) return 'obstacle'; }
    // колонны и стойки навесов: луч сверху их не видит (верх выше 1,5 м), поэтому на террасах и в кухне-гостиной ещё
    // горизонтальные лучи на высоте 1 м поперёк предмета — с обоих краёв, по трём линиям вдоль каждой оси
    if (this.dense && this.cross && (hw > 0.3 || hd > 0.3)) {
      const e = 0.08;
      for (const f of [0.15, 0.5, 0.85]) {
        const lz = z - hd + 2 * hd * f, lx = x - hw + 2 * hw * f;
        for (const [ox, oz, dx, dz, len] of [[x - hw + e, lz, 1, 0, 2 * hw - 2 * e], [x + hw - e, lz, -1, 0, 2 * hw - 2 * e], [lx, z - hd + e, 0, 1, 2 * hd - 2 * e], [lx, z + hd - e, 0, -1, 2 * hd - 2 * e]] as [number, number, number, number, number][]) {
          const h = this.cross(ox, y - 0.3, oz, dx, dz); if (h !== null && h < len) return 'obstacle';
        }
      }
    }
    return '';
  }
  free(x: number, z: number, yaw: number, w: number, d: number, margin = 0.15) { return this.check(x, z, yaw, w, d, margin) === ''; }
  /** Можно ли здесь стоять человеку: в комнате, не в проёме, не в мебели, под ногами пол. */
  canStand(x: number, z: number) {
    if (!this.ok(x, z, 0.5, 0.5, 0, 0)) return false;
    for (const it of this.placed) { if (it.fail || it.soft) continue; const ic = Math.abs(Math.cos(it.yaw)), is = Math.abs(Math.sin(it.yaw)); const ihw = (it.w * ic + it.d * is) / 2, ihd = (it.w * is + it.d * ic) / 2; if (Math.abs(it.x - x) < 0.25 + ihw && Math.abs(it.z - z) < 0.25 + ihd) return false; }
    return !this.support || this.support(x, this.room.y, z);
  }
  /** soft — ковёр: может лежать под другими предметами. Предметы не пересекаются и стоят только там, где под ними есть пол. */
  put(g: BufferGeometry, x: number, z: number, yaw: number, w: number, d: number, list: BufferGeometry[] = this.matte, margin = 0.15, soft = false) {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    const why = this.check(x, z, yaw, w, d, margin, soft);
    if (why) { this.placed.push({ x, z, yaw, w, d, fail: true, why }); return false; }
    // низкий подиум модели (каменный пол санузла +20 см, ступень) — предмет встаёт на него, а не утопает: верх
    // поверхности под центром и углами, если он не выше 45 см над полом
    let base = this.room.y;
    if (this.obsH && !soft) { const y = this.room.y; for (const [px, pz] of [[x, z], [x - hw + 0.1, z - hd + 0.1], [x + hw - 0.1, z - hd + 0.1], [x - hw + 0.1, z + hd - 0.1], [x + hw - 0.1, z + hd - 0.1]] as [number, number][]) { const t = this.obsH(px, y, pz); if (t !== null && t <= y + 0.45) base = Math.max(base, t); } }
    list.push(F.place(g, x, base, z, yaw)); this.placed.push({ x, z, yaw, w, d, soft }); return true;
  }
  putAt(g: BufferGeometry, x: number, y: number, z: number, yaw: number, list: BufferGeometry[] = this.matte) { list.push(F.place(g, x, y, z, yaw)); }
  /** Перила по отрезку (x1,z1)-(x2,z2): ставятся, если под обоими концами (с отступом 0,15 м) и серединой есть пол. */
  putRail(r: { frame: BufferGeometry; glass: BufferGeometry }, x1: number, z1: number, x2: number, z2: number, yaw: number) {
    const y = this.room.y; const L = Math.hypot(x2 - x1, z2 - z1) || 1; const ux = (x2 - x1) / L, uz = (z2 - z1) / L;
    const pts: [number, number][] = [[x1 + ux * 0.15, z1 + uz * 0.15], [x2 - ux * 0.15, z2 - uz * 0.15], [(x1 + x2) / 2, (z1 + z2) / 2]];
    if (this.support && !pts.every(([px, pz]) => this.support!(px, y, pz))) return false;
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    this.matte.push(F.place(r.frame, mx, y, mz, yaw)); this.glassParts.push(F.place(r.glass, mx, y, mz, yaw)); return true;
  }
  /** Кадка с растением — только в свободный угол комнаты: не ближе 1,2 м к проёмам и 1 м к лестницам/служебным зонам, сначала глухие углы. */
  putPlant(g: BufferGeometry, size = 0.8): boolean {
    const r = this.room.rect, y = this.room.y, ins = size / 2 + 0.12;
    const corners: { x: number; z: number; glass: number }[] = [
      { x: r.x0 + ins, z: r.z0 + ins, glass: this.room.glass.nx + this.room.glass.nz }, { x: r.x1 - ins, z: r.z0 + ins, glass: this.room.glass.px + this.room.glass.nz },
      { x: r.x0 + ins, z: r.z1 - ins, glass: this.room.glass.nx + this.room.glass.pz }, { x: r.x1 - ins, z: r.z1 - ins, glass: this.room.glass.px + this.room.glass.pz },
    ].sort((a, b) => a.glass - b.glass);
    for (const c of corners) {
      let bad = false;
      for (const p of this.passages) { if (p.max[1] < y + 0.2 || p.min[1] > y + 2.2) continue; const dx = Math.max(p.min[0] - c.x, 0, c.x - p.max[0]), dz = Math.max(p.min[2] - c.z, 0, c.z - p.max[2]); if (Math.hypot(dx, dz) < 1.2) { bad = true; break; } }
      if (!bad) for (const b of this.far) { const dx = Math.max(b.x0 - c.x, 0, c.x - b.x1), dz = Math.max(b.z0 - c.z, 0, c.z - b.z1); if (Math.hypot(dx, dz) < 2.5) { bad = true; break; } } // от лестниц и служебных зон — не ближе 2,5 м
      if (bad) continue;
      if (this.put(g, c.x, c.z, 0, size, size, this.matte, 0.3)) return true;
    }
    return false;
  }
}

/** Точка у стены side на расстоянии dist внутрь, со сдвигом along вдоль стены от её середины. */
function nearWall(rect: Rect, side: Side, dist: number, along = 0): { x: number; z: number; n: Vector3 } {
  const n = inward(side); const mx = (rect.x0 + rect.x1) / 2, mz = (rect.z0 + rect.z1) / 2;
  if (side === 'px') return { x: rect.x1 - dist, z: mz + along, n };
  if (side === 'nx') return { x: rect.x0 + dist, z: mz + along, n };
  if (side === 'pz') return { x: mx + along, z: rect.z1 - dist, n };
  return { x: mx + along, z: rect.z0 + dist, n };
}
const sideLen = (rect: Rect, side: Side) => (side === 'px' || side === 'nx' ? rect.z1 - rect.z0 : rect.x1 - rect.x0);
const depth = (rect: Rect, side: Side) => (side === 'px' || side === 'nx' ? rect.x1 - rect.x0 : rect.z1 - rect.z0);

function furnishBedroom(p: Placer, r: RoomInfo, seed: number) {
  const order = SIDES.slice().sort((a, b) => r.glass[a] - r.glass[b] || sideLen(r.rect, b) - sideLen(r.rect, a));
  let solid: Side = order[0], bedW = 1.5, yaw = 0, w = nearWall(r.rect, solid, 1.15), placed = false;
  // платформы кроватей Revit убраны (clearBeds) — кровать всегда у глухой стены
  // два прохода: сначала изголовьем к подтверждённой лучом стене; если стен не нашлось (контур комнаты шире реальных
  // стен, ниша, перегородка-стекло) — к наименее остеклённой стороне без проверки луча. Спальня без кровати хуже
  // кровати у перегородки; пересечения, проёмы и препятствия модели проверяет put() в обоих проходах
  let byWall = true;
  for (const needWall of [true, false]) {
    for (const side of order) {
      if (r.glass[side] > 0.6 || sideLen(r.rect, side) < (needWall ? 2.4 : 2.0) || depth(r.rect, side) < (needWall ? 2.7 : 2.5)) continue;
      if (needWall) { const wp = nearWall(r.rect, side, 0.3); if (!p.wallAt(wp.x, wp.z, wp.n)) continue; } // за изголовьем должна быть стена
      solid = side; bedW = sideLen(r.rect, side) > 3.6 ? 1.8 : 1.5; yaw = yawTo(inward(side)); const bedG = F.bed(bedW, 2.1);
      for (const along of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) { w = nearWall(r.rect, side, 1.15, along); if (p.put(bedG, w.x, w.z, yaw, bedW + 0.1, 2.2)) { placed = true; break; } }
      if (placed) break;
    }
    if (placed) { byWall = needWall; break; }
  }
  if (!placed) return;
  (p as unknown as { note: string }).note = (byWall ? 'bed@' : 'bed~') + solid; // bed~ — без подтверждённой лучом стены (для автопроверки)
  const t = new Vector3(-w.n.z, 0, w.n.x); // вдоль стены
  for (const s of [-1, 1]) {
    const bx = w.x + t.x * s * (bedW / 2 + 0.4) - w.n.x * 0.7, bz = w.z + t.z * s * (bedW / 2 + 0.4) - w.n.z * 0.7;
    if (p.put(F.bedside(), bx, bz, yaw, 0.5, 0.45)) { const lamp = F.tableLamp(); p.putAt(lamp.body, bx, r.y + 0.53, bz, 0); p.putAt(lamp.shade, bx, r.y + 0.53, bz, 0, p.shade); }
  }
  p.put(F.rug(bedW + 1.6, 2.2), w.x + w.n.x * 0.9, w.z + w.n.z * 0.9, yaw, bedW + 1.6, 2.2, p.matte, 0.3, true);
  // диптих над кроватью (на глухой стене)
  const wallPt = nearWall(r.rect, solid, 0.3);
  if (r.glass[solid] < 0.3 && !r.leaked && p.wallAt(wallPt.x, wallPt.z, wallPt.n)) for (const s of [-1, 1]) { const a = F.artFrame(0.6, 0.8); const ax = w.x - w.n.x * 1.1 + t.x * s * 0.42, az = w.z - w.n.z * 1.1 + t.z * s * 0.42; p.putAt(a.frame, ax, r.y + 1.45, az, yaw); p.putAt(a.canvas, ax, r.y + 1.45, az, yaw, p.art); }
  // кресло и растение по углам у стены напротив стекла
  const corner = (sideA: Side, sideB: Side) => ({ x: sideA === 'px' || sideB === 'px' ? r.rect.x1 - 0.6 : r.rect.x0 + 0.6, z: sideA === 'pz' || sideB === 'pz' ? r.rect.z1 - 0.6 : r.rect.z0 + 0.6 });
  const view = SIDES.slice().sort((a, b) => r.glass[b] - r.glass[a])[0];
  const others = SIDES.filter((s) => s !== solid && s !== opposite(solid));
  const c1 = corner(solid, others[0]);
  const toCentre = (c: { x: number; z: number }) => yawTo(new Vector3(r.cx - c.x, 0, r.cz - c.z));
  p.put(F.rattanChair(), c1.x, c1.z, toCentre(c1), 0.9, 0.9) || p.put(F.floorVase(), c1.x, c1.z, 0, 0.5, 0.5);
  p.putPlant(F.pottedPlant('kentia', seed), 0.8);
  if (r.glass[view] > 0.2) { const vc = corner(view, others[0]); p.put(F.floorVase(), vc.x, vc.z, 0, 0.5, 0.5); }
  p.putAt(F.ceilingFan(), r.cx, r.y + 2.75, r.cz, 0);
}

function furnishLiving(p: Placer, r: RoomInfo, seed: number) {
  // диван у стены напротив самой остеклённой стороны; если там не встаёт (проём, лестница) — пробуем остальные стороны
  const order = SIDES.slice().sort((a, b) => r.glass[b] - r.glass[a]);
  let view: Side = order[0], back = opposite(view), W = sideLen(r.rect, view), D = depth(r.rect, view);
  let n = inward(view), face = yawTo(n.clone().negate()), w = nearWall(r.rect, back, 1), sofaLen = 2.6, ok = false;
  for (const maxLen of [2.6, 1.8]) {
    for (const side of order) {
      view = side; back = opposite(view); W = sideLen(r.rect, view); D = depth(r.rect, view);
      if (W < 2.8 || D < 2.8) continue;
      n = inward(view); face = yawTo(n.clone().negate()); sofaLen = Math.min(maxLen, W - 1.4);
      const sofaG = F.sofa(sofaLen, sofaLen > 2.2 ? 3 : 2);
      for (const along of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1]) { w = nearWall(r.rect, back, Math.min(1.3, D * 0.3), along); if (p.put(sofaG, w.x, w.z, face, sofaLen, 0.95)) { ok = true; break; } }
      if (ok) break;
    }
    if (ok) break;
  }
  if (!ok) { // совсем тесно: пара кресел и столик у центра зоны
    // маленькая «зона отдыха» без места под диван — это проходной холл (лестница, двери): кресла посреди прохода мешают;
    // только растение в свободном углу
    if (p.putPlant(F.pottedPlant('kentia'), 0.6)) (p as unknown as { note: string }).note = 'plant';
    return;
  }
  (p as unknown as { note: string }).note = 'sofa@' + back;
  const big = W >= 4.2 && D >= 4.2;
  const t = new Vector3(-n.z, 0, n.x);
  const tx = w.x - n.x * 1.5, tz = w.z - n.z * 1.5; // стол перед диваном (к стеклу)
  p.put(F.coffeeTable(1.3, 0.7), tx, tz, face, 1.3, 0.7);
  p.put(F.rug(Math.min(W - 1, 3.6), 3.0), tx + n.x * 0.5, tz + n.z * 0.5, face, 3.6, 3.0, p.matte, 0.3, true);
  if (big) for (const s of [-1, 1]) { const ax = tx + t.x * s * 1.75, az = tz + t.z * s * 1.75; p.put(F.armchair(s > 0), ax, az, yawTo(new Vector3(-t.x * s, 0, -t.z * s)), 0.85, 0.85); }
  const lamp = F.tableLamp(); const lx = w.x + t.x * (sofaLen / 2 + 0.45), lz = w.z + t.z * (sofaLen / 2 + 0.45);
  if (p.put(F.sideTable(), lx, lz, 0, 0.5, 0.5)) { p.putAt(lamp.body, lx, r.y + 0.55, lz, 0); p.putAt(lamp.shade, lx, r.y + 0.55, lz, 0, p.shade); }
  p.putAt(F.rattanPendant(0.45, 0.5, -0.6), tx, r.y + 2.9, tz, 0); // подвес над столом
  if (r.glass[back] < 0.3) { // картина на глухой стене за диваном
    const a = F.artFrame(1.1, 1.3); const wb = nearWall(r.rect, back, 0.04); const wq = nearWall(r.rect, back, 0.3);
    if (!r.leaked && p.wallAt(wq.x, wq.z, wq.n)) { p.putAt(a.frame, wb.x, r.y + 0.9, wb.z, face); p.putAt(a.canvas, wb.x, r.y + 0.9, wb.z, face, p.art); }
  }
  const vx = w.x - t.x * (sofaLen / 2 + 0.6), vz = w.z - t.z * (sofaLen / 2 + 0.6); p.put(F.floorVase(), vx, vz, 0, 0.5, 0.5);
  p.putPlant(F.pottedPlant('strelitzia', seed), 0.9);
  p.putAt(F.ceilingFan(), r.cx, r.y + 2.75, r.cz, 0);
}

function furnishDining(p: Placer, r: RoomInfo) {
  const W = r.rect.x1 - r.rect.x0, D = r.rect.z1 - r.rect.z0; if (W < 2.8 || D < 2.8) return;
  // стол на свободном месте ближе к центру комнаты (колонны и лестницы модели обходятся), вдоль длинной стороны
  const alongX = W >= D; const len = Math.min(2.4, (alongX ? W : D) - 1.8); const fw = alongX ? len + 0.4 : 2.5, fd = alongX ? 2.5 : len + 0.4;
  const cells: [number, number][] = []; for (let x = r.rect.x0 + fw / 2 + 0.2; x <= r.rect.x1 - fw / 2 - 0.2 + 1e-6; x += 0.3) for (let z = r.rect.z0 + fd / 2 + 0.2; z <= r.rect.z1 - fd / 2 - 0.2 + 1e-6; z += 0.3) cells.push([x, z]);
  cells.sort((a, b) => Math.hypot(a[0] - r.cx, a[1] - r.cz) - Math.hypot(b[0] - r.cx, b[1] - r.cz));
  for (const [x, z] of cells) { if (!p.free(x, z, 0, fw, fd, 0)) continue; if (putDining(p, r, x, z, alongX, len)) { (p as unknown as { note: string }).note = 'dining'; break; } }
  if ((p as unknown as { note?: string }).note !== 'dining') return;
  // комод у глухой стены и растение
  const order = SIDES.slice().sort((a, b) => r.glass[a] - r.glass[b] || sideLen(r.rect, b) - sideLen(r.rect, a));
  outer: for (const s of order) { if (r.glass[s] > 0.3) continue; const L = sideLen(r.rect, s); for (let a = 0; a <= L / 2 - 1; a += 0.4) for (const sg of a ? [1, -1] : [1]) { const w = nearWall(r.rect, s, 0.26, a * sg); if (p.wallAt(w.x, w.z, w.n) && p.put(F.sideboard(1.6), w.x, w.z, yawTo(w.n), 1.7, 0.5)) break outer; } }
  p.putPlant(F.pottedPlant('strelitzia', 5), 0.9);
}

/** Кухня: гарнитур вдоль самой глухой длинной стены (холодильник в торце, верхние шкафы над), при глубине ≥ 3,4 м — остров. */
function furnishKitchen(p: Placer, r: RoomInfo) {
  const order = SIDES.slice().sort((a, b) => r.glass[a] - r.glass[b] || sideLen(r.rect, b) - sideLen(r.rect, a));
  for (const side of order) {
    const L = sideLen(r.rect, side); if (r.glass[side] > 0.5 || L < 2.4) continue;
    { const wp = nearWall(r.rect, side, 0.3); if (!p.wallAt(wp.x, wp.z, wp.n)) continue; } // гарнитур только у реальной стены
    const n = inward(side); const yaw = yawTo(n); const t = new Vector3(-n.z, 0, n.x); // вдоль стены
    const withFridge = L >= 3.4; const runLen = Math.min(L - 0.2 - (withFridge ? 0.76 : 0), 5.4);
    const shift = withFridge ? -0.38 : 0; // гарнитур смещён от торца с холодильником
    let c = nearWall(r.rect, side, 0.32, shift); let len = runLen;
    // если вдоль всей стены мешает встроенная сантехника модели — пробуем половины стены
    if (!p.put(F.kitchenBase(len), c.x, c.z, yaw, len, 0.66)) {
      let ok = false;
      for (const sgn of [1, -1]) { len = Math.max(1.8, (L - 0.2) / 2 - 0.1); c = nearWall(r.rect, side, 0.32, sgn * (L / 4)); if (p.put(F.kitchenBase(len), c.x, c.z, yaw, len, 0.66)) { ok = true; break; } }
      if (!ok) continue;
    }
    const runLenUsed = len;
    p.putAt(F.kitchenUpper(runLenUsed), c.x - n.x * 0.12, r.y, c.z - n.z * 0.12, yaw);
    if (withFridge) { const fx = c.x + t.x * (runLenUsed / 2 + 0.38), fz = c.z + t.z * (runLenUsed / 2 + 0.38); p.put(F.fridge(), fx + n.x * 0.03, fz + n.z * 0.03, yaw, 0.72, 0.68); }
    if (depth(r.rect, side) >= 3.4 && L >= 3.0) { const il = Math.min(2.2, L - 1.4); p.put(F.island(il), c.x + n.x * 1.45, c.z + n.z * 1.45, yaw, il + 0.1, 1.6); }
    (p as unknown as { note: string }).note = 'kitchen@' + side; console.info('[kitchen]', 'гарнитур', runLenUsed.toFixed(1), 'м у стены', side); return;
  }
  console.info('[kitchen]', 'гарнитур не поместился', r.rect);
}
/** Санузел: ванна вдоль самой длинной глухой стены (если комната ≥ 2,2 × 1,9 м), умывальник с зеркалом у другой глухой
 *  стены, унитаз у оставшейся стены ближе к углу, полотенечница и растение — в свободные места. Всё через put(): без
 *  наложений друг на друга, не в проёмах, только там, где под ногами пол и за спиной стена. */
function furnishBath(p: Placer, r: RoomInfo, seed: number, full = true) {
  const order = SIDES.slice().sort((a, b) => r.glass[a] - r.glass[b] || sideLen(r.rect, b) - sideLen(r.rect, a));
  // стена «глухая»: без стекла и с попаданием луча в стену; если луч не находит стен ни с одной стороны (контур комнаты
  // чуть шире реальных стен), доверяем плану — иначе санузел остаётся пустым
  const anyWall = SIDES.some((s) => { const wp = nearWall(r.rect, s, 0.3); return p.wallAt(wp.x, wp.z, wp.n); });
  const solidWall = (s: Side, along = 0) => { if (r.glass[s] >= 0.3) return false; if (!anyWall) return true; const wp = nearWall(r.rect, s, 0.3, along); return p.wallAt(wp.x, wp.z, wp.n); };
  // позиции вдоль стены для предмета шириной w: от торцов к центру с шагом 0,3 м
  const alongs = (s: Side, w: number, fromEnds: boolean) => { const half = Math.max(0, sideLen(r.rect, s) / 2 - w / 2 - 0.08); const out: number[] = []; for (let a = 0; a <= half + 1e-6; a += 0.3) { out.push(a); if (a > 0) out.push(-a); } if (half > 0 && !out.includes(half)) { out.push(half, -half); } return fromEnds ? out.sort((x, y) => Math.abs(y) - Math.abs(x)) : out; };
  const used: Side[] = []; const rest = () => [...order.filter((s) => !used.includes(s)), ...used];
  let tub = false, van = false, wc = false;
  // ванна — вдоль самой длинной глухой стены, в торце (освобождает стену напротив); узкий санузел 1,4 м: ванна 0,75, проход 0,6
  if (full) for (const s of order) {
    if (!solidWall(s) || sideLen(r.rect, s) < 1.9 || depth(r.rect, s) < 1.35) continue;
    for (const along of alongs(s, 1.8, true)) { const w = nearWall(r.rect, s, 0.42, along); if (solidWall(s, along) && p.put(F.bathtub(1.7, 0.75), w.x, w.z, yawTo(w.n), 1.8, 0.85, p.matte, 0.1)) { tub = true; used.push(s); break; } }
    if (tub) break;
  }
  // умывальник с зеркалом: сначала у другой глухой стены, при тесноте — узкий на одну чашу
  for (const len of full ? [1.5, 1.1, 0.7] : [0.9, 0.7]) {
    for (const s of rest()) {
      if (!solidWall(s) || sideLen(r.rect, s) < len + 0.3) continue; const basins = len >= 1.3 ? 2 : 1;
      for (const along of alongs(s, len + 0.1, false)) {
        const w = nearWall(r.rect, s, 0.3, along);
        if (solidWall(s, along) && p.put(F.vanity(len, basins), w.x, w.z, yawTo(w.n), len + 0.1, 0.6)) { const m = nearWall(r.rect, s, 0.03, along); p.putAt(F.mirror(Math.max(0.5, len - 0.2), 0.8), m.x, r.y + 1.1, m.z, yawTo(w.n)); van = true; used.push(s); break; }
      }
      if (van) break;
    }
    if (van) break;
  }
  // унитаз — у оставшейся глухой стены, ближе к углу
  for (const s of rest()) {
    if (!solidWall(s)) continue;
    for (const along of alongs(s, 0.45, true)) { const w = nearWall(r.rect, s, 0.38, along); if (solidWall(s, along) && p.put(F.toilet(), w.x, w.z, yawTo(w.n), 0.45, 0.75)) { wc = true; break; } }
    if (wc) break;
  }
  // полотенечница и растение — в свободные места
  if (full) outer: for (const s of order) for (const along of alongs(s, 0.5, true)) { const w = nearWall(r.rect, s, 0.25, along); if (solidWall(s, along) && p.put(F.towelLadder(), w.x, w.z, yawTo(w.n), 0.5, 0.3, p.matte, 0.3)) break outer; }
  if (full) p.putPlant(F.pottedPlant('kentia', seed), 0.6);
  if (van || wc || tub) (p as unknown as { note: string }).note = [tub ? 'tub' : '', van ? 'vanity' : '', wc ? 'wc' : ''].filter(Boolean).join('+');
  // плитка на стенах: панель в 1 см перед стеной на высоту 2,2 м — там, где стена глухая, нет проёма и стена действительно
  // в 2–8 см за контуром (луч). Без проверки лучом панель висела бы в воздухе там, где контур не дотянулся до стены
  if (p.cross) for (const s of SIDES) {
    if (r.glass[s] >= 0.3) continue; const L = sideLen(r.rect, s); let st: number | null = null, last = 0; const runs: [number, number][] = [];
    const flush = (a0: number, a1: number) => { if (a1 - a0 >= 0.45) runs.push([a0, a1]); };
    for (let a = -L / 2 + 0.05; a <= L / 2 - 0.05 + 1e-6; a += 0.1) {
      const w = nearWall(r.rect, s, 0.3, a); const d = p.cross(w.x, r.y, w.z, -w.n.x, -w.n.z); const why = p.check(w.x, w.z, 0, 0.1, 0.1, 0.3, true);
      const ok = d !== null && d > 0.27 && d < 0.4 && (why === '' || why === 'obstacle' || why === 'overlap');
      if (ok) { if (st === null) st = a; } else if (st !== null) { flush(st - 0.05, last + 0.05); st = null; }
      last = a;
    }
    if (st !== null) flush(st - 0.05, last + 0.05);
    // плитка — только на стене, которую она закрывает почти целиком (≥ 65 % длины, проём двери не в счёт): заплатки
    // посреди стены выглядят недоделкой, лучше одна-две акцентные стены
    const cover = runs.reduce((sum, q) => sum + q[1] - q[0], 0); if (cover < 0.65 * L) continue;
    for (const [a0, a1] of runs) { const w = nearWall(r.rect, s, 0.01, (a0 + a1) / 2); p.putAt(F.wallTile(a1 - a0, 2.2), w.x, r.y, w.z, yawTo(w.n), p.tile); }
  }
  console.info('[bath]', r.name, `${(r.rect.x1 - r.rect.x0).toFixed(1)}×${(r.rect.z1 - r.rect.z0).toFixed(1)}`, { tub, van, wc }, anyWall ? '' : 'стен лучом не найдено', p.placed.filter((it) => it.fail).map((it) => it.why).join(','));
}

/** Прачечная: вдоль глухой стены в ряд стиральная и сушильная машины и стол с мойкой, корзиной и полкой. */
function furnishLaundry(p: Placer, r: RoomInfo) {
  const order = SIDES.slice().sort((a, b) => r.glass[a] - r.glass[b] || sideLen(r.rect, b) - sideLen(r.rect, a));
  for (const s of order) {
    const L = sideLen(r.rect, s); if (r.glass[s] > 0.3 || L < 1.4) continue;
    const mid = nearWall(r.rect, s, 0.3); const yaw = yawTo(mid.n); const cl = Math.min(1.4, Math.max(0.9, L - 1.7));
    const row: [BufferGeometry, number][] = [[F.washer(false), 0.62], [F.washer(true), 0.62], [F.laundryCounter(cl), cl + 0.06]];
    let a = -L / 2 + 0.1, n = 0;
    for (const [g, w] of row) for (let k = 0; k < 14 && a + w <= L / 2 - 0.05 + 1e-6; k++) {
      const c = nearWall(r.rect, s, 0.34, a + w / 2);
      if (p.wallAt(c.x, c.z, c.n) && p.put(g, c.x, c.z, yaw, w, 0.62, p.matte, 0.1)) { a += w + 0.02; n++; break; }
      a += 0.2;
    }
    if (n) { (p as unknown as { note: string }).note = 'laundry@' + s; return; }
  }
}

const overlapR = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
const boxAt = (x: number, z: number, yaw: number, w: number, d: number): Rect => { const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2; return { x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd }; };
/** Обеденная группа: стол длиной len (alongX — вдоль x), стулья по обе стороны лицом к столу, подвесы над столом. */
function putDining(p: Placer, r: RoomInfo, x: number, z: number, alongX: boolean, len: number, pendants = true): boolean {
  const yaw = alongX ? 0 : Math.PI / 2; // геометрия стола — длиной вдоль локальной x
  if (!p.put(F.diningTable(len, 0.95), x, z, yaw, len, 0.95)) return false;
  const t = alongX ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1), n = alongX ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const nC = Math.max(2, Math.floor(len / 0.62));
  for (let i = 0; i < nC; i++) { const a = -len / 2 + (i + 0.5) * (len / nC); for (const sg of [-1, 1]) p.put(F.chair(), x + t.x * a + n.x * sg * 0.72, z + t.z * a + n.z * sg * 0.72, yawTo(n.clone().multiplyScalar(-sg)), 0.45, 0.45); }
  if (pendants) for (let i = 0; i < Math.min(3, nC); i++) { const a = -len / 2 + (i + 0.5) * (len / Math.min(3, nC)); p.putAt(F.rattanPendant(0.28, 0.32, -0.8), x + t.x * a, r.y + 2.9, z + t.z * a, 0); }
  return true;
}

/** Кухня-гостиная открытой планировки (виллы типа 2): одна комната вместо трёх меток плана.
 *  1) гарнитур с холодильником — вдоль глухого участка стены, ближайшего к метке кухни;
 *  2) обеденный стол — параллельно гарнитуру (при глубине ≥ 6,4 м между ними остров), вне проходов;
 *  3) диван с журнальным столом — у самой дальней от кухни глухой стены, вне проходов от дверей и проёмов.
 *  Глухой участок: луч находит стену, рядом нет витрины, место свободно (put-проверки). */
function furnishOpenPlan(p: Placer, r: RoomInfo, seed: number) {
  const R = r.rect; const notes: string[] = []; const K = r.label ?? [r.cx, r.cz];
  const solidAt = (s: Side, along: number) => { const w = nearWall(R, s, 0.3, along); return !p.glassOnWall(s, along) && p.wallAt(w.x, w.z, w.n); };
  type Run = { s: Side; a0: number; a1: number }; const runs: Run[] = []; const corr: Rect[] = [];
  const strip = (s: Side, a0: number, a1: number, d0: number, d1: number): Rect => { const A = nearWall(R, s, d0, a0), B = nearWall(R, s, d1, a1); return { x0: Math.min(A.x, B.x), z0: Math.min(A.z, B.z), x1: Math.max(A.x, B.x), z1: Math.max(A.z, B.z) }; };
  for (const s of SIDES) {
    const L = sideLen(R, s); let st: number | null = null, ost: number | null = null, last = 0;
    for (let a = -L / 2 + 0.2; a <= L / 2 - 0.2 + 1e-6; a += 0.1) {
      const w = nearWall(R, s, 0.36, a); const glassy = p.glassOnWall(s, a); const wall = !glassy && p.wallAt(w.x, w.z, w.n); const ok = wall && p.free(w.x, w.z, 0, 0.3, 0.3, 0.3);
      if (ok) { if (st === null) st = a; } else if (st !== null) { runs.push({ s, a0: st - 0.15, a1: last + 0.15 }); st = null; }
      const open = !wall && !glassy; // проём без двери (в соседнюю зону) — перед ним проход
      if (open) { if (ost === null) ost = a; } else if (ost !== null) { if (last - ost >= 0.8) corr.push(strip(s, ost - 0.1, last + 0.1, -0.2, 1.7)); ost = null; }
      last = a;
    }
    if (st !== null) runs.push({ s, a0: st - 0.15, a1: last + 0.15 });
    if (ost !== null && last - ost >= 0.8) corr.push(strip(s, ost - 0.1, last + 0.1, -0.2, 1.7));
  }
  for (const q of p.doorways()) corr.push(q);
  const corrArea = (b: Rect) => corr.reduce((sum, c) => sum + overlapR(b, c), 0);
  // 1. кухня
  let KC: { x: number; z: number } | null = null, kSide: Side | null = null, kAlong = 0, kLen = 0;
  const kRuns = runs.filter((q) => q.a1 - q.a0 >= 2.0).map((q) => {
    const mid = nearWall(R, q.s, 0, 0); const alongK = q.s === 'px' || q.s === 'nx' ? K[1] - (R.z0 + R.z1) / 2 : K[0] - (R.x0 + R.x1) / 2;
    const dWall = q.s === 'px' || q.s === 'nx' ? Math.abs(K[0] - mid.x) : Math.abs(K[1] - mid.z); const dAlong = Math.max(0, q.a0 - alongK, alongK - q.a1);
    return { q, score: Math.min(q.a1 - q.a0, 4.3) * 0.4 - dWall - dAlong };
  }).sort((a, b) => b.score - a.score);
  for (const { q } of kRuns) {
    const s = q.s, L = sideLen(R, s), n = inward(s), yaw = yawTo(n); const total = Math.min(q.a1 - q.a0, 4.3);
    const fromA0 = Math.abs(q.a0 + L / 2) <= Math.abs(L / 2 - q.a1); const dir = fromA0 ? 1 : -1, start = fromA0 ? q.a0 : q.a1; // от конца, ближнего к углу комнаты
    const withFridge = total >= 2.35; let bl = total - (withFridge ? 0.78 : 0) - 0.05, done = false, ac = 0, c = nearWall(R, s, 0.33, 0);
    for (let k = 0; k < 6 && bl >= 1.5; k++, bl -= 0.3) { ac = start + dir * ((withFridge ? 0.78 : 0) + bl / 2); c = nearWall(R, s, 0.33, ac); if (p.put(F.kitchenBase(bl), c.x, c.z, yaw, bl, 0.66, p.matte, 0.2)) { done = true; break; } }
    if (!done) continue;
    p.putAt(F.kitchenUpper(bl), c.x - n.x * 0.12, r.y, c.z - n.z * 0.12, yaw);
    if (withFridge) { const f = nearWall(R, s, 0.36, start + dir * 0.38); p.put(F.fridge(), f.x, f.z, yaw, 0.72, 0.68, p.matte, 0.2); }
    KC = { x: c.x, z: c.z }; kSide = s; kAlong = ac; kLen = bl; notes.push('kitchen@' + s); break;
  }
  if (!KC || !kSide) { console.info('[open]', 'гарнитур не поместился', R); return; }
  // 2. остров (если глубоко) и обеденный стол параллельно гарнитуру
  { const s = kSide, n = inward(s), yaw = yawTo(n), D = depth(R, s), alongX = s === 'pz' || s === 'nz'; const len = sideLen(R, s) >= 5 ? 2.0 : 1.4;
    const island = D >= 6.4; if (island) { const il = Math.min(2.2, kLen); p.put(F.island(il), KC.x + n.x * 1.45, KC.z + n.z * 1.45, yaw, il + 0.1, 1.6); }
    let best: { x: number; z: number; sc: number } | null = null;
    for (const dist of island ? [4.4, 4.7, 5.0] : [2.55, 2.8, 3.05, 3.3]) for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2]) {
      const c = nearWall(R, s, dist, kAlong + off); const fw = alongX ? len + 0.3 : 2.45, fd = alongX ? 2.45 : len + 0.3;
      if (!p.free(c.x, c.z, 0, fw, fd, 0)) continue;
      const sc = corrArea(boxAt(c.x, c.z, 0, fw, fd)) * 3 + (dist - 2.55) * 0.5 + Math.abs(off) * 0.3; if (!best || sc < best.sc) best = { x: c.x, z: c.z, sc };
    }
    if (best && putDining(p, r, best.x, best.z, alongX, len)) { notes.push('dining'); p.reserve(boxAt(best.x, best.z, 0, alongX ? len + 0.5 : 2.6, alongX ? 2.6 : len + 0.5)); }
  }
  // 3. диван у самой дальней от кухни глухой стены
  { let best: { s: Side; a: number; len: number; sc: number } | null = null;
    for (const len of [2.4, 2.0, 1.7]) for (const q of runs) {
      const n = inward(q.s), yaw = yawTo(n);
      for (let a = q.a0 + len / 2; a <= q.a1 - len / 2 + 1e-6; a += 0.2) {
        const w = nearWall(R, q.s, 0.56, a); if (!solidAt(q.s, a - len / 2 + 0.25) || !solidAt(q.s, a + len / 2 - 0.25)) continue;
        if (!p.free(w.x, w.z, yaw, len, 0.95) || corrArea(boxAt(w.x, w.z, yaw, len, 0.95)) > 0.15) continue;
        const sc = Math.hypot(w.x - KC.x, w.z - KC.z) + len; if (!best || sc > best.sc + 1e-6) best = { s: q.s, a, len, sc };
      }
    }
    if (best) {
      const { s, a, len } = best; const n = inward(s), yaw = yawTo(n), w = nearWall(R, s, 0.56, a);
      if (p.put(F.sofa(len, len > 2.2 ? 3 : 2), w.x, w.z, yaw, len, 0.95)) {
        notes.push('sofa@' + s);
        const tx = w.x + n.x * 1.35, tz = w.z + n.z * 1.35; p.put(F.coffeeTable(1.1, 0.6), tx, tz, yaw, 1.1, 0.6);
        for (const rw of [len + 0.4, len, len - 0.3]) if (p.put(F.rug(rw, 1.9), w.x + n.x * 1.15, w.z + n.z * 1.15, yaw, rw, 1.9, p.matte, 0.3, true)) break;
        const ends = [1, -1].sort((e1, e2) => Number(solidAt(s, a + e2 * (len / 2 + 0.4))) - Number(solidAt(s, a + e1 * (len / 2 + 0.4))));
        for (const e of ends) { const lt = nearWall(R, s, 0.45, a + e * (len / 2 + 0.42)); if (p.put(F.sideTable(), lt.x, lt.z, 0, 0.5, 0.5)) { const lamp = F.tableLamp(); p.putAt(lamp.body, lt.x, r.y + 0.55, lt.z, 0); p.putAt(lamp.shade, lt.x, r.y + 0.55, lt.z, 0, p.shade); break; } }
        { const art = F.artFrame(1.1, 1.3); const wb = nearWall(R, s, 0.04, a); p.putAt(art.frame, wb.x, r.y + 0.9, wb.z, yaw); p.putAt(art.canvas, wb.x, r.y + 0.9, wb.z, yaw, p.art); }
        const t = s === 'px' || s === 'nx' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
        for (const e of [1, -1]) { const ax = tx + t.x * e * 1.4, az = tz + t.z * e * 1.4; if (corrArea(boxAt(ax, az, 0, 0.85, 0.85)) < 0.1 && p.put(F.armchair(e > 0), ax, az, yawTo(new Vector3(-t.x * e, 0, -t.z * e)), 0.85, 0.85)) break; }
        p.putAt(F.ceilingFan(), tx, r.y + 2.75, tz, 0);
      }
    }
  }
  p.putPlant(F.pottedPlant('strelitzia', seed), 0.9);
  (p as unknown as { note: string }).note = 'open: ' + notes.join(' ');
  console.info('[open]', r.name, `${(R.x1 - R.x0).toFixed(1)}×${(R.z1 - R.z0).toFixed(1)}`, notes.join(' '), 'проходов:', corr.length);
}

/** Места для гостей на террасах (координаты виллы): у наружного края (стоять, смотреть на вид) и на диване (сидеть). */
export type TerraceSpot = { x: number; y: number; z: number; yaw: number; kind: 'rail' | 'sit' | 'lie' };
let spots: TerraceSpot[] = []; let bboxC: [number, number] = [0, 0];
function furnishTerrace(p: Placer, r: RoomInfo, seed: number) {
  const R = r.rect, W = R.x1 - R.x0, D = R.z1 - R.z0; const area = r.area ?? W * D; const short = Math.min(W, D), long = Math.max(W, D);
  const covered = /overed/i.test(r.name); const notes: string[] = [];
  // направление «наружу»: от центра дома к центру террасы по главной оси
  const ox = r.cx - bboxC[0], oz = r.cz - bboxC[1]; const out = Math.abs(ox) >= Math.abs(oz) ? new Vector3(Math.sign(ox) || 1, 0, 0) : new Vector3(0, 0, Math.sign(oz) || 1);
  const pools = p.water.filter((b) => (b.x1 - b.x0) * (b.z1 - b.z0) > 6 && b.x1 > R.x0 - 2.4 && b.x0 < R.x1 + 2.4 && b.z1 > R.z0 - 2.4 && b.z0 < R.z1 + 2.4);
  const AX = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];
  // шезлонги парами у воды: в 0,65 м от кромки, ногами к бассейну, между ними столик, за изголовьями зонт (на открытой террасе)
  const sunbeds = (maxPairs: number) => {
    let n = 0;
    for (const b of pools) {
      const edges = AX.map((o) => ({ o, len: o.x ? b.z1 - b.z0 : b.x1 - b.x0 })).sort((e1, e2) => e2.len - e1.len);
      for (const { o, len } of edges) {
        const yaw = yawTo(o.clone().negate()); const cx0 = (b.x0 + b.x1) / 2, cz0 = (b.z0 + b.z1) / 2; const lastAt: number[] = [];
        for (let a = -len / 2 + 1.0; a <= len / 2 - 1.0 + 1e-6 && n < maxPairs; a += 0.3) {
          if (lastAt.some((q) => Math.abs(q - a) < 3.2)) continue;
          const ex = o.x ? (o.x > 0 ? b.x1 : b.x0) + o.x * 1.65 : cx0 + a, ez = o.z ? (o.z > 0 ? b.z1 : b.z0) + o.z * 1.65 : cz0 + a; // центр пары
          if (!p.free(ex, ez, yaw, 2.0, 2.0, 0)) continue;
          const t = o.x ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
          let ok = 0; for (const sg of [-1, 1]) if (p.put(F.lounger(), ex + t.x * sg * 0.62, ez + t.z * sg * 0.62, yaw, 0.72, 1.95, p.matte, 0)) { ok++; if (sg < 0) spots.push({ x: ex + t.x * sg * 0.62, y: r.y, z: ez + t.z * sg * 0.62, yaw, kind: 'lie' }); } // на одном шезлонге пары может лежать гость
          if (!ok) continue;
          p.put(F.sideTable(), ex + o.x * 0.6, ez + o.z * 0.6, 0, 0.42, 0.42, p.matte, 0);
          if (!covered) p.put(F.umbrella(), ex + o.x * 1.3, ez + o.z * 1.3, 0, 0.5, 0.5, p.matte, 0);
          lastAt.push(a); n++;
        }
        if (n >= maxPairs) return n;
      }
    }
    return n;
  };
  // диванная группа: диван спиной к дому (лицом к воде или наружу), стол, ковёр; на большой террасе — два кресла
  const lounge = () => {
    const want = pools.length ? new Vector3((pools[0].x0 + pools[0].x1) / 2 - r.cx, 0, (pools[0].z0 + pools[0].z1) / 2 - r.cz) : out.clone();
    const faces = AX.slice().sort((a, b) => b.dot(want) - a.dot(want)).slice(0, 3);
    const st = short < 4.5 ? 0.25 : 0.5; const cells: [number, number][] = []; for (let x = R.x0 + 1.1; x <= R.x1 - 1.1 + 1e-6; x += st) for (let z = R.z0 + 1.1; z <= R.z1 - 1.1 + 1e-6; z += st) cells.push([x, z]);
    cells.sort((a, b) => Math.hypot(a[0] - r.cx, a[1] - r.cz) - Math.hypot(b[0] - r.cx, b[1] - r.cz));
    for (const f of faces) {
      const yaw = yawTo(f); const t = new Vector3(-f.z, 0, f.x);
      for (const [x, z] of cells) {
        if (!p.free(x, z, yaw, 2.4, 2.2, 0.02) || !p.onPaving(x, z, yaw, 2.4, 2.2)) continue; // диван и ковёр — только на мощении, не на газоне
        if (!p.put(F.sofa(2.2, 3), x - f.x * 0.6, z - f.z * 0.6, yaw, 2.2, 0.95, p.matte, 0.05)) continue;
        p.put(F.coffeeTable(1.0, 0.6), x + f.x * 0.6, z + f.z * 0.6, yaw, 1.0, 0.6, p.matte, 0.05);
        p.put(F.rug(3.0, 2.6, F.C.jute), x, z, yaw, 3.0, 2.6, p.matte, 0.3, true);
        if (area >= 30) for (const sg of [-1, 1]) p.put(F.armchair(sg > 0), x + f.x * 0.6 + t.x * sg * 1.5, z + f.z * 0.6 + t.z * sg * 1.5, yawTo(new Vector3(-t.x * sg, 0, -t.z * sg)), 0.85, 0.85, p.matte, 0);
        spots.push({ x: x - f.x * 0.4, y: r.y, z: z - f.z * 0.4, yaw: Math.atan2(f.x, f.z), kind: 'sit' }); // сидит на диване лицом к столику
        return true;
      }
    }
    return false;
  };
  // балкон: два ротанговых кресла со столиком у стены дома, лицом наружу
  const bistro = () => {
    const alongX = W >= D; const inner: Side = alongX ? (Math.abs(R.z0 - bboxC[1]) < Math.abs(R.z1 - bboxC[1]) ? 'nz' : 'pz') : (Math.abs(R.x0 - bboxC[0]) < Math.abs(R.x1 - bboxC[0]) ? 'nx' : 'px');
    const n = inward(inner), yaw = yawTo(n); const offs: number[] = [0]; for (let a = 0.6; a <= long / 2 - 1.2; a += 0.6) offs.push(a, -a);
    for (const a of offs) {
      const c = nearWall(R, inner, 0.58, a); const why = p.check(c.x, c.z, yaw, 2.3, 0.95, 0.1); if (why) { if (a === 0) p.placed.push({ x: c.x, z: c.z, yaw, w: 2.3, d: 0.95, fail: true, why }); continue; }
      let ok = 0; for (const sg of [-1, 1]) { const q = nearWall(R, inner, 0.58, a + sg * 0.72); if (p.put(F.rattanChair(), q.x, q.z, yaw - sg * 0.3 * (inner === 'pz' || inner === 'nx' ? 1 : -1), 0.85, 0.85, p.matte, 0.1)) ok++; }
      if (!ok) continue; const tb = nearWall(R, inner, 0.5, a); p.put(F.sideTable(), tb.x, tb.z, 0, 0.42, 0.42, p.matte, 0.1);
      return true;
    }
    // вдоль стены дома сплошь двери — кресла у ограждения, друг напротив друга вдоль балкона, столик между ними
    const outer = opposite(inner); const t = alongX ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    for (const a of offs) {
      const c = nearWall(R, outer, 0.55, a); if (!p.free(c.x, c.z, alongX ? 0 : Math.PI / 2, 2.5, 0.9, 0.1)) continue;
      let ok = 0; for (const sg of [-1, 1]) if (p.put(F.rattanChair(), c.x + t.x * sg * 0.82, c.z + t.z * sg * 0.82, yawTo(t.clone().multiplyScalar(-sg)), 0.85, 0.85, p.matte, 0.1)) ok++;
      if (!ok) continue; p.put(F.sideTable(), c.x, c.z, 0, 0.42, 0.42, p.matte, 0.1);
      return true;
    }
    return false;
  };
  if (pools.length && !covered && short >= 2.6 && sunbeds(area >= 45 ? 2 : 1)) notes.push('sunbeds');
  if (area >= 18 && short >= 2.9 && lounge()) notes.push('lounge');
  if (pools.length && covered && short >= 2.6 && sunbeds(1)) notes.push('sunbeds');
  if (area >= 40 && short >= 4.5) { // большая терраса: уличный обеденный стол на свободном месте
    const alongX = W >= D; const cells: [number, number][] = []; for (let x = R.x0 + 1.4; x <= R.x1 - 1.4 + 1e-6; x += 0.5) for (let z = R.z0 + 1.4; z <= R.z1 - 1.4 + 1e-6; z += 0.5) cells.push([x, z]);
    cells.sort((a, b) => Math.hypot(a[0] - r.cx, a[1] - r.cz) - Math.hypot(b[0] - r.cx, b[1] - r.cz));
    for (const [x, z] of cells) { if (!p.free(x, z, 0, alongX ? 2.5 : 2.9, alongX ? 2.9 : 2.5, 0) || !p.onPaving(x, z, 0, alongX ? 2.5 : 2.9, alongX ? 2.9 : 2.5)) continue; if (putDining(p, r, x, z, alongX, 2.0, false)) { notes.push('dining'); break; } }
  }
  if (!notes.length && short >= 1.35 && long >= 2.4 && !r.leaked && bistro()) notes.push('bistro');
  if (notes.length) (p as unknown as { note: string }).note = notes.join('+');
  if (short < 1.35 || r.leaked) return; // узкий проход или контур «утёк» (углы коробки — посреди террасы) — без кадок
  // кадки — только в свободные углы террасы (не у проёмов и лестниц), как растения в комнатах
  if (short >= 2.6) { p.putPlant(F.planter(seed), 0.9); p.putPlant(F.planter(seed + 1), 0.9); } else if (long >= 3) p.putPlant(F.planter(seed), 0.7);
  // место у наружного края террасы (сторона, дальняя от центра дома): стоит в 0,7 м от кромки, смотрит наружу
  if (area >= 6 && short >= 2.6) {
    const sides: { d: number; x: number; z: number; yaw: number }[] = [
      { d: Math.abs(r.rect.x1 - bboxC[0]), x: r.rect.x1 - 0.7, z: r.cz, yaw: Math.PI / 2 }, { d: Math.abs(r.rect.x0 - bboxC[0]), x: r.rect.x0 + 0.7, z: r.cz, yaw: -Math.PI / 2 },
      { d: Math.abs(r.rect.z1 - bboxC[1]), x: r.cx, z: r.rect.z1 - 0.7, yaw: 0 }, { d: Math.abs(r.rect.z0 - bboxC[1]), x: r.cx, z: r.rect.z0 + 0.7, yaw: Math.PI },
    ].sort((a, b) => b.d - a.d);
    for (const sd of sides.slice(0, 2)) { const off = ((seed % 3) - 1) * 0.6; const x = sd.yaw === 0 || sd.yaw === Math.PI ? sd.x + off : sd.x, z = sd.yaw === 0 || sd.yaw === Math.PI ? sd.z : sd.z + off; if (p.canStand(x, z)) { spots.push({ x, y: r.y, z, yaw: sd.yaw, kind: 'rail' }); break; } }
  }
}

/** Марши: кластеры отрезков лестниц плана (ближе 1 м друг к другу) → габариты. */
export function stairFlights(segs: Seg[]): Rect[] {
  const used = new Uint8Array(segs.length); const out: Rect[] = [];
  const bb = (s: Seg): Rect => ({ x0: Math.min(s[0], s[2]), z0: Math.min(s[1], s[3]), x1: Math.max(s[0], s[2]), z1: Math.max(s[1], s[3]) });
  const near = (a: Rect, b: Rect) => a.x0 - 1 < b.x1 && b.x0 - 1 < a.x1 && a.z0 - 1 < b.z1 && b.z0 - 1 < a.z1;
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = 1; const r = bb(segs[i]); let grown = true;
    while (grown) { grown = false; for (let j = 0; j < segs.length; j++) { if (used[j]) continue; const q = bb(segs[j]); if (near(r, q)) { used[j] = 1; r.x0 = Math.min(r.x0, q.x0); r.z0 = Math.min(r.z0, q.z0); r.x1 = Math.max(r.x1, q.x1); r.z1 = Math.max(r.z1, q.z1); grown = true; } } }
    out.push(r);
  }
  return out;
}
/** Прямоугольники комнат плана по предикату имени (заливкой, как при расстановке мебели) — для точных коробок санузлов. */
export function roomRects(plan: Plan, glass: Box3[], pred: (name: string) => boolean): { rect: Rect; level: number; x: number; z: number; area: number | null }[] {
  const out: { rect: Rect; level: number; x: number; z: number; area: number | null }[] = [];
  for (const l of plan.levels) for (const r of l.rooms) {
    if (!pred(r.name)) continue;
    let rect = roomRect(l, plan.bbox, r.x, r.z, r.area, glass, [], false);
    if (r.area && (rect.x1 - rect.x0) * (rect.z1 - rect.z0) > 3.5 * r.area) { const h = Math.sqrt(r.area) * 0.9; rect = { x0: Math.max(rect.x0, r.x - h), z0: Math.max(rect.z0, r.z - h), x1: Math.min(rect.x1, r.x + h), z1: Math.min(rect.z1, r.z + h) }; }
    out.push({ rect, level: l.level, x: r.x, z: r.z, area: r.area });
  }
  return out;
}
/** Собирает мебель всей виллы: Group из трёх мешей (матовая мебель, абажуры, холсты). */
/** Коробки воды (бассейны, пруды) — мебель на них не ставим. */
export function waterBoxes(root: Object3D): Box3[] {
  const out: Box3[] = []; root.updateMatrixWorld(true);
  root.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.userData.role === 'water') out.push(new Box3().setFromObject(m)); });
  return out;
}
export function furnishVilla(plan: Plan, glass: Box3[], passages: Passage[], artTexture: Texture, detail?: DetailMaps, water: Box3[] = [], support: ((x: number, y: number, z: number) => boolean) | null = null, obstacle: ((x: number, y: number, z: number) => number | null) | null = null, wallProbe: ((x: number, y: number, z: number, nx: number, nz: number) => boolean) | null = null, topAt: ((x: number, y: number, z: number) => number | null) | null = null, wallDist: WallDist | null = null, paved: ((x: number, y: number, z: number) => boolean) | null = null): Group {
  const matte: BufferGeometry[] = [], shade: BufferGeometry[] = [], art: BufferGeometry[] = [], glassParts: BufferGeometry[] = [], tiles: BufferGeometry[] = [];
  const dbg: unknown[] = []; const W = window as unknown as { __rooms: Record<string, unknown[]> }; W.__rooms = { ...(W.__rooms && !Array.isArray(W.__rooms) ? W.__rooms : {}), [plan.villa]: dbg }; // отладка: комнаты по виллам
  let seed = 1; spots = []; bboxC = [(plan.bbox[0] + plan.bbox[2]) / 2, (plan.bbox[1] + plan.bbox[3]) / 2];
  for (const l of plan.levels) {
    const kitchens = l.rooms.filter((r) => kindOf(r.name) === 'kitchen');
    // открытая планировка: метка кухни (до 20 м²) и метки зон отдыха лежат в одном пространстве без перегородок —
    // комната обставляется целиком (furnishOpenPlan), зоны отдыха внутри неё отдельной мебели не получают
    const openOf = new Map<unknown, Rect>(); const consumed = new Set<unknown>();
    for (const k of kitchens) {
      if (k.area && k.area > 25) { // большая «кухня» (вилла 1: 44 м²) — это кухня-гостиная целиком: гарнитур, стол и диван
        let rr = roomRect(l, plan.bbox, k.x, k.z, k.area, glass, passages, false); if (wallDist) rr = snapRect(rr, l.level, wallDist); openOf.set(k, rr); continue; }
      if (!k.area || k.area > 20) continue; const o = openRect(l, plan.bbox, k.x, k.z, glass, passages); if (!o) continue;
      const inside = l.rooms.filter((v) => kindOf(v.name) === 'living' && o.has(v.x, v.z)); const a = (o.rect.x1 - o.rect.x0) * (o.rect.z1 - o.rect.z0);
      if (!inside.length || a < 20 || a < 1.5 * k.area) continue;
      openOf.set(k, o.rect); inside.forEach((v) => consumed.add(v));
    }
    const livings = l.rooms.filter((r) => kindOf(r.name) === 'living' && !consumed.has(r));
    // из двух зон отдыха ближняя к кухне — столовая
    const diningFromLiving = livings.length >= 2 && kitchens.length ? livings.slice().sort((a, b) => Math.hypot(a.x - kitchens[0].x, a.z - kitchens[0].z) - Math.hypot(b.x - kitchens[0].x, b.z - kitchens[0].z))[0] : null;
    // прямоугольники всех комнат уровня; меньшие расставляются первыми, дубликаты (та же площадь дважды в плане) пропускаются,
    // крупные комнаты не ставят мебель на площадь, уже занятую меньшей
    // маленькие служебные помещения (туалет, техническая, кладовая) — блокируют мебель квадратом своей площади вокруг метки
    const service: Rect[] = l.rooms.filter((r) => { const k = kindOf(r.name); return k === 'skip' && !!r.area && r.area > 1 && r.area < 14; })
      .map((r) => { const h = Math.sqrt(r.area ?? 4) / 2; return { x0: r.x - h, z0: r.z - h, x1: r.x + h, z1: r.z + h }; });
    const items = l.rooms.map((room) => {
      let kind = kindOf(room.name); if (room === diningFromLiving) kind = 'dining';
      if (kind === 'skip' || consumed.has(room)) return null;
      if (openOf.has(room)) { let rect = openOf.get(room)!; if (wallDist && !(room.area && room.area > 25)) rect = snapRect(rect, l.level, wallDist); return { room, kind: 'open' as Kind, rect, leaked: false, a: (rect.x1 - rect.x0) * (rect.z1 - rect.z0) }; }
      let rect = roomRect(l, plan.bbox, room.x, room.z, room.area, glass, passages, kind === 'terrace');
      // заливка «утекла» (bbox сильно больше площади помещения) — ограничиваем коробкой вокруг метки
      let leaked = false;
      if (room.area && (rect.x1 - rect.x0) * (rect.z1 - rect.z0) > 3.5 * room.area && kind !== 'terrace') {
        if (kind === 'bedroom') return null; leaked = true; // метка спальни внутри большего помещения (гардероб, зона в спальне) — вторая кровать в той же комнате не нужна
        const h = Math.sqrt(room.area) * 0.9;
        rect = { x0: Math.max(rect.x0, room.x - h), z0: Math.max(rect.z0, room.z - h), x1: Math.min(rect.x1, room.x + h), z1: Math.min(rect.z1, room.z + h) };
      }
      if (wallDist && !leaked && (kind === 'bath' || kind === 'wc' || kind === 'laundry' || kind === 'kitchen')) rect = snapRect(rect, l.level, wallDist); // сантехника и гарнитур — вплотную к реальной стене
      return { room, kind, rect, leaked, a: (rect.x1 - rect.x0) * (rect.z1 - rect.z0) };
    }).filter((it): it is NonNullable<typeof it> => !!it);
    const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));
    // открытый план: гостиная и столовая (или две зоны) делят одно пространство — режем по серединному перпендикуляру между их метками
    const zones = items.filter((it) => it.kind === 'living' || it.kind === 'dining');
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
      const A = zones[i], B = zones[j]; if (overlap(A.rect, B.rect) < 0.3 * Math.min(A.a, B.a)) continue;
      const dx = B.room.x - A.room.x, dz = B.room.z - A.room.z;
      if (Math.abs(dx) >= Math.abs(dz)) { const m = (A.room.x + B.room.x) / 2; if (dx > 0) { A.rect = { ...A.rect, x1: Math.min(A.rect.x1, m) }; B.rect = { ...B.rect, x0: Math.max(B.rect.x0, m) }; } else { A.rect = { ...A.rect, x0: Math.max(A.rect.x0, m) }; B.rect = { ...B.rect, x1: Math.min(B.rect.x1, m) }; } }
      else { const m = (A.room.z + B.room.z) / 2; if (dz > 0) { A.rect = { ...A.rect, z1: Math.min(A.rect.z1, m) }; B.rect = { ...B.rect, z0: Math.max(B.rect.z0, m) }; } else { A.rect = { ...A.rect, z0: Math.max(A.rect.z0, m) }; B.rect = { ...B.rect, z1: Math.min(B.rect.z1, m) }; } }
      for (const it of [A, B]) it.a = (it.rect.x1 - it.rect.x0) * (it.rect.z1 - it.rect.z0);
    }
    items.sort((p, q) => p.a - q.a);
    const claimed: Rect[] = service.slice();
    for (const [x1, z1, x2, z2] of l.stairs) claimed.push({ x0: Math.min(x1, x2) - 0.6, z0: Math.min(z1, z2) - 0.6, x1: Math.max(x1, x2) + 0.6, z1: Math.max(z1, z2) + 0.6 }); // лестницы плана: мебель и кадки не на проходе
    const far = claimed.slice(); // служебные зоны и лестницы: кадки не ближе 2,5 м
    const waterR: Rect[] = water.filter((b) => b.max.y > l.level - 1 && b.min.y < l.level + 1).map((b) => ({ x0: b.min.x, z0: b.min.z, x1: b.max.x, z1: b.max.z }));
    for (const b of water) if (b.max.y > l.level - 1 && b.min.y < l.level + 1) claimed.push({ x0: b.min.x - 0.3, z0: b.min.z - 0.3, x1: b.max.x + 0.3, z1: b.max.z + 0.3 }); // вода этого уровня
    if (import.meta.env.DEV) (window as unknown as { __service: unknown[] }).__service = [...((window as unknown as { __service?: unknown[] }).__service ?? []), { level: l.level, service, rooms: l.rooms.map((r) => [r.name, r.area, +r.x.toFixed(1), +r.z.toFixed(1)]) }];
    for (const { room, kind, rect, a, leaked } of items) {
      if (a < 0.5 || claimed.slice(service.length + water.length).some((c) => overlap(rect, c) > 0.7 * a)) continue;
      const walls = rect;
      const info: RoomInfo = { name: room.name, kind, y: l.level, rect, cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, area: room.area, leaked,
        glass: { px: glassOnSide(rect, l.level, 'px', glass), nx: glassOnSide(rect, l.level, 'nx', glass), pz: glassOnSide(rect, l.level, 'pz', glass), nz: glassOnSide(rect, l.level, 'nz', glass) } };
      info.label = [room.x, room.z];
      // контур, привязанный к реальным стенам, служебными «квадратами по площади» (вход, техпомещение за стеной) не режем
      const exact = !!wallDist && !leaked && (kind === 'open' || kind === 'kitchen' || kind === 'bath' || kind === 'wc' || kind === 'laundry');
      const p = new Placer(info, passages, exact ? claimed.slice(service.length) : claimed.slice(), support, obstacle); p.wallProbe = wallProbe; p.far = far; p.glassB = glass; p.water = waterR; p.paved = paved; p.cross = wallDist; p.dense = kind === 'terrace' ? 0.1 : kind === 'open' ? 0.25 : 0; seed += 3; claimed.push(rect); // dense: на террасе стен с бра нет — сетка до самого края (колонны навесов)
      dbg.push({ name: room.name, kind, level: l.level, rect: [rect.x0, rect.z0, rect.x1, rect.z1].map((v) => +v.toFixed(1)), walls: [walls.x0, walls.z0, walls.x1, walls.z1].map((v) => +v.toFixed(1)), glass: info.glass, items: p.placed, note: '' });
      if (kind === 'bedroom') furnishBedroom(p, info, seed);
      else if (kind === 'living') furnishLiving(p, info, seed);
      else if (kind === 'dining') furnishDining(p, info);
      else if (kind === 'bath') furnishBath(p, info, seed);
      else if (kind === 'wc') furnishBath(p, info, seed, false);
      else if (kind === 'laundry') furnishLaundry(p, info);
      else if (kind === 'open') furnishOpenPlan(p, info, seed);
      else if (kind === 'terrace') furnishTerrace(p, info, seed);
      else if (kind === 'kitchen') furnishKitchen(p, info);
      (dbg[dbg.length - 1] as { placed: number; note: string }).placed = p.placed.filter((it) => !it.fail).length; (dbg[dbg.length - 1] as { note: string }).note = (p as unknown as { note?: string }).note ?? '';
      matte.push(...p.matte); shade.push(...p.shade); art.push(...p.art); glassParts.push(...p.glassParts); tiles.push(...p.tile);
    }
    // перила по линиям ограждений плана (террасы, балконы, площадки): стойки, деревянный поручень, стекло;
    // не на лестничных маршах (у них свой уклон) и только там, где под обоими концами есть пол
    const lvlInfo: RoomInfo = { name: 'level', kind: 'skip', y: l.level, rect: { x0: plan.bbox[0] - 1, z0: plan.bbox[1] - 1, x1: plan.bbox[2] + 1, z1: plan.bbox[3] + 1 }, cx: 0, cz: 0, glass: { px: 0, nx: 0, pz: 0, nz: 0 }, area: null };
    const lp = new Placer(lvlInfo, passages, [], support, null);
    for (const [x1, z1, x2, z2] of l.rails) {
      const L = Math.hypot(x2 - x1, z2 - z1); if (L < 0.6) continue;
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      if (l.stairs.some(([sx1, sz1, sx2, sz2]) => mx > Math.min(sx1, sx2) - 0.8 && mx < Math.max(sx1, sx2) + 0.8 && mz > Math.min(sz1, sz2) - 0.8 && mz < Math.max(sz1, sz2) + 0.8)) continue;
      const yaw = Math.atan2(-(z2 - z1), x2 - x1); const r = F.railing(L);
      lp.putRail(r, x1, z1, x2, z2, yaw);
    }
    matte.push(...lp.matte); glassParts.push(...lp.glassParts);
    // перила лестничных маршей: отрезки stairs плана группируются в марши (габарит кластера), уклон — по высоте
    // ступеней на концах (луч сверху), ограждение ставится на стороне, где нет стены
    for (const fl of stairFlights(l.stairs)) {
      const lw = fl.x1 - fl.x0, ld = fl.z1 - fl.z0; const alongX = lw >= ld; const L = Math.max(lw, ld), S = Math.min(lw, ld);
      if (L < 1.6 || S < 0.7 || S > 3.0 || !topAt) continue;
      const cx = (fl.x0 + fl.x1) / 2, cz = (fl.z0 + fl.z1) / 2;
      const a = alongX ? [fl.x0 + 0.3, cz] : [cx, fl.z0 + 0.3], b = alongX ? [fl.x1 - 0.3, cz] : [cx, fl.z1 - 0.3];
      const ha = topAt(a[0], l.level, a[1]), hb = topAt(b[0], l.level, b[1]); if (ha === null || hb === null) continue;
      const rise = hb - ha; if (Math.abs(rise) < 0.6 || Math.abs(rise) > 4.2) continue;
      const base = Math.min(ha, hb); const yaw = alongX ? (rise >= 0 ? 0 : Math.PI) : (rise >= 0 ? -Math.PI / 2 : Math.PI / 2); // +x геометрии — в сторону подъёма
      for (const side of [-1, 1]) {
        const off = S / 2 + 0.05; const px = alongX ? cx : cx + side * off, pz = alongX ? cz + side * off : cz;
        const nx = alongX ? 0 : -side, nz = alongX ? -side : 0; // нормаль от перил внутрь марша
        if (wallProbe && wallProbe(px, base, pz, -nx, -nz)) continue; // с этой стороны стена — перила не нужны
        matte.push(F.place(F.stairRail(L - 0.6, Math.abs(rise)), px, base, pz, yaw));
      }
    }
  }
  const g = new Group(); g.name = 'furniture';
  const mk = (parts: BufferGeometry[], mat: MeshStandardMaterial, name: string) => { if (!parts.length) return; const m = new Mesh(F.merge(parts), mat); m.name = name; m.castShadow = true; m.receiveShadow = true; m.userData.role = 'furniture'; g.add(m); };
  { const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: DoubleSide }); if (detail) applyDetailMaps(m, detail); mk(matte, m, 'furniture-matte'); }
  { const sm = new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide, emissive: '#ffd6a0', emissiveIntensity: 0.55 }); onEve((k) => { sm.emissiveIntensity = 0.55 + 3.4 * k; }); mk(shade, sm, 'furniture-shades'); } // вечером абажуры горят
  if (glassParts.length) { const gm = new Mesh(F.merge(glassParts), new MeshStandardMaterial({ color: '#dceef4', transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, side: DoubleSide })); gm.name = 'furniture-glass'; gm.renderOrder = 10; gm.userData.role = 'furniture'; gm.userData.noCollide = false; g.add(gm); }
  // холсты: UV в [0,1] по картине — текстура из двух работ, каждому холсту своя половина
  if (art.length) {
    art.forEach((c, i) => { const uv = c.getAttribute('uv'); if (uv) for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + (i % 2) * 0.5); });
    mk(art, new MeshStandardMaterial({ map: artTexture, roughness: 0.9 }), 'furniture-art');
  }
  // настенная плитка санузлов: своя текстура (глазурованная, 10 см), полуглянец
  if (tiles.length) { zellige ??= makeZelligeTexture(); zellige.wrapS = zellige.wrapT = RepeatWrapping; const tm = new Mesh(F.merge(tiles), new MeshStandardMaterial({ map: zellige, roughness: 0.32, metalness: 0, side: DoubleSide })); tm.name = 'furniture-tile'; tm.receiveShadow = true; tm.userData.role = 'furniture'; tm.userData.noCollide = true; g.add(tm); }
  g.userData.spots = spots; // места гостей на террасах — клоны домов наследуют (userData копируется)
  return g;
}

/** Отладка (dev, ?plandebug): план каждого уровня с прямоугольниками комнат, стеклом, проёмами и следами мебели → app/captures/. */
export async function debugPlanImage(villaId: string, plan: Plan, glass: Box3[], passages: Passage[]) {
  const dbg = (window as unknown as { __rooms?: Record<string, { level: number; rect: number[]; walls: number[]; name: string; items: { x: number; z: number; yaw: number; w: number; d: number; fail?: boolean }[] }[]> }).__rooms?.[villaId] ?? [];
  const [bx0, bz0, bx1, bz1] = plan.bbox; const S = 40; const W = Math.ceil((bx1 - bx0 + 2) * S), H = Math.ceil((bz1 - bz0 + 2) * S);
  const X = (x: number) => (x - bx0 + 1) * S, Z = (z: number) => (z - bz0 + 1) * S;
  for (const l of plan.levels) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#999'; for (const poly of l.wallPolys ?? []) { ctx.beginPath(); for (let k = 0; k < poly.length; k += 2) ctx[k ? 'lineTo' : 'moveTo'](X(poly[k]), Z(poly[k + 1])); ctx.closePath(); ctx.fill(); }
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; for (const [x1, z1, x2, z2] of l.slabs) { ctx.beginPath(); ctx.moveTo(X(x1), Z(z1)); ctx.lineTo(X(x2), Z(z2)); ctx.stroke(); }
    ctx.strokeStyle = '#3af'; ctx.lineWidth = 3; for (const b of glass) if (b.min.y < l.level + 2.6 && b.max.y > l.level + 0.4) ctx.strokeRect(X(b.min.x), Z(b.min.z), (b.max.x - b.min.x) * S, (b.max.z - b.min.z) * S);
    ctx.fillStyle = 'rgba(255,0,0,.35)'; for (const p of passages) if (p.min[1] < l.level + 2.2 && p.max[1] > l.level + 0.2) ctx.fillRect(X(p.min[0]), Z(p.min[2]), (p.max[0] - p.min[0]) * S, (p.max[2] - p.min[2]) * S);
    for (const r of dbg) {
      if (r.level !== l.level) continue;
      ctx.strokeStyle = '#0a0'; ctx.lineWidth = 2; ctx.strokeRect(X(r.rect[0]), Z(r.rect[1]), (r.rect[2] - r.rect[0]) * S, (r.rect[3] - r.rect[1]) * S);
      ctx.strokeStyle = '#8c8'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.strokeRect(X(r.walls[0]), Z(r.walls[1]), (r.walls[2] - r.walls[0]) * S, (r.walls[3] - r.walls[1]) * S); ctx.setLineDash([]);
      ctx.fillStyle = '#060'; ctx.font = '12px sans-serif'; ctx.fillText(r.name.slice(0, 14), X(r.rect[0]) + 3, Z(r.rect[1]) + 13);
      ctx.fillStyle = 'rgba(180,90,30,.6)';
      for (const it of r.items) { ctx.save(); ctx.translate(X(it.x), Z(it.z)); ctx.rotate(-it.yaw);
        if (it.fail) { ctx.strokeStyle = '#e00'; ctx.lineWidth = 1; ctx.strokeRect(-it.w / 2 * S, -it.d / 2 * S, it.w * S, it.d * S); }
        else { ctx.fillStyle = it.w * it.d > 5 ? 'rgba(180,140,60,.25)' : 'rgba(180,90,30,.6)'; ctx.fillRect(-it.w / 2 * S, -it.d / 2 * S, it.w * S, it.d * S); ctx.fillStyle = '#000'; ctx.fillRect(-2, it.d / 2 * S - 4, 4, 4); }
        ctx.restore(); }
      ctx.fillStyle = '#060'; ctx.fillText((r as unknown as { note: string }).note + ' g:' + ['px', 'nx', 'pz', 'nz'].map((k) => (r as unknown as { glass: Record<string, number> }).glass[k].toFixed(1)).join('/'), X(r.rect[0]) + 3, Z(r.rect[1]) + 25);
    }
    for (const room of l.rooms) { ctx.fillStyle = '#c00'; ctx.beginPath(); ctx.arc(X(room.x), Z(room.z), 3, 0, 7); ctx.fill(); }
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (blob) await fetch('/__save?name=' + encodeURIComponent(`plan_${villaId}_${l.id}.png`), { method: 'POST', body: blob });
  }
}
