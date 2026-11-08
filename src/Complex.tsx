// Сцена всего комплекса Lake Land: 12 строений по генплану 053-ГП (23.10.2026), рельеф участка по горизонталям,
// окрестности: рельеф SRTM 4×4 км, лагуна Мавелла и океан, дома и деревья вокруг (OpenStreetMap).
// Данные готовит aps/tools/genplan_*.py → public/complex/. Оси: x — восток, z — юг, y — отметка генплана.
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useTexture } from '@react-three/drei';
import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, LOD, Matrix4, Mesh, MeshStandardMaterial, type Object3D,
  Ray, RepeatWrapping, Shape, SRGBColorSpace, type Texture, Vector3, type Intersection, Quaternion,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyMaterialRules, openDoors, splitComponents } from './materials';
import { buildCollider, buildColliderFromParts, collectColliderParts, colliderStore, type Collider } from './collider';
import { MODELS } from './models';
import { asset } from './assets';
import { makeRamp } from './Villa';
import { Player } from './Player';
import { Frangipani, Palms, Shrubs, type Plant } from './world/Vegetation';
import { Lagoon, WATER_TIME, makeBottomTexture, type Bottom } from './world/Lagoon';
import { buildPathNetwork, distToPaths, pathRibbon, type PathNet } from './world/Paths';
import { makeArtTexture, makeNoiseTexture, makeWeaveTexture, type DetailMaps } from './world/textures';
import { furnishVilla, glassBoxes, waterBoxes, type TerraceSpot } from './world/Interiors';
import type { IdlerSpec } from './world/Characters';
import { Npcs } from './world/Characters';
import { buildShop } from './world/Shop';
import { Grass } from './world/Grass';
import { planTerraces, wallGeometry, type Terraces } from './world/Terraces';
import { gradePaths, stepGeometry, type Graded } from './world/PathGrade';
import { buildIndoor, indoorAt, type IndoorMask } from './world/Indoor';
import * as F from './world/Furniture';
import { DataTexture, NearestFilter, RedFormat, UnsignedByteType, Vector2 } from 'three';
import { Lotuses, placeLotuses, type LotusItem } from './world/Lotus';
import { ModelPlants } from './world/ModelPlants';
import { useQuality } from './world/Quality';
import { input } from './input';
import { loadPlan } from './plan';
import type { Plan } from './plan';

/** Дом на генплане для карты комплекса и телепорта: контур в мире (x,z), матрица дома, точка входа. */
export type HouseInfo = {
  id: string; model: string; title: string;
  poly: [number, number][];
  /** контур дома в координатах виллы: minX, minZ, maxX, maxZ */
  fp: [number, number, number, number];
  entry: [number, number, number]; entryYaw: number; matrix: Matrix4;
  /** места гостей на террасах (мир) */
  spots: (TerraceSpot & { house: string })[];
};
/** Данные комплекса для HUD (карта, телепорт): заполняются сценой, читаются по таймеру. */
export const complexStore: {
  data: ComplexData | null;
  houses: HouseInfo[];
  heightAt: ((x: number, z: number) => number | null) | null;
  /** 'none' — коллайдер не строился, 'building' — строится, 'ready' — можно ходить */
  collider: 'none' | 'building' | 'ready';
} = { data: null, houses: [], heightAt: null, collider: 'none' };
let complexCollider: Collider | null = null;
let detailCache: DetailMaps | null = null;
/** Карты деталей мебели: дерево — текстура ореха Романа (повтор), ткань — процедурное переплетение. */
export function detailMaps(walnut: Texture): DetailMaps {
  if (detailCache) return detailCache;
  const wood = walnut.clone(); wood.wrapS = wood.wrapT = RepeatWrapping; wood.needsUpdate = true;
  detailCache = { wood, fabric: makeWeaveTexture() }; return detailCache;
}
let builtCache: { data: NonNullable<ReturnType<typeof useComplexData>>; built: BuiltScene; heightAt: (x: number, z: number) => number | null } | null = null; // рельеф/растения между заходами
/** Этап загрузки комплекса (для индикатора и замеров): window.__stage, window.__stageTimes. */
const stageTimes: Record<string, number> = {};
export const complexStage = { value: '', listeners: new Set<(s: string) => void>() };
function setStage(name: string) {
  complexStage.value = name; stageTimes[name] = Math.round(performance.now());
  (window as unknown as { __stage: string; __stageTimes: unknown }).__stage = name; (window as unknown as { __stageTimes: unknown }).__stageTimes = stageTimes;
  complexStage.listeners.forEach((l) => l(name));
} // кэш между заходами в режим (сцена размонтируется при смене режима)

/** Маски «внутри дома» по типам вилл (координаты плана) и мировая маска участка для шейдера рельефа. */
const indoorMasks = new Map<string, IndoorMask>();
const INDOOR = { tex: { value: null as DataTexture | null }, i0: { value: new Vector2() }, size: { value: new Vector2(1, 1) }, has: { value: 0 } };
/** Точка старта пешей прогулки: у въезда рядом с магазином, взгляд на ряд вилл. */
const WALK_SPAWN_XZ: [number, number] = [-36, -34];
const LOD_FAR = 65;
const PROVEG = new URLSearchParams(location.search).has('proveg'); // процедурная растительность вместо моделей Kenney
// расстановка моделей растений: высота в метрах, поворот и наклон из параметров Plant (s, r)
const placePalm = (p: Plant) => ({ x: p.x, y: p.y + 0.2, z: p.z, yaw: p.r * 6.28, height: 8 + p.s * 6, lean: (p.r - 0.5) * 0.18, leanDir: p.s * 6.28 });
const placePalmShort = (p: Plant) => ({ x: p.x, y: p.y + 0.2, z: p.z, yaw: p.r * 6.28, height: 5 + p.s * 3, lean: (p.r - 0.5) * 0.12, leanDir: p.s * 6.28 });
const placeBush = (p: Plant) => ({ x: p.x, y: p.y + 0.1, z: p.z, yaw: p.r * 6.28, height: 0.7 + p.s * 0.9 });
const placeTree = (p: Plant) => ({ x: p.x, y: p.y + 0.05, z: p.z, yaw: p.r * 6.28, height: 4 + p.s * 2.5 });
const LAGOON_XZ: [number, number] = [150, 20]; // над чем кружат птицы (лагуна к востоку от участка)
type BuiltScene = { site: BufferGeometry; dem: BufferGeometry; houses: BufferGeometry | null; paths: BufferGeometry | null; near: Plant[]; far: Plant[]; shrubs: Plant[]; frangipani: Plant[]; net: PathNet; walls: BufferGeometry | null; steps: BufferGeometry | null; cheeks: BufferGeometry | null; lotus: LotusItem[]; bottom: Bottom | null; waterAt: (x: number, z: number) => boolean; grassOk: (x: number, z: number) => boolean }; // м: дальше этого дом рисуется упрощённой копией
let artTexture: ReturnType<typeof makeArtTexture> | null = null;
export const artTex = () => (artTexture ??= makeArtTexture());
const WALK_LOOK_XZ: [number, number] = [-10, 0];

type Placement = { id: string; model: string; floor: number; rot: number; pos: [number, number]; size?: [number, number]; moved?: boolean };
/** По указанию заказчика магазин отодвинут целиком на 15 м от ближайшей виллы в сторону границы участка
 *  (вдоль направления «от виллы», но не ближе 6 м к границе). Идемпотентно: флаг moved. */
function moveShop(shop: Placement, houses: HouseInfo[], B: [number, number][]) {
  if (shop.moved) return;
  const near = houses.map((hh) => new Vector3().setFromMatrixPosition(hh.matrix)).sort((a, b) => Math.hypot(a.x - shop.pos[0], a.z - shop.pos[1]) - Math.hypot(b.x - shop.pos[0], b.z - shop.pos[1]))[0];
  const distB = (x: number, z: number) => { let best = Infinity; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [ax, az] = B[j], [bx, bz] = B[i]; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz; const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0; best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z)); } return best; };
  if (near) {
    const dx = shop.pos[0] - near.x, dz = shop.pos[1] - near.z; const L = Math.hypot(dx, dz) || 1; let m = 15;
    while (m > 0 && (!inPoly(shop.pos[0] + (dx / L) * m, shop.pos[1] + (dz / L) * m, B) || distB(shop.pos[0] + (dx / L) * m, shop.pos[1] + (dz / L) * m) < 6)) m -= 1;
    shop.pos = [shop.pos[0] + (dx / L) * m, shop.pos[1] + (dz / L) * m];
  }
  shop.moved = true;
}
/** Положение магазина: сдвиг от виллы, поворот входом по указанию заказчика, размеры с учётом поворота, точка перед дверью. */
function shopPose(shop: Placement, houses: HouseInfo[], B: [number, number][]) {
  moveShop(shop, houses, B);
  let W = shop.size?.[0] ?? 9.5, D = shop.size?.[1] ?? 8.5;
  // вход — по указанию заказчика: стена справа от прежнего стеклянного фасада (прежний фасад смотрел к старту прогулки),
  // то есть поворот на +90°; при нечётном повороте относительно пятна генплана ширина и глубина меняются местами
  const toSpawn = Math.atan2(WALK_SPAWN_XZ[0] - shop.pos[0], WALK_SPAWN_XZ[1] - shop.pos[1]);
  const yaw0 = [0, 1, 2, 3].map((k) => -shop.rot + k * Math.PI / 2).sort((a, b) => Math.cos(b - toSpawn) - Math.cos(a - toSpawn))[0];
  const yaw = yaw0 + Math.PI / 2;
  const kq = ((Math.round((yaw + shop.rot) / (Math.PI / 2)) % 4) + 4) % 4; if (kq % 2) { const t = W; W = D; D = t; }
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const door: [number, number] = [shop.pos[0] + fx * (D / 2 + 2.6), shop.pos[1] + fz * (D / 2 + 2.6)];
  return { pos: shop.pos, yaw, W, D, fx, fz, door, r: Math.hypot(W, D) / 2 + 1.2 };
}
type ComplexData = {
  water_level: number;
  site: { x0: number; z0: number; step: number; nx: number; nz: number; boundary: [number, number][]; paths: [number, number][][] };
  dem: { n: number; half: number; step: number; mask_n: number; land_n: number };
  buildings: Placement[];
  osm: { water: [number, number][][]; coast: [number, number][][]; buildings: [number, number][][]; roads: [number, number][][] };
};

const MODEL_IDS = ['villa1', 'villa21', 'villa22', 'villa3'] as const;

function inPoly(x: number, z: number, poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Загрузка JSON и двух бинарных сеток высот. */
function useComplexData() {
  const [d, setD] = useState<{ c: ComplexData; site: Float32Array; dem: Float32Array; water: Uint8Array; land: Float32Array; cover: Uint8Array | null; plans: Record<string, Plan | null> } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(asset('complex/complex.json')).then((r) => r.json()),
      fetch(asset('complex/site_h.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/dem.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/water_mask.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/land_h.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/landcover.bin')).then((r) => (r.ok && !(r.headers.get('content-type') || '').includes('text/html') ? r.arrayBuffer() : null)).catch(() => null),
      Promise.all(MODEL_IDS.map((id) => loadPlan(id))),
    ]).then(([c, s, dm, wm, lh, lc, plans]) => { setStage('data:' + (alive ? 'set' : 'stale')); if (alive) setD({ c, site: new Float32Array(s), dem: new Float32Array(dm), water: new Uint8Array(wm), land: new Float32Array(lh), cover: lc ? new Uint8Array(lc) : null, plans: Object.fromEntries(MODEL_IDS.map((id, k) => [id, plans[k]])) }); }).catch((e) => { setStage('data:error ' + e); });
    return () => { alive = false; };
  }, []);
  return d;
}

/** Высота окрестностей (SRTM) билинейно; вода — ниже уровня лагуны. */
function demSampler(c: ComplexData, dem: Float32Array) {
  const { n, half, step } = c.dem;
  return (x: number, z: number) => {
    const fx = (x + half) / step, fz = (z + half) / step;
    const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const a = dem[j * n + i], b = dem[j * n + i + 1], cc = dem[(j + 1) * n + i], d = dem[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz;
  };
}

function siteSampler(c: ComplexData, h: Float32Array) {
  const { x0, z0, step, nx, nz } = c.site;
  return (x: number, z: number) => {
    const fx = (x - x0) / step, fz = (z - z0) / step;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j;
    return (h[j * nx + i] * (1 - tx) + h[j * nx + i + 1] * tx) * (1 - tz) + (h[(j + 1) * nx + i] * (1 - tx) + h[(j + 1) * nx + i + 1] * tx) * tz;
  };
}

/** Сантехника из Revit пришла с «деревянным» материалом (серый 0,5 → орех): ванны и раковины в санузлах (комнаты
 *  «Toilet & Bath» плана, коробка вокруг метки) из мешей роли walnut отделяются в белый глянцевый акрил. */
function whitenBath(scene: Object3D, plan: Plan) {
  const boxes: Box3[] = [];
  for (const l of plan.levels) for (const r of l.rooms) {
    if (!r.name.toLowerCase().includes('toilet & bath')) continue;
    const half = Math.max(1.6, Math.sqrt(r.area ?? 6) * 0.8);
    boxes.push(new Box3(new Vector3(r.x - half, l.level - 0.3, r.z - half), new Vector3(r.x + half, l.level + 2.3, r.z + half)));
  }
  if (!boxes.length) return;
  const acrylic = new MeshStandardMaterial({ color: '#f7f6f2', roughness: 0.12, metalness: 0, side: DoubleSide });
  const targets: Mesh[] = []; scene.traverse((o) => { const m = o as Mesh; if (m.isMesh && (m.userData.role === 'walnut' || m.userData.role === 'plants')) targets.push(m); });
  for (const m of targets) {
    if (m.userData.role === 'walnut') {
      // ванна из Revit — грубая «деревянная» форма: в каждом санузле ищем связный кусок размером с ванну и ставим вместо
      // него процедурную того же пятна; остальное дерево санузла — белый акрил
      const tubPred = (sz: Vector3) => { const L = Math.max(sz.x, sz.z), Wd = Math.min(sz.x, sz.z); return L >= 1.3 && L <= 2.4 && Wd >= 0.6 && Wd <= 1.3 && sz.y >= 0.3 && sz.y <= 0.95; };
      const rest: BufferGeometry[] = [];
      for (const b of boxes) {
        const piece = splitOutBoxes(m, [b]); if (!piece) continue;
        const tmp = new Mesh(piece); tmp.position.copy(m.position); tmp.quaternion.copy(m.quaternion); tmp.scale.copy(m.scale); m.parent?.add(tmp); tmp.updateWorldMatrix(true, false);
        let tubGeom: BufferGeometry | null = null;
        const part = splitComponents(tmp, tubPred);
        if (part) tubGeom = part.geometry;
        else { const sz = new Box3().setFromBufferAttribute(piece.getAttribute('position') as BufferAttribute).applyMatrix4(tmp.matrixWorld).getSize(new Vector3()); if (tubPred(sz)) { tubGeom = tmp.geometry; tmp.geometry = new BufferGeometry(); } }
        if (tubGeom && tubGeom.getAttribute('position')) {
          const wb = new Box3().setFromBufferAttribute(tubGeom.getAttribute('position') as BufferAttribute).applyMatrix4(tmp.matrixWorld); const sz = wb.getSize(new Vector3());
          const tub = new Mesh(F.bathtub(Math.min(Math.max(sz.x, sz.z), 1.9), Math.min(Math.min(sz.x, sz.z), 0.9)), acrylic);
          // шаблон дома повёрнут (Revit Z-up) и сдвинут: ставим ванну в мировые координаты через обёртку-группу в системе сцены
          const holder = new Group(); scene.add(holder); scene.updateMatrixWorld(true);
          holder.position.copy(scene.worldToLocal(new Vector3((wb.min.x + wb.max.x) / 2, wb.min.y, (wb.min.z + wb.max.z) / 2)));
          const sq = new Quaternion(); scene.getWorldQuaternion(sq); holder.quaternion.copy(sq.invert()); if (sz.x < sz.z) tub.rotation.y = Math.PI / 2;
          tub.userData.role = 'default'; tub.castShadow = true; tub.receiveShadow = true; tub.name = 'bathtub'; holder.add(tub);
          console.info('[bath]', plan.villa, 'ванна заменена', { L: +Math.max(sz.x, sz.z).toFixed(2), W: +Math.min(sz.x, sz.z).toFixed(2) });
        }
        const posA = tmp.geometry.getAttribute('position'); m.parent?.remove(tmp);
        if (posA && posA.count) rest.push(tmp.geometry);
      }
      for (const g of rest) { const nm = new Mesh(g, acrylic); nm.position.copy(m.position); nm.quaternion.copy(m.quaternion); nm.scale.copy(m.scale); nm.userData.role = 'default'; nm.castShadow = true; nm.receiveShadow = true; nm.name = m.name + '-bath'; m.parent?.add(nm); }
    } else {
      // «растения» Revit внутри санузла — сиденье унитаза и прочая керамика: белые
      const inside = splitOutBoxes(m, boxes); if (!inside) continue;
      const nm = new Mesh(inside, acrylic); nm.position.copy(m.position); nm.quaternion.copy(m.quaternion); nm.scale.copy(m.scale); nm.userData.role = 'default'; nm.castShadow = true; nm.receiveShadow = true; nm.name = m.name + '-bath'; m.parent?.add(nm);
    }
  }
}
/** Вырезает из меша треугольники с центром (мир) внутри любой из коробок: возвращает их геометрию, меш остаётся без них. */
function splitOutBoxes(m: Mesh, boxes: Box3[]): BufferGeometry | null {
  const g = m.geometry, pos = g.getAttribute('position') as BufferAttribute, uv = g.getAttribute('uv') as BufferAttribute | undefined, idx = g.index;
  const n = idx ? idx.count / 3 : pos.count / 3; m.updateWorldMatrix(true, false);
  const PI: number[] = [], UI: number[] = [], PO: number[] = [], UO: number[] = []; const w = new Vector3(), c = new Vector3();
  for (let t = 0; t < n; t++) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
    c.set(0, 0, 0); for (const i of ids) { w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld); c.addScaledVector(w, 1 / 3); }
    const inside = boxes.some((b) => b.containsPoint(c));
    const P = inside ? PI : PO, U = inside ? UI : UO;
    for (const i of ids) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (uv) U.push(uv.getX(i), uv.getY(i)); }
  }
  if (!PI.length) return null;
  const mk = (P: number[], U: number[]) => { const ng = new BufferGeometry(); ng.setAttribute('position', new Float32BufferAttribute(P, 3)); if (uv) ng.setAttribute('uv', new Float32BufferAttribute(U, 2)); ng.computeVertexNormals(); return ng; };
  m.geometry = mk(PO, UO); return mk(PI, UI);
}
/** Новая геометрия меша только из треугольников, центр которых (в мировых x,z) внутри box. */
function keepInside(m: Mesh, box: Box3): BufferGeometry {
  const g = m.geometry, pos = g.getAttribute('position') as BufferAttribute, uv = g.getAttribute('uv') as BufferAttribute | undefined, idx = g.index;
  const n = idx ? idx.count / 3 : pos.count / 3; m.updateWorldMatrix(true, false);
  const P: number[] = [], U: number[] = []; const w = new Vector3();
  for (let t = 0; t < n; t++) {
    const ids = [0, 1, 2].map((k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k));
    let cx = 0, cz = 0;
    for (const i of ids) { w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m.matrixWorld); cx += w.x / 3; cz += w.z / 3; }
    if (cx < box.min.x || cx > box.max.x || cz < box.min.z || cz > box.max.z) continue;
    for (const i of ids) { P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); if (uv) U.push(uv.getX(i), uv.getY(i)); }
  }
  const ng = new BufferGeometry(); ng.setAttribute('position', new Float32BufferAttribute(P, 3));
  if (uv) ng.setAttribute('uv', new Float32BufferAttribute(U, 2));
  ng.computeVertexNormals(); return ng;
}

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

export function ComplexScene({ walk = false }: { walk?: boolean }) {
  const data = useComplexData();
  const gltfs = MODEL_IDS.map((id) => useGLTF(asset(MODELS[id].url)));
  // упрощённые копии (gltf-transform simplify, ~25 % треугольников) для домов дальше LOD_FAR: без теней и коллизий
  const lows = MODEL_IDS.map((id) => useGLTF(asset(MODELS[id].url.replace('.glb', '_low.glb'))));
  const tex = useTexture({
    grass: asset('textures/grass.jpg'),
    slats: asset('textures/slats.jpg'), slatsN: asset('textures/slats_n.webp'),
    walnut: asset('textures/walnut.jpg'),
    stucco: asset('textures/stucco.jpg'), stuccoN: asset('textures/stucco_n.webp'),
    wallstone: asset('textures/wallstone.jpg'),
    stone2: asset('textures/stone2.jpg'), stone2N: asset('textures/stone2_n.webp'),
    mosaic: asset('textures/mosaic.jpg'),
  });
  const { camera } = useThree();
  const [built, setBuilt] = useState<BuiltScene | null>(null);
  const instRoot = useRef<Group>(null);
  const groundRoot = useRef<Group>(null);

  // экземпляры вилл: материалы как в прогулке, участок/рельеф самой модели скрыт
  const groundBVH = useRef(new Map<string, Collider>()); // рельеф шаблона каждого типа виллы (для подгонки земли)
  const { instances, houses, pools } = useMemo(() => {
    if (!data) { setStage('memo:nodata'); return { instances: [] as Group[], houses: [] as HouseInfo[], pools: [] as Box3[] }; }
    try {
    setStage('instances:start');
    gltfs.forEach((g, k) => {
      // шаблон ставим как в прогулке (поворот из Revit Z-up, сдвиг): роли земли/рельефа и вырезки считаются
      // по мировым габаритам, без поворота «высота» меша попадает в z и земля классифицируется как мощение
      const cfg0 = MODELS[MODEL_IDS[k]];
      g.scene.rotation.set(...cfg0.rotation); g.scene.position.set(...cfg0.offset);
      g.scene.updateMatrixWorld(true); applyMaterialRules(g.scene, tex, cfg0.terrainCuts ?? [], { paint: cfg0.paint });
      const t0 = performance.now(); const nd = openDoors(g.scene, cfg0.passages ?? []); // двери открыты: полотна в проёмах убраны
      if (nd) console.info('[openDoors]', MODEL_IDS[k], nd, 'tris removed in', (performance.now() - t0) | 0, 'ms');
      // интерьеры по стайл-гайду: мебель в координатах виллы, кладём внутрь шаблона (клоны домов её наследуют)
      const plan = data.plans[MODEL_IDS[k]];
      if (plan && !g.scene.getObjectByName('furniture')) {
        const t1 = performance.now();
        const colT = buildCollider(g.scene); const rayS = new Ray(new Vector3(), new Vector3(0, -1, 0));
        const support = colT ? (x: number, y: number, z: number) => { rayS.origin.set(x, y + 0.35, z); const hs = colT.bvh.raycast(rayS, DoubleSide); return hs.some((ht) => ht.distance < 0.9); } : null;
        const furn = furnishVilla(plan, glassBoxes(g.scene), cfg0.passages ?? [], artTex(), detailMaps(tex.walnut), waterBoxes(g.scene), support);
        colT?.geometry.dispose();
        furn.applyMatrix4(g.scene.matrixWorld.clone().invert()); g.scene.add(furn); g.scene.updateMatrixWorld(true);
        console.info('[furniture]', MODEL_IDS[k], furn.children.map((m) => ((m as Mesh).geometry.getAttribute('position').count / 3) | 0), 'tris in', (performance.now() - t1) | 0, 'ms');
      }
      if (plan && !g.scene.userData.bathDone) { whitenBath(g.scene, plan); g.scene.userData.bathDone = true; }
      if (plan && !indoorMasks.has(MODEL_IDS[k])) indoorMasks.set(MODEL_IDS[k], buildIndoor(plan, glassBoxes(g.scene)));
      const low = lows[k].scene;
      if (!low.userData.prepared) {
        low.rotation.set(...cfg0.rotation); low.position.set(...cfg0.offset); low.updateMatrixWorld(true);
        applyMaterialRules(low, tex, cfg0.terrainCuts ?? [], { paint: cfg0.paint });
        low.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.userData.noCollide = true; m.castShadow = false; m.receiveShadow = false; } });
        low.userData.prepared = true;
      }
      if (!groundBVH.current.has(MODEL_IDS[k])) {
        const gc = buildColliderFromParts(collectColliderParts(g.scene, [], undefined, (m) => m.userData.role !== 'ground' && m.userData.role !== 'terrain'));
        if (gc) groundBVH.current.set(MODEL_IDS[k], gc);
      }
    });
    (window as unknown as { __models: unknown }).__models = MODELS;
    const houses: HouseInfo[] = []; const pools: Box3[] = [];
    const floorsTopo: Record<string, { plan: number; topo: number }> = {};
    const instances = data.c.buildings.filter((b) => b.model !== 'shop').map((b) => {
      const k = MODEL_IDS.indexOf(b.model as typeof MODEL_IDS[number]);
      const cfg = MODELS[b.model];
      const inner = gltfs[k].scene.clone(true);
      inner.rotation.set(...cfg.rotation); inner.position.set(...cfg.offset);
      const innerLow = lows[k].scene.clone(true);
      innerLow.rotation.set(...cfg.rotation); innerLow.position.set(...cfg.offset);
      const outer = new Group(); outer.name = `house-${b.id}`;
      const lod = new LOD(); lod.name = 'lod'; lod.addLevel(inner, 0); lod.addLevel(innerLow, LOD_FAR);
      outer.add(lod); outer.rotation.y = -b.rot; outer.position.set(b.pos[0], b.floor, b.pos[1]);
      outer.updateMatrixWorld(true);
      // футпринт дома в координатах модели: по мешам не больше 32 м (большие меши — участок вместе с плитами)
      outer.rotation.y = 0; outer.position.set(0, 0, 0); outer.updateMatrixWorld(true);
      const fp = new Box3(), tmp = new Box3();
      inner.traverse((o) => {
        const m = o as Mesh; if (!m.isMesh) return;
        tmp.setFromObject(m); const sz = tmp.getSize(new Vector3());
        if (Math.max(sz.x, sz.z) <= 32 && m.userData.role !== 'ground' && m.userData.role !== 'terrain') fp.union(tmp);
      });
      fp.expandByVector(new Vector3(1.2, 0, 1.2));
      // отметка пола по топосъёмке (горизонтали генплана), а не по ±0,00 из чертежей: у каждого типа своя «привязка»
      const topo = siteSampler(data.c, data.site);
      const sampleLocal = (pts: [number, number][]) => {
        const vals: number[] = [];
        for (const [lx, lz] of pts) { const w = new Vector3(lx, 0, lz); w.applyAxisAngle(new Vector3(0, 1, 0), -b.rot).add(new Vector3(b.pos[0], 0, b.pos[1])); const y = topo(w.x, w.z); if (y !== null) vals.push(y); }
        vals.sort((p, q) => p - q); return vals;
      };
      const pct = (v: number[], q: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))] : b.floor);
      const bb = b as Placement & { floorPlan?: number }; if (bb.floorPlan === undefined) bb.floorPlan = b.floor; // StrictMode: memo считается дважды
      let floorTopo = b.floor;
      if (b.model === 'villa1') {
        // ступенчатый дом на склоне: ±0,00 — нижний этаж у южного (к лагуне) края дома (fp.max.z), x по всей ширине
        const pts: [number, number][] = []; for (let x = fp.min.x + 1.2; x <= fp.max.x - 1.2; x += 1) pts.push([x, fp.max.z - 1.2]);
        floorTopo = pct(sampleLocal(pts), 0.5) + 0.15;
      } else if (b.model === 'villa3') {
        // верхний уровень сидит на холме, нижний врезан к бассейну: ±0,00 — по верхней части пятна (75-й процентиль)
        const pts: [number, number][] = []; for (let x = fp.min.x; x <= fp.max.x; x += 2) for (let z = fp.min.z; z <= fp.max.z; z += 2) pts.push([x, z]);
        floorTopo = pct(sampleLocal(pts), 0.75);
      } else {
        // плоский участок: медиана по пятну дома + цоколь 0,25 м
        const pts: [number, number][] = []; for (let x = fp.min.x; x <= fp.max.x; x += 2) for (let z = fp.min.z; z <= fp.max.z; z += 2) pts.push([x, z]);
        floorTopo = pct(sampleLocal(pts), 0.5) + 0.25;
      }
      floorsTopo[b.id] = { plan: bb.floorPlan, topo: +floorTopo.toFixed(2) };
      b.floor = floorTopo;
      for (const root of [inner, innerLow]) root.traverse((o) => {
        const m = o as Mesh; if (!m.isMesh) return;
        const role = m.userData.role;
        if (role === 'ground' || role === 'terrain') { m.visible = false; m.userData.noCollide = true; return; }
        tmp.setFromObject(m); const sz = tmp.getSize(new Vector3());
        if (Math.max(sz.x, sz.z) <= 32) return;
        m.geometry = keepInside(m, fp); // оставляем плиты и стены дома, площадку участка отрезаем
      });
      // невидимые пандусы из конфига виллы (бортики, дыры в рельефе) — в координатах виллы, как в прогулке
      for (const h of cfg.helpers ?? []) outer.add(makeRamp(h));
      outer.rotation.y = -b.rot; outer.position.set(b.pos[0], b.floor, b.pos[1]); outer.updateMatrixWorld(true);
      // контур дома и точка входа (старт прогулки по вилле) в мировых координатах
      const corners: [number, number][] = [[fp.min.x, fp.min.z], [fp.max.x, fp.min.z], [fp.max.x, fp.max.z], [fp.min.x, fp.max.z]]
        .map(([x, z]) => { const w = outer.localToWorld(new Vector3(x, 0, z)); return [w.x, w.z]; });
      const e = outer.localToWorld(new Vector3(...(cfg.entry?.pos ?? cfg.spawn)));
      // бассейны (меши воды) в мировых координатах — для пловцов
      inner.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.userData.role === 'water' && m.visible) { const bx = new Box3().setFromObject(m); if (bx.max.x - bx.min.x > 1.5 && bx.max.z - bx.min.z > 1.5) pools.push(bx); } });
      const tspots = ((inner.getObjectByName('furniture')?.userData.spots ?? []) as TerraceSpot[]).map((sp) => { const v = new Vector3(sp.x, sp.y, sp.z).applyMatrix4(outer.matrixWorld); return { x: v.x, y: v.y, z: v.z, yaw: sp.yaw - b.rot, kind: sp.kind, house: b.id }; });
      houses.push({ id: b.id, model: b.model, title: `${b.id} · ${cfg.title}`, poly: corners, fp: [fp.min.x, fp.min.z, fp.max.x, fp.max.z], entry: [e.x, e.y, e.z], entryYaw: (cfg.entry?.yaw ?? cfg.spawnYaw) - b.rot, matrix: outer.matrixWorld.clone(), spots: tspots });
      return outer;
    });
    setStage('instances:done');
    console.info('[floors] план ±0,00 → по топосъёмке:', Object.entries(floorsTopo).map(([id, f]) => `${id}: ${f.plan} → ${f.topo} (${(f.topo - f.plan) >= 0 ? '+' : ''}${(f.topo - f.plan).toFixed(2)})`).join('; '));
    (window as unknown as { __floors: unknown }).__floors = floorsTopo;
    return { instances, houses, pools };
    } catch (e) { setStage('memo:error ' + (e as Error).message); throw e; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // рельеф, вырезка под домами, окрестности, массовка (считается один раз, при повторном входе в режим — из кэша)
  useEffect(() => {
    if (!data || !instances.length) return;
    if (builtCache && builtCache.data === data) {
      setBuilt(builtCache.built); complexStore.data = data.c; complexStore.houses = houses; complexStore.heightAt = builtCache.heightAt;
      setStage('terrain:done'); return;
    }
    setStage('terrain:start');
    const { c, site, water, land, cover } = data;
    const LC_N = 401, LC_STEP = 10, LC_HALF = 2000;
    const coverAt = (x: number, z: number) => { if (!cover) return 1; const i = Math.round((x + LC_HALF) / LC_STEP), j = Math.round((z + LC_HALF) / LC_STEP); return i < 0 || j < 0 || i >= LC_N || j >= LC_N ? 1 : cover[j * LC_N + i]; };
    const MN = c.dem.mask_n, mstep = (2 * c.dem.half) / (MN - 1);
    // лагуна подведена к виллам: по замечанию заказчика от уреза воды до домов должно быть ~10 м (берег OSM дальше
    // реального). Заливаем водой клетки между участком и лагуной: не ближе 10 м к любому дому, в пределах 250 м от
    // воды OSM и на «водной» стороне (направление к ближайшей воде совпадает с направлением от центра комплекса)
    const water2 = new Uint8Array(water); let lagoonFine: Uint8Array | null = null;
    {
      const dist = new Int32Array(MN * MN).fill(-1); const src = new Int32Array(MN * MN); const q: number[] = [];
      for (let k = 0; k < MN * MN; k++) if (water[k] === 1) { dist[k] = 0; src[k] = k; q.push(k); }
      for (let qi = 0; qi < q.length; qi++) { const k = q[qi]; const i = k % MN, j = (k - i) / MN;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= MN || jj >= MN) continue; const k2 = jj * MN + ii; if (dist[k2] >= 0) continue; dist[k2] = dist[k] + 1; src[k2] = src[k]; q.push(k2); } }
      const hp = houses.map((hh) => ({ m: hh.matrix.clone().invert(), fp: hh.fp, off: hh.model === 'villa3' ? 18 : 10 })); // от виллы 3 вода дальше (пруд вокруг неё, замечание заказчика)
      const shopB = c.buildings.find((b) => b.model === 'shop');
      const dHouse = (x: number, z: number) => { let best = Infinity; const lp = new Vector3();
        for (const { m, fp, off } of hp) { lp.set(x, 0, z).applyMatrix4(m); best = Math.min(best, Math.hypot(Math.max(fp[0] - lp.x, 0, lp.x - fp[2]), Math.max(fp[1] - lp.z, 0, lp.z - fp[3])) - off + 10); }
        if (shopB) best = Math.min(best, Math.max(0, Math.hypot(x - shopB.pos[0], z - shopB.pos[1]) - 7)); return best; }; // ≥ 10 означает «можно заливать»
      const cx = houses.reduce((a, hh) => a + hh.matrix.elements[12], 0) / Math.max(1, houses.length), cz = houses.reduce((a, hh) => a + hh.matrix.elements[14], 0) / Math.max(1, houses.length);
      // 1) зона, пригодная для заливки (без учёта домов): до воды OSM ≤ 250 м, не дальше 220 м от центра, водная сторона
      const elig = new Uint8Array(MN * MN);
      for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) {
        const k = j * MN + i; if (water[k] === 1 || dist[k] < 0 || dist[k] * mstep > 250) continue;
        const x = i * mstep - c.dem.half, z = j * mstep - c.dem.half; if (Math.hypot(x - cx, z - cz) > 220) continue;
        const si = src[k] % MN, sj = (src[k] - si) / MN; const wx = si * mstep - c.dem.half - x, wz = sj * mstep - c.dem.half - z; const wl = Math.hypot(wx, wz) || 1;
        const vx = x - cx, vz = z - cz; const vl = Math.hypot(vx, vz) || 1;
        if (vx <= 0 && vz <= 0) continue; // север и запад (канал, дорога, соседняя земля) не трогаем
        // водная сторона: направление к ближайшей воде сонаправлено «от центра», либо клетка у самого берега OSM
        // (до 30 м — там ближайшая вода часто сбоку из-за изгибов берега)
        if ((wx * vx + wz * vz) / (wl * vl) >= 0.2 || dist[k] <= 6) elig[k] = 1;
      }
      // 2) только связанная с лагуной часть зоны (без отдельных прудов)
      const seen = new Uint8Array(MN * MN); const q2: number[] = [];
      for (let k = 0; k < MN * MN; k++) if (water[k] === 1) { seen[k] = 1; q2.push(k); }
      for (let qi = 0; qi < q2.length; qi++) { const k = q2[qi]; const i = k % MN, j = (k - i) / MN;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= MN || jj >= MN) continue; const k2 = jj * MN + ii; if (seen[k2] || !elig[k2]) continue; seen[k2] = 1; q2.push(k2); } }
      // 3) грубая маска (вне сетки участка): зона минус 10 м от домов; 4) тонкая маска на сетке участка 0,5 м —
      //    отступ 10 м считается в каждой клетке, кромка ровная
      let filled = 0;
      for (let j = 0; j < MN; j++) for (let i = 0; i < MN; i++) { const k = j * MN + i; if (water[k] === 1 || !seen[k]) continue; const x = i * mstep - c.dem.half, z = j * mstep - c.dem.half; if (dHouse(x, z) >= 10) { water2[k] = 1; filled++; } }
      console.info('[lagoon] подведена к виллам: залито клеток', filled, '(шаг', mstep, 'м)');
      if (import.meta.env.DEV) (window as unknown as { __lagoon: unknown }).__lagoon = { water, water2, elig, seen, dist, MN, mstep, half: c.dem.half, dHouse, cx, cz };
      const S = c.site; lagoonFine = new Uint8Array(S.nx * S.nz);
      for (let j = 0; j < S.nz; j++) for (let i = 0; i < S.nx; i++) {
        const x = S.x0 + i * S.step, z = S.z0 + j * S.step;
        const ci = Math.round((x + c.dem.half) / mstep), cj = Math.round((z + c.dem.half) / mstep); if (ci < 0 || cj < 0 || ci >= MN || cj >= MN) continue;
        const k = cj * MN + ci; if (water[k] === 1 || (seen[k] && dHouse(x, z) >= 10)) lagoonFine[j * S.nx + i] = 1;
      }
    }
    const waterAt = (x: number, z: number) => {
      const S = c.site; const fi = Math.round((x - S.x0) / S.step), fj = Math.round((z - S.z0) / S.step);
      if (lagoonFine && fi >= 0 && fj >= 0 && fi < S.nx && fj < S.nz) return lagoonFine[fj * S.nx + fi] === 1;
      const i = Math.round((x + c.dem.half) / mstep), j = Math.round((z + c.dem.half) / mstep);
      return i < 0 || j < 0 || i >= MN || j >= MN ? true : water2[j * MN + i] === 1;
    };
    const W = c.water_level;
    const h = Float32Array.from(site);
    let gradeFixed: Uint8Array | null = null; let inHouseMask: Uint8Array | null = null;
    const { x0, z0, step, nx, nz } = c.site;
    // 1) сглаживание рельефа с генплана: горизонтали дают террасы-«складки», газон должен быть ровным
    const blur = (src: Float32Array, r: number) => {
      const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let a = 0, n = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < nx) { a += src[j * nx + ii]; n++; } } tmp[j * nx + i] = a / n; }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let a = 0, n = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < nz) { a += tmp[jj * nx + i]; n++; } } out[j * nx + i] = a / n; }
      return out;
    };
    h.set(blur(blur(h, 4), 4)); // 2 прохода по 2 м — складки уходят, общий уклон остаётся
    // 2) вертикальная планировка по посадке зданий: у каждого дома площадка (полоса PAD м от контура стен) на
    //    проектной отметке земли самой виллы (скрытые меши ground/terrain модели, BVH на тип виллы) — она
    //    зафиксирована; между площадками рельеф не круче MAX_SLOPE (итеративное ограничение уклона от площадок),
    //    так земля не наезжает на стены и нет обрывов между домами с разной отметкой.
    {
      const PAD = 1.5, MAX_SLOPE = 0.25; // площадка 1,5 м от стен; дальше — гладкая мембрана между домами
      const fixed = new Uint8Array(nx * nz);
      const ray = new Ray(), lp = new Vector3(), inv = new Matrix4();
      // отметка площадки относительно пола дома (локальный y=0): плоские виллы 2.x — ровно пол, вилла 3 — рельеф
      // Revit в пределах [нижний уровень −3,4; верх +0,2], вилла 1 (ступенчатая) — рельеф Revit в [−0,15; +10,2].
      // Раньше брался «верх» рельефа Revit как есть — у 2.x он на 1–2 м выше пола (окна уходили в землю)
      const PAD_RANGE: Record<string, [number, number] | null> = { villa21: null, villa22: null, villa3: [-3.4, 0.2], villa1: [-0.15, 10.2] };
      inHouseMask = new Uint8Array(nx * nz);
      for (const inst of instances) {
        const id = inst.name.slice('house-'.length);
        const hi = houses.find((x) => x.id === id); const gb = hi && groundBVH.current.get(hi.model);
        if (!hi || !gb) continue;
        inv.copy(inst.matrixWorld).invert(); const range = PAD_RANGE[hi.model] ?? null; const floorY = inst.position.y;
        const PADW = hi.model === 'villa3' ? 0.9 : PAD; // у виллы 3 (заглублённый нижний уровень) фиксируем только 0,9 м у стен — дальше гладкий склон
        const [fx0, fz0, fx1, fz1] = hi.fp;
        const box = new Box3();
        for (const [x, z] of [[fx0 - PADW, fz0 - PADW], [fx1 + PADW, fz0 - PADW], [fx1 + PADW, fz1 + PADW], [fx0 - PADW, fz1 + PADW]])
          box.expandByPoint(inst.localToWorld(new Vector3(x, 0, z)));
        const i0 = Math.max(0, Math.floor((box.min.x - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((box.max.x - x0) / step));
        const j0 = Math.max(0, Math.floor((box.min.z - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((box.max.z - z0) / step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const x = x0 + i * step, z = z0 + j * step;
          lp.set(x, 0, z); inst.worldToLocal(lp);
          if (lp.x < fx0 - PADW || lp.x > fx1 + PADW || lp.z < fz0 - PADW || lp.z > fz1 + PADW) continue;
          const k = j * nx + i; let top = floorY - 0.05;
          if (lp.x > fx0 - 0.4 && lp.x < fx1 + 0.4 && lp.z > fz0 - 0.4 && lp.z < fz1 + 0.4) inHouseMask[k] = 1;
          if (range) {
            ray.origin.set(x, 80, z).applyMatrix4(inv); ray.direction.set(0, -1, 0).transformDirection(inv);
            const hits = gb.bvh.raycast(ray, DoubleSide);
            if (hits.length) { top = -Infinity; for (const ht of hits) top = Math.max(top, 80 - ht.distance); top = Math.min(floorY + range[1], Math.max(floorY + range[0], top)); }
            // рельеф Revit под домом вырезан: клетка всё равно фиксируется (не ниже нижнего пола), отметку полов
            // комнат ей даст вырезка под полами ниже; раньше такие клетки оставались свободными, и мембрана
            // проводила сквозь комнаты гладкий склон — газон внутри санузлов виллы 1
            else top = Math.max(h[k], floorY + range[0]); // не ниже нижнего уровня дома (вилла 3 стоит в пруду на −3,4: иначе вырастал бугор)
          }
          h[k] = fixed[k] ? Math.min(h[k], top) : top; fixed[k] = 1; // стык двух площадок — по нижней
        }
      }
      // выемка под бассейнами и прудами: земля ниже дна воды (вилла 3 стоит в пруду — иначе вода «лужей» у стен)
      // водные меши вилл шире видимых чаш (прямоугольные плоскости): вне пятна дома земля не ниже уровня воды + 0,15,
      // иначе плоскость воды проступает «лужей» у стен; сами чаши — в модели дома и в выемке под пятном
      for (const b of pools) {
        const i0 = Math.max(0, Math.floor((b.min.x - 0.5 - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((b.max.x + 0.5 - x0) / step));
        const j0 = Math.max(0, Math.floor((b.min.z - 0.5 - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((b.max.z + 0.5 - z0) / step));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const k = j * nx + i; if (inHouseMask![k] || fixed[k]) continue; h[k] = Math.max(h[k], b.max.y + 0.15); fixed[k] = 1; }
      }
      // лёгкое сглаживание вне площадок — до ограничения уклона, чтобы не вернуть крутизну у их края
      { const sm = blur(h, 2); for (let k = 0; k < nx * nz; k++) if (!fixed[k]) h[k] = sm[k]; }
      void MAX_SLOPE;
      gradeFixed = fixed;
    }
    // вырезка: под каждым домом земля не выше самой нижней ПОВЕРХНОСТИ ПОЛА модели (грани нормалью вверх: плиты
    // террас, полы, борта бассейнов) — по всему пятну дома с запасом 0,6 м. Нижние грани плит и свесы не считаются,
    // иначе вдоль консольных террас и карнизов получалась траншея; вода не считается — её плоскости шире чаш
    const lpv = new Vector3(); const lowMask = new Uint8Array(nx * nz), footMask = new Uint8Array(nx * nz);
    for (const inst of instances) {
      inst.updateMatrixWorld(true);
      const hi = houses.find((x) => x.id === inst.name.slice('house-'.length)); if (!hi) continue;
      const [fx0, fz0, fx1, fz1] = hi.fp; const inFoot = (x: number, z: number) => { lpv.set(x, 0, z); inst.worldToLocal(lpv); return lpv.x > fx0 + 1.2 && lpv.x < fx1 - 1.2 && lpv.z > fz0 + 1.2 && lpv.z < fz1 - 1.2; }; // строго габарит мешей дома: снаружи стен рельеф не трогаем (были «дырки» у входов)
      const col = buildColliderFromParts(collectColliderParts(inst, [], undefined, (m) => m.userData.role === 'water' || m.userData.role === 'ground' || m.userData.role === 'terrain' || m.userData.role === 'glass' || m.userData.role === 'plants'));
      if (!col) continue;
      const planL = data.plans[hi.model]; const minLevel = planL ? Math.min(...planL.levels.map((l) => l.level)) : 0;
      let lowered = 0; const cp = col.geometry.getAttribute('position') as BufferAttribute; const e1 = new Vector3(), e2 = new Vector3(), nrm = new Vector3(), v0 = new Vector3();
      // нормаль треугольника по индексу грани (геометрия коллайдера неиндексированная, мировые координаты)
      const upFacing = (ht: Intersection) => {
        if (ht.face && ht.face.normal) return ht.face.normal.y > 0.5;
        if (ht.faceIndex === undefined || ht.faceIndex === null) return true;
        const f = ht.faceIndex * 3; v0.fromBufferAttribute(cp, f); e1.fromBufferAttribute(cp, f + 1).sub(v0); e2.fromBufferAttribute(cp, f + 2).sub(v0); nrm.crossVectors(e1, e2);
        return nrm.y > 0.5 * nrm.length(); // грань нормалью вверх (обход против часовой)
      };
      col.geometry.computeBoundingBox(); const bb = col.geometry.boundingBox!;
      const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
      const i0 = Math.max(0, Math.floor((bb.min.x - x0) / step) - 1), i1 = Math.min(nx - 1, Math.ceil((bb.max.x - x0) / step) + 1);
      const j0 = Math.max(0, Math.floor((bb.min.z - z0) / step) - 1), j1 = Math.min(nz - 1, Math.ceil((bb.max.z - z0) / step) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!inFoot(x0 + i * step, z0 + j * step)) continue;
        ray.origin.set(x0 + i * step, 80, z0 + j * step);
        const hits = col.bvh.raycast(ray, DoubleSide);
        if (!hits.length) continue;
        let low = Infinity; for (const ht of hits) if (upFacing(ht)) low = Math.min(low, 80 - ht.distance);
        low = Math.max(low, inst.position.y + minLevel - 0.3); // ниже нижнего пола дома поверхностей, по которым ходят, нет
        const k = j * nx + i; footMask[k] = 1; if (h[k] > low - 0.05) { h[k] = low - 0.05; lowered++; lowMask[k] = 1; }
      }
      console.info('[floors]', hi.id, 'земля опущена под полами в', lowered, 'клетках');
      col.geometry.dispose();
    }
    // под наружными лестницами и террасами: минимум по окрестности 1 м среди опущенных клеток — земля ниже
    // нижней ступени марша, а не повторяет ступени (грунт торчал сквозь проступи)
    { const src = Float32Array.from(h); const rr = 2;
      for (let j = rr; j < nz - rr; j++) for (let i = rr; i < nx - rr; i++) { const k = j * nx + i; if (!lowMask[k]) continue; let v = src[k]; for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) { const n = k + dj * nx + di; if (lowMask[n]) v = Math.min(v, src[n]); } h[k] = v; } }
    // интерьер по планам: мировая маска 0,1 м (стены + комнаты до наружной грани); в глубине ≥ 0,5 м от грани
    // земля на 5 см ниже пола этого места, у грани остаётся отметка площадки — рельеф внутри маски не рисуется
    const WX = 0.1, wnx = Math.ceil((nx - 1) * step / WX) + 1, wnz = Math.ceil((nz - 1) * step / WX) + 1;
    const wmask = new Uint8Array(wnx * wnz), wfloor = new Float32Array(wnx * wnz).fill(Infinity), wgreen = new Float32Array(wnx * wnz).fill(NaN);
    for (const inst of instances) {
      const hi = houses.find((x) => x.id === inst.name.slice('house-'.length)); const m = hi && indoorMasks.get(hi.model); if (!hi || !m) continue;
      const inv = inst.matrixWorld.clone().invert(); const lp = new Vector3();
      const corners = [[m.x0, m.z0], [m.x0 + (m.nx - 1) * m.step, m.z0], [m.x0, m.z0 + (m.nz - 1) * m.step], [m.x0 + (m.nx - 1) * m.step, m.z0 + (m.nz - 1) * m.step]].map(([x, z]) => new Vector3(x, 0, z).applyMatrix4(inst.matrixWorld));
      const bx0 = Math.min(...corners.map((v) => v.x)), bx1 = Math.max(...corners.map((v) => v.x)), bz0 = Math.min(...corners.map((v) => v.z)), bz1 = Math.max(...corners.map((v) => v.z));
      const i0 = Math.max(0, Math.floor((bx0 - x0) / WX)), i1 = Math.min(wnx - 1, Math.ceil((bx1 - x0) / WX)), j0 = Math.max(0, Math.floor((bz0 - z0) / WX)), j1 = Math.min(wnz - 1, Math.ceil((bz1 - z0) / WX));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        lp.set(x0 + i * WX, 0, z0 + j * WX).applyMatrix4(inv); const r = indoorAt(m, lp.x, lp.z); const k = j * wnx + i;
        if (r.green) wgreen[k] = Number.isNaN(wgreen[k]) ? inst.position.y + r.greenFloor : Math.min(wgreen[k], inst.position.y + r.greenFloor);
        if (!r.inside) continue;
        wmask[k] = 1; wfloor[k] = Math.min(wfloor[k], inst.position.y + r.floor);
      }
    }
    const indoorW = (x: number, z: number) => { const i = Math.round((x - x0) / WX), j = Math.round((z - z0) / WX); if (i < 0 || j < 0 || i >= wnx || j >= wnz) return null; const k = j * wnx + i; return wmask[k] ? wfloor[k] : null; };
    // зелёные зоны плана (посадки у бассейна виллы 3 на нижнем уровне): газон на отметке своего уровня — не «бугор» верхнего рельефа
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step; const gi = Math.round((x - x0) / WX), gj = Math.round((z - z0) / WX); if (gi < 0 || gj < 0 || gi >= wnx || gj >= wnz) continue;
      const gf = wgreen[gj * wnx + gi]; if (Number.isNaN(gf)) continue; const k = j * nx + i; h[k] = gf - 0.02; if (gradeFixed) gradeFixed[k] = 1;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step; const f = indoorW(x, z); if (f === null) continue;
      const k = j * nx + i; if (gradeFixed) gradeFixed[k] = 1;
      let deep = true; for (let a = 0; a < 8 && deep; a++) if (indoorW(x + Math.cos(a * Math.PI / 4) * 0.55, z + Math.sin(a * Math.PI / 4) * 0.55) === null) deep = false;
      if (deep) h[k] = Math.min(h[k], f - 0.05); // у грани (≤ 0,5 м) — отметка площадки, перепад к полу спрятан внутри маски
    }
    { const tex = new DataTexture(wmask, wnx, wnz, RedFormat, UnsignedByteType); tex.minFilter = tex.magFilter = NearestFilter; tex.needsUpdate = true;
      INDOOR.tex.value = tex; INDOOR.i0.value.set(x0, z0); INDOOR.size.value.set((wnx - 1) * WX, (wnz - 1) * WX); INDOOR.has.value = 1; }
    // дорожка начинается перед дверью магазина (он сдвинут на 15 м, прежняя точка въезда оказалась внутри него) и обходит его
    const shopP = c.buildings.find((b) => b.model === 'shop'); const pose = shopP ? shopPose(shopP, houses, c.site.boundary) : null;
    const net = buildPathNetwork(houses, pose ? pose.door : (WALK_SPAWN_XZ.map((v, k) => v + (k ? -14 : -12)) as [number, number]),
      pose ? { x: pose.pos[0], z: pose.pos[1], r: pose.r, toward: WALK_SPAWN_XZ } : undefined, houses.map((hh) => ({ x: hh.entry[0], z: hh.entry[2], yaw: hh.entryYaw })));
    let terr: Terraces | null = null; let graded: Graded | null = null;
    // под магазином земля не выше его пола: пол ставится по отметке у двери (+0,12), цоколь 1,8 м прячет перепад;
    // пятно магазина опускается на 0,5 м ниже отметки у двери и фиксируется, пятачок у двери фиксируется как есть
    if (pose && gradeFixed) {
      const sAt0 = siteSampler(c, h); const [sx, sz] = pose.pos; const dX = sx + pose.fx * (pose.D / 2 + 1.2), dZ = sz + pose.fz * (pose.D / 2 + 1.2);
      const doorH = sAt0(dX, dZ); const cs = Math.cos(pose.yaw), sn = Math.sin(pose.yaw);
      if (doorH !== null) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, z = z0 + j * step; const k = j * nx + i;
        if (Math.hypot(x - dX, z - dZ) < 1.6) { gradeFixed[k] = 1; continue; }
        const lx = (x - sx) * cs - (z - sz) * sn, lz = (x - sx) * sn + (z - sz) * cs;
        if (Math.abs(lx) < pose.W / 2 + 0.8 && Math.abs(lz) < pose.D / 2 + 0.8) { h[k] = Math.min(h[k], doorH - 0.5); gradeFixed[k] = 1; }
      }
    }
    // за границей участка сетка повторяет окрестности: вода — ниже уровня, суша — рельеф SRTM;
    // внутри, в полосе EDGE м вдоль границы, участок плавно сходит к окрестностям (иначе на стыке уступ)
    {
      const EDGE = 15; const demLand = demSampler({ ...c, dem: { ...c.dem, n: c.dem.land_n, step: (2 * c.dem.half) / (c.dem.land_n - 1) } }, land);
      const B = c.site.boundary;
      const distToBoundary = (x: number, z: number) => {
        let best = Infinity;
        for (let i = 0, j = B.length - 1; i < B.length; j = i++) {
          const [ax, az] = B[j], [bx, bz] = B[i]; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
          const px = ax + t * dx - x, pz = az + t * dz - z; const d2 = px * px + pz * pz; if (d2 < best) best = d2;
        }
        return Math.sqrt(best);
      };
      void EDGE;
      const relaxFixed = new Uint8Array(nx * nz); const shore = new Uint8Array(nx * nz); // полоса воды у берега: сглаживается, но не выше W − 0,2
      // дно лагуны: от уреза пологий песчаный уступ (2,5 м сглаживается вместе с берегом), дальше глубина растёт
      // 0,5 м на метр до 4 м — сквозь прозрачную воду у берега видно дно, середина лагуны тёмная
      const dShore = new Int32Array(nx * nz).fill(-1);
      { const q: number[] = []; for (let k = 0; k < nx * nz; k++) if (!waterAt(x0 + (k % nx) * step, z0 + Math.floor(k / nx) * step)) { dShore[k] = 0; q.push(k); }
        for (let qi = 0; qi < q.length; qi++) { const k = q[qi], i = k % nx; for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) { if (n < 0 || n >= nx * nz || dShore[n] >= 0) continue; dShore[n] = dShore[k] + 1; q.push(n); } } }
      const bedAt = (k: number) => { const d = dShore[k] < 0 ? 30 : dShore[k] * step; return W - 0.45 - Math.min(3.5, 0.5 * Math.max(0, d - 2.5)); };
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, z = z0 + j * step, k = j * nx + i;
        const wet = waterAt(x, z); const bed = bedAt(k); const shallow = dShore[k] >= 0 && dShore[k] * step <= 2.5;
        // площадки домов зафиксированы и за границей участка тоже: вилла 1.1 частично выходит за контур генплана, и
        // без этого мембрана поднимала землю внутрь её санузла и оставляла провалы под плитой
        if (gradeFixed && gradeFixed[k]) { relaxFixed[k] = 1; continue; }
        if (inPoly(x, z, B)) { if (wet) { h[k] = bed; if (shallow) shore[k] = 1; else relaxFixed[k] = 1; } continue; }
        if (wet) { h[k] = bed; if (!shallow || distToBoundary(x, z) > 8) relaxFixed[k] = 1; else shore[k] = 1; continue; }
        h[k] = Math.min(h[k], demLand(x, z)); if (distToBoundary(x, z) > 30) relaxFixed[k] = 1;
      }
      // гладкая поверхность между зафиксированными клетками (Гаусс–Зейдель с верхней релаксацией): площадки домов,
      // вода и дальние окрестности держат форму, газон между ними — плавный, без уступов и обрывов
      const omega = 1.7;
      const relax = (fx: Uint8Array) => {
        for (let pass = 0; pass < 500; pass++) {
          let maxd = 0;
          for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
            const k = j * nx + i; if (fx[k]) continue;
            const avg = (h[k - 1] + h[k + 1] + h[k - nx] + h[k + nx]) * 0.25; let v = h[k] + omega * (avg - h[k]); if (shore[k] && v > W - 0.2) v = W - 0.2;
            const dd = Math.abs(v - h[k]); if (dd > maxd) maxd = dd; h[k] = v;
          }
          if (maxd < 0.002) break;
        }
      };
      relax(relaxFixed);
      // продольный профиль дорожек: пандусы не круче 1:8, где круче — лестницы; рельеф в коридоре дорожки зафиксирован
      setStage('terrain:paths-grade');
      graded = gradePaths(net, { h, x0, z0, step, nx, nz }, relaxFixed);
      h.set(graded.h); relaxFixed.set(graded.fixed);
      // террасы: где мембрана всё же круче 1:3,3 (между рядами 1.x и 2.x перепад 4–8 м на 10–20 м) — подпорные
      // стенки по горизонталям и лестницы на дорожках (Terraces.ts); газон между стенками релаксируется заново
      setStage('terrain:terraces');
      const shopB = c.buildings.find((b) => b.model === 'shop'); if (shopB) moveShop(shopB, houses, B);
      // берег лагуны не террасируем (естественный уклон к воде, песок, лотосы): клетки ближе 9 м к воде пропускаем —
      // перепад от площадок вилл 1.x к урезу (2,5 м на ~9 м) остаётся пологим газоном без стенок
      const nearWater = (x: number, z: number) => { for (const R of [3, 6, 9]) for (let a = 0; a < 8; a++) if (waterAt(x + Math.cos(a * Math.PI / 4) * R, z + Math.sin(a * Math.PI / 4) * R)) return true; return waterAt(x, z); };
      const skipT = (x: number, z: number) => !inPoly(x, z, B) || nearWater(x, z) || (!!shopB && Math.hypot(x - shopB.pos[0], z - shopB.pos[1]) < 10);
      terr = planTerraces({ h, x0, z0, step, nx, nz }, relaxFixed, skipT, net, false); // лестницы — у дорожек (PathGrade), стенки у дорожек сходят на нет
      h.set(terr.h); relax(terr.fixed);
    }
    // меш участка; цвет вершин: газон, песок у воды, влажная тёмная полоса над водой, вытоптанная земля у дорожек,
    // сухие пятна травы шумом
    const sp = new Float32Array(nx * nz * 3), su = new Float32Array(nx * nz * 2), scol = new Float32Array(nx * nz * 3);
    const green = new Color('#cfdcc0'), sand = new Color('#d8cfb0'), wet = new Color('#a8b894'), worn = new Color('#c9c3a0'), dry = new Color('#d6d6a6');
    const cc = new Color();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * step, z = z0 + j * step, y = h[k];
      const sx = terr ? terr.shift[k * 2] : 0, sz = terr ? terr.shift[k * 2 + 1] : 0; // у подпорных стенок вершины прижаты к граням
      sp.set([x + sx, y, z + sz], k * 3); su.set([(x + sx) / 4, (z + sz) / 4], k * 2);
      cc.copy(y < W + 0.6 ? sand : y < W + 1.4 ? wet : green);
      if (y >= W + 0.6) {
        const dp = distToPaths(net, x, z); if (dp < 1.6) cc.lerp(worn, (1 - dp / 1.6) * 0.65);
        const nse = Math.sin(x * 0.11 + 1.3) * Math.sin(z * 0.14 + 0.7) + Math.sin(x * 0.031) * Math.sin(z * 0.027); if (nse > 0.9) cc.lerp(dry, Math.min(1, (nse - 0.9) * 2) * 0.5);
      }
      scol.set([cc.r, cc.g, cc.b], k * 3);
    }
    const sidx: number[] = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; sidx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    const sg = new BufferGeometry(); sg.setAttribute('position', new BufferAttribute(sp, 3)); sg.setAttribute('uv', new BufferAttribute(su, 2));
    sg.setAttribute('color', new BufferAttribute(scol, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
    // окрестности: сетка 20 м в квадрате ±2 км; вода — ниже уровня; внутри участка — под ним
    const LN = c.dem.land_n;
    const demAt = demSampler({ ...c, dem: { ...c.dem, n: LN, step: (2 * c.dem.half) / (LN - 1) } }, land), siteAt = siteSampler(c, h);
    const inGrid = (x: number, z: number, m: number) => x > x0 + m && z > z0 + m && x < x0 + (nx - 1) * step - m && z < z0 + (nz - 1) * step - m;
    const N = 401, half = c.dem.half, st = (2 * half) / (N - 1); // шаг 10 м
    const dp = new Float32Array(N * N * 3), du = new Float32Array(N * N * 2), dcol = new Float32Array(N * N * 3);
    const landCol = new Color('#5f8a46'), shore = new Color('#cbbf98'), openCol = new Color('#a9b77a');
    const isWater = (x: number, z: number, _raw: number) => waterAt(x, z);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -half + i * st, z = -half + j * st;
      const raw = demAt(x, z);
      let y = raw;
      // в прямоугольнике сетки участка рельеф рисует сетка участка (0,5 м): окрестности прячем под неё, иначе
      // вершины SRTM (10 м) торчат «пирамидами» между границей участка и подведённой к виллам лагуной
      if (inPoly(x, z, c.site.boundary) || inGrid(x, z, 2)) y = Math.min(y, W - 3);
      else if (isWater(x, z, raw)) y = Math.min(y, W - 3); // вода вне сетки участка — глубоко (сквозь непрозрачную воду дна не видно)
      dp.set([x, y, z], k * 3); du.set([x / 12, z / 12], k * 2);
      const lc = coverAt(x, z); const cc = y < W + 1.5 ? shore : (lc === 2 ? openCol : landCol); dcol.set([cc.r, cc.g, cc.b], k * 3);
    }
    const didx: number[] = [];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; didx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1); }
    const dg = new BufferGeometry(); dg.setAttribute('position', new BufferAttribute(dp, 3)); dg.setAttribute('uv', new BufferAttribute(du, 2));
    dg.setAttribute('color', new BufferAttribute(dcol, 3)); dg.setIndex(didx); dg.computeVertexNormals();
    const heightAt = (x: number, z: number) => {
      const s = inPoly(x, z, c.site.boundary) ? siteAt(x, z) : null;
      if (s !== null) return s;
      const raw = demAt(x, z); if (isWater(x, z, raw)) return null;
      if (inGrid(x, z, 0)) { const g = siteAt(x, z); if (g !== null) return g; } // суша в сетке участка вне его границы (берег)
      return raw;
    };
    // соседние дома (OSM): коробки 4 м с плоской крышей
    const hg: BufferGeometry[] = [];
    for (const poly of c.osm.buildings) {
      if (poly.length < 4) continue;
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length, cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const y = heightAt(cx, cz); if (y === null) continue;
      const shape = new Shape(poly.map(([x, z]) => ({ x, y: -z }) as never));
      const g = new ExtrudeGeometry(shape, { depth: 3.6 + ((cx * 7 + cz * 3) % 1.5 + 1.5) % 1.5, bevelEnabled: false });
      g.rotateX(-Math.PI / 2); g.translate(0, y - 0.3, 0); hg.push(g);
    }
    const nbHouses = hg.length ? mergeGeometries(hg, true) : null;
    // подпорные стенки и лестницы террас (каменные), лотосы у берега лагуны
    const walls = terr ? wallGeometry(terr.walls) : null; const stairG = { treads: graded ? stepGeometry(graded.steps) : null, cheeks: null as BufferGeometry | null }; void inHouseMask;
    const lotus = lagoonFine ? placeLotuses({ x0, z0, step, nx, nz }, lagoonFine) : [];
    const bottom = makeBottomTexture(h, nx, nz, x0, z0, step, W); // карта дна для прозрачной воды
    // дорожки: сеть по генплану (въезд → проезд между 2.x → дорога ряда 1.x → вилла 3), ленты 2,6 м по рельефу
    setStage('terrain:paths');
    const ribbons = graded ? graded.ribbons : net.lines.map((l) => pathRibbon(l, 2.6, (x, z) => siteAt(x, z) ?? heightAt(x, z))).filter((g): g is BufferGeometry => !!g);
    const paths = ribbons.length ? mergeGeometries(ribbons, false) : null;
    // пальмы: окрестности (сетка 14 м со случайным сдвигом, суша, не на домах) и участок (в зелёных зонах, не на дорожках);
    // ближние (до 260 м от центра участка) — с перистыми листьями, дальние — простые
    const r = rng(7); const near: Plant[] = [], far: Plant[] = [];
    const nearHouse = (x: number, z: number, d = 17) => c.buildings.some((b) => Math.hypot(x - b.pos[0], z - b.pos[1]) < d);
    for (let z = -1500; z < 1500; z += 14) for (let x = -1500; x < 1500; x += 14) {
      const px = x + (r() - 0.5) * 12, pz = z + (r() - 0.5) * 12;
      const lc = coverAt(px, pz); const pKeep = lc === 1 ? 0.6 : lc === 2 ? 0.1 : lc === 0 ? 0.45 : 0;
      if (r() > pKeep) continue;
      if (inPoly(px, pz, c.site.boundary)) continue;
      const y = heightAt(px, pz); if (y === null) continue;
      (Math.hypot(px, pz) < 260 ? near : far).push({ x: px, y: y - 0.2, z: pz, s: r(), r: r() });
    }
    for (let k = 0; k < 900; k++) {
      const px = -95 + r() * 190, pz = -75 + r() * 150;
      if (!inPoly(px, pz, c.site.boundary) || waterAt(px, pz) || nearHouse(px, pz) || distToPaths(net, px, pz) < 2.5 || r() > 0.35) continue;
      const y = siteAt(px, pz); if (y === null) continue;
      near.push({ x: px, y: y - 0.2, z: pz, s: r(), r: r() });
    }
    // кусты: вдоль контуров домов (с отступом 1,5–2,5 м, не у входов) и россыпью по газону; франжипани вдоль дорожек
    const shrubs: Plant[] = [], frangipani: Plant[] = [];
    for (const hs of houses) {
      const [fx0, fz0, fx1, fz1] = hs.fp; const per: [number, number][] = [];
      for (let x = fx0; x <= fx1; x += 2.6) { per.push([x, fz0 - 1.8]); per.push([x, fz1 + 1.8]); }
      for (let z = fz0; z <= fz1; z += 2.6) { per.push([fx0 - 1.8, z]); per.push([fx1 + 1.8, z]); }
      for (const [lx, lz] of per) {
        if (r() > 0.6) continue;
        const w = new Vector3(lx, 0, lz).applyMatrix4(hs.matrix); if (!inPoly(w.x, w.z, c.site.boundary) || waterAt(w.x, w.z) || distToPaths(net, w.x, w.z) < 1.8) continue;
        const y = siteAt(w.x, w.z); if (y === null) continue; shrubs.push({ x: w.x, y: y - 0.1, z: w.z, s: r(), r: r() });
      }
    }
    for (let k = 0; k < 500; k++) {
      const px = -95 + r() * 190, pz = -75 + r() * 150;
      if (!inPoly(px, pz, c.site.boundary) || waterAt(px, pz) || nearHouse(px, pz, 14) || distToPaths(net, px, pz) < 2 || r() > 0.5) continue;
      const y = siteAt(px, pz); if (y === null) continue; shrubs.push({ x: px, y: y - 0.1, z: pz, s: r(), r: r() });
    }
    for (const l of net.lines) for (let i = 0; i < l.length - 1; i++) {
      const a = l[i], b = l[i + 1]; const L = a.distanceTo(b); const n = Math.floor(L / 9);
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1); const side = (k % 2 ? 1 : -1) * 3.2; const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
        const px = a.x + dx * L * t - dz * side, pz = a.z + dz * L * t + dx * side;
        if (!inPoly(px, pz, c.site.boundary) || nearHouse(px, pz, 12) || r() > 0.7) continue;
        const y = siteAt(px, pz); if (y === null) continue; frangipani.push({ x: px, y: y - 0.05, z: pz, s: r(), r: r() });
      }
    }
    setStage('terrain:done');
    const hpInv = houses.map((hh) => ({ m: hh.matrix.clone().invert(), fp: hh.fp })); const lpG = new Vector3(); const shopB = c.buildings.find((b) => b.model === 'shop');
    const grassOk = (x: number, z: number) => {
      if (!inPoly(x, z, c.site.boundary) || waterAt(x, z) || distToPaths(net, x, z) < 1.3) return false;
      if (terr) { const ti = Math.round((x - x0) / step), tj = Math.round((z - z0) / step); if (ti >= 0 && tj >= 0 && ti < nx && tj < nz && terr.mask[tj * nx + ti]) return false; }
      if (shopB && Math.hypot(x - shopB.pos[0], z - shopB.pos[1]) < 8.5) return false;
      if (indoorW(x, z) !== null) return false;
      for (const { m, fp } of hpInv) { lpG.set(x, 0, z).applyMatrix4(m); if (lpG.x > fp[0] - 0.3 && lpG.x < fp[2] + 0.3 && lpG.z > fp[1] - 0.3 && lpG.z < fp[3] + 0.3) return false; }
      return true;
    };
    (window as unknown as { __grassOk: unknown }).__grassOk = grassOk;
    const builtNow = { site: sg, dem: dg, houses: nbHouses, paths, near, far, shrubs, frangipani, net, walls, steps: stairG.treads, cheeks: stairG.cheeks, lotus, bottom, waterAt, grassOk }; builtCache = { data, built: builtNow, heightAt }; setBuilt(builtNow);
    complexStore.data = c; complexStore.houses = houses; complexStore.heightAt = heightAt;
    (window as unknown as { __complex: unknown }).__complex = { heightAt, data: c, root: instRoot.current, h, x0, z0, step, nx, nz, houses, terraces: terr && { walls: terr.walls, stairs: terr.stairs, blobs: terr.blobs }, graded: graded && { flights: graded.flights, steps: graded.steps.length }, lotus: lotus.length };
  }, [data, instances, houses]);

  // коллайдер всего комплекса: дома (с проёмами дверей в системе координат каждого дома, без растений и штор),
  // рельеф участка и окрестностей, дорожки, соседние дома, магазин. Строится один раз при первом выходе пешком.
  useEffect(() => {
    if (!walk || !built || !groundRoot.current) return;
    if (complexCollider) { colliderStore.current = complexCollider; complexStore.collider = 'ready'; return; }
    complexStore.collider = 'building';
    const t = setTimeout(() => {
      const parts: BufferGeometry[] = [];
      const skip = (m: Mesh) => m.userData.role === 'plants' || !!m.userData.curtain;
      for (const inst of instances) {
        inst.updateMatrixWorld(true);
        const id = inst.name.slice('house-'.length);
        const b = data!.c.buildings.find((x) => x.id === id)!;
        parts.push(...collectColliderParts(inst, MODELS[b.model].passages ?? [], inst.matrixWorld, skip));
      }
      parts.push(...collectColliderParts(groundRoot.current!));
      complexCollider = buildColliderFromParts(parts);
      colliderStore.current = complexCollider;
      complexStore.collider = 'ready';
      console.info('[complex collider]', complexCollider ? complexCollider.geometry.getAttribute('position').count / 3 : 0, 'tris');
    }, 30);
    return () => clearTimeout(t);
  }, [walk, built, instances, data]);
  useEffect(() => () => { colliderStore.current = null; }, []); // при выходе из режима коллайдер виллы соберёт сама вилла

  // старт прогулки: у въезда, на высоте рельефа; взгляд на ряд вилл
  const spawn = useMemo<[number, number, number]>(() => {
    const y = complexStore.heightAt?.(WALK_SPAWN_XZ[0], WALK_SPAWN_XZ[1]) ?? (data?.c.water_level ?? 0) + 6;
    return [WALK_SPAWN_XZ[0], y + 0.4, WALK_SPAWN_XZ[1]];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, data]);
  const lowQ = useQuality();
  const inSiteFn = useMemo(() => { const B = data?.c.site.boundary; return (x: number, z: number) => (B ? inPoly(x, z, B) : false); }, [data]);
  const spawnYaw = Math.atan2(-(WALK_LOOK_XZ[0] - WALK_SPAWN_XZ[0]), -(WALK_LOOK_XZ[1] - WALK_SPAWN_XZ[1]));

  // магазин у въезда — простой объём 1 этаж
  const shop = data?.c.buildings.find((b) => b.model === 'shop');
  // магазин у въезда: достроен процедурно (Shop.ts), фасадом к старту прогулки, пол по рельефу у двери
  const shopObj = useMemo(() => {
    const hAt = complexStore.heightAt; if (!shop || !built || !hAt) return null;
    const pose = shopPose(shop, houses, data!.c.site.boundary); const { W, D, yaw, fx, fz } = pose;
    const door = hAt(shop.pos[0] + fx * (D / 2 + 1.2), shop.pos[1] + fz * (D / 2 + 1.2)) ?? shop.floor;
    const front = hAt(shop.pos[0] + fx * (D / 2 + 3), shop.pos[1] + fz * (D / 2 + 3)) ?? door;
    const centre = hAt(shop.pos[0], shop.pos[1]) ?? door;
    const y = Math.max(door, centre) + 0.12;
    const g = buildShop(W, D, { stucco: tex.stucco, stuccoN: tex.stuccoN, stone2: tex.stone2, walnut: tex.walnut, detail: detailMaps(tex.walnut) }, Math.max(0.05, y - front));
    g.position.set(shop.pos[0], y, shop.pos[1]); g.rotation.y = yaw; g.updateMatrixWorld(true);
    const rp = (g.userData.receptionist as Vector3).clone().applyMatrix4(g.matrixWorld);
    g.userData.receptionistWorld = { x: rp.x, y: rp.y, z: rp.z, yaw: yaw }; // смотрит к входу (+z локально)
    g.userData.size = [W, D];
    g.userData.customersWorld = (g.userData.customers as { x: number; z: number; yaw: number; anim: string; char: string }[]).map((c) => { const v = new Vector3(c.x, 0, c.z).applyMatrix4(g.matrixWorld); return { x: v.x, y: v.y, z: v.z, yaw: c.yaw + yaw, anim: c.anim, char: c.char, role: 'guest' }; });
    shop.floor = y;
    return g;
  }, [shop, built, tex]);
  const idlerSpecs = useMemo<IdlerSpec[]>(() => shopObj ? [{ ...(shopObj.userData.receptionistWorld as { x: number; y: number; z: number; yaw: number }), char: 'f_formal', role: 'reception', anim: 'idle' }, ...(shopObj.userData.customersWorld as IdlerSpec[])] : [], [shopObj]);
  const terraceSpots = useMemo(() => houses.flatMap((hh) => hh.spots), [houses]);
  // для персонажей магазин — тоже «дом»: газон для косилки и кусты для полива не выбираются у его стен
  const housesNpc = useMemo<{ fp: [number, number, number, number]; matrix: Matrix4 }[]>(() => {
    if (!shopObj) return houses; const [W, D] = shopObj.userData.size as [number, number];
    return [...houses, { fp: [-W / 2 - 1, -D / 2 - 1, W / 2 + 1, D / 2 + 1], matrix: shopObj.matrixWorld.clone() }];
  }, [houses, shopObj]);
  const grass = tex.grass;
  // газон: плитка травы + крупный шум (убирает повторы) через onBeforeCompile
  // вариации травы шумом; под водой (y < уровня) — бегущая каустика на песчаном дне, затухает с глубиной
  const grassVary = (m: MeshStandardMaterial, scale: number, caustics = false) => {
    const noise = makeNoiseTexture(256, 3); const level = data?.c.water_level ?? 0;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNoise = { value: noise }; sh.uniforms.uNoiseScale = { value: scale }; sh.uniforms.uTime = WATER_TIME; sh.uniforms.uLevel = { value: level };
      sh.uniforms.uIndoor = INDOOR.tex; sh.uniforms.uI0 = INDOOR.i0; sh.uniforms.uISize = INDOOR.size; sh.uniforms.uHasIndoor = INDOOR.has;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise; uniform float uNoiseScale; uniform float uTime, uLevel; varying vec3 vWp; uniform sampler2D uIndoor; uniform vec2 uI0, uISize; uniform float uHasIndoor;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          ${caustics ? 'if (uHasIndoor > 0.5) { vec2 iuv = (vWp.xz - uI0) / uISize; if (iuv.x > 0.0 && iuv.x < 1.0 && iuv.y > 0.0 && iuv.y < 1.0 && texture2D(uIndoor, iuv).r > 0.5) discard; }' : ''}
          float nz = texture2D(uNoise, vMapUv * uNoiseScale).r;
          float nz2 = texture2D(uNoise, vMapUv * uNoiseScale * 7.3 + 0.37).r;
          diffuseColor.rgb *= mix(0.78, 1.16, nz) * mix(0.9, 1.08, nz2);
          diffuseColor.g *= 1.0 + (nz - 0.5) * 0.12;
          ${caustics ? `
          float depth = uLevel - vWp.y;
          if (depth > 0.0) {
            vec2 q = vWp.xz * 1.6; float t = uTime;
            float c1 = sin(q.x * 1.3 + t * 0.9) * sin(q.y * 1.1 - t * 0.7);
            float c2 = sin((q.x + q.y) * 0.9 + t * 1.1) * sin((q.x - q.y) * 1.2 + t * 0.6);
            float c = pow(abs(c1 * c2), 1.4);
            float fade = exp(-depth / 1.2);
            diffuseColor.rgb *= (0.9 + 0.7 * c) * mix(1.0, 0.92, 1.0 - fade) ;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.95, 1.0), clamp(depth / 2.0, 0.0, 0.6)); // песок под водой холоднее
          }` : ''}`);
    };
    return m;
  };
  const siteMat = useMemo(() => { const t = grass.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
    return grassVary(new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 1 }), 0.012, true); }, [grass, data]);
  const demMat = useMemo(() => grassVary(new MeshStandardMaterial({ map: siteMat.map, vertexColors: true, roughness: 1 }), 0.006), [siteMat]);
  const roofMat = useMemo(() => new MeshStandardMaterial({ color: '#b5674a', roughness: 0.9 }), []);
  const wallMat = useMemo(() => new MeshStandardMaterial({ color: '#efe9de', roughness: 0.95 }), []);
  const retMat = useMemo(() => { const t = tex.wallstone.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, color: '#cfc6b4', roughness: 0.95, side: DoubleSide }); }, [tex.wallstone]);
  const stepMat = useMemo(() => { const t = tex.stone2.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, color: '#c9c2b2', roughness: 0.9 }); }, [tex.stone2]);
  const pathMat = useMemo(() => { const t = tex.stone2.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.repeat.set(1, 1); t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, color: '#d8d2c4', roughness: 0.9, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }); }, [tex.stone2]);

  useEffect(() => {
    // дальняя плоскость для окрестностей 4 км (в прогулке 500 м)
    const pc = camera as unknown as { near: number; far: number; updateProjectionMatrix: () => void };
    const prev = [pc.near, pc.far]; pc.near = 0.3; pc.far = 9000; pc.updateProjectionMatrix();
    (window as unknown as { __drone: unknown }).__drone = {
      set: (p: [number, number, number], t: [number, number, number]) => { camera.position.set(...p); camera.lookAt(...t); ctrl.current?.target.set(...t); ctrl.current?.update(); },
    };
    return () => { pc.near = prev[0]; pc.far = prev[1]; pc.updateProjectionMatrix(); };
  }, [camera]);
  // вид с дрона при входе в режим и при возврате из прогулки
  useEffect(() => { if (!walk) { camera.position.set(150, 95, 170); camera.lookAt(0, 8, 0); } }, [camera, walk]);
  const ctrl = useRef<{ target: Vector3; update: () => void } | null>(null);

  return (
    <group>
      {!walk && <OrbitControls ref={ctrl as never} target={[0, 8, 0]} maxPolarAngle={Math.PI / 2.05} minDistance={8} maxDistance={1500} />}
      {walk && built && <Player spawn={spawn} yaw={spawnYaw} />}
      <group ref={instRoot}>{instances.map((o) => <primitive key={o.name} object={o} />)}</group>
      <group ref={groundRoot}>
        {shopObj && <primitive object={shopObj} />}
        {built && (
          <>
            <mesh geometry={built.site} material={siteMat} receiveShadow />
            <mesh geometry={built.dem} material={demMat} receiveShadow />
            {built.houses && <mesh geometry={built.houses} material={[roofMat, wallMat]} castShadow receiveShadow />}
            {built.paths && <mesh geometry={built.paths} material={pathMat} receiveShadow />}
            {built.walls && <mesh geometry={built.walls} material={retMat} castShadow receiveShadow />}
            {built.cheeks && <mesh geometry={built.cheeks} material={retMat} castShadow receiveShadow />}
            {built.steps && <mesh geometry={built.steps} material={stepMat} castShadow receiveShadow />}
          </>
        )}
      </group>
      {built && (PROVEG
        ? <><Palms near={built.near} far={built.far} /><Shrubs items={built.shrubs} /><Frangipani items={built.frangipani} /></>
        : <Suspense fallback={<><Palms near={built.near} far={built.far} /><Shrubs items={built.shrubs} /><Frangipani items={built.frangipani} /></>}>
            {/* модели Kenney Nature Kit (CC0): пальмы трёх видов (ближние), кусты трёх видов, деревья вместо франжипани; дальние пальмы — процедурные */}
            {/* Quaternius Ultimate Stylized Nature (CC0): текстурные пальмы четырёх видов, кусты (в т.ч. цветущие), клён вместо франжипани */}
            <ModelPlants url={asset('models/nature/q_PalmTree_1.glb')} items={built.near.filter((_, i) => i % 4 === 0)} place={placePalm} />
            <ModelPlants url={asset('models/nature/q_PalmTree_2.glb')} items={built.near.filter((_, i) => i % 4 === 1)} place={placePalm} />
            <ModelPlants url={asset('models/nature/q_PalmTree_3.glb')} items={built.near.filter((_, i) => i % 4 === 2)} place={placePalmShort} />
            <ModelPlants url={asset('models/nature/q_PalmTree_4.glb')} items={built.near.filter((_, i) => i % 4 === 3)} place={placePalm} />
            <Palms near={[]} far={built.far} />
            <ModelPlants url={asset('models/nature/q_Bush.glb')} items={built.shrubs.filter((_, i) => i % 4 === 0)} place={placeBush} castShadow={false} />
            <ModelPlants url={asset('models/nature/q_Bush_Large.glb')} items={built.shrubs.filter((_, i) => i % 4 === 1)} place={placeBush} castShadow={false} />
            <ModelPlants url={asset('models/nature/q_Bush_Flowers.glb')} items={built.shrubs.filter((_, i) => i % 4 === 2)} place={placeBush} castShadow={false} />
            <ModelPlants url={asset('models/nature/q_Bush_Large_Flowers.glb')} items={built.shrubs.filter((_, i) => i % 4 === 3)} place={placeBush} castShadow={false} />
            <ModelPlants url={asset('models/nature/q_MapleTree_1.glb')} items={built.frangipani} place={placeTree} />
          </Suspense>)}
      {data && <Lagoon level={data.c.water_level} bottom={built?.bottom ?? null} />}
      {data && built && <Lotuses items={built.lotus} level={data.c.water_level} />}
      {built && complexStore.heightAt && !lowQ && !new URLSearchParams(location.search).has('nograss') && <Grass heightAt={complexStore.heightAt} ok={built.grassOk} count={Number(new URLSearchParams(location.search).get('grass')) || (input.mobile ? 15_000 : 45_000)} radius={input.mobile ? 18 : 26} />}
      {built && complexStore.heightAt && <Npcs net={built.net} heightAt={complexStore.heightAt} houses={housesNpc} pools={pools} inSite={inSiteFn} water={built.waterAt} audioBase={asset('')} shrubs={built.shrubs} lagoon={LAGOON_XZ} idlers={idlerSpecs} terraceSpots={terraceSpots} />}
    </group>
  );
}
