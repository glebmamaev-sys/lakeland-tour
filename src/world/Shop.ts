// Магазин у въезда (строение 4 генплана): рецепшен + мини-маркет с вендинговыми автоматами. Достроен по нашему
// усмотрению — в генплане только пятно 9,5×8,5 м. Локальные координаты: пол y=0, вход на +z, x — вдоль фасада.
// Плоская кровля с выносом, стеклянный фасад между деревянными стойками, открытый дверной проём 1,8 м (без полотна),
// стены в штукатурке, вывеска. Внутри: стойка ресепшен, стеллажи с товаром, два вендинговых автомата, кресла.
import {
  BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, RepeatWrapping,
  SRGBColorSpace, Texture, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as F from './Furniture';
import { box, col, merge, C } from './Furniture';

const WALL_H = 3.4, T = 0.25;

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Табличка с текстом (вывеска, указатели): холст → текстура. */
function makeSign(lines: string[], w = 1024, h = 256, bg = '#2f2d2b', fg = '#f4f1ea'): Texture {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const n = lines.length; lines.forEach((t, i) => { const big = i === 0; ctx.font = `${big ? 600 : 400} ${big ? h * 0.42 : h * 0.2}px Georgia, serif`; ctx.fillText(t, w / 2, (h * (i + 0.5)) / n + (big ? h * 0.04 : -h * 0.02)); });
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; return t;
}

/** Вендинговый автомат: тёмный корпус, акцентная панель, светящаяся вывеска, стекло, ряды банок, клавиатура. */
function vendingMachine(accent: string, seed: number): { matte: BufferGeometry[]; glow: BufferGeometry[]; cans: BufferGeometry[] } {
  const r = rng(seed); const W = 0.95, H = 1.9, D = 0.8;
  const matte: BufferGeometry[] = [], glow: BufferGeometry[] = [], cans: BufferGeometry[] = [];
  matte.push(box(W, H, D, '#2a2927', 0, 0, 0, 0.02));                                     // корпус
  matte.push(box(W + 0.02, 0.1, D + 0.02, '#1d1c1b', 0, 0, 0, 0.01));                     // цоколь
  matte.push(box(0.28, H - 0.3, 0.03, accent, W / 2 - 0.16, 0.15, D / 2 + 0.005, 0.02));   // правая панель
  matte.push(box(0.2, 0.3, 0.04, '#111', W / 2 - 0.16, 1.15, D / 2 + 0.02, 0.01));         // клавиатура
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) matte.push(box(0.035, 0.035, 0.01, '#d8d2c4', W / 2 - 0.22 + j * 0.06, 1.33 - i * 0.06, D / 2 + 0.045));
  matte.push(box(0.2, 0.12, 0.05, '#111', W / 2 - 0.16, 0.5, D / 2 + 0.02, 0.01));         // лоток выдачи
  glow.push(box(W - 0.1, 0.22, 0.03, '#9fd8ff', 0, H - 0.3, D / 2 + 0.01));                // световая панель сверху
  // полки с банками за стеклом (стекло — отдельный меш)
  const cols = ['#c45f4a', '#3b4a6b', '#e2b23a', '#7a9a6a', '#f4f1ea', '#b7792f'];
  for (let row = 0; row < 4; row++) {
    const y = 0.45 + row * 0.3; matte.push(box(W - 0.42, 0.02, D - 0.3, '#444', -0.14, y, 0));
    for (let k = 0; k < 5; k++) { const g = new CylinderGeometry(0.035, 0.035, 0.12, 10); g.translate(-0.14 - (W - 0.5) / 2 + 0.07 + k * ((W - 0.5) / 5), y + 0.08, D / 2 - 0.3); cans.push(col(g, cols[Math.floor(r() * cols.length)], 0.02)); }
  }
  return { matte, glow, cans };
}

/** Стеллаж 1,8×1,8 с товаром (коробки и бутылки случайных цветов). */
function shelving(seed: number): BufferGeometry[] {
  const r = rng(seed); const W = 1.8, H = 1.85, D = 0.45; const p: BufferGeometry[] = [];
  for (const sx of [-1, 1]) p.push(box(0.04, H, D, C.walnut, sx * (W / 2 - 0.02), 0, 0));
  p.push(box(W, H, 0.03, C.linen, 0, 0, -D / 2 + 0.015, 0.02));
  const cols = ['#c45f4a', '#3b4a6b', '#e2b23a', '#7a9a6a', '#f4f1ea', '#b7792f', '#d9a5b3', '#2a2927'];
  for (let s = 0; s < 4; s++) {
    const y = 0.12 + s * 0.45; p.push(box(W - 0.08, 0.03, D, C.walnut, 0, y, 0));
    let x = -W / 2 + 0.12;
    while (x < W / 2 - 0.15) {
      const w = 0.08 + r() * 0.12, h = 0.12 + r() * 0.2; const c = cols[Math.floor(r() * cols.length)];
      if (r() < 0.4) { const g = new CylinderGeometry(w / 2.4, w / 2.4, h, 8); g.translate(x + w / 2, y + 0.03 + h / 2, 0.02); p.push(col(g, c, 0.02)); }
      else p.push(box(w, h, 0.12 + r() * 0.15, c, x + w / 2, y + 0.03, 0.02, 0.03));
      x += w + 0.04;
    }
  }
  return p;
}

export type ShopTextures = { stucco: Texture; stuccoN?: Texture; stone2: Texture; walnut: Texture };

/** Строит магазин. W×D — пятно по генплану; groundDrop — на сколько земля у двери ниже пола (для пандуса). */
export function buildShop(W: number, D: number, tex: ShopTextures, groundDrop = 0.1): Group {
  const g = new Group(); g.name = 'shop';
  const hw = W / 2, hd = D / 2;
  const matte: BufferGeometry[] = [], glow: BufferGeometry[] = [], art: BufferGeometry[] = [];
  const walls: BufferGeometry[] = [], glass: BufferGeometry[] = [], floor: BufferGeometry[] = [];

  // плита с террасой вокруг и цоколь под уклон
  floor.push(box(W + 1.6, 0.3, D + 1.6, C.stone, 0, -0.3, 0, 0.02));
  matte.push(box(W + 1.4, 1.8, D + 1.4, '#b9b3a6', 0, -2.1, 0, 0.02));
  // стены: задняя и боковые (штукатурка), с фасада — стойки и стекло
  walls.push(new BoxGeometry(W, WALL_H, T).translate(0, WALL_H / 2, -hd + T / 2));
  for (const sx of [-1, 1]) walls.push(new BoxGeometry(T, WALL_H, D).translate(sx * (hw - T / 2), WALL_H / 2, 0));
  // фасад: стойки через ~2,3 м, дверной проём 1,8 м по центру с фрамугой
  const posts = [-hw + 0.06, -hw / 2 - 0.5, -0.95, 0.95, hw / 2 + 0.5, hw - 0.06];
  for (const x of posts) matte.push(box(0.12, WALL_H, 0.12, C.walnut, x, 0, hd - 0.06, 0.03));
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1]; const door = a === -0.95;
    const y0 = door ? 2.3 : 0, h = WALL_H - y0; if (h <= 0) continue;
    glass.push(new BoxGeometry(b - a - 0.12, h - 0.04, 0.02).translate((a + b) / 2, y0 + h / 2, hd - 0.06));
    matte.push(box(b - a - 0.12, 0.04, 0.12, C.walnut, (a + b) / 2, y0, hd - 0.06, 0.02)); // нижняя обвязка/порог
    if (door) matte.push(box(b - a - 0.12, 0.05, 0.12, C.walnut, (a + b) / 2, y0 - 0.05, hd - 0.06, 0.02)); // перемычка над дверью
  }
  // внутренний цвет стен (светлая штукатурка) — накладка на задней стене; кровля с выносом, фасция, потолок
  matte.push(box(W + 1.6, 0.3, D + 2.2, '#f1ece2', 0, WALL_H, 0.3, 0.02));
  matte.push(box(W + 1.6, 0.6, 0.06, C.walnut, 0, WALL_H - 0.3, hd + 1.37, 0.02));   // фасция спереди (рейка)
  for (let x = -hw - 0.6; x <= hw + 0.6; x += 0.3) matte.push(box(0.06, 0.1, 1.3, C.walnut, x, WALL_H - 0.1, hd + 0.7, 0.03)); // рейки навеса
  // вывеска над входом
  const sign = new BoxGeometry(3.4, 0.7, 0.1).translate(0, WALL_H - 0.75, hd + 1.42); art.push(sign);
  // ступень у входа
  matte.push(box(2.4, 0.15, 0.5, C.stone, 0, -0.15, hd + 1.0, 0.02));

  // --- интерьер ---
  // ресепшен слева у задней стены: стойка с реечным фасадом, столешница, табличка, растение
  const desk = (x: number, z: number) => {
    matte.push(box(2.6, 1.05, 0.6, C.linen, x, 0, z, 0.02));
    for (let i = 0; i < 18; i++) matte.push(box(0.06, 1.0, 0.03, C.walnut, x - 1.25 + i * 0.145, 0.02, z + 0.31, 0.03));
    matte.push(box(2.8, 0.06, 0.75, C.walnut, x, 1.05, z, 0.02));
    matte.push(box(0.3, 0.02, 0.2, C.paper, x - 0.6, 1.11, z + 0.1, 0.01));            // журнал гостей
    const bell = new CylinderGeometry(0.05, 0.06, 0.05, 10); bell.translate(x + 0.5, 1.14, z + 0.12); matte.push(col(bell, C.brass));
    matte.push(box(0.5, 0.35, 0.03, '#1d1c1b', x + 0.1, 1.11, z - 0.15, 0.01));        // монитор
  };
  desk(-2.3, -hd + 1.6);
  art.push(new BoxGeometry(1.6, 0.35, 0.04).translate(-2.3, 2.3, -hd + T + 0.02));      // «RECEPTION»
  matte.push(F.place(F.pottedPlant('strelitzia', 3), -hw + 0.7, 0, -hd + 0.8));
  matte.push(F.place(F.rattanChair(), -2.3, 0, -hd + 0.8, Math.PI));                    // стул администратора
  // мини-маркет справа: два стеллажа вдоль правой стены, холодильные автоматы у задней стены
  for (const z of [-0.3, 1.9]) { const sh = shelving(11 + z); for (const p of sh) matte.push(F.place(p, hw - T - 0.25, 0, z, -Math.PI / 2)); }
  [['#c45f4a', 1.1], ['#3b4a6b', 2.2]].forEach(([acc, x], i) => {
    const v = vendingMachine(acc as string, 21 + i);
    for (const p of v.matte) matte.push(F.place(p, x as number, 0, -hd + T + 0.42));
    for (const p of v.glow) glow.push(F.place(p, x as number, 0, -hd + T + 0.42));
    for (const p of v.cans) matte.push(F.place(p, x as number, 0, -hd + T + 0.42));
    glass.push(new BoxGeometry(0.6, 1.25, 0.02).translate((x as number) - 0.14, 0.95, -hd + T + 0.42 + 0.41));
  });
  // уголок ожидания у витрины слева: два кресла, столик, ковёр, растение
  matte.push(F.place(F.rug(2.6, 2.0, C.jute), -2.6, 0.001, 1.6));
  matte.push(F.place(F.armchair(true), -3.3, 0, 1.2, Math.PI / 2 + 0.3));
  matte.push(F.place(F.armchair(true), -1.9, 0, 1.2, -Math.PI / 2 - 0.3));
  matte.push(F.place(F.sideTable(), -2.6, 0, 1.3));
  matte.push(F.place(F.pottedPlant('kentia', 5), hw - 0.7, 0, hd - 0.8));
  matte.push(F.place(F.rug(1.6, 1.0, C.sand), 0, 0.001, hd - 0.6));                      // коврик у входа
  // подвесы и потолочные вентиляторы
  for (const [x, z] of [[-2.3, -hd + 1.6], [-2.6, 1.4], [hw - 1.4, 0.6]] as [number, number][]) { matte.push(F.place(F.rattanPendant(0.4, 0.45, -0.9), x, WALL_H - 0.02, z)); glow.push(box(0.12, 0.08, 0.12, '#ffd6a0', x, WALL_H - 1.35, z)); }
  matte.push(F.place(F.ceilingFan(), 1.5, WALL_H - 0.02, 1.2));

  // --- меши ---
  const mk = (parts: BufferGeometry[], mat: MeshStandardMaterial, name: string, shadow = true) => { if (!parts.length) return; const m = new Mesh(merge(parts), mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m; };
  mk(matte, new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide }), 'shop-matte');
  mk(glow, new MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.9 }), 'shop-glow', false);
  const stucco = tex.stucco.clone(); stucco.wrapS = stucco.wrapT = RepeatWrapping; stucco.repeat.set(3, 1.2); stucco.needsUpdate = true;
  const wallMesh = new Mesh(mergeGeometries(walls, false)!, new MeshStandardMaterial({ map: stucco, normalMap: tex.stuccoN, roughness: 0.95, color: '#f2ede4' }));
  wallMesh.castShadow = wallMesh.receiveShadow = true; wallMesh.name = 'shop-walls'; g.add(wallMesh);
  const stone = tex.stone2.clone(); stone.wrapS = stone.wrapT = RepeatWrapping; stone.repeat.set(4, 4); stone.needsUpdate = true;
  const floorMesh = new Mesh(merge(floor), new MeshStandardMaterial({ map: stone, vertexColors: true, roughness: 0.9 })); floorMesh.receiveShadow = true; floorMesh.name = 'shop-floor'; g.add(floorMesh);
  const glassMesh = new Mesh(mergeGeometries(glass, false)!, new MeshStandardMaterial({ color: '#dceef4', transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0.1, side: DoubleSide }));
  glassMesh.name = 'shop-glass'; glassMesh.renderOrder = 10; g.add(glassMesh);
  // вывески: одна текстура на меш — делаем два меша
  const signMesh = new Mesh(art[0], new MeshStandardMaterial({ map: makeSign(['LAKE LAND', 'reception · mini market']), roughness: 0.8 })); signMesh.castShadow = true; g.add(signMesh);
  const recMesh = new Mesh(art[1], new MeshStandardMaterial({ map: makeSign(['RECEPTION'], 512, 128, '#f4f1ea', '#2f2d2b'), roughness: 0.8 })); g.add(recMesh);
  // невидимый пандус от земли к порогу (в коллайдер), чтобы ступень 0,1–0,4 м не мешала
  const ramp = new Mesh(new BoxGeometry(2.6, 0.02, 2.2), new MeshStandardMaterial({ visible: false }));
  ramp.position.set(0, -groundDrop / 2 - 0.05, hd + 1.9); ramp.rotation.x = Math.atan2(groundDrop + 0.1, 2.2); g.add(ramp);
  g.userData.receptionist = new Vector3(-2.3, 0, -hd + 0.95); // где стоит администратор (локально)
  return g;
}
