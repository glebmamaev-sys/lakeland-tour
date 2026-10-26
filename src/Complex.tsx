// Сцена всего комплекса Lake Land: 12 строений по генплану 053-ГП (23.10.2026), рельеф участка по горизонталям,
// окрестности: рельеф SRTM 4×4 км, лагуна Мавелла и океан, дома и деревья вокруг (OpenStreetMap).
// Данные готовит aps/tools/genplan_*.py → public/complex/. Оси: x — восток, z — юг, y — отметка генплана.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useTexture } from '@react-three/drei';
import {
  Box3, BufferAttribute, BufferGeometry, Color, CylinderGeometry, PlaneGeometry, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  Quaternion, Ray, RepeatWrapping, Shape, SRGBColorSpace, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyMaterialRules } from './materials';
import { buildCollider } from './collider';
import { MODELS } from './models';
import { asset } from './assets';

type Placement = { id: string; model: string; floor: number; rot: number; pos: [number, number]; size?: [number, number] };
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
  const [d, setD] = useState<{ c: ComplexData; site: Float32Array; dem: Float32Array; water: Uint8Array; land: Float32Array } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(asset('complex/complex.json')).then((r) => r.json()),
      fetch(asset('complex/site_h.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/dem.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/water_mask.bin')).then((r) => r.arrayBuffer()),
      fetch(asset('complex/land_h.bin')).then((r) => r.arrayBuffer()),
    ]).then(([c, s, dm, wm, lh]) => { if (alive) setD({ c, site: new Float32Array(s), dem: new Float32Array(dm), water: new Uint8Array(wm), land: new Float32Array(lh) }); });
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

/** Простая пальма для массовки: ствол + зонтик кроны (InstancedMesh, два вызова отрисовки на тысячи деревьев). */
function Palms({ points }: { points: { x: number; y: number; z: number; s: number; r: number }[] }) {
  const trunkGeo = useMemo(() => { const g = new CylinderGeometry(0.12, 0.2, 1, 5); g.translate(0, 0.5, 0); return g; }, []);
  // крона: 8 свисающих листьев (плоскости), так силуэт читается как кокосовая пальма
  const crownGeo = useMemo(() => {
    const leaves: BufferGeometry[] = [];
    for (let k = 0; k < 8; k++) {
      const g = new PlaneGeometry(0.6, 3.4, 1, 3); g.translate(0, 1.7, 0);
      const pos = g.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setZ(i, -0.08 * y * y); } // изгиб листа вниз
      g.rotateX(Math.PI / 2 - 0.35 - (k % 2) * 0.25); g.rotateY((k / 8) * Math.PI * 2);
      leaves.push(g);
    }
    return mergeGeometries(leaves)!;
  }, []);
  const trunkMat = useMemo(() => new MeshStandardMaterial({ color: '#8a7a64', roughness: 1 }), []);
  const crownMat = useMemo(() => new MeshStandardMaterial({ color: '#3f6b2c', roughness: 1, side: DoubleSide }), []);
  const trunks = useRef<InstancedMesh>(null), crowns = useRef<InstancedMesh>(null);
  useEffect(() => {
    const m = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0);
    points.forEach((p, i) => {
      const h = 7 + p.s * 7; const lean = (p.r - 0.5) * 0.25;
      q.setFromAxisAngle(new Vector3(Math.cos(p.r * 6.28), 0, Math.sin(p.r * 6.28)), lean);
      m.compose(new Vector3(p.x, p.y, p.z), q, new Vector3(1, h, 1)); trunks.current!.setMatrixAt(i, m);
      const top = new Vector3(0, h, 0).applyQuaternion(q).add(new Vector3(p.x, p.y, p.z));
      m.compose(top, new Quaternion().setFromAxisAngle(up, p.r * 6.28), new Vector3(0.9 + p.s * 0.4, 1, 0.9 + p.s * 0.4)); crowns.current!.setMatrixAt(i, m);
    });
    trunks.current!.instanceMatrix.needsUpdate = true; crowns.current!.instanceMatrix.needsUpdate = true;
  }, [points]);
  return (
    <>
      <instancedMesh ref={trunks} args={[trunkGeo, trunkMat, points.length]} castShadow />
      <instancedMesh ref={crowns} args={[crownGeo, crownMat, points.length]} castShadow receiveShadow />
    </>
  );
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

export function ComplexScene() {
  const data = useComplexData();
  const gltfs = MODEL_IDS.map((id) => useGLTF(asset(MODELS[id].url)));
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
  const [built, setBuilt] = useState<{ site: BufferGeometry; dem: BufferGeometry; houses: BufferGeometry | null; paths: BufferGeometry | null; palms: { x: number; y: number; z: number; s: number; r: number }[] } | null>(null);
  const instRoot = useRef<Group>(null);

  // экземпляры вилл: материалы как в прогулке, участок/рельеф самой модели скрыт
  const instances = useMemo(() => {
    if (!data) return [];
    gltfs.forEach((g, k) => { g.scene.updateMatrixWorld(true); applyMaterialRules(g.scene, tex, MODELS[MODEL_IDS[k]].terrainCuts ?? [], { paint: MODELS[MODEL_IDS[k]].paint }); });
    return data.c.buildings.filter((b) => b.model !== 'shop').map((b) => {
      const k = MODEL_IDS.indexOf(b.model as typeof MODEL_IDS[number]);
      const cfg = MODELS[b.model];
      const inner = gltfs[k].scene.clone(true);
      inner.rotation.set(...cfg.rotation); inner.position.set(...cfg.offset);
      const outer = new Group(); outer.name = `house-${b.id}`;
      outer.add(inner); outer.rotation.y = -b.rot; outer.position.set(b.pos[0], b.floor, b.pos[1]);
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
      inner.traverse((o) => {
        const m = o as Mesh; if (!m.isMesh) return;
        const role = m.userData.role;
        if (role === 'ground' || role === 'terrain') { m.visible = false; m.userData.noCollide = true; return; }
        tmp.setFromObject(m); const sz = tmp.getSize(new Vector3());
        if (Math.max(sz.x, sz.z) <= 32) return;
        m.geometry = keepInside(m, fp); // оставляем плиты и стены дома, площадку участка отрезаем
      });
      outer.rotation.y = -b.rot; outer.position.set(b.pos[0], b.floor, b.pos[1]); outer.updateMatrixWorld(true);
      return outer;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // рельеф, вырезка под домами, окрестности, массовка
  useEffect(() => {
    if (!data || !instances.length) return;
    const { c, site, water, land } = data;
    const MN = c.dem.mask_n, mstep = (2 * c.dem.half) / (MN - 1);
    const waterAt = (x: number, z: number) => {
      const i = Math.round((x + c.dem.half) / mstep), j = Math.round((z + c.dem.half) / mstep);
      return i < 0 || j < 0 || i >= MN || j >= MN ? true : water[j * MN + i] === 1;
    };
    const W = c.water_level;
    const h = Float32Array.from(site);
    const { x0, z0, step, nx, nz } = c.site;
    // вырезка: под каждым домом земля не выше самой нижней поверхности модели
    for (const inst of instances) {
      inst.updateMatrixWorld(true);
      const col = buildCollider(inst);
      if (!col) continue;
      col.geometry.computeBoundingBox(); const bb = col.geometry.boundingBox!;
      const ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
      const i0 = Math.max(0, Math.floor((bb.min.x - x0) / step) - 1), i1 = Math.min(nx - 1, Math.ceil((bb.max.x - x0) / step) + 1);
      const j0 = Math.max(0, Math.floor((bb.min.z - z0) / step) - 1), j1 = Math.min(nz - 1, Math.ceil((bb.max.z - z0) / step) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        ray.origin.set(x0 + i * step, 80, z0 + j * step);
        const hits = col.bvh.raycast(ray, DoubleSide);
        if (!hits.length) continue;
        let low = Infinity; for (const ht of hits) low = Math.min(low, 80 - ht.distance);
        const k = j * nx + i; if (h[k] > low - 0.08) h[k] = low - 0.08;
      }
      col.geometry.dispose();
    }
    // за границей участка сетка повторяет окрестности: вода — ниже уровня, суша — рельеф SRTM
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      if (inPoly(x, z, c.site.boundary)) continue;
      const k = j * nx + i;
      h[k] = waterAt(x, z) ? W - 0.6 : Math.min(h[k], demSampler({ ...c, dem: { ...c.dem, n: c.dem.land_n, step: (2 * c.dem.half) / (c.dem.land_n - 1) } }, land)(x, z));
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
    const landCol = new Color('#5f8a46'), shore = new Color('#cbbf98');
    const isWater = (x: number, z: number, _raw: number) => waterAt(x, z);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -half + i * st, z = -half + j * st;
      const raw = demAt(x, z);
      let y = raw;
      if (inPoly(x, z, c.site.boundary)) y = Math.min(y, W - 3);
      dp.set([x, y, z], k * 3); du.set([x / 12, z / 12], k * 2);
      const cc = y < W + 1.5 ? shore : landCol; dcol.set([cc.r, cc.g, cc.b], k * 3);
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
    const houses = hg.length ? mergeGeometries(hg, true) : null;
    // дорожки участка — ленты 1,6 м
    const pv: number[] = [];
    for (const pl of c.site.paths) for (let i = 0; i < pl.length - 1; i++) {
      const [ax, az] = pl[i], [bx, bz] = pl[i + 1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
      const nxv = (-dz / L) * 0.8, nzv = (dx / L) * 0.8;
      const ya = (siteAt(ax, az) ?? W) + 0.06, yb = (siteAt(bx, bz) ?? W) + 0.06;
      pv.push(ax - nxv, ya, az - nzv, ax + nxv, ya, az + nzv, bx - nxv, yb, bz - nzv, bx - nxv, yb, bz - nzv, ax + nxv, ya, az + nzv, bx + nxv, yb, bz + nzv);
    }
    const paths = pv.length ? new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pv, 3)) : null;
    paths?.computeVertexNormals();
    // пальмы: окрестности (сетка 14 м со случайным сдвигом, суша, не на домах) и участок (вдоль границы и в зелёных зонах)
    const r = rng(7); const palms: { x: number; y: number; z: number; s: number; r: number }[] = [];
    const nearHouse = (x: number, z: number) => c.buildings.some((b) => Math.hypot(x - b.pos[0], z - b.pos[1]) < 17);
    for (let z = -1500; z < 1500; z += 14) for (let x = -1500; x < 1500; x += 14) {
      const px = x + (r() - 0.5) * 12, pz = z + (r() - 0.5) * 12;
      if (r() > 0.55) continue;
      if (inPoly(px, pz, c.site.boundary)) continue;
      const y = heightAt(px, pz); if (y === null) continue;
      palms.push({ x: px, y: y - 0.2, z: pz, s: r(), r: r() });
    }
    for (let k = 0; k < 900; k++) {
      const px = -95 + r() * 190, pz = -75 + r() * 150;
      if (!inPoly(px, pz, c.site.boundary) || nearHouse(px, pz) || r() > 0.35) continue;
      const y = siteAt(px, pz); if (y === null) continue;
      palms.push({ x: px, y: y - 0.2, z: pz, s: r(), r: r() });
    }
    setBuilt({ site: sg, dem: dg, houses, paths, palms });
    (window as unknown as { __complex: unknown }).__complex = { heightAt, data: c, root: instRoot.current, h, x0, z0, step, nx, nz };
  }, [data, instances]);

  // магазин у въезда — простой объём 1 этаж
  const shop = data?.c.buildings.find((b) => b.model === 'shop');
  const grass = tex.grass;
  const siteMat = useMemo(() => { const t = grass.clone(); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
    return new MeshStandardMaterial({ map: t, vertexColors: true, roughness: 1 }); }, [grass]);
  const demMat = useMemo(() => new MeshStandardMaterial({ map: siteMat.map, vertexColors: true, roughness: 1 }), [siteMat]);
  const waterMat = useMemo(() => new MeshPhysicalMaterial({ color: '#2d6b74', roughness: 0.12, metalness: 0, envMapIntensity: 1.2, clearcoat: 0.6 }), []);
  const roofMat = useMemo(() => new MeshStandardMaterial({ color: '#b5674a', roughness: 0.9 }), []);
  const wallMat = useMemo(() => new MeshStandardMaterial({ color: '#efe9de', roughness: 0.95 }), []);
  const pathMat = useMemo(() => new MeshStandardMaterial({ color: '#d9cfbb', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }), []);

  useEffect(() => {
    // дальняя плоскость для окрестностей 4 км (в прогулке 500 м)
    const pc = camera as unknown as { near: number; far: number; updateProjectionMatrix: () => void };
    const prev = [pc.near, pc.far]; pc.near = 0.3; pc.far = 9000; pc.updateProjectionMatrix();
    camera.position.set(150, 95, 170); camera.lookAt(0, 8, 0);
    (window as unknown as { __drone: unknown }).__drone = {
      set: (p: [number, number, number], t: [number, number, number]) => { camera.position.set(...p); camera.lookAt(...t); ctrl.current?.target.set(...t); ctrl.current?.update(); },
    };
    return () => { pc.near = prev[0]; pc.far = prev[1]; pc.updateProjectionMatrix(); };
  }, [camera]);
  const ctrl = useRef<{ target: Vector3; update: () => void } | null>(null);

  return (
    <group>
      <OrbitControls ref={ctrl as never} target={[0, 8, 0]} maxPolarAngle={Math.PI / 2.05} minDistance={8} maxDistance={1500} />
      <group ref={instRoot}>{instances.map((o) => <primitive key={o.name} object={o} />)}</group>
      {shop && (
        <mesh position={[shop.pos[0], shop.floor + 1.8, shop.pos[1]]} rotation={[0, -shop.rot, 0]} castShadow receiveShadow>
          <boxGeometry args={[shop.size?.[0] ?? 9, 3.6, shop.size?.[1] ?? 8]} />
          <meshStandardMaterial color="#f1ece2" roughness={0.9} />
        </mesh>
      )}
      {built && (
        <>
          <mesh geometry={built.site} material={siteMat} receiveShadow />
          <mesh geometry={built.dem} material={demMat} receiveShadow />
          {built.houses && <mesh geometry={built.houses} material={[roofMat, wallMat]} castShadow receiveShadow />}
          {built.paths && <mesh geometry={built.paths} material={pathMat} receiveShadow />}
          <Palms points={built.palms} />
        </>
      )}
      {data && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, data.c.water_level, 0]} material={waterMat} receiveShadow>
          <planeGeometry args={[12000, 12000]} />
        </mesh>
      )}
    </group>
  );
}
