// Правила подмены материалов для моделей из Revit (через APS → OBJ → GLB).
// Имена материалов в экспорте безличные (Obj.NNNN), поэтому роль определяем по признакам:
// прозрачность, цвет, размер, ориентация граней и наличие текстуры.
import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Material, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, Texture, Vector2, Vector3,
} from 'three';

export type Role =
  | 'glass' | 'water' | 'ground' | 'paving' | 'terrain' | 'ceiling' | 'textured' | 'default'
  // отделка по текстурам бюро «Алгоритм» (Роман), см. README «Материалы»
  | 'slats' | 'walnut' | 'stucco' | 'wallstone' | 'mosaic' | 'paint' | 'plants';

export const ROLES: Role[] = ['glass', 'water', 'ground', 'paving', 'terrain', 'ceiling', 'textured', 'default', 'slats', 'walnut', 'stucco', 'wallstone', 'mosaic', 'paint', 'plants'];

/** Цвет Revit-материала (из IFC: IfcSurfaceStyle → IfcColourRgb) совпадает с запрошенным с допуском. */
function near(c: Color, r: number, g: number, b: number, tol = 0.025) {
  return Math.abs(c.r - r) < tol && Math.abs(c.g - g) < tol && Math.abs(c.b - b) < tol;
}

export type MaterialStats = { role: Role; count: number };

const tmpBox = new Box3();
const tmpSize = new Vector3();
const tmpN = new Vector3();

const tA = new Vector3(), tB = new Vector3(), tC = new Vector3();
/** Доля горизонтальных треугольников, по геометрии в мировых координатах (нормали из экспорта ненадёжны). */
function horizontalShare(mesh: Mesh): number {
  const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
  const idx = mesh.geometry.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const step = Math.max(1, Math.floor(triCount / 1500));
  mesh.updateWorldMatrix(true, false);
  let up = 0, total = 0;
  for (let t = 0; t < triCount; t += step) {
    const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    tA.set(pos.getX(a), pos.getY(a), pos.getZ(a)).applyMatrix4(mesh.matrixWorld);
    tB.set(pos.getX(b), pos.getY(b), pos.getZ(b)).applyMatrix4(mesh.matrixWorld);
    tC.set(pos.getX(c), pos.getY(c), pos.getZ(c)).applyMatrix4(mesh.matrixWorld);
    tB.sub(tA); tC.sub(tA); tmpN.crossVectors(tB, tC);
    const L = tmpN.length(); if (L < 1e-9) continue;
    if (Math.abs(tmpN.y / L) > 0.9) up++;
    total++;
  }
  return total ? up / total : 0;
}

function classify(mesh: Mesh, mat: MeshStandardMaterial, largestGround: Mesh | null, waterBoxes: Box3[]): Role {
  const map = mat.map;
  const mapName = (map?.name || '').toLowerCase();
  // мировые размеры (геометрия квантована, масштаб сидит в узле): x,z — план, y — высота
  tmpBox.setFromObject(mesh).getSize(tmpSize);
  const c = mat.color;
  const lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
  if (map && /grass|planting/.test(mapName)) return 'ground';
  if (mat.transparent || mat.opacity < 0.99) {
    // вода: голубой оттенок; стекло — всё остальное прозрачное
    if (c.b > c.r + 0.12 && c.b > c.g) return 'water';
    return 'glass';
  }
  if (map) return 'textured';
  // рельеф участка (топоповерхность Revit): огромный меш на весь участок с сотнями тысяч треугольников
  const idx = mesh.geometry.index;
  const tris = (idx ? idx.count : (mesh.geometry.getAttribute('position') as BufferAttribute).count) / 3;
  if (tmpSize.x > 40 && tmpSize.z > 40 && tris > 100_000) return 'terrain';
  // площадка/участок: самый большой меш без текстуры — трава; остальные большие плоские — дороги/мощение
  if (tmpSize.x > 50 && tmpSize.z > 30) return mesh === largestGround ? 'ground' : 'paving';
  if (tmpSize.x > 25 && tmpSize.z > 25 && tmpSize.y < 3) return 'paving';
  // --- отделка по цветам Revit-материалов (одинаковы во всех виллах; расшифровка цвет→имя из IFC) ---
  // «Панель из древесины» / «Деревянный каркас» — обшивка фасадов → реечная панель СМ Wall
  if (near(c, 0.88, 0.70, 0.49)) return 'slats';
  // «KSM_Дерево_Орех» — перголы над террасами и реечные экраны
  if (near(c, 0.5, 0.5, 0.5)) return 'walnut';
  // «KSM_краска_RAL 7021/7005» — перила, рамы, козырьки; в экспорте оранжевая заглушка
  if (near(c, 0.98, 0.52, 0.17)) return 'paint';
  // «KSM_01_Штукатурка …» (жёлтая заглушка) и белые крашеные стены (вилла 2.x — один большой меш без UV)
  if (c.r > 0.9 && c.g > 0.9 && c.b < 0.1) return 'stucco';
  if (c.r > 0.99 && c.g > 0.99 && c.b > 0.99 && tris > 20_000 && tmpSize.x > 8 && tmpSize.z > 8) return 'stucco';
  // «KSM_Вентфасад_керамогранит» — акцентные полосы фасада → камень «фрагменты стен»
  if (near(c, 0.75, 0.75, 0.75) && tris > 2000 && tmpSize.x > 8 && tmpSize.z > 8) return 'wallstone';
  // озеленение из семейств Revit (серые пальмы/кусты, без IFC-материала)
  if (near(c, 0.4, 0.4, 0.4) && tris > 3000 && tmpSize.y > 2) return 'plants';
  // чаша бассейна: бирюзовая заглушка Revit или непрозрачный меш, вложенный в объём воды
  if (c.b > 0.6 && c.g > 0.6 && c.r < 0.45) return 'mosaic';
  tmpBox.setFromObject(mesh);
  for (const w of waterBoxes) {
    const inPlan = tmpBox.min.x > w.min.x - 0.3 && tmpBox.max.x < w.max.x + 0.3 && tmpBox.min.z > w.min.z - 0.3 && tmpBox.max.z < w.max.z + 0.3;
    if (inPlan && tmpBox.max.y <= w.max.y + 0.25 && tmpBox.min.y <= w.min.y + 0.3 && tmpSize.y < 3.5) return 'mosaic';
  }
  // тёмные горизонтальные плоскости размером с дом — потолки/подшивки из Revit
  if (lum < 0.16 && tmpSize.x > 8 && tmpSize.z > 8 && horizontalShare(mesh) > 0.85) return 'ceiling';
  return 'default';
}

/**
 * Развёртка «коробкой» для земли без UV (Вилла №1): каждый треугольник проецируется по своей
 * доминирующей оси в мировых координатах, поэтому откосы не растягивают текстуру в полосы.
 * Геометрия пересобирается неиндексированной во float (исходная квантована).
 */
function boxUV(mesh: Mesh, scale: number) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as BufferAttribute;
  const idx = g.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  mesh.updateWorldMatrix(true, false);
  const P = new Float32Array(triCount * 9);
  const UV = new Float32Array(triCount * 6);
  const w = [new Vector3(), new Vector3(), new Vector3()];
  const n = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
      P[t * 9 + k * 3] = pos.getX(i); P[t * 9 + k * 3 + 1] = pos.getY(i); P[t * 9 + k * 3 + 2] = pos.getZ(i);
      w[k].set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
    }
    e1.subVectors(w[1], w[0]); e2.subVectors(w[2], w[0]); n.crossVectors(e1, e2);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = w[k];
      let u: number, vv: number;
      if (ay >= ax && ay >= az) { u = v.x; vv = v.z; }
      else if (ax >= az) { u = v.z; vv = v.y; }
      else { u = v.x; vv = v.y; }
      UV[t * 6 + k * 2] = u / scale; UV[t * 6 + k * 2 + 1] = vv / scale;
    }
  }
  const ng = new BufferGeometry();
  ng.setAttribute('position', new Float32BufferAttribute(P, 3));
  ng.setAttribute('uv', new Float32BufferAttribute(UV, 2));
  ng.computeVertexNormals();
  mesh.geometry = ng;
}

export type MaterialAssets = {
  grass: Texture;
  /** Текстуры Романа (3D чертежи/Мои, 7_Текстура), подготовлены scripts/prep_textures.py */
  slats: Texture; slatsN: Texture; walnut: Texture; stucco: Texture; stuccoN: Texture;
  wallstone: Texture; stone2: Texture; stone2N: Texture; mosaic: Texture;
};
export type MaterialOptions = {
  /** Цвет «краски» (RAL 7021 по умолчанию; у Виллы №3 это RAL 7005 серый) */
  paint?: string;
};
/** Масштаб «коробочной» развёртки (м на один повтор текстуры) по ролям без UV. */
const BOX_UV_SCALE: Partial<Record<Role, number>> = { ground: 4, terrain: 4, slats: 0.45, walnut: 1.5, stucco: 1.2, wallstone: 1.0, mosaic: 0.6 };

function prepTexture(t: Texture, name: string, color = true) {
  t.wrapS = t.wrapT = RepeatWrapping;
  if (color) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  t.name = name;
  t.needsUpdate = true;
}
export type PlanRect = { min: [number, number]; max: [number, number]; above?: number };

/** Удаляет у меша треугольники, центр которых (в плане, мировые x,z) попадает в один из прямоугольников. */
export function cutTriangles(mesh: Mesh, cuts: PlanRect[]) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as BufferAttribute;
  const uv = g.getAttribute('uv') as BufferAttribute | undefined;
  const idx = g.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  mesh.updateWorldMatrix(true, false);
  const P: number[] = [], U: number[] = [];
  const w = new Vector3();
  for (let t = 0; t < triCount; t++) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
    let cx = 0, cy = 0, cz = 0;
    for (const i of ids) { w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld); cx += w.x / 3; cy += w.y / 3; cz += w.z / 3; }
    const inside = cuts.some((c) => cx >= c.min[0] && cx <= c.max[0] && cz >= c.min[1] && cz <= c.max[1] && (c.above === undefined || cy > c.above));
    if (inside) continue;
    for (const i of ids) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (uv) U.push(uv.getX(i), uv.getY(i)); }
  }
  const ng = new BufferGeometry();
  ng.setAttribute('position', new Float32BufferAttribute(P, 3));
  if (uv) ng.setAttribute('uv', new Float32BufferAttribute(U, 2));
  ng.computeVertexNormals();
  mesh.geometry = ng;
}

/** Проходит по сцене, заменяет материалы по ролям. Возвращает статистику для отладки. */
export function applyMaterialRules(root: Object3D, assets: MaterialAssets, terrainCuts: PlanRect[] = [], options: MaterialOptions = {}): Record<Role, number> {
  const stats = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const cache = new Map<Material, Material>();
  prepTexture(assets.grass, 'grass');
  prepTexture(assets.slats, 'slats'); prepTexture(assets.slatsN, 'slats_n', false);
  prepTexture(assets.walnut, 'walnut');
  prepTexture(assets.stucco, 'stucco'); prepTexture(assets.stuccoN, 'stucco_n', false);
  prepTexture(assets.wallstone, 'wallstone');
  prepTexture(assets.stone2, 'stone2'); prepTexture(assets.stone2N, 'stone2_n', false);
  prepTexture(assets.mosaic, 'mosaic');

  // объёмы воды (бассейны) — чтобы распознать чашу под ними
  const waterBoxes: Box3[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
    const role = mesh.userData.role as Role | undefined;
    if (role === 'water' || (!role && (m.transparent || m.opacity < 0.99) && m.color.b > m.color.r + 0.12 && m.color.b > m.color.g)) {
      waterBoxes.push(new Box3().setFromObject(mesh));
    }
  });

  // самый большой по площади нетекстурированный меш — земля участка
  let largestGround: Mesh | null = null, largestArea = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || mesh.userData.role) return;
    const m = mesh.material as MeshStandardMaterial;
    if (Array.isArray(mesh.material) || m.map || m.transparent) return;
    tmpBox.setFromObject(mesh).getSize(tmpSize);
    const idx = mesh.geometry.index;
    const tris = (idx ? idx.count : (mesh.geometry.getAttribute('position') as BufferAttribute).count) / 3;
    if (tris > 100_000) return; // это рельеф (terrain), обрабатывается отдельно
    const area = tmpSize.x * tmpSize.z;
    if (area > largestArea) { largestArea = area; largestGround = mesh; }
  });

  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.role) { stats[mesh.userData.role as Role]++; return; } // уже обработан (StrictMode)
    mesh.castShadow = true; mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out: Material[] = mats.map((m) => {
      const src = m as MeshStandardMaterial;
      const role = classify(mesh, src, largestGround, waterBoxes);
      // роли с текстурой у мешей без UV требуют «коробочной» развёртки — делаем на уровне меша
      const uvScale = BOX_UV_SCALE[role];
      if (uvScale && !src.map) boxUV(mesh, uvScale);
      if ((role === 'ground' || role === 'terrain') && terrainCuts.length) cutTriangles(mesh, terrainCuts);
      let mat = cache.get(m);
      if (!mat) {
        mat = buildMaterial(role, src, assets, options);
        cache.set(m, mat);
      }
      stats[role]++;
      mesh.userData.role = role;
      // дороги/мощение лежат вровень с рельефом — приподнимаем на 3 см (локальная ось Z = вверх до поворота)
      if (role === 'paving') mesh.position.z += 0.03 / (mesh.scale.z || 1);
      return mat;
    });
    mesh.material = out.length === 1 ? out[0] : out;
    if (mesh.userData.role === 'glass' || mesh.userData.role === 'water') { mesh.castShadow = false; mesh.renderOrder = 10; }
  });
  return stats;
}

function buildMaterial(role: Role, src: MeshStandardMaterial, assets: MaterialAssets, options: MaterialOptions): Material {
  switch (role) {
    case 'slats':
      return new MeshStandardMaterial({ map: assets.slats, normalMap: assets.slatsN, normalScale: new Vector2(0.9, 0.9), roughness: 0.75, metalness: 0, side: DoubleSide });
    case 'walnut':
      return new MeshStandardMaterial({ map: assets.walnut, color: new Color('#d9c6b0'), roughness: 0.7, metalness: 0, side: DoubleSide });
    case 'stucco':
      return new MeshStandardMaterial({ map: assets.stucco, normalMap: assets.stuccoN, normalScale: new Vector2(0.6, 0.6), color: new Color('#ebe6dc'), roughness: 0.95, metalness: 0, side: DoubleSide });
    case 'wallstone':
      return new MeshStandardMaterial({ map: assets.wallstone, roughness: 0.95, metalness: 0, side: DoubleSide });
    case 'mosaic':
      return new MeshStandardMaterial({ map: assets.mosaic, roughness: 0.35, metalness: 0, side: DoubleSide });
    case 'paint':
      return new MeshStandardMaterial({ color: new Color(options.paint ?? '#35383a'), roughness: 0.55, metalness: 0.1, side: DoubleSide });
    case 'plants':
      return new MeshStandardMaterial({ color: new Color('#4f7a3c'), roughness: 1, metalness: 0, side: DoubleSide });
    case 'glass':
      return new MeshPhysicalMaterial({
        color: new Color('#cfe6ea'), transparent: true, opacity: 0.22, roughness: 0.06, metalness: 0,
        envMapIntensity: 1.2, side: DoubleSide, depthWrite: false, clearcoat: 1, clearcoatRoughness: 0.05,
      });
    case 'water':
      return new MeshPhysicalMaterial({
        color: new Color('#2f9fc4'), transparent: true, opacity: 0.78, roughness: 0.08, metalness: 0,
        envMapIntensity: 1.0, side: DoubleSide, depthWrite: false,
      });
    case 'ground': {
      const m = new MeshStandardMaterial({ map: src.map ?? assets.grass, color: new Color('#dfe6d2'), roughness: 1, metalness: 0, side: DoubleSide });
      if (m.map) { m.map.wrapS = m.map.wrapT = RepeatWrapping; m.map.colorSpace = SRGBColorSpace; m.map.anisotropy = 8; m.map.needsUpdate = true; }
      return m;
    }
    case 'terrain': {
      const m = new MeshStandardMaterial({ map: assets.grass, color: new Color('#cfdcc0'), roughness: 1, metalness: 0, side: DoubleSide });
      m.map!.wrapS = m.map!.wrapT = RepeatWrapping; m.map!.colorSpace = SRGBColorSpace; m.map!.anisotropy = 8;
      return m;
    }
    case 'paving': {
      // дороги/мощение лежат вровень с землёй — выигрываем z-fight сдвигом полигонов
      const m = src.clone();
      m.roughness = 0.95; m.metalness = 0; m.side = DoubleSide;
      m.polygonOffset = true; m.polygonOffsetFactor = -4; m.polygonOffsetUnits = -4;
      return m;
    }
    case 'ceiling':
      return new MeshStandardMaterial({ color: new Color('#e9e4da'), roughness: 0.95, metalness: 0, side: DoubleSide });
    case 'textured': {
      const m = src.clone();
      m.roughness = 0.9; m.metalness = 0; m.side = DoubleSide;
      // каменная кладка Revit (masonry.stone.ashlar) → камень Романа с его картой нормалей, UV из Revit
      if (/ashlar|masonry|stone/.test((src.map?.name || '').toLowerCase())) {
        m.map = assets.stone2; m.normalMap = assets.stone2N; m.normalScale = new Vector2(0.7, 0.7); m.color.set('#ffffff');
        return m;
      }
      if (m.map) { m.map.wrapS = m.map.wrapT = RepeatWrapping; m.map.colorSpace = SRGBColorSpace; m.map.needsUpdate = true; }
      return m;
    }
    default: {
      const m = src.clone();
      m.roughness = 0.88; m.metalness = 0; m.side = DoubleSide;
      // бетон плит/парапетов вилл 2.x и 3 (0.67,0.63,0.61) под зеленоватым небом уходит в оливковый — светлее и нейтральнее
      if (near(m.color, 0.67, 0.63, 0.61)) m.color.set('#dcd8d2');
      // чисто чёрные/очень тёмные «служебные» цвета Revit слегка поднимаем, иначе проваливаются в тень
      const lum = 0.3 * m.color.r + 0.59 * m.color.g + 0.11 * m.color.b;
      if (lum < 0.08) m.color.setScalar(0.18);
      return m;
    }
  }
}
