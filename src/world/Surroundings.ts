// Окружение за границей участка: дороги по карте (OSM) лентами по рельефу, соседняя деревня — дома с двускатными
// крышами по контурам OSM с окнами, которые вечером светятся. Раньше за границей был пустой рельеф с редкими
// пальмами, дома стояли серыми коробками с плоской крышей (аудит 10.11.2026, «Окружение»).
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { ribbon } from './Entrance';
import * as F from './Furniture';

type XZ = [number, number];
type H = (x: number, z: number) => number | null;
function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Дороги: ближе 450 м — подробная лента с боковыми юбками, дальше — редкий шаг без юбок. near(x,z,r) — дорога ближе r. */
export function buildRoads(roads: XZ[][], hAt: H, skip: (x: number, z: number) => boolean, maxDist = 1700): { geom: BufferGeometry | null; near: (x: number, z: number, r: number) => boolean; length: number } {
  const parts: BufferGeometry[] = []; const CELL = 12; const grid = new Map<string, XZ[]>(); let length = 0;
  const hGate: H = (x, z) => (skip(x, z) ? null : hAt(x, z));
  for (const r of roads) {
    // дорога режется на куски по дальности: кусок целиком ближе 450 м — подробный
    let cur: XZ[] = []; let curNear = true;
    const flush = () => { if (cur.length > 1) { const g = ribbon(cur, curNear ? 5.2 : 5.6, hGate, curNear ? 0.14 : 0.3, curNear ? 1.5 : 5, curNear); if (g) parts.push(g); } cur = []; };
    for (let i = 0; i < r.length; i++) {
      const p = r[i]; const d = Math.hypot(p[0], p[1]); if (d > maxDist) { flush(); continue; }
      const isNear = d < 450; if (cur.length && isNear !== curNear) { const last = cur[cur.length - 1]; flush(); cur = [last]; } curNear = isNear; cur.push(p);
      if (i) { const q = r[i - 1]; const L = Math.hypot(p[0] - q[0], p[1] - q[1]); length += L; const n = Math.max(1, Math.ceil(L / 6)); for (let k = 0; k <= n; k++) { const x = q[0] + ((p[0] - q[0]) * k) / n, z = q[1] + ((p[1] - q[1]) * k) / n; const key = Math.floor(x / CELL) + ',' + Math.floor(z / CELL); const list = grid.get(key); if (list) list.push([x, z]); else grid.set(key, [[x, z]]); } }
    }
    flush();
  }
  const near = (x: number, z: number, rad: number) => { const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), R = Math.ceil(rad / CELL);
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) { const list = grid.get(i + ',' + j); if (list) for (const q of list) if (Math.hypot(q[0] - x, q[1] - z) < rad) return true; } return false; };
  return { geom: parts.length ? F.merge(parts) : null, near, length };
}

const WALLS = ['#f1ece0', '#e9dcc0', '#f3e7c6', '#dfe6e3', '#e8cdb9', '#f6f2ea'], ROOFS = ['#b5674a', '#a4533b', '#8f5a45', '#7d7f80', '#9b6a4c'];
/** Деревня: по каждому контуру OSM — прямоугольный дом с двускатной крышей (крупные — с плоской) и окна на длинных стенах. */
export function buildVillage(polys: XZ[][], hAt: H, maxDist = 1700): { houses: BufferGeometry | null; windows: BufferGeometry | null; count: number; spots: XZ[] } {
  const P: number[] = [], C: number[] = [], WP: number[] = []; const spots: XZ[] = []; let count = 0; const r = rng(77);
  const col = (hex: string, k = 1): [number, number, number] => { const n = parseInt(hex.slice(1), 16); const f = (v: number) => Math.pow(v / 255, 2.2) * k; return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]; };
  for (const poly of polys) {
    if (poly.length < 4) continue; const pts = poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1] ? poly.slice(0, -1) : poly;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length; if (Math.hypot(cx, cz) > maxDist) continue;
    const y0 = hAt(cx, cz); if (y0 === null) continue;
    // ось дома — самая длинная сторона контура; габариты — проекции вершин на ось и поперёк
    let ax = 1, az = 0, best = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > best) { best = L; ax = (b[0] - a[0]) / L; az = (b[1] - a[1]) / L; } }
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity; for (const p of pts) { const u = (p[0] - cx) * ax + (p[1] - cz) * az, v = -(p[0] - cx) * az + (p[1] - cz) * ax; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const L = u1 - u0, Wd = v1 - v0; if (L < 2.5 || Wd < 2.5) continue; const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    const W = (u: number, y: number, v: number): [number, number, number] => [cx + (uc + u) * ax - (vc + v) * az, y, cz + (uc + u) * az + (vc + v) * ax];
    // основание — по самой низкой точке рельефа под домом, чтобы на склоне дом не висел
    let yb = y0; for (const [u, v] of [[-L / 2, -Wd / 2], [L / 2, -Wd / 2], [L / 2, Wd / 2], [-L / 2, Wd / 2]]) { const q = W(u, 0, v); const hh = hAt(q[0], q[2]); if (hh !== null) yb = Math.min(yb, hh); }
    yb -= 0.3; const big = L * Wd > 420; const h = (big ? 5 : 2.9 + r() * 1.3) + (y0 - yb); const wc = col(WALLS[Math.floor(r() * WALLS.length)]), rc = col(ROOFS[Math.floor(r() * ROOFS.length)]);
    const tri = (a: number[], b: number[], c: number[], cc: [number, number, number]) => { P.push(...a, ...b, ...c); C.push(...cc, ...cc, ...cc); };
    const quad = (a: number[], b: number[], c: number[], d: number[], cc: [number, number, number]) => { tri(a, b, c, cc); tri(a, c, d, cc); };
    const hl = L / 2, hw = Wd / 2; const c0 = W(-hl, yb, -hw), c1 = W(hl, yb, -hw), c2 = W(hl, yb, hw), c3 = W(-hl, yb, hw), t0 = W(-hl, yb + h, -hw), t1 = W(hl, yb + h, -hw), t2 = W(hl, yb + h, hw), t3 = W(-hl, yb + h, hw);
    quad(c0, c1, t1, t0, wc); quad(c1, c2, t2, t1, wc); quad(c2, c3, t3, t2, wc); quad(c3, c0, t0, t3, wc);
    if (big) quad(t0, t1, t2, t3, col('#c9c5bb'));
    else { const rise = Math.max(0.8, Wd * 0.3), o = 0.4; const e0 = W(-hl - o, yb + h - 0.05, -hw - o), e1 = W(hl + o, yb + h - 0.05, -hw - o), e2 = W(hl + o, yb + h - 0.05, hw + o), e3 = W(-hl - o, yb + h - 0.05, hw + o), r0 = W(-hl - o, yb + h + rise, 0), r1 = W(hl + o, yb + h + rise, 0);
      quad(e0, e1, r1, r0, rc); quad(e2, e3, r0, r1, rc); tri(t0, t3, W(-hl, yb + h + rise * 0.95, 0), wc); tri(t2, t1, W(hl, yb + h + rise * 0.95, 0), wc); }
    // окна на длинных стенах: вечером светятся
    const nW = Math.max(1, Math.min(5, Math.floor(L / 3.2))); const wy = yb + (y0 - yb) + 1.1 + 0.3;
    if (!big) for (const sg of [-1, 1]) for (let i = 0; i < nW; i++) { if (r() < 0.25) continue; const u = -hl + ((i + 0.5) * L) / nW; const a = W(u - 0.45, wy, sg * (hw + 0.03)), b = W(u + 0.45, wy, sg * (hw + 0.03)), c = W(u + 0.45, wy + 1.0, sg * (hw + 0.03)), d = W(u - 0.45, wy + 1.0, sg * (hw + 0.03)); WP.push(...a, ...b, ...c, ...a, ...c, ...d); }
    spots.push([cx, cz]); count++;
  }
  const mk = (arr: number[], colors?: number[]) => { if (!arr.length) return null; const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(arr, 3)); if (colors) g.setAttribute('color', new Float32BufferAttribute(colors, 3)); g.computeVertexNormals(); return g; };
  return { houses: mk(P, C), windows: mk(WP), count, spots };
}
