// Продольный профиль дорожек. По каждой линии сети: рельеф вдоль оси (шаг 0,5 м) сглаживается (±1,5 м), концы
// привязаны к площадкам домов, уклон ограничен 1:2 в обе стороны (двухпроходный ограничитель). Участки положе
// 1:8 (12 %) — пандус, круче — уличная лестница: подступёнок ≈ 15 см, проступь = длина участка / число ступеней
// (на пологих местах — широкие садовые ступени). Рельеф в коридоре дорожки (±1,5 м) фиксируется на 6 см ниже
// профиля (лента лежит на +10 см), полоса рядом релаксируется вместе с газоном — дорожка «врезана» в склон, а не
// повторяет его складки. Ступени — каменные плиты стопкой над пандусом (игрок и персонажи идут по пандусу).
import { BufferGeometry, CatmullRomCurve3 } from 'three';
import type { PathNet } from './Paths';
import { hexa, finish, type Grid, type Tri } from './Terraces';

export type Step = { x: number; z: number; dir: [number, number]; len: number; width: number; top: number; base: number };
export type Graded = { fixed: Uint8Array; h: Float32Array; steps: Step[]; flights: number; corridor: Uint8Array };

const DS = 0.5, SLOPE_WALK = 0.12, SLOPE_MAX = 0.5, RISER = 0.15, HALF = 1.5, LIFT = -0.06, SMOOTH = 1.5;

export function gradePaths(net: PathNet, g: Grid, fixed: Uint8Array, width = 2.6): Graded {
  const { h, x0, z0, step, nx, nz } = g; const N = nx * nz;
  const sample = (x: number, z: number) => {
    const fx = Math.max(0, Math.min(nx - 1.001, (x - x0) / step)), fz = Math.max(0, Math.min(nz - 1.001, (z - z0) / step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (h[j * nx + i] * (1 - tx) + h[j * nx + i + 1] * tx) * (1 - tz) + (h[(j + 1) * nx + i] * (1 - tx) + h[(j + 1) * nx + i + 1] * tx) * tz;
  };
  const fx = Uint8Array.from(fixed), ht = Float32Array.from(h), best = new Float32Array(N).fill(Infinity), corridor = new Uint8Array(N);
  const steps: Step[] = []; let flights = 0;
  for (const line of net.lines) {
    if (line.length < 2) continue;
    const curve = new CatmullRomCurve3(line, false, 'catmullrom', 0.3); const L = curve.getLength(); const n = Math.max(2, Math.ceil(L / DS)); const ds = L / n;
    const pts = curve.getSpacedPoints(n); const t = pts.map((p) => sample(p.x, p.z));
    const w = Math.round(SMOOTH / ds); const gp = t.map((_, i) => { let a = 0, c = 0; for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j <= n) { a += t[j]; c++; } } return a / c; });
    gp[0] = t[0]; gp[n] = t[n]; // концы — на отметках площадок/дорог, куда дорожка приходит
    for (let i = 1; i <= n; i++) gp[i] = Math.max(gp[i - 1] - SLOPE_MAX * ds, Math.min(gp[i - 1] + SLOPE_MAX * ds, gp[i]));
    for (let i = n - 1; i >= 0; i--) gp[i] = Math.max(gp[i + 1] - SLOPE_MAX * ds, Math.min(gp[i + 1] + SLOPE_MAX * ds, gp[i]));
    // лестничные марши: подряд идущие участки круче SLOPE_WALK одного знака
    let i = 1;
    while (i <= n) {
      const sl = (gp[i] - gp[i - 1]) / ds;
      if (Math.abs(sl) <= SLOPE_WALK) { i++; continue; }
      const sign = Math.sign(sl); let j = i;
      while (j <= n && Math.sign(gp[j] - gp[j - 1]) === sign && Math.abs(gp[j] - gp[j - 1]) / ds > SLOPE_WALK) j++;
      const a = i - 1, b = j - 1; const dh = gp[b] - gp[a], len = (b - a) * ds;
      if (Math.abs(dh) >= 0.3 && len >= 0.9) {
        const ns = Math.max(2, Math.round(Math.abs(dh) / RISER)); const tread = len / ns, riser = dh / ns; flights++;
        for (let k = 0; k < ns; k++) {
          const sm = a * ds + (k + 0.5) * tread; const p = curve.getPointAt(Math.min(1, sm / L)), tg = curve.getTangentAt(Math.min(1, sm / L));
          const dl = Math.hypot(tg.x, tg.z) || 1; const top = dh > 0 ? gp[a] + (k + 1) * riser : gp[a] + k * riser; // верх ступени — её высокий край
          steps.push({ x: p.x, z: p.z, dir: [tg.x / dl, tg.z / dl], len: tread, width: width + 0.4, top, base: top - Math.abs(riser) - 0.3 });
        }
      }
      i = Math.max(j, i + 1);
    }
    // коридор: каждой клетке — отметка ближайшей точки оси
    const R = HALF + 0.35;
    for (let s = 0; s <= n; s++) {
      const p = pts[s];
      const i0 = Math.max(0, Math.floor((p.x - R - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((p.x + R - x0) / step));
      const j0 = Math.max(0, Math.floor((p.z - R - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((p.z + R - z0) / step));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const k = j * nx + ii; const d = Math.hypot(x0 + ii * step - p.x, z0 + j * step - p.z);
        if (d <= R && d < best[k]) { best[k] = d; ht[k] = gp[s] + LIFT; }
      }
    }
  }
  for (let k = 0; k < N; k++) { if (best[k] <= HALF && !fixed[k]) { fx[k] = 1; corridor[k] = 1; } else if (best[k] <= HALF) ht[k] = h[k]; else if (best[k] < Infinity) ht[k] = h[k]; }
  return { fixed: fx, h: ht, steps, flights, corridor };
}

/** Ступени: каменные плиты стопкой; верх каждой — её высокий край, низ заглублён в пандус. */
export function stepGeometry(steps: Step[]): BufferGeometry | null {
  const T: Tri = { P: [], U: [] };
  for (const s of steps) {
    const [dx, dz] = s.dir; const lx = -dz, lz = dx; const w2 = s.width / 2, l2 = s.len / 2;
    const P = (a: number, l: number, y: number) => [s.x + dx * a + lx * l, y, s.z + dz * a + lz * l];
    hexa(T, [P(-l2, -w2, s.base), P(l2, -w2, s.base), P(l2, w2, s.base), P(-l2, w2, s.base)], [P(-l2, -w2, s.top), P(l2, -w2, s.top), P(l2, w2, s.top), P(-l2, w2, s.top)]);
  }
  return finish(T);
}
