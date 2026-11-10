// Въезд в комплекс: ворота на сухопутной границе участка у ресепшена, за ними гостевая парковка на материке,
// подъездная дорога до ближайшей дороги из карты (OSM) и ограда вдоль границы там, где за ней суша.
// Раньше комплекс «начинался с лестницы к магазину»: ни дороги, ни парковки, ни ворот (аудит 10.11.2026, п. 2).
import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute } from 'three';
import * as F from './Furniture';

export type Gate = { x: number; z: number; nx: number; nz: number }; // точка на границе и единичная нормаль наружу
type XZ = [number, number];
type H = (x: number, z: number) => number | null;

function inPoly(x: number, z: number, B: XZ[]) { let c = false; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [xi, zi] = B[i], [xj, zj] = B[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
/** Точки вдоль границы с шагом ≈ step и нормалью наружу. */
function walkBoundary(B: XZ[], step: number): Gate[] {
  const out: Gate[] = [];
  for (let i = 0; i < B.length; i++) {
    const a = B[i], b = B[(i + 1) % B.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
    let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2; if (inPoly(mx + nx * 0.5, mz + nz * 0.5, B)) { nx = -nx; nz = -nz; }
    const n = Math.max(1, Math.round(L / step)); for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, nx, nz }); }
  }
  return out;
}
function nearestOnRoads(roads: XZ[][], x: number, z: number): { x: number; z: number; d: number; road: XZ[] } | null {
  let best: { x: number; z: number; d: number; road: XZ[] } | null = null;
  for (const r of roads) for (let i = 0; i < r.length - 1; i++) {
    const a = r[i], b = r[i + 1]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    const px = a[0] + dx * t, pz = a[1] + dz * t; const d = Math.hypot(px - x, pz - z); if (!best || d < best.d) best = { x: px, z: pz, d, road: r };
  }
  return best;
}

/** Место ворот: на границе, за которой суша в сторону ближайшей дороги, с запасом до домов и бассейнов и поближе к ресепшену. */
export function planGate(B: XZ[], blocked: (x: number, z: number) => boolean, land: (x: number, z: number) => boolean, door: XZ, roads: XZ[][]): Gate | null {
  let best: { g: Gate; sc: number } | null = null;
  for (const g of walkBoundary(B, 1.5)) {
    if (![4, 10, 16, 22].every((d) => land(g.x + g.nx * d, g.z + g.nz * d))) continue; // за воротами — место под парковку
    const road = nearestOnRoads(roads, g.x, g.z); if (!road || road.d > 140) continue;
    if (((road.x - g.x) * g.nx + (road.z - g.z) * g.nz) / road.d < 0.6) continue; // ворота смотрят на дорогу, а не вдоль берега
    const qx = g.x - g.nx * 2.5, qz = g.z - g.nz * 2.5; let cl = 7;
    for (let r = 0.5; r <= 7 && cl === 7; r += 0.5) for (let a = 0; a < 16; a++) { const an = (a * Math.PI) / 8; if (blocked(qx + Math.cos(an) * r, qz + Math.sin(an) * r)) { cl = r - 0.5; break; } }
    if (cl < 4) continue;
    const tx = -g.nz, tz = g.nx; // вдоль границы: парковка 20 м должна целиком стоять на суше
    if (![-10, 10].every((u) => [3, 13].every((v) => land(g.x + tx * u + g.nx * v, g.z + tz * u + g.nz * v)))) continue;
    const sc = Math.min(cl, 6) - 0.08 * Math.hypot(g.x - door[0], g.z - door[1]); if (!best || sc > best.sc) best = { g, sc };
  }
  return best ? best.g : null;
}

/** Лента по ломаной: ширина w, высота по hAt + lift, UV в метрах / 3, боковые юбки вниз на 0,5 м (закрывают зазор над рельефом). */
function ribbon(line: XZ[], w: number, hAt: H, lift: number): BufferGeometry | null {
  const pts: XZ[] = []; for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(L / 1.5)); for (let k = i ? 1 : 0; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
  if (pts.length < 2) return null; const P: number[] = [], U: number[] = [], idx: number[] = []; let rows = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)]; let dx = q[0] - o[0], dz = q[1] - o[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const sx = -dz * (w / 2), sz = dx * (w / 2); const hl = hAt(p[0] - sx, p[1] - sz), hr = hAt(p[0] + sx, p[1] + sz), hc = hAt(p[0], p[1]); if (hl === null || hr === null || hc === null) { rows = 0; continue; } // вода — разрыв ленты
    const yl = Math.max(hl, hc - 0.4) + lift, yr = Math.max(hr, hc - 0.4) + lift; const b = P.length / 3;
    P.push(p[0] - sx, yl - 0.5, p[1] - sz, p[0] - sx, yl, p[1] - sz, p[0] + sx, yr, p[1] + sz, p[0] + sx, yr - 0.5, p[1] + sz);
    U.push((p[0] - sx) / 3, (p[1] - sz) / 3 + 0.2, (p[0] - sx) / 3, (p[1] - sz) / 3, (p[0] + sx) / 3, (p[1] + sz) / 3, (p[0] + sx) / 3, (p[1] + sz) / 3 + 0.2);
    if (rows) { const a = b - 4; for (let k = 0; k < 3; k++) idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k); }
    rows++;
  }
  if (!idx.length) return null; const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(P, 3)); g.setAttribute('uv', new Float32BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

/** Легковая машина-кроссовер: длина вдоль +x, 4,3 × 1,8 × 1,6 м. */
function car(color: string): BufferGeometry {
  const p: BufferGeometry[] = [F.box(4.3, 0.62, 1.78, color, 0, 0.32, 0, 0.02), F.box(2.5, 0.5, 1.6, '#27303a', -0.2, 0.94, 0, 0.01), F.box(2.6, 0.07, 1.66, color, -0.2, 1.44, 0, 0.02)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { p.push(F.col(new CylinderGeometry(0.34, 0.34, 0.24, 14).rotateX(Math.PI / 2).translate(sx * 1.38, 0.34, sz * 0.82), '#1d1d1f', 0.02)); p.push(F.col(new CylinderGeometry(0.19, 0.19, 0.25, 10).rotateX(Math.PI / 2).translate(sx * 1.38, 0.34, sz * 0.82), '#b9bcc0', 0.02)); }
  for (const sz of [-1, 1]) { p.push(F.box(0.06, 0.14, 0.34, '#f3efe0', 2.14, 0.66, sz * 0.62, 0.0)); p.push(F.box(0.06, 0.12, 0.3, '#a8322a', -2.14, 0.7, sz * 0.62, 0.0)); }
  p.push(F.box(0.5, 0.05, 1.5, '#1d1d1f', 2.0, 0.34, 0, 0.0)); // бампер
  return F.merge(p);
}
/** Брусок от точки a до точки b (с уклоном): сечение w × h. */
function beam(a: [number, number, number], b: [number, number, number], h: number, w: number, color: string): BufferGeometry {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const Lxz = Math.hypot(dx, dz) || 0.001, L = Math.hypot(Lxz, dy);
  const g = new BoxGeometry(L, h, w); g.rotateZ(Math.atan2(dy, Lxz)); return F.place(F.col(g, color), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, Math.atan2(-dz, dx));
}

export type Entrance = { paved: BufferGeometry | null; solid: BufferGeometry | null; keepOut: (x: number, z: number) => boolean; lot: { cx: number; cz: number }; arrive: { x: number; z: number; yaw: number } };

/** Геометрия въезда. hAt — высота рельефа (суша; null — вода), land — суша ли в точке. */
export function buildEntrance(gate: Gate, B: XZ[], hAt: H, land: (x: number, z: number) => boolean, roads: XZ[][]): Entrance {
  const { x: gx, z: gz, nx, nz } = gate; const tx = -nz, tz = nx; // t — вдоль границы
  const W = (u: number, v: number): XZ => [gx + tx * u + nx * v, gz + tz * u + nz * v];
  const HU = 10, V0 = 1.2, V1 = 13.6; // парковка: 20 м вдоль границы, от 1,2 до 13,6 м наружу
  const paved: BufferGeometry[] = [], solid: BufferGeometry[] = [];
  // площадка: сетка 1 м по рельефу (+12 см) с юбкой по периметру
  { const P: number[] = [], U: number[] = [], idx: number[] = []; const NU = 2 * HU, NV = Math.round(V1 - V0);
    const y = (u: number, v: number) => { const [x, z] = W(u, v); return (hAt(x, z) ?? hAt(...W(0, 6)) ?? 0) + 0.12; };
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const u = -HU + i, v = V0 + ((V1 - V0) * j) / NV; const [x, z] = W(u, v); P.push(x, y(u, v), z); U.push(x / 3, z / 3); }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i; idx.push(a, a + NU + 1, a + 1, a + 1, a + NU + 1, a + NU + 2); }
    const edge: number[] = []; for (let i = 0; i <= NU; i++) edge.push(i); for (let j = 1; j <= NV; j++) edge.push(j * (NU + 1) + NU); for (let i = NU - 1; i >= 0; i--) edge.push(NV * (NU + 1) + i); for (let j = NV - 1; j >= 0; j--) edge.push(j * (NU + 1));
    for (let e = 0; e < edge.length - 1; e++) { const a = edge[e], b = edge[e + 1]; const k = P.length / 3; P.push(P[a * 3], P[a * 3 + 1] - 0.7, P[a * 3 + 2], P[b * 3], P[b * 3 + 1] - 0.7, P[b * 3 + 2]); U.push(U[a * 2], U[a * 2 + 1] + 0.25, U[b * 2], U[b * 2 + 1] + 0.25); idx.push(a, b, k, b, k + 1, k); }
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(P, 3)); g.setAttribute('uv', new Float32BufferAttribute(U, 2)); g.setIndex(idx); g.computeVertexNormals(); paved.push(g); }
  // подъездная дорога: от дальнего края парковки к ближайшей дороге карты, сама эта дорога — в пределах 170 м
  const lotOut = W(0, V1 - 0.5); const road = nearestOnRoads(roads, lotOut[0], lotOut[1]); const drive: XZ[] = [lotOut];
  if (road) { const mid = W(0, V1 + 8); drive.push(mid, [road.x, road.z]); const d = ribbon(drive, 4.6, hAt, 0.14); if (d) paved.push(d);
    const part = road.road.filter((q) => Math.hypot(q[0] - road.x, q[1] - road.z) < 170); if (part.length > 1) { const r = ribbon(part, 5.6, hAt, 0.1); if (r) paved.push(r); } }
  // короткий выход от ворот на площадку (полоса у самой границы — между оградой и парковкой)
  { const a = ribbon([W(0, -0.6), W(0, V0 + 0.6)], 3.6, hAt, 0.13); if (a) paved.push(a); }
  const yAt = (x: number, z: number) => hAt(x, z) ?? 0;
  // разметка мест и машины: по два места с каждой стороны от прохода к воротам, носом к ограде
  const stalls = [-7.0, -4.4, 4.4, 7.0];
  for (const u of [-8.3, -5.7, -3.1, 3.1, 5.7, 8.3]) { const a = W(u, V0 + 0.6), b = W(u, V0 + 5.6); solid.push(beam([a[0], yAt(a[0], a[1]) + 0.135, a[1]], [b[0], yAt(b[0], b[1]) + 0.135, b[1]], 0.012, 0.1, '#efece2')); }
  const colors = ['#e9e6de', '#3f4a44', '#b9a27c']; const yawCar = Math.atan2(-(-nz), -nx); // нос к ограде (−n)
  [0, 2, 3].forEach((si, k) => { const [x, z] = W(stalls[si], V0 + 3.1); solid.push(F.place(car(colors[k]), x, yAt(x, z) + 0.13, z, yawCar)); });
  // ворота: два оштукатуренных столба с каменными крышками, тиковая балка-портал, распахнутые внутрь створки из реек
  const HG = 2.1; const yG = yAt(gx, gz);
  for (const s of [-1, 1]) {
    const [px, pz] = W(s * (HG + 0.28), 0); const yp = yAt(px, pz);
    solid.push(F.place(F.merge([F.box(0.56, 2.5, 0.56, F.C.white, 0, 0, 0, 0.02), F.box(0.7, 0.08, 0.7, F.C.stone, 0, 2.5, 0, 0.02), F.box(0.2, 0.26, 0.2, '#ffe2a8', 0, 2.58, 0, 0.0)]), px, Math.min(yp, yG), pz, Math.atan2(-tz, tx)));
    // створка: петля у столба, полотно 1,95 м развернуто внутрь участка под 80° к линии ворот
    const hx = gx + tx * s * HG, hz = gz + tz * s * HG; const ang = (80 * Math.PI) / 180; const dx = -nx * Math.sin(ang) - tx * s * Math.cos(ang), dz = -nz * Math.sin(ang) - tz * s * Math.cos(ang);
    const ex = hx + dx * 1.95, ez = hz + dz * 1.95; const y0 = yG + 0.12;
    for (const yy of [0.15, 1.75]) solid.push(beam([hx, y0 + yy, hz], [ex, y0 + yy, ez], 0.07, 0.05, F.C.charcoal));
    for (let k = 0; k <= 9; k++) { const q = k / 9; const sx = hx + (ex - hx) * q, sz = hz + (ez - hz) * q; solid.push(F.place(F.box(0.09, 1.66, 0.03, F.C.teak, 0, 0, 0, 0.05), sx, y0 + 0.12, sz, Math.atan2(-dz, dx))); }
  }
  { const a = W(-HG - 0.75, 0), b = W(HG + 0.75, 0); solid.push(beam([a[0], yG + 2.72, a[1]], [b[0], yG + 2.72, b[1]], 0.2, 0.3, F.C.teak)); solid.push(beam([a[0], yG + 2.95, a[1]], [b[0], yG + 2.95, b[1]], 0.06, 0.5, F.C.walnut)); }
  // ограда вдоль границы, где за ней суша: стойки через ≈ 2,4 м, три тиковые рейки; у ворот — разрыв
  { let prev: [number, number, number] | null = null;
    for (const q of walkBoundary(B, 2.4)) {
      const nearGate = Math.hypot(q.x - gx, q.z - gz) < HG + 0.9; const ok = !nearGate && land(q.x + q.nx * 3, q.z + q.nz * 3) && hAt(q.x, q.z) !== null;
      if (!ok) { prev = null; continue; }
      const cur: [number, number, number] = [q.x, yAt(q.x, q.z), q.z];
      solid.push(F.box(0.12, 1.4, 0.12, F.C.charcoal, q.x, cur[1] - 0.1, q.z, 0.02));
      if (prev && Math.hypot(prev[0] - cur[0], prev[2] - cur[2]) < 3.6) for (const yy of [0.45, 0.82, 1.2]) solid.push(beam([prev[0], prev[1] + yy, prev[2]], [cur[0], cur[1] + yy, cur[2]], 0.09, 0.035, F.C.teak));
      prev = cur;
    } }
  const keepOut = (x: number, z: number) => {
    const u = (x - gx) * tx + (z - gz) * tz, v = (x - gx) * nx + (z - gz) * nz; if (Math.abs(u) < HU + 3 && v > -2 && v < V1 + 3) return true;
    for (let i = 0; i < drive.length - 1; i++) { const a = drive[i], b = drive[i + 1]; const dx = b[0] - a[0], dz = b[1] - a[1]; const L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); if (Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) < 5) return true; }
    const r = nearestOnRoads(road ? [road.road] : [], x, z); return !!r && r.d < 5.5;
  };
  const lotC = W(0, (V0 + V1) / 2); const arr = W(0, V1 - 3);
  return { paved: paved.length ? F.merge(paved) : null, solid: solid.length ? F.merge(solid) : null, keepOut, lot: { cx: lotC[0], cz: lotC[1] }, arrive: { x: arr[0], z: arr[1], yaw: Math.atan2(nx, nz) } };
}
