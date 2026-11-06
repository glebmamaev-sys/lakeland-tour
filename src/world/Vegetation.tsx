// Процедурная растительность комплекса: кокосовые пальмы с перистыми листьями (ближние) и простые (дальние),
// кусты вдоль домов и на газоне, франжипани у дорожек. Всё инстансами: несколько вызовов отрисовки на тысячи растений.
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, IcosahedronGeometry,
  InstancedMesh, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Plant = { x: number; y: number; z: number; s: number; r: number };

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const up = new Vector3(0, 1, 0);
/** Без индекса: у PolyhedronGeometry индекса нет, у Plane/Cylinder есть — mergeGeometries требует единообразия. */
const ni = (g: BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** Красит геометрию в один цвет с лёгкой вариацией по вершинам (атрибут color). */
function paint(g: BufferGeometry, base: Color, vary = 0.08, seed = 1) {
  const r = rng(seed); const n = g.getAttribute('position').count; const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = 1 + (r() - 0.5) * 2 * vary; c[i * 3] = base.r * k; c[i * 3 + 1] = base.g * k; c[i * 3 + 2] = base.b * k; }
  g.setAttribute('color', new BufferAttribute(c, 3)); return g;
}
function gradientY(g: BufferGeometry, bottom: Color, top: Color) {
  const p = g.getAttribute('position'); const n = p.count; let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  const c = new Float32Array(n * 3); const tmp = new Color();
  for (let i = 0; i < n; i++) { const t = (p.getY(i) - y0) / Math.max(1e-6, y1 - y0); tmp.copy(bottom).lerp(top, t); c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b; }
  g.setAttribute('color', new BufferAttribute(c, 3)); return g;
}

/** Крона кокосовой пальмы: fronds перистых листьев; каждый лист — изогнутый черешок и пары листочков-пластин. */
export function makePalmCrown(seed = 1, fronds = 12): BufferGeometry {
  const r = rng(seed); const parts: BufferGeometry[] = [];
  const green = new Color('#3f7a2f'), tip = new Color('#7fb04a'), dark = new Color('#2f5f24');
  for (let f = 0; f < fronds; f++) {
    const yaw = (f / fronds) * Math.PI * 2 + (r() - 0.5) * 0.3;
    const len = 3.0 + r() * 1.2; const lift = 0.35 + r() * 0.5; // стартовый подъём листа
    const droop = 0.9 + r() * 0.5;
    // черешок по кривой p(t)
    const P = (t: number) => new Vector3(0, lift * t - droop * t * t, -len * t);
    const steps = 9; const rachis: BufferGeometry[] = [];
    for (let i = 0; i < steps; i++) {
      const a = P(i / steps), b = P((i + 1) / steps); const w = 0.08 * (1 - i / steps) + 0.015;
      const g = new PlaneGeometry(w, a.distanceTo(b)); g.rotateX(-Math.PI / 2);
      const m = new Matrix4().lookAt(a, b, up); const q = new Quaternion().setFromRotationMatrix(m); g.applyQuaternion(q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      rachis.push(paint(g, dark, 0.05, seed + i));
    }
    parts.push(...rachis);
    // листочки парами вдоль черешка
    const pairs = 16;
    for (let i = 0; i < pairs; i++) {
      const t = 0.12 + (i / pairs) * 0.85; const a = P(t), b = P(Math.min(1, t + 0.02)); const dir = b.clone().sub(a).normalize();
      const side = new Vector3().crossVectors(dir, up).normalize();
      const ll = 0.75 * (1 - 0.55 * Math.abs(t - 0.45) * 2) + 0.25; // длина листочка: длиннее в середине
      for (const s of [-1, 1]) {
        const g = new PlaneGeometry(0.07, ll); g.translate(0, ll / 2, 0);
        // листочек отходит в сторону под ~55° и свисает
        const out = side.clone().multiplyScalar(s).applyAxisAngle(dir, s * (0.55 + r() * 0.25)).lerp(dir, 0.35).normalize();
        out.y -= 0.55 + t * 0.4; out.normalize();
        const q = new Quaternion().setFromUnitVectors(up, out); g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
        gradientY(g, green, tip); parts.push(g);
      }
    }
    for (const g of parts.slice(-pairs * 2 - steps)) g.rotateY(yaw);
  }
  // кокосы у основания кроны
  for (let i = 0; i < 7; i++) { const g = new IcosahedronGeometry(0.13, 1); const a = r() * Math.PI * 2; g.translate(Math.cos(a) * 0.3, -0.25 - r() * 0.2, Math.sin(a) * 0.3); parts.push(paint(g, new Color('#6b7a3a'), 0.1, i + 3)); }
  const merged = mergeGeometries(parts.map(ni), false)!; merged.computeVertexNormals(); return merged;
}

/** Простая крона для дальних пальм: 8 свисающих плоскостей. */
export function makeSimpleCrown(): BufferGeometry {
  const leaves: BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const g = new PlaneGeometry(0.6, 3.4, 1, 3); g.translate(0, 1.7, 0);
    const pos = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); pos.setZ(i, -0.08 * y * y); }
    g.rotateX(Math.PI / 2 - 0.35 - (k % 2) * 0.25); g.rotateY((k / 8) * Math.PI * 2); leaves.push(gradientY(g, new Color('#3f6b2c'), new Color('#5f9a3c')));
  }
  return mergeGeometries(leaves)!;
}

export function makeTrunk(): BufferGeometry {
  const g = new CylinderGeometry(0.13, 0.22, 1, 7, 6); g.translate(0, 0.5, 0);
  // лёгкий изгиб ствола и кольца
  const p = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + 0.12 * y * y); }
  g.computeVertexNormals(); return gradientY(g, new Color('#7b6a52'), new Color('#9a8a70'));
}

/** Куст: деформированная сфера, чуть сплюснутая. */
export function makeShrub(seed = 1): BufferGeometry {
  // индексированная сфера → после деформации нормали сглаженные (у икосаэдра были бы гранёные)
  const g = new SphereGeometry(1, 16, 11); const p = g.getAttribute('position') as BufferAttribute;
  const bump = (x: number, y: number, z: number) => 0.82 + 0.2 * (Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed) * 0.5 + Math.sin(y * 4.3 + x * 1.7) * 0.5);
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = bump(x, y, z); p.setXYZ(i, x * k, y * k * 0.72 + 0.25, z * k); }
  g.computeVertexNormals(); return paint(g, new Color('#2f6b2c'), 0.14, seed);
}

/** Франжипани: ствол, 5 веток, розетки листьев и белые соцветия на концах. */
export function makeFrangipani(seed = 1): BufferGeometry {
  const r = rng(seed); const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.09, 0.15, 1.1, 6); trunk.translate(0, 0.55, 0); parts.push(paint(trunk, new Color('#8a8070'), 0.06, seed));
  for (let b = 0; b < 6; b++) {
    const yaw = (b / 6) * Math.PI * 2 + r() * 0.5, tilt = 0.55 + r() * 0.5, len = 0.7 + r() * 0.6;
    const dir = new Vector3(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
    const br = new CylinderGeometry(0.045, 0.07, len, 5); br.translate(0, len / 2, 0); br.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir)); br.translate(0, 1.05, 0);
    parts.push(paint(br, new Color('#8a8070'), 0.06, seed + b));
    const tipP = dir.clone().multiplyScalar(len).add(new Vector3(0, 1.05, 0));
    for (let l = 0; l < 12; l++) {
      const g = new PlaneGeometry(0.11, 0.36); g.translate(0, 0.18, 0);
      const a = (l / 12) * Math.PI * 2 + r() * 0.3; const ld = new Vector3(Math.cos(a) * 0.8, 0.5 - r() * 0.5, Math.sin(a) * 0.8).normalize();
      g.applyQuaternion(new Quaternion().setFromUnitVectors(up, ld)); g.translate(tipP.x, tipP.y, tipP.z); parts.push(gradientY(g, new Color('#2f6b2a'), new Color('#5a9a3e')));
    }
    for (let k = 0; k < 4; k++) { const g = new IcosahedronGeometry(0.09, 1); g.translate(tipP.x + (r() - 0.5) * 0.3, tipP.y + 0.1 + r() * 0.15, tipP.z + (r() - 0.5) * 0.3); parts.push(paint(g, new Color('#fff6d6'), 0.03, k)); }
  }
  const m = mergeGeometries(parts.map(ni), false)!; m.computeVertexNormals(); return m;
}

const leafMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });
const solidMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

function Instanced({ geometry, material, items, place }: { geometry: BufferGeometry; material: MeshStandardMaterial; items: Plant[]; place: (p: Plant, m: Matrix4) => void }) {
  const ref = useRef<InstancedMesh>(null);
  useEffect(() => {
    const m = new Matrix4(); items.forEach((p, i) => { place(p, m); ref.current!.setMatrixAt(i, m); });
    ref.current!.instanceMatrix.needsUpdate = true; ref.current!.computeBoundingSphere();
  }, [items, place]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow receiveShadow frustumCulled={false} />;
}

/** Пальмы: ближние (детальная крона) и дальние (простая); у каждой свой наклон и размер. */
export function Palms({ near, far }: { near: Plant[]; far: Plant[] }) {
  const trunk = useMemo(() => makeTrunk(), []);
  const crownA = useMemo(() => makePalmCrown(3), []), crownB = useMemo(() => makePalmCrown(9, 11), []);
  const simple = useMemo(() => makeSimpleCrown(), []);
  const nearA = useMemo(() => near.filter((_, i) => i % 2 === 0), [near]), nearB = useMemo(() => near.filter((_, i) => i % 2 === 1), [near]);
  const placeTrunk = (p: Plant, m: Matrix4) => { const h = 7 + p.s * 7; const lean = (p.r - 0.5) * 0.25; const q = new Quaternion().setFromAxisAngle(new Vector3(Math.cos(p.r * 6.28), 0, Math.sin(p.r * 6.28)), lean); m.compose(new Vector3(p.x, p.y, p.z), q, new Vector3(1, h, 1)); };
  const placeCrown = (p: Plant, m: Matrix4) => { const h = 7 + p.s * 7; const lean = (p.r - 0.5) * 0.25; const q = new Quaternion().setFromAxisAngle(new Vector3(Math.cos(p.r * 6.28), 0, Math.sin(p.r * 6.28)), lean); const top = new Vector3(0.12 * h, h, 0).applyQuaternion(q).add(new Vector3(p.x, p.y, p.z)); const s = 0.9 + p.s * 0.4; m.compose(top, new Quaternion().setFromAxisAngle(up, p.r * 6.28), new Vector3(s, s, s)); };
  return (
    <>
      <Instanced geometry={trunk} material={solidMat} items={[...near, ...far]} place={placeTrunk} />
      <Instanced geometry={crownA} material={leafMat} items={nearA} place={placeCrown} />
      <Instanced geometry={crownB} material={leafMat} items={nearB} place={placeCrown} />
      <Instanced geometry={simple} material={leafMat} items={far} place={placeCrown} />
    </>
  );
}

export function Shrubs({ items }: { items: Plant[] }) {
  const gA = useMemo(() => makeShrub(5), []), gB = useMemo(() => makeShrub(21), []);
  const a = useMemo(() => items.filter((_, i) => i % 2 === 0), [items]), b = useMemo(() => items.filter((_, i) => i % 2 === 1), [items]);
  const place = (p: Plant, m: Matrix4) => { const s = 0.5 + p.s * 0.8; m.compose(new Vector3(p.x, p.y, p.z), new Quaternion().setFromAxisAngle(up, p.r * 6.28), new Vector3(s, s * 0.8, s)); };
  return (<><Instanced geometry={gA} material={leafMat} items={a} place={place} /><Instanced geometry={gB} material={leafMat} items={b} place={place} /></>);
}

export function Frangipani({ items }: { items: Plant[] }) {
  const g = useMemo(() => makeFrangipani(7), []);
  const place = (p: Plant, m: Matrix4) => { const s = 1.4 + p.s * 0.9; m.compose(new Vector3(p.x, p.y, p.z), new Quaternion().setFromAxisAngle(up, p.r * 6.28), new Vector3(s, s, s)); };
  return <Instanced geometry={g} material={leafMat} items={items} place={place} />;
}
