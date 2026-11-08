// «Дизайнер» интерьеров: по планам этажей (public/plans/<villa>.json) и стеклу модели расставляет процедурную
// мебель (Furniture.ts) по правилам стайл-гайда: кровать изголовьем к глухой стене, диван лицом к остеклению,
// ничего в дверных проёмах. Результат — Group в координатах виллы (как в прогулке), 3 меша на виллу.
import { Box3, BufferGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type Texture } from 'three';
import type { Plan, PlanLevel } from '../plan';
import type { Passage } from '../models';
import { labelComponents } from '../materials';
import * as F from './Furniture';
import { applyDetailMaps, type DetailMaps } from './textures';

type Rect = { x0: number; z0: number; x1: number; z1: number };
type Side = 'px' | 'nx' | 'pz' | 'nz';
type RoomInfo = { name: string; kind: Kind; y: number; rect: Rect; cx: number; cz: number; glass: Record<Side, number>; area: number | null };
type Kind = 'bedroom' | 'living' | 'dining' | 'bath' | 'terrace' | 'kitchen' | 'skip';

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
  if (n.includes('terrace') || n.includes('balcony')) return 'terrace';
  if (n.includes('kitchen')) return 'kitchen';
  return 'skip';
}

/** Границы комнаты заливкой по растру 0,2 м: стены (wallPolys), проёмы дверей и стеклянные стены — препятствия,
 *  для террас ещё и кромки плит; при открытой планировке разлив ограничен площадью комнаты из плана (×1,6). */
function roomRect(l: PlanLevel, bbox: [number, number, number, number], cx: number, cz: number, area: number | null, glass: Box3[], passages: Passage[], terrace: boolean): Rect {
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
  for (const p of passages) if (p.min[1] < l.level + 2.2 && p.max[1] > l.level + 0.2) fillRect(p.min[0], p.min[2], p.max[0], p.max[2]);
  for (const b of glass) if (b.min.y < l.level + 2.6 && b.max.y > l.level + 0.4) fillRect(b.min.x - 0.08, b.min.z - 0.08, b.max.x + 0.08, b.max.z + 0.08);
  if (terrace) for (const [x1, z1, x2, z2] of l.slabs) fillRect(Math.min(x1, x2) - 0.05, Math.min(z1, z2) - 0.05, Math.max(x1, x2) + 0.05, Math.max(z1, z2) + 0.05);
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
  matte: BufferGeometry[] = []; shade: BufferGeometry[] = []; art: BufferGeometry[] = [];
  private room: RoomInfo; private passages: Passage[]; private blocked: Rect[]; private support: ((x: number, y: number, z: number) => boolean) | null;
  constructor(room: RoomInfo, passages: Passage[], blocked: Rect[] = [], support: ((x: number, y: number, z: number) => boolean) | null = null) { this.room = room; this.passages = passages; this.blocked = blocked; this.support = support; }
  private ok(x: number, z: number, w: number, d: number, yaw: number, margin = 0.15) {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    const r = this.room.rect; if (x - hw < r.x0 - margin || x + hw > r.x1 + margin || z - hd < r.z0 - margin || z + hd > r.z1 + margin) return false;
    // площадь, уже занятая другой (меньшей) комнатой того же уровня — например «открытая терраса» внутри «крытой»
    for (const b of this.blocked) if (x + hw > b.x0 + 0.05 && x - hw < b.x1 - 0.05 && z + hd > b.z0 + 0.05 && z - hd < b.z1 - 0.05) return false;
    const y = this.room.y;
    for (const p of this.passages) {
      if (p.max[1] < y + 0.2 || p.min[1] > y + 2.2) continue;
      if (x + hw > p.min[0] - 0.15 && x - hw < p.max[0] + 0.15 && z + hd > p.min[2] - 0.15 && z - hd < p.max[2] + 0.15) return false;
    }
    return true;
  }
  placed: { x: number; z: number; yaw: number; w: number; d: number; fail?: boolean; soft?: boolean }[] = [];
  /** Можно ли здесь стоять человеку: в комнате, не в проёме, не в мебели, под ногами пол. */
  canStand(x: number, z: number) {
    if (!this.ok(x, z, 0.5, 0.5, 0, 0)) return false;
    for (const it of this.placed) { if (it.fail || it.soft) continue; const ic = Math.abs(Math.cos(it.yaw)), is = Math.abs(Math.sin(it.yaw)); const ihw = (it.w * ic + it.d * is) / 2, ihd = (it.w * is + it.d * ic) / 2; if (Math.abs(it.x - x) < 0.25 + ihw && Math.abs(it.z - z) < 0.25 + ihd) return false; }
    return !this.support || this.support(x, this.room.y, z);
  }
  /** soft — ковёр: может лежать под другими предметами. Предметы не пересекаются и стоят только там, где под ними есть пол. */
  put(g: BufferGeometry, x: number, z: number, yaw: number, w: number, d: number, list: BufferGeometry[] = this.matte, margin = 0.15, soft = false) {
    const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)); const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    let ok = this.ok(x, z, w, d, yaw, margin);
    if (ok && !soft) for (const it of this.placed) {
      if (it.fail || it.soft) continue;
      const ic = Math.abs(Math.cos(it.yaw)), is = Math.abs(Math.sin(it.yaw)); const ihw = (it.w * ic + it.d * is) / 2, ihd = (it.w * is + it.d * ic) / 2;
      if (Math.abs(it.x - x) < hw + ihw - 0.02 && Math.abs(it.z - z) < hd + ihd - 0.02) { ok = false; break; }
    }
    if (ok && this.support) { // пол под центром и четырьмя углами (чуть внутрь), иначе предмет висел бы в воздухе
      const y = this.room.y; const pts: [number, number][] = [[x, z], [x - hw + 0.1, z - hd + 0.1], [x + hw - 0.1, z - hd + 0.1], [x - hw + 0.1, z + hd - 0.1], [x + hw - 0.1, z + hd - 0.1]];
      for (const [px, pz] of pts) if (!this.support(px, y, pz)) { ok = false; break; }
    }
    if (!ok) { this.placed.push({ x, z, yaw, w, d, fail: true }); return false; }
    list.push(F.place(g, x, this.room.y, z, yaw)); this.placed.push({ x, z, yaw, w, d, soft }); return true;
  }
  putAt(g: BufferGeometry, x: number, y: number, z: number, yaw: number, list: BufferGeometry[] = this.matte) { list.push(F.place(g, x, y, z, yaw)); }
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
  for (const side of order) {
    if (r.glass[side] > 0.6 || sideLen(r.rect, side) < 2.4 || depth(r.rect, side) < 2.7) continue;
    solid = side; bedW = sideLen(r.rect, side) > 3.6 ? 1.8 : 1.5; yaw = yawTo(inward(side)); const bedG = F.bed(bedW, 2.1);
    for (const along of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) { w = nearWall(r.rect, side, 1.15, along); if (p.put(bedG, w.x, w.z, yaw, bedW + 0.1, 2.2)) { placed = true; break; } }
    if (placed) break;
  }
  if (!placed) return;
  (p as unknown as { note: string }).note = 'bed@' + solid;
  const t = new Vector3(-w.n.z, 0, w.n.x); // вдоль стены
  for (const s of [-1, 1]) {
    const bx = w.x + t.x * s * (bedW / 2 + 0.4) - w.n.x * 0.7, bz = w.z + t.z * s * (bedW / 2 + 0.4) - w.n.z * 0.7;
    if (p.put(F.bedside(), bx, bz, yaw, 0.5, 0.45)) { const lamp = F.tableLamp(); p.putAt(lamp.body, bx, r.y + 0.53, bz, 0); p.putAt(lamp.shade, bx, r.y + 0.53, bz, 0, p.shade); }
  }
  p.put(F.rug(bedW + 1.6, 2.2), w.x + w.n.x * 0.9, w.z + w.n.z * 0.9, yaw, bedW + 1.6, 2.2, p.matte, 0.3, true);
  // диптих над кроватью (на глухой стене)
  if (r.glass[solid] < 0.3) for (const s of [-1, 1]) { const a = F.artFrame(0.6, 0.8); const ax = w.x - w.n.x * 1.1 + t.x * s * 0.42, az = w.z - w.n.z * 1.1 + t.z * s * 0.42; p.putAt(a.frame, ax, r.y + 1.45, az, yaw); p.putAt(a.canvas, ax, r.y + 1.45, az, yaw, p.art); }
  // кресло и растение по углам у стены напротив стекла
  const corner = (sideA: Side, sideB: Side) => ({ x: sideA === 'px' || sideB === 'px' ? r.rect.x1 - 0.6 : r.rect.x0 + 0.6, z: sideA === 'pz' || sideB === 'pz' ? r.rect.z1 - 0.6 : r.rect.z0 + 0.6 });
  const view = SIDES.slice().sort((a, b) => r.glass[b] - r.glass[a])[0];
  const others = SIDES.filter((s) => s !== solid && s !== opposite(solid));
  const c1 = corner(solid, others[0]), c2 = corner(solid, others[1]);
  const toCentre = (c: { x: number; z: number }) => yawTo(new Vector3(r.cx - c.x, 0, r.cz - c.z));
  p.put(F.rattanChair(), c1.x, c1.z, toCentre(c1), 0.9, 0.9) || p.put(F.floorVase(), c1.x, c1.z, 0, 0.5, 0.5);
  p.put(F.pottedPlant('kentia', seed), c2.x, c2.z, 0, 0.8, 0.8);
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
    const c = r.cx, d = r.cz; (p as unknown as { note: string }).note = 'chairs';
    if (p.put(F.armchair(false), c - 0.8, d, Math.PI / 2, 0.85, 0.85)) { p.put(F.armchair(true), c + 0.8, d, -Math.PI / 2, 0.85, 0.85); p.put(F.sideTable(), c, d, 0, 0.5, 0.5); return; }
    // проходная зона: хотя бы растение в кадке у центра
    for (const [ox, oz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) if (p.put(F.pottedPlant('kentia'), c + ox, d + oz, 0, 0.6, 0.6)) { (p as unknown as { note: string }).note = 'plant'; break; }
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
    const a = F.artFrame(1.1, 1.3); const wb = nearWall(r.rect, back, 0.04);
    p.putAt(a.frame, wb.x, r.y + 0.9, wb.z, face); p.putAt(a.canvas, wb.x, r.y + 0.9, wb.z, face, p.art);
  }
  const vx = w.x - t.x * (sofaLen / 2 + 0.6), vz = w.z - t.z * (sofaLen / 2 + 0.6); p.put(F.floorVase(), vx, vz, 0, 0.5, 0.5);
  const pc = { x: tx - t.x * (W / 2 - 0.7), z: tz - t.z * (W / 2 - 0.7) }; p.put(F.pottedPlant('strelitzia', seed), pc.x, pc.z, 0, 0.9, 0.9);
  p.putAt(F.ceilingFan(), r.cx, r.y + 2.75, r.cz, 0);
}

function furnishDining(p: Placer, r: RoomInfo) {
  const W = r.rect.x1 - r.rect.x0, D = r.rect.z1 - r.rect.z0; if (W < 2.8 || D < 2.8) return;
  const alongX = W >= D; const len = Math.min(2.2, (alongX ? W : D) - 1.6), yaw = alongX ? Math.PI / 2 : 0;
  if (!p.put(F.diningTable(len, 0.95), r.cx, r.cz, yaw, 0.95, len)) return;
  const nC = Math.max(2, Math.floor(len / 0.65)); const t = alongX ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1), n = alongX ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  for (let i = 0; i < nC; i++) { const a = -len / 2 + (i + 0.5) * (len / nC); for (const s of [-1, 1]) { const cx = r.cx + t.x * a + n.x * s * 0.75, cz = r.cz + t.z * a + n.z * s * 0.75; p.put(F.chair(), cx, cz, yawTo(n.clone().multiplyScalar(-s)), 0.45, 0.45); } }
  for (let i = 0; i < Math.min(3, nC); i++) { const a = -len / 2 + (i + 0.5) * (len / Math.min(3, nC)); p.putAt(F.rattanPendant(0.28, 0.32, -0.8), r.cx + t.x * a, r.y + 2.9, r.cz + t.z * a, 0); }
}

function furnishBath(p: Placer, r: RoomInfo, seed: number) {
  const solid = SIDES.slice().sort((a, b) => r.glass[a] - r.glass[b])[0];
  const c = nearWall(r.rect, solid, 0.3, sideLen(r.rect, solid) / 2 - 0.5);
  p.put(F.towelLadder(), c.x, c.z, yawTo(c.n), 0.5, 0.3, p.matte, 0.3);
  const c2 = nearWall(r.rect, solid, 0.5, -(sideLen(r.rect, solid) / 2 - 0.5));
  p.put(F.pottedPlant('kentia', seed), c2.x, c2.z, 0, 0.7, 0.7, p.matte, 0.3);
}

/** Места для гостей на террасах (координаты виллы): у наружного края (стоять, смотреть на вид) и на диване (сидеть). */
export type TerraceSpot = { x: number; y: number; z: number; yaw: number; kind: 'rail' | 'sit' };
let spots: TerraceSpot[] = []; let bboxC: [number, number] = [0, 0];
function furnishTerrace(p: Placer, r: RoomInfo, seed: number) {
  const W = r.rect.x1 - r.rect.x0, D = r.rect.z1 - r.rect.z0;
  if ((r.area ?? W * D) >= 18 && W >= 3 && D >= 3) {
    const alongX = W >= D; const yaw = alongX ? 0 : Math.PI / 2; const n = alongX ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    const sx = r.cx - n.x * 1.1, sz = r.cz - n.z * 1.1;
    if (p.put(F.sofa(2.2, 3), sx, sz, yaw, 2.2, 0.95)) {
      p.put(F.coffeeTable(1.0, 0.6), r.cx + n.x * 0.3, r.cz + n.z * 0.3, yaw, 1.0, 0.6);
      spots.push({ x: sx + n.x * 0.2, y: r.y, z: sz + n.z * 0.2, yaw: Math.atan2(n.x, n.z), kind: 'sit' }); // сидит на диване лицом к столику
    }
    p.put(F.rug(3.0, 2.6, F.C.jute), r.cx, r.cz, yaw, 3.0, 2.6, p.matte, 0.3, true);
  }
  if (W < 1.8 || D < 1.8) return; // узкий балкон/проход — без кадок (кадка на парапете или у лестницы)
  const corners = [[r.rect.x0 + 0.75, r.rect.z0 + 0.75], [r.rect.x1 - 0.75, r.rect.z1 - 0.75]];
  corners.forEach(([x, z], i) => p.put(F.planter(seed + i), x, z, 0, 0.9, 0.9, p.matte, 0.0));
  // место у наружного края террасы (сторона, дальняя от центра дома): стоит в 0,7 м от кромки, смотрит наружу
  if ((r.area ?? W * D) >= 6) {
    const sides: { d: number; x: number; z: number; yaw: number }[] = [
      { d: Math.abs(r.rect.x1 - bboxC[0]), x: r.rect.x1 - 0.7, z: r.cz, yaw: Math.PI / 2 }, { d: Math.abs(r.rect.x0 - bboxC[0]), x: r.rect.x0 + 0.7, z: r.cz, yaw: -Math.PI / 2 },
      { d: Math.abs(r.rect.z1 - bboxC[1]), x: r.cx, z: r.rect.z1 - 0.7, yaw: 0 }, { d: Math.abs(r.rect.z0 - bboxC[1]), x: r.cx, z: r.rect.z0 + 0.7, yaw: Math.PI },
    ].sort((a, b) => b.d - a.d);
    for (const sd of sides.slice(0, 2)) { const off = ((seed % 3) - 1) * 0.6; const x = sd.yaw === 0 || sd.yaw === Math.PI ? sd.x + off : sd.x, z = sd.yaw === 0 || sd.yaw === Math.PI ? sd.z : sd.z + off; if (p.canStand(x, z)) { spots.push({ x, y: r.y, z, yaw: sd.yaw, kind: 'rail' }); break; } }
  }
}

/** Собирает мебель всей виллы: Group из трёх мешей (матовая мебель, абажуры, холсты). */
/** Коробки воды (бассейны, пруды) — мебель на них не ставим. */
export function waterBoxes(root: Object3D): Box3[] {
  const out: Box3[] = []; root.updateMatrixWorld(true);
  root.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.userData.role === 'water') out.push(new Box3().setFromObject(m)); });
  return out;
}
export function furnishVilla(plan: Plan, glass: Box3[], passages: Passage[], artTexture: Texture, detail?: DetailMaps, water: Box3[] = [], support: ((x: number, y: number, z: number) => boolean) | null = null): Group {
  const matte: BufferGeometry[] = [], shade: BufferGeometry[] = [], art: BufferGeometry[] = [];
  const dbg: unknown[] = []; (window as unknown as { __rooms: unknown }).__rooms = dbg;
  let seed = 1; spots = []; bboxC = [(plan.bbox[0] + plan.bbox[2]) / 2, (plan.bbox[1] + plan.bbox[3]) / 2];
  for (const l of plan.levels) {
    const kitchens = l.rooms.filter((r) => kindOf(r.name) === 'kitchen');
    const livings = l.rooms.filter((r) => kindOf(r.name) === 'living');
    // из двух зон отдыха ближняя к кухне — столовая
    const diningFromLiving = livings.length >= 2 && kitchens.length ? livings.slice().sort((a, b) => Math.hypot(a.x - kitchens[0].x, a.z - kitchens[0].z) - Math.hypot(b.x - kitchens[0].x, b.z - kitchens[0].z))[0] : null;
    // прямоугольники всех комнат уровня; меньшие расставляются первыми, дубликаты (та же площадь дважды в плане) пропускаются,
    // крупные комнаты не ставят мебель на площадь, уже занятую меньшей
    // маленькие служебные помещения (туалет, техническая, кладовая) — блокируют мебель квадратом своей площади вокруг метки
    const service: Rect[] = l.rooms.filter((r) => { const k = kindOf(r.name); return k === 'skip' && !!r.area && r.area > 1 && r.area < 14; })
      .map((r) => { const h = Math.sqrt(r.area ?? 4) / 2; return { x0: r.x - h, z0: r.z - h, x1: r.x + h, z1: r.z + h }; });
    const items = l.rooms.map((room) => {
      let kind = kindOf(room.name); if (room === diningFromLiving) kind = 'dining';
      if (kind === 'skip' || kind === 'kitchen') return null;
      let rect = roomRect(l, plan.bbox, room.x, room.z, room.area, glass, passages, kind === 'terrace');
      // заливка «утекла» (bbox сильно больше площади помещения) — ограничиваем коробкой вокруг метки
      if (room.area && (rect.x1 - rect.x0) * (rect.z1 - rect.z0) > 3.5 * room.area && kind !== 'terrace') {
        const h = Math.sqrt(room.area) * 0.9;
        rect = { x0: Math.max(rect.x0, room.x - h), z0: Math.max(rect.z0, room.z - h), x1: Math.min(rect.x1, room.x + h), z1: Math.min(rect.z1, room.z + h) };
      }
      return { room, kind, rect, a: (rect.x1 - rect.x0) * (rect.z1 - rect.z0) };
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
    for (const b of water) if (b.max.y > l.level - 1 && b.min.y < l.level + 1) claimed.push({ x0: b.min.x - 0.3, z0: b.min.z - 0.3, x1: b.max.x + 0.3, z1: b.max.z + 0.3 }); // вода этого уровня
    if (import.meta.env.DEV) (window as unknown as { __service: unknown[] }).__service = [...((window as unknown as { __service?: unknown[] }).__service ?? []), { level: l.level, service, rooms: l.rooms.map((r) => [r.name, r.area, +r.x.toFixed(1), +r.z.toFixed(1)]) }];
    for (const { room, kind, rect, a } of items) {
      if (a < 0.5 || claimed.slice(service.length + water.length).some((c) => overlap(rect, c) > 0.7 * a)) continue;
      const walls = rect;
      const info: RoomInfo = { name: room.name, kind, y: l.level, rect, cx: (rect.x0 + rect.x1) / 2, cz: (rect.z0 + rect.z1) / 2, area: room.area,
        glass: { px: glassOnSide(rect, l.level, 'px', glass), nx: glassOnSide(rect, l.level, 'nx', glass), pz: glassOnSide(rect, l.level, 'pz', glass), nz: glassOnSide(rect, l.level, 'nz', glass) } };
      const p = new Placer(info, passages, claimed.slice(), support); seed += 3; claimed.push(rect);
      dbg.push({ name: room.name, kind, level: l.level, rect: [rect.x0, rect.z0, rect.x1, rect.z1].map((v) => +v.toFixed(1)), walls: [walls.x0, walls.z0, walls.x1, walls.z1].map((v) => +v.toFixed(1)), glass: info.glass, items: p.placed, note: '' });
      if (kind === 'bedroom') furnishBedroom(p, info, seed);
      else if (kind === 'living') furnishLiving(p, info, seed);
      else if (kind === 'dining') furnishDining(p, info);
      else if (kind === 'bath') furnishBath(p, info, seed);
      else if (kind === 'terrace') furnishTerrace(p, info, seed);
      (dbg[dbg.length - 1] as { placed: number; note: string }).placed = p.placed.filter((it) => !it.fail).length; (dbg[dbg.length - 1] as { note: string }).note = (p as unknown as { note?: string }).note ?? '';
      matte.push(...p.matte); shade.push(...p.shade); art.push(...p.art);
    }
  }
  const g = new Group(); g.name = 'furniture';
  const mk = (parts: BufferGeometry[], mat: MeshStandardMaterial, name: string) => { if (!parts.length) return; const m = new Mesh(F.merge(parts), mat); m.name = name; m.castShadow = true; m.receiveShadow = true; m.userData.role = 'furniture'; g.add(m); };
  { const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: DoubleSide }); if (detail) applyDetailMaps(m, detail); mk(matte, m, 'furniture-matte'); }
  mk(shade, new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide, emissive: '#ffd6a0', emissiveIntensity: 0.55 }), 'furniture-shades');
  // холсты: UV в [0,1] по картине — текстура из двух работ, каждому холсту своя половина
  if (art.length) {
    art.forEach((c, i) => { const uv = c.getAttribute('uv'); if (uv) for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 0.5 + (i % 2) * 0.5); });
    mk(art, new MeshStandardMaterial({ map: artTexture, roughness: 0.9 }), 'furniture-art');
  }
  g.userData.spots = spots; // места гостей на террасах — клоны домов наследуют (userData копируется)
  return g;
}

/** Отладка (dev, ?plandebug): план каждого уровня с прямоугольниками комнат, стеклом, проёмами и следами мебели → app/captures/. */
export async function debugPlanImage(villaId: string, plan: Plan, glass: Box3[], passages: Passage[]) {
  const dbg = (window as unknown as { __rooms: { level: number; rect: number[]; walls: number[]; name: string; items: { x: number; z: number; yaw: number; w: number; d: number; fail?: boolean }[] }[] }).__rooms ?? [];
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
