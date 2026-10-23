// Правила подмены материалов для моделей из Revit (через APS → OBJ → GLB).
// Имена материалов в экспорте безличные (Obj.NNNN), поэтому роль определяем по признакам:
// прозрачность, цвет, размер, ориентация граней и наличие текстуры.
import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Material, Mesh,
  MeshPhysicalMaterial, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, Texture, Vector3,
} from 'three';

export type Role = 'glass' | 'water' | 'ground' | 'paving' | 'terrain' | 'ceiling' | 'textured' | 'default';

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

function classify(mesh: Mesh, mat: MeshStandardMaterial, largestGround: Mesh | null): Role {
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

export type MaterialAssets = { grass: Texture };
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
export function applyMaterialRules(root: Object3D, assets: MaterialAssets, terrainCuts: PlanRect[] = []): Record<Role, number> {
  const stats: Record<Role, number> = { glass: 0, water: 0, ground: 0, paving: 0, terrain: 0, ceiling: 0, textured: 0, default: 0 };
  const cache = new Map<Material, Material>();
  assets.grass.wrapS = assets.grass.wrapT = RepeatWrapping;
  assets.grass.colorSpace = SRGBColorSpace;
  assets.grass.name = 'grass';

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
      const role = classify(mesh, src, largestGround);
      // роль ground для меша без UV требует планарной развёртки — делаем на уровне меша
      if ((role === 'ground' || role === 'terrain') && !src.map) boxUV(mesh, 4);
      if ((role === 'ground' || role === 'terrain') && terrainCuts.length) cutTriangles(mesh, terrainCuts);
      let mat = cache.get(m);
      if (!mat) {
        mat = buildMaterial(role, src, assets);
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

function buildMaterial(role: Role, src: MeshStandardMaterial, assets: MaterialAssets): Material {
  switch (role) {
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
      if (m.map) { m.map.wrapS = m.map.wrapT = RepeatWrapping; m.map.colorSpace = SRGBColorSpace; m.map.needsUpdate = true; }
      return m;
    }
    default: {
      const m = src.clone();
      m.roughness = 0.88; m.metalness = 0; m.side = DoubleSide;
      // чисто чёрные/очень тёмные «служебные» цвета Revit слегка поднимаем, иначе проваливаются в тень
      const lum = 0.3 * m.color.r + 0.59 * m.color.g + 0.11 * m.color.b;
      if (lum < 0.08) m.color.setScalar(0.18);
      // «служебный» ядовито-жёлтый Revit (1,1,0) — на фасадах Виллы №3; заменяем на светлую штукатурку
      if (m.color.r > 0.9 && m.color.g > 0.9 && m.color.b < 0.1) m.color.set('#e9e3d4');
      return m;
    }
  }
}
