// Сцена всего комплекса Lake Land: 12 строений по генплану 053-ГП (23.10.2026), рельеф участка по горизонталям,
// окрестности: рельеф SRTM 4×4 км, лагуна Мавелла и океан, дома и деревья вокруг (OpenStreetMap).
// Данные готовит aps/tools/genplan_*.py → public/complex/. Оси: x — восток, z — юг, y — отметка генплана.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useTexture } from '@react-three/drei';
import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, LOD, Matrix4, Mesh, MeshStandardMaterial,
  Ray, RepeatWrapping, Shape, SRGBColorSpace, type Texture, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyMaterialRules, openDoors } from './materials';
import { buildCollider, buildColliderFromParts, collectColliderParts, colliderStore, type Collider } from './collider';
import { MODELS } from './models';
import { asset } from './assets';
import { makeRamp } from './Villa';
import { Player } from './Player';
import { Frangipani, Palms, Shrubs, type Plant } from './world/Vegetation';
import { Lagoon } from './world/Lagoon';
import { buildPathNetwork, distToPaths, pathRibbon, type PathNet } from './world/Paths';
import { makeArtTexture, makeNoiseTexture, makeWeaveTexture, type DetailMaps } from './world/textures';
import { furnishVilla, glassBoxes, waterBoxes } from './world/Interiors';
import { Npcs } from './world/Characters';
import { buildShop } from './world/Shop';
import { loadPlan } from './plan';
import type { Plan } from './plan';

/** Дом на генплане для карты комплекса и телепорта: контур в мире (x,z), матрица дома, точка входа. */
export type HouseInfo = {
  id: string; model: string; title: string;
  poly: [number, number][];
  /** контур дома в координатах виллы: minX, minZ, maxX, maxZ */
  fp: [number, number, number, number];
  entry: [number, number, number]; entryYaw: number; matrix: Matrix4;
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

/** Точка старта пешей прогулки: у въезда рядом с магазином, взгляд на ряд вилл. */
const WALK_SPAWN_XZ: [number, number] = [-36, -34];
const LOD_FAR = 65;
const LAGOON_XZ: [number, number] = [150, 20]; // над чем кружат птицы (лагуна к востоку от участка)
type BuiltScene = { site: BufferGeometry; dem: BufferGeometry; houses: BufferGeometry | null; paths: BufferGeometry | null; near: Plant[]; far: Plant[]; shrubs: Plant[]; frangipani: Plant[]; net: PathNet; walls: BufferGeometry | null }; // м: дальше этого дом рисуется упрощённой копией
let artTexture: ReturnType<typeof makeArtTexture> | null = null;
export const artTex = () => (artTexture ??= makeArtTexture());
const WALK_LOOK_XZ: [number, number] = [-10, 0];

type Placement = { id: string; model: string; floor: number; rot: number; pos: [number, number]; size?: [number, number]; moved?: boolean };
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
        const furn = furnishVilla(plan, glassBoxes(g.scene), cfg0.passages ?? [], artTex(), detailMaps(tex.walnut), waterBoxes(g.scene));
        furn.applyMatrix4(g.scene.matrixWorld.clone().invert()); g.scene.add(furn); g.scene.updateMatrixWorld(true);
        console.info('[furniture]', MODEL_IDS[k], furn.children.map((m) => ((m as Mesh).geometry.getAttribute('position').count / 3) | 0), 'tris in', (performance.now() - t1) | 0, 'ms');
      }
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
      houses.push({ id: b.id, model: b.model, title: `${b.id} · ${cfg.title}`, poly: corners, fp: [fp.min.x, fp.min.z, fp.max.x, fp.max.z], entry: [e.x, e.y, e.z], entryYaw: (cfg.entry?.yaw ?? cfg.spawnYaw) - b.rot, matrix: outer.matrixWorld.clone() });
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
    const waterAt = (x: number, z: number) => {
      const i = Math.round((x + c.dem.half) / mstep), j = Math.round((z + c.dem.half) / mstep);
      return i < 0 || j < 0 || i >= MN || j >= MN ? true : water[j * MN + i] === 1;
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
            const hits = gb.bvh.raycast(ray, DoubleSide); if (!hits.length) continue;
            top = -Infinity; for (const ht of hits) top = Math.max(top, 80 - ht.distance);
            top = Math.min(floorY + range[1], Math.max(floorY + range[0], top));
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
    // вырезка: под каждым домом земля не выше самой нижней поверхности модели — только внутри пятна стен
    // (без запаса 1,2 м: иначе свесы крыш и террас прорезают траншею вокруг дома)
    const lpv = new Vector3();
    for (const inst of instances) {
      inst.updateMatrixWorld(true);
      const hi = houses.find((x) => x.id === inst.name.slice('house-'.length)); if (!hi) continue;
      const [fx0, fz0, fx1, fz1] = hi.fp; const inFoot = (x: number, z: number) => { lpv.set(x, 0, z); inst.worldToLocal(lpv); return lpv.x > fx0 + 1.2 && lpv.x < fx1 - 1.2 && lpv.z > fz0 + 1.2 && lpv.z < fz1 - 1.2; };
      const col = buildCollider(inst);
      if (!col) continue;
      col.geometry.computeBoundingBox(); const bb = col.geometry.boundingBox!;
      const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
      const i0 = Math.max(0, Math.floor((bb.min.x - x0) / step) - 1), i1 = Math.min(nx - 1, Math.ceil((bb.max.x - x0) / step) + 1);
      const j0 = Math.max(0, Math.floor((bb.min.z - z0) / step) - 1), j1 = Math.min(nz - 1, Math.ceil((bb.max.z - z0) / step) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (!inFoot(x0 + i * step, z0 + j * step)) continue;
        ray.origin.set(x0 + i * step, 80, z0 + j * step);
        const hits = col.bvh.raycast(ray, DoubleSide);
        if (!hits.length) continue;
        let low = Infinity; for (const ht of hits) low = Math.min(low, 80 - ht.distance);
        const k = j * nx + i; if (h[k] > low - 0.08) h[k] = low - 0.08;
      }
      col.geometry.dispose();
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
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = x0 + i * step, z = z0 + j * step, k = j * nx + i;
        if (inPoly(x, z, B)) { if (gradeFixed && gradeFixed[k]) relaxFixed[k] = 1; continue; }
        if (waterAt(x, z)) { h[k] = W - 0.6; if (distToBoundary(x, z) > 8) relaxFixed[k] = 1; else shore[k] = 1; continue; }
        h[k] = Math.min(h[k], demLand(x, z)); if (distToBoundary(x, z) > 30) relaxFixed[k] = 1;
      }
      // гладкая поверхность между зафиксированными клетками (Гаусс–Зейдель с верхней релаксацией): площадки домов,
      // вода и дальние окрестности держат форму, газон между ними — плавный, без уступов и обрывов
      const omega = 1.7;
      for (let pass = 0; pass < 500; pass++) {
        let maxd = 0;
        for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) {
          const k = j * nx + i; if (relaxFixed[k]) continue;
          const avg = (h[k - 1] + h[k + 1] + h[k - nx] + h[k + nx]) * 0.25; let v = h[k] + omega * (avg - h[k]); if (shore[k] && v > W - 0.2) v = W - 0.2;
          const dd = Math.abs(v - h[k]); if (dd > maxd) maxd = dd; h[k] = v;
        }
        if (maxd < 0.002) break;
      }
    }
    // меш участка
    const sp = new Float32Array(nx * nz * 3), su = new Float32Array(nx * nz * 2), scol = new Float32Array(nx * nz * 3);
    const green = new Color('#cfdcc0'), sand = new Color('#d8cfb0');
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * step, z = z0 + j * step, y = h[k];
      sp.set([x, y, z], k * 3); su.set([x / 4, z / 4], k * 2);
      const cc = y < W + 0.6 ? sand : green; scol.set([cc.r, cc.g, cc.b], k * 3);
    }
    const sidx: number[] = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i; sidx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1); }
    const sg = new BufferGeometry(); sg.setAttribute('position', new BufferAttribute(sp, 3)); sg.setAttribute('uv', new BufferAttribute(su, 2));
    sg.setAttribute('color', new BufferAttribute(scol, 3)); sg.setIndex(sidx); sg.computeVertexNormals();
    // окрестности: сетка 20 м в квадрате ±2 км; вода — ниже уровня; внутри участка — под ним
    const LN = c.dem.land_n;
    const demAt = demSampler({ ...c, dem: { ...c.dem, n: LN, step: (2 * c.dem.half) / (LN - 1) } }, land), siteAt = siteSampler(c, h);
    const N = 401, half = c.dem.half, st = (2 * half) / (N - 1); // шаг 10 м
    const dp = new Float32Array(N * N * 3), du = new Float32Array(N * N * 2), dcol = new Float32Array(N * N * 3);
    const landCol = new Color('#5f8a46'), shore = new Color('#cbbf98'), openCol = new Color('#a9b77a');
    const isWater = (x: number, z: number, _raw: number) => waterAt(x, z);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -half + i * st, z = -half + j * st;
      const raw = demAt(x, z);
      let y = raw;
      if (inPoly(x, z, c.site.boundary)) y = Math.min(y, W - 3);
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
      const raw = demAt(x, z); return isWater(x, z, raw) ? null : raw;
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
    // подпорных стенок нет: заказчик просил сплошной плавный газон от фундамента к фундаменту
    const walls: BufferGeometry | null = null; void inHouseMask;
    // дорожки: сеть по генплану (въезд → проезд между 2.x → дорога ряда 1.x → вилла 3), ленты 2,6 м по рельефу
    setStage('terrain:paths');
    const net = buildPathNetwork(houses, WALK_SPAWN_XZ.map((v, k) => v + (k ? -14 : -12)) as [number, number]);
    const ribbons = net.lines.map((l) => pathRibbon(l, 2.6, (x, z) => siteAt(x, z) ?? heightAt(x, z))).filter((g): g is BufferGeometry => !!g);
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
      if (!inPoly(px, pz, c.site.boundary) || nearHouse(px, pz) || distToPaths(net, px, pz) < 2.5 || r() > 0.35) continue;
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
        const w = new Vector3(lx, 0, lz).applyMatrix4(hs.matrix); if (!inPoly(w.x, w.z, c.site.boundary) || distToPaths(net, w.x, w.z) < 1.8) continue;
        const y = siteAt(w.x, w.z); if (y === null) continue; shrubs.push({ x: w.x, y: y - 0.1, z: w.z, s: r(), r: r() });
      }
    }
    for (let k = 0; k < 500; k++) {
      const px = -95 + r() * 190, pz = -75 + r() * 150;
      if (!inPoly(px, pz, c.site.boundary) || nearHouse(px, pz, 14) || distToPaths(net, px, pz) < 2 || r() > 0.5) continue;
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
    const builtNow = { site: sg, dem: dg, houses: nbHouses, paths, near, far, shrubs, frangipani, net, walls }; builtCache = { data, built: builtNow, heightAt }; setBuilt(builtNow);
    complexStore.data = c; complexStore.houses = houses; complexStore.heightAt = heightAt;
    (window as unknown as { __complex: unknown }).__complex = { heightAt, data: c, root: instRoot.current, h, x0, z0, step, nx, nz, houses };
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
  const inSiteFn = useMemo(() => { const B = data?.c.site.boundary; return (x: number, z: number) => (B ? inPoly(x, z, B) : false); }, [data]);
  const spawnYaw = Math.atan2(-(WALK_LOOK_XZ[0] - WALK_SPAWN_XZ[0]), -(WALK_LOOK_XZ[1] - WALK_SPAWN_XZ[1]));

  // магазин у въезда — простой объём 1 этаж
  const shop = data?.c.buildings.find((b) => b.model === 'shop');
  // магазин у въезда: достроен процедурно (Shop.ts), фасадом к старту прогулки, пол по рельефу у двери
  const shopObj = useMemo(() => {
    const hAt = complexStore.heightAt; if (!shop || !built || !hAt) return null;
    let W = shop.size?.[0] ?? 9.5, D = shop.size?.[1] ?? 8.5;
    // по указанию заказчика магазин отодвинут целиком на 15 м от ближайшей виллы в сторону границы участка
    // (вдоль направления «от виллы», но не ближе 6 м к границе)
    if (!shop.moved && data) {
      const near = houses.map((hh) => new Vector3().setFromMatrixPosition(hh.matrix)).sort((a, b) => Math.hypot(a.x - shop.pos[0], a.z - shop.pos[1]) - Math.hypot(b.x - shop.pos[0], b.z - shop.pos[1]))[0];
      const B = data.c.site.boundary; const distB = (x: number, z: number) => { let best = Infinity; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [ax, az] = B[j], [bx, bz] = B[i]; const dx = bx - ax, dz = bz - az; const L2 = dx * dx + dz * dz; const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0; best = Math.min(best, Math.hypot(ax + t * dx - x, az + t * dz - z)); } return best; };
      if (near) {
        const dx = shop.pos[0] - near.x, dz = shop.pos[1] - near.z; const L = Math.hypot(dx, dz) || 1; let m = 15;
        while (m > 0 && (!inPoly(shop.pos[0] + (dx / L) * m, shop.pos[1] + (dz / L) * m, B) || distB(shop.pos[0] + (dx / L) * m, shop.pos[1] + (dz / L) * m) < 6)) m -= 1;
        shop.pos = [shop.pos[0] + (dx / L) * m, shop.pos[1] + (dz / L) * m];
      }
      shop.moved = true;
    }
    // вход — по указанию заказчика: стена справа от прежнего стеклянного фасада (прежний фасад смотрел к старту прогулки),
    // то есть поворот на +90°; при нечётном повороте относительно пятна генплана ширина и глубина меняются местами
    const toSpawn = Math.atan2(WALK_SPAWN_XZ[0] - shop.pos[0], WALK_SPAWN_XZ[1] - shop.pos[1]);
    const yaw0 = [0, 1, 2, 3].map((k) => -shop.rot + k * Math.PI / 2).sort((a, b) => Math.cos(b - toSpawn) - Math.cos(a - toSpawn))[0];
    const yaw = yaw0 + Math.PI / 2;
    const kq = ((Math.round((yaw + shop.rot) / (Math.PI / 2)) % 4) + 4) % 4; if (kq % 2) { const t = W; W = D; D = t; }
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const door = hAt(shop.pos[0] + fx * (D / 2 + 1.2), shop.pos[1] + fz * (D / 2 + 1.2)) ?? shop.floor;
    const front = hAt(shop.pos[0] + fx * (D / 2 + 3), shop.pos[1] + fz * (D / 2 + 3)) ?? door;
    const centre = hAt(shop.pos[0], shop.pos[1]) ?? door;
    const y = Math.max(door, centre) + 0.12;
    const g = buildShop(W, D, { stucco: tex.stucco, stuccoN: tex.stuccoN, stone2: tex.stone2, walnut: tex.walnut, detail: detailMaps(tex.walnut) }, Math.max(0.05, y - front));
    g.position.set(shop.pos[0], y, shop.pos[1]); g.rotation.y = yaw; g.updateMatrixWorld(true);
    const rp = (g.userData.receptionist as Vector3).clone().applyMatrix4(g.matrixWorld);
    g.userData.receptionistWorld = { x: rp.x, y: rp.y, z: rp.z, yaw: yaw }; // смотрит к входу (+z локально)
    shop.floor = y;
    return g;
  }, [shop, built, tex]);
  const grass = tex.grass;
  // газон: плитка травы + крупный шум (убирает повторы) через onBeforeCompile
  const grassVary = (m: MeshStandardMaterial, scale: number) => {
    const noise = makeNoiseTexture(256, 3);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNoise = { value: noise }; sh.uniforms.uNoiseScale = { value: scale };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uNoise; uniform float uNoiseScale;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float nz = texture2D(uNoise, vMapUv * uNoiseScale).r;
          float nz2 = texture2D(uNoise, vMapUv * uNoiseScale * 7.3 + 0.37).r;
          diffuseColor.rgb *= mix(0.78, 1.16, nz) * mix(0.9, 1.08, nz2);
          diffuseColor.g *= 1.0 + (nz - 0.5) * 0.12;`);
    };
    return m;
  };
  const siteMat = useMemo(() => { const t = grass.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
    return grassVary(new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 1 }), 0.012); }, [grass]);
  const demMat = useMemo(() => grassVary(new MeshStandardMaterial({ map: siteMat.map, vertexColors: true, roughness: 1 }), 0.006), [siteMat]);
  const roofMat = useMemo(() => new MeshStandardMaterial({ color: '#b5674a', roughness: 0.9 }), []);
  const wallMat = useMemo(() => new MeshStandardMaterial({ color: '#efe9de', roughness: 0.95 }), []);
  const retMat = useMemo(() => { const t = tex.wallstone.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, color: '#cfc6b4', roughness: 0.95, side: DoubleSide }); }, [tex.wallstone]);
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
          </>
        )}
      </group>
      {built && <><Palms near={built.near} far={built.far} /><Shrubs items={built.shrubs} /><Frangipani items={built.frangipani} /></>}
      {data && <Lagoon level={data.c.water_level} />}
      {built && complexStore.heightAt && <Npcs net={built.net} heightAt={complexStore.heightAt} houses={houses} pools={pools} inSite={inSiteFn} audioBase={asset('')} shrubs={built.shrubs} lagoon={LAGOON_XZ} idlers={shopObj ? [shopObj.userData.receptionistWorld as { x: number; y: number; z: number; yaw: number }] : []} />}
    </group>
  );
}
