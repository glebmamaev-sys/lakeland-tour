// Процедурная мебель и декор по стайл-гайду (renders/СТИЛЬ-ИНТЕРЬЕРОВ.md): лён, орех, тик, ротанг, джут,
// терракота, чёрная глина, ланкийские полосы (охра/индиго/песок). Каждый предмет — геометрия с атрибутом color,
// стоит на полу (y=0), «лицом» на +z, центр в (0,0). Собирается в один меш на материал.
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, LatheGeometry, PlaneGeometry, SphereGeometry,
  TorusGeometry, Vector2, Vector3, Quaternion, Shape, ExtrudeGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const C = {
  linen: '#d9d2c0', linenDark: '#c9c0aa', walnut: '#5a3f2b', teak: '#8c6a46', rattan: '#c9a66b', jute: '#b9a67c',
  terracotta: '#b5674a', clay: '#2a2927', ochre: '#b7792f', indigo: '#3b4a6b', sand: '#d8c9a8', white: '#f4f1ea',
  brass: '#b08d4a', leaf: '#3f7a2f', leafLight: '#6fa24a', stone: '#d6d0c4', charcoal: '#333436', bedWhite: '#f6f3ec',
  paper: '#efe7d6',
};

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const up = new Vector3(0, 1, 0);

/** Красит геометрию (однотонно, с лёгкой вариацией) и делает non-indexed для слияния. */
export function col(g: BufferGeometry, color: string, vary = 0.04, seed = 1): BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g; const base = new Color(color); const r = rng(seed);
  const n = ng.getAttribute('position').count; const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) { const k = 1 + (r() - 0.5) * 2 * vary; for (let t = 0; t < 3; t++) { c[(i + t) * 3] = base.r * k; c[(i + t) * 3 + 1] = base.g * k; c[(i + t) * 3 + 2] = base.b * k; } }
  ng.setAttribute('color', new BufferAttribute(c, 3)); return ng;
}
export const box = (w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, vary = 0.04) => { const g = new BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return col(g, color, vary); };
const cyl = (rt: number, rb: number, h: number, color: string, x = 0, y = 0, z = 0, seg = 10) => { const g = new CylinderGeometry(rt, rb, h, seg); g.translate(x, y + h / 2, z); return col(g, color); };
export function merge(parts: BufferGeometry[]): BufferGeometry { const m = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!; m.computeVertexNormals(); return m; }

/** Полосатая ткань Barefoot: тело из полос вдоль оси x (охра/индиго/песок/лён). */
function stripedBox(w: number, h: number, d: number, colors: string[], y = 0, stripe = 0.09): BufferGeometry {
  const parts: BufferGeometry[] = []; const n = Math.max(1, Math.round(w / stripe));
  for (let i = 0; i < n; i++) parts.push(box(w / n, h, d, colors[i % colors.length], -w / 2 + (i + 0.5) * (w / n), y, 0, 0.02));
  return merge(parts);
}
const STRIPES = [C.sand, C.ochre, C.sand, C.indigo, C.linen, C.ochre];

export function sofa(len = 2.4, seats = 3): BufferGeometry {
  const p: BufferGeometry[] = [];
  p.push(box(len, 0.42, 0.95, C.linen, 0, 0, 0));                       // корпус
  p.push(box(len, 0.45, 0.22, C.linenDark, 0, 0.42, -0.36));             // спинка
  for (const s of [-1, 1]) p.push(box(0.2, 0.25, 0.95, C.linenDark, s * (len / 2 - 0.1), 0.42, 0)); // подлокотники
  const sw = (len - 0.4) / seats;
  for (let i = 0; i < seats; i++) p.push(box(sw - 0.04, 0.14, 0.62, C.linen, -len / 2 + 0.2 + sw * (i + 0.5), 0.42, 0.12, 0.03)); // подушки сидений
  // декоративные подушки в полоску и плед
  for (let i = 0; i < Math.min(3, seats + 1); i++) { const g = stripedBox(0.46, 0.46, 0.14, STRIPES, 0); g.rotateX(-0.18); g.translate(-len / 2 + 0.45 + i * (len - 0.9) / Math.max(1, Math.min(2, seats)), 0.56, -0.25); p.push(g); }
  p.push(box(0.5, 0.05, 0.9, C.sand, len / 2 - 0.45, 0.56, 0.02, 0.02)); // плед на подлокотнике
  return merge(p);
}
export function armchair(rattanStyle = false): BufferGeometry {
  const p: BufferGeometry[] = [];
  const body = rattanStyle ? C.rattan : C.linen;
  p.push(box(0.8, 0.42, 0.85, body, 0, 0, 0)); p.push(box(0.8, 0.5, 0.18, body, 0, 0.42, -0.33));
  for (const s of [-1, 1]) p.push(box(0.14, 0.24, 0.85, body, s * 0.33, 0.42, 0));
  p.push(box(0.5, 0.12, 0.55, C.linen, 0, 0.42, 0.1, 0.03));
  const c = stripedBox(0.4, 0.4, 0.12, STRIPES); c.rotateX(-0.2); c.translate(0, 0.54, -0.2); p.push(c);
  return merge(p);
}
export function coffeeTable(w = 1.3, d = 0.7): BufferGeometry {
  const p: BufferGeometry[] = [box(w, 0.06, d, C.walnut, 0, 0.34, 0)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.06, 0.34, 0.06, C.walnut, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08)));
  // книги, чаша, веточка
  p.push(box(0.32, 0.03, 0.24, C.charcoal, -w * 0.25, 0.4, 0)); p.push(box(0.3, 0.03, 0.22, C.ochre, -w * 0.25, 0.43, 0.02));
  p.push(col(new LatheGeometry([new Vector2(0.02, 0), new Vector2(0.14, 0.02), new Vector2(0.16, 0.08), new Vector2(0.12, 0.1)], 12).translate(w * 0.2, 0.4, 0), C.clay));
  p.push(cyl(0.03, 0.04, 0.16, C.stone, w * 0.02, 0.4, -0.15, 8)); p.push(col(new SphereGeometry(0.05, 6, 5).translate(w * 0.02, 0.62, -0.15), C.white));
  return merge(p);
}
export function sideTable(): BufferGeometry {
  return merge([box(0.5, 0.05, 0.5, C.walnut, 0, 0.5, 0), cyl(0.04, 0.04, 0.5, C.walnut, 0, 0, 0, 8)]);
}
/** Керамическая лампа с льняным абажуром; абажур — отдельная эмиссивная часть (возвращается парой). */
export function tableLamp(): { body: BufferGeometry; shade: BufferGeometry } {
  const body = col(new LatheGeometry([new Vector2(0.02, 0), new Vector2(0.12, 0.02), new Vector2(0.13, 0.18), new Vector2(0.06, 0.3), new Vector2(0.03, 0.4)], 12), C.stone);
  const shade = col(new CylinderGeometry(0.16, 0.2, 0.22, 14, 1, true).translate(0, 0.5, 0), C.paper, 0);
  return { body, shade };
}
/** Плетёный ротанговый подвес: колокол из колец + шнур. Подвешивается за точку (0, drop, 0) вниз. */
export function rattanPendant(r = 0.45, h = 0.5, drop = 1.0): BufferGeometry {
  const p: BufferGeometry[] = [];
  const rings = 7;
  for (let i = 0; i < rings; i++) { const t = i / (rings - 1); const rr = r * (0.35 + 0.65 * Math.sin(t * Math.PI * 0.5 + 0.2)); const g = new TorusGeometry(rr, 0.012, 5, 24); g.rotateX(Math.PI / 2); g.translate(0, drop + h * (1 - t) - h, 0); p.push(col(g, C.rattan, 0.06, i + 1)); }
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; const g = new BoxGeometry(0.012, h, 0.012); g.translate(r * 0.75 * Math.cos(a), drop - h / 2, r * 0.75 * Math.sin(a)); p.push(col(g, C.rattan, 0.06, k + 20)); }
  p.push(cyl(0.006, 0.006, 1.2, C.charcoal, 0, drop, 0, 5)); // шнур вверх
  return merge(p);
}
export function rug(w: number, d: number, color = C.jute): BufferGeometry { return box(w, 0.015, d, color, 0, 0, 0, 0.08); }
export function floorVase(): BufferGeometry {
  const p: BufferGeometry[] = [col(new LatheGeometry([new Vector2(0.08, 0), new Vector2(0.2, 0.08), new Vector2(0.24, 0.45), new Vector2(0.14, 0.78), new Vector2(0.11, 0.9)], 14), C.clay)];
  for (let k = 0; k < 5; k++) { const g = new PlaneGeometry(0.16, 1.1); g.translate(0, 0.55, 0); g.rotateZ((k - 2) * 0.22); g.rotateY(k * 1.3); g.translate(0, 0.85, 0); p.push(col(g, C.sand, 0.1, k + 7)); }
  return merge(p);
}
/** Растение в терракотовом кашпо: стрелиция (крупные листья) или кентия (веер узких). */
export function pottedPlant(kind: 'strelitzia' | 'kentia' = 'strelitzia', seed = 1): BufferGeometry {
  const r = rng(seed); const p: BufferGeometry[] = [col(new CylinderGeometry(0.22, 0.17, 0.42, 10).translate(0, 0.21, 0), C.terracotta)];
  p.push(col(new CylinderGeometry(0.2, 0.2, 0.03, 10).translate(0, 0.41, 0), '#5a4a3a'));
  const n = kind === 'strelitzia' ? 9 : 14;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.5; const len = kind === 'strelitzia' ? 0.6 + r() * 0.35 : 0.75 + r() * 0.35;
    const stem = new BoxGeometry(0.015, len, 0.015); stem.translate(0, len / 2, 0);
    const leaf = new PlaneGeometry(kind === 'strelitzia' ? 0.22 : 0.08, kind === 'strelitzia' ? 0.42 : 0.6); leaf.translate(0, len + (kind === 'strelitzia' ? 0.18 : 0.25), 0);
    const g = merge([col(stem, C.leaf), col(leaf, k % 2 ? C.leaf : C.leafLight, 0.08, k)]);
    g.rotateX(0.35 + r() * 0.35); g.rotateY(a); g.translate(0, 0.42, 0); p.push(g);
  }
  return merge(p);
}
/** Картина в дубовой раме: возвращает раму (геометрия) и холст (отдельно, под текстуру). Висит на стене z=0 лицом +z. */
export function artFrame(w: number, h: number): { frame: BufferGeometry; canvas: BufferGeometry } {
  const frame = merge([box(w + 0.08, 0.04, 0.04, C.teak, 0, h - 0.02, 0), box(w + 0.08, 0.04, 0.04, C.teak, 0, -0.02, 0), box(0.04, h, 0.04, C.teak, -w / 2 - 0.02, 0, 0), box(0.04, h, 0.04, C.teak, w / 2 + 0.02, 0, 0)]);
  const canvas = new PlaneGeometry(w, h); canvas.translate(0, h / 2, 0.01);
  return { frame, canvas };
}
export function ceilingFan(): BufferGeometry {
  const p: BufferGeometry[] = [cyl(0.03, 0.03, 0.35, C.charcoal, 0, -0.35, 0, 6), cyl(0.12, 0.12, 0.08, C.brass, 0, -0.43, 0, 12)];
  for (let k = 0; k < 3; k++) { const g = new BoxGeometry(0.75, 0.012, 0.14); g.translate(0.5, -0.4, 0); g.rotateY(k * Math.PI * 2 / 3); p.push(col(g, C.teak)); }
  return merge(p);
}
export function bed(w = 1.8, l = 2.1): BufferGeometry {
  const p: BufferGeometry[] = [];
  p.push(box(w + 0.1, 0.25, l + 0.1, C.walnut, 0, 0, 0));                 // рама
  p.push(box(w + 0.1, 1.0, 0.1, C.linen, 0, 0, -l / 2 - 0.02));            // изголовье льняное
  p.push(box(w, 0.26, l, C.bedWhite, 0, 0.25, 0.02, 0.015));               // матрас с бельём
  p.push(box(w - 0.1, 0.06, l * 0.55, C.white, 0, 0.51, l * 0.1, 0.01));   // одеяло
  for (const s of [-1, 1]) p.push(box(0.6, 0.14, 0.4, C.white, s * (w / 4), 0.51, -l / 2 + 0.35, 0.01)); // подушки
  for (const s of [-1, 1]) p.push(box(0.48, 0.12, 0.3, C.sand, s * (w / 4 + 0.02), 0.65, -l / 2 + 0.5, 0.02));
  const spread = stripedBox(w + 0.04, 0.05, 0.55, STRIPES, 0.51); spread.translate(0, 0, l / 2 - 0.4); p.push(spread); // полосатое покрывало в ногах
  return merge(p);
}
export function bedside(): BufferGeometry { return merge([box(0.5, 0.5, 0.42, C.walnut, 0, 0, 0), box(0.46, 0.03, 0.38, C.walnut, 0, 0.5, 0), box(0.2, 0.03, 0.14, C.ochre, 0.1, 0.53, 0.08)]); }
export function rattanChair(): BufferGeometry {
  const p: BufferGeometry[] = [];
  const seat = col(new CylinderGeometry(0.4, 0.4, 0.08, 14).translate(0, 0.4, 0), C.rattan);
  const back = col(new SphereGeometry(0.45, 14, 10, 0, Math.PI, 0, Math.PI * 0.5).translate(0, 0.42, 0), C.rattan, 0.06); // чаша спинки
  back.rotateY(Math.PI);
  p.push(seat, back, box(0.5, 0.08, 0.5, C.linen, 0, 0.44, 0.02), cyl(0.03, 0.03, 0.4, C.rattan, 0, 0, 0, 8), box(0.4, 0.03, 0.6, C.sand, 0.12, 0.52, 0.02));
  return merge(p);
}
export function diningTable(len = 2.0, w = 0.95): BufferGeometry {
  const p: BufferGeometry[] = [box(len, 0.05, w, C.walnut, 0, 0.72, 0)];
  for (const sx of [-1, 1]) p.push(box(0.08, 0.72, w - 0.3, C.walnut, sx * (len / 2 - 0.25), 0, 0));
  p.push(box(len * 0.9, 0.01, 0.35, C.linen, 0, 0.77, 0, 0.02)); // дорожка
  p.push(col(new LatheGeometry([new Vector2(0.02, 0), new Vector2(0.18, 0.02), new Vector2(0.22, 0.1), new Vector2(0.18, 0.13)], 14).translate(0, 0.78, 0), C.teak));
  for (let k = 0; k < 6; k++) { const a = k * 1.1; p.push(col(new SphereGeometry(0.06 + (k % 3) * 0.015, 7, 6).translate(Math.cos(a) * 0.1, 0.9, Math.sin(a) * 0.08), k % 2 ? C.ochre : C.leafLight)); } // фрукты
  p.push(cyl(0.05, 0.06, 0.25, '#cfe3e6', len * 0.3, 0.78, 0.1, 10)); // графин
  return merge(p);
}
export function chair(): BufferGeometry {
  const p: BufferGeometry[] = [box(0.44, 0.04, 0.44, C.walnut, 0, 0.44, 0), box(0.44, 0.44, 0.03, C.rattan, 0, 0.48, -0.2, 0.06)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.035, 0.44, 0.035, C.walnut, sx * 0.2, 0, sz * 0.2));
  return merge(p);
}
/** Ограждение: стальные стойки через ≤1,3 м, поручень из ореха на 1,0 м, стеклянный экран (отдельная геометрия). Вдоль +x, центр в 0. */
export function railing(len = 2.0): { frame: BufferGeometry; glass: BufferGeometry } {
  const p: BufferGeometry[] = []; const n = Math.max(1, Math.round(len / 1.3)); const seg = len / n;
  for (let i = 0; i <= n; i++) p.push(box(0.04, 1.02, 0.04, '#b9bcbf', -len / 2 + seg * i, 0, 0, 0.01));
  p.push(box(len + 0.04, 0.05, 0.07, C.walnut, 0, 1.0, 0, 0.03)); // поручень
  p.push(box(len, 0.02, 0.03, '#b9bcbf', 0, 0.1, 0, 0.01));          // нижняя обвязка
  const glass = new BoxGeometry(len - 0.08, 0.86, 0.012); glass.translate(0, 0.12 + 0.43, 0);
  return { frame: merge(p), glass };
}
/** Кухонный гарнитур вдоль стены: нижние шкафы (тик) с цоколем и фасадами, столешница из камня, мойка с краном,
 *  варочная панель. Длина len, глубина 0,6, лицом на +z (стена за спиной, −z). */
export function kitchenBase(len = 3.0): BufferGeometry {
  const p: BufferGeometry[] = [];
  p.push(box(len - 0.06, 0.1, 0.52, C.charcoal, 0, 0, -0.02, 0.02));                  // цоколь
  p.push(box(len, 0.78, 0.58, C.teak, 0, 0.1, 0, 0.03));                                // корпус
  const nDoors = Math.max(2, Math.round(len / 0.6)); const dw = len / nDoors;
  for (let i = 0; i < nDoors; i++) { const x = -len / 2 + dw * (i + 0.5); p.push(box(dw - 0.03, 0.74, 0.02, C.teak, x, 0.12, 0.29, 0.05)); p.push(box(0.14, 0.015, 0.02, C.brass, x, 0.78, 0.31, 0.02)); } // фасады и ручки
  p.push(box(len + 0.04, 0.04, 0.64, C.stone, 0, 0.88, 0.02, 0.02));                     // столешница
  // мойка у левой трети, варочная панель у правой
  const sx = -len / 4, cx = len / 4;
  p.push(box(0.52, 0.015, 0.4, '#b9b9b4', sx, 0.915, 0.0, 0.02)); p.push(box(0.46, 0.012, 0.34, '#8c8c88', sx, 0.918, 0.0, 0.02)); // мойка
  p.push(cyl(0.012, 0.012, 0.3, '#cfcfca', sx, 0.92, -0.2, 8)); const spout = new BoxGeometry(0.02, 0.02, 0.2); spout.translate(sx, 1.22, -0.1); p.push(col(spout, '#cfcfca')); // кран
  p.push(box(0.6, 0.012, 0.5, '#2a2927', cx, 0.92, 0.0, 0.01)); for (const [dx, dz] of [[-0.14, -0.12], [0.14, -0.12], [-0.14, 0.12], [0.14, 0.12]]) p.push(cyl(0.08, 0.08, 0.004, '#4a4a48', cx + dx, 0.932, dz, 14)); // варочная панель
  p.push(box(0.3, 0.03, 0.2, C.walnut, -len / 2 + 0.3, 0.92, 0.1, 0.03)); p.push(cyl(0.05, 0.04, 0.22, C.terracotta, len / 2 - 0.25, 0.92, -0.1, 10)); // доска и кувшин
  return merge(p);
}
/** Верхние шкафы: глубина 0,35, низ на 1,5 м, фасады с ручками. */
export function kitchenUpper(len = 3.0): BufferGeometry {
  const p: BufferGeometry[] = [];
  p.push(box(len, 0.7, 0.34, C.teak, 0, 1.5, -0.13, 0.03));
  const n = Math.max(2, Math.round(len / 0.6)); const dw = len / n;
  for (let i = 0; i < n; i++) { const x = -len / 2 + dw * (i + 0.5); p.push(box(dw - 0.03, 0.66, 0.02, C.linen, x, 1.52, 0.05, 0.04)); p.push(box(0.12, 0.015, 0.02, C.brass, x, 1.56, 0.07, 0.02)); }
  return merge(p);
}
/** Холодильник: стальной серый, две двери, ручки. */
export function fridge(): BufferGeometry {
  const p: BufferGeometry[] = [];
  p.push(box(0.7, 1.9, 0.66, '#9ea3a6', 0, 0, 0, 0.02)); p.push(box(0.68, 0.86, 0.02, '#aab0b3', 0, 0.06, 0.34, 0.02)); p.push(box(0.68, 0.96, 0.02, '#aab0b3', 0, 0.94, 0.34, 0.02));
  p.push(box(0.02, 0.6, 0.02, '#e6e6e3', -0.25, 0.3, 0.36, 0.01)); p.push(box(0.02, 0.7, 0.02, '#e6e6e3', -0.25, 1.1, 0.36, 0.01));
  return merge(p);
}
/** Кухонный остров со столешницей и двумя барными табуретами (ротанг на чёрных ножках). */
export function island(len = 2.0): BufferGeometry {
  const p: BufferGeometry[] = [];
  p.push(box(len, 0.86, 0.86, C.teak, 0, 0, 0, 0.03)); p.push(box(len + 0.08, 0.05, 0.94, C.stone, 0, 0.86, 0, 0.02));
  for (const s of [-1, 1]) { const x = s * Math.min(0.45, len / 4); for (const [lx, lz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) p.push(cyl(0.012, 0.012, 0.66, C.charcoal, x + lx, 0, 0.72 + lz, 6)); p.push(cyl(0.18, 0.18, 0.05, C.rattan, x, 0.66, 0.72, 14)); }
  p.push(box(0.4, 0.04, 0.3, C.walnut, len / 2 - 0.4, 0.91, 0.05, 0.03)); for (let i = 0; i < 4; i++) p.push(cyl(0.045, 0.045, 0.08, i % 2 ? '#e9b949' : '#c9552f', len / 2 - 0.5 + (i % 2) * 0.12, 0.95, 0.0 + Math.floor(i / 2) * 0.12, 8)); // доска с фруктами
  return merge(p);
}
/** Отдельно стоящая ванна: скруглённый овальный борт, чаша внутри, белый акрил. Длина l, ширина w, высота 0,56. */
export function bathtub(l = 1.7, w = 0.8): BufferGeometry {
  const rr = (x: number, z: number, lw: number, ww: number, r: number) => { const s = new Shape(); s.moveTo(x - lw / 2 + r, z - ww / 2); s.lineTo(x + lw / 2 - r, z - ww / 2); s.quadraticCurveTo(x + lw / 2, z - ww / 2, x + lw / 2, z - ww / 2 + r); s.lineTo(x + lw / 2, z + ww / 2 - r); s.quadraticCurveTo(x + lw / 2, z + ww / 2, x + lw / 2 - r, z + ww / 2); s.lineTo(x - lw / 2 + r, z + ww / 2); s.quadraticCurveTo(x - lw / 2, z + ww / 2, x - lw / 2, z + ww / 2 - r); s.lineTo(x - lw / 2, z - ww / 2 + r); s.quadraticCurveTo(x - lw / 2, z - ww / 2, x - lw / 2 + r, z - ww / 2); return s; };
  const outer = rr(0, 0, l, w, Math.min(0.38, w / 2 - 0.01)); const hole = rr(0, 0, l - 0.16, w - 0.16, Math.min(0.3, (w - 0.16) / 2 - 0.01)); outer.holes.push(hole);
  const wall = new ExtrudeGeometry(outer, { depth: 0.56, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 }); wall.rotateX(-Math.PI / 2); wall.translate(0, 0, 0);
  const bottom = new ExtrudeGeometry(rr(0, 0, l - 0.14, w - 0.14, 0.28), { depth: 0.1, bevelEnabled: false, curveSegments: 10 }); bottom.rotateX(-Math.PI / 2); bottom.translate(0, 0.0, 0);
  const tap = new CylinderGeometry(0.012, 0.012, 0.25, 8); tap.translate(0, 0.68, -w / 2 + 0.06); const spout = new BoxGeometry(0.02, 0.02, 0.16); spout.translate(0, 0.8, -w / 2 + 0.14);
  return merge([col(wall, '#f7f6f2'), col(bottom, '#f2f1ed'), col(tap, '#c9c9c4'), col(spout, '#c9c9c4')]);
}
export function towelLadder(): BufferGeometry {
  const p: BufferGeometry[] = [];
  for (const s of [-1, 1]) { const g = new BoxGeometry(0.035, 1.7, 0.035); g.translate(s * 0.22, 0.85, 0); g.rotateX(-0.12); p.push(col(g, C.teak)); }
  for (let k = 0; k < 4; k++) { const g = new BoxGeometry(0.44, 0.03, 0.03); g.translate(0, 0.35 + k * 0.4, 0); g.rotateX(-0.12); p.push(col(g, C.teak)); }
  p.push(col(new CylinderGeometry(0.07, 0.07, 0.4, 8).rotateZ(Math.PI / 2).translate(0, 1.18, 0.05), C.white)); // скрученное полотенце
  return merge(p);
}
export function lounger(): BufferGeometry {
  const p: BufferGeometry[] = [box(0.7, 0.08, 1.4, C.teak, 0, 0.3, 0.2)];
  const back = new BoxGeometry(0.7, 0.08, 0.7); back.translate(0, 0, -0.35); back.rotateX(-0.9); back.translate(0, 0.34, -0.5); p.push(col(back, C.teak));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.05, 0.3, 0.05, C.teak, sx * 0.3, 0, sz * 0.55));
  p.push(box(0.62, 0.05, 1.3, C.white, 0, 0.38, 0.22, 0.01));
  return merge(p);
}
export function planter(seed = 1): BufferGeometry {
  const p: BufferGeometry[] = [col(new CylinderGeometry(0.42, 0.34, 0.7, 12).translate(0, 0.35, 0), C.terracotta)];
  const plant = pottedPlant(seed % 2 ? 'strelitzia' : 'kentia', seed); plant.scale(0.8, 0.75, 0.8); plant.translate(0, 0.3, 0); p.push(plant);
  return merge(p);
}

/** Поворот вокруг Y и перенос. */
export function place(g: BufferGeometry, x: number, y: number, z: number, yaw = 0): BufferGeometry {
  const ng = g.clone(); ng.applyQuaternion(new Quaternion().setFromAxisAngle(up, yaw)); ng.translate(x, y, z); return ng;
}
