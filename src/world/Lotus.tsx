// Лотосы (Nelumbo nucifera) у берега лагуны Мавелла: куртины листьев — плавающие и приподнятые на черешках, —
// раскрытые розовые и белые цветы на стеблях 0,3–0,8 м, бутоны. Инстансинг: листья, черешки, цветы двух
// окрасок, бутоны. Листья чуть вогнутые (край приподнят), окраска листа и цветка варьирует по экземплярам.
import { useEffect, useMemo, useRef } from 'react';
import { Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, LatheGeometry, Matrix4, MeshStandardMaterial, Quaternion, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type LotusItem = { x: number; z: number; r: number; raised: number; flower: 0 | 1 | 2 | 3; stalk: number; yaw: number; tint: number }; // flower: 0 нет, 1 розовый, 2 белый, 3 бутон

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Расстановка: куртины в полосе воды 1–9 м от берега (сетка участка), отдельные листья между ними. */
export function placeLotuses(g: { x0: number; z0: number; step: number; nx: number; nz: number }, water: Uint8Array, seed = 41): LotusItem[] {
  const { x0, z0, step, nx, nz } = g; const N = nx * nz;
  // расстояние до берега по воде (BFS от клеток суши)
  const dist = new Int32Array(N).fill(-1); const q: number[] = [];
  for (let k = 0; k < N; k++) if (!water[k]) { dist[k] = 0; q.push(k); }
  for (let qi = 0; qi < q.length; qi++) { const k = q[qi], i = k % nx; for (const n of [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, k - nx, k + nx]) { if (n < 0 || n >= N || dist[n] >= 0) continue; dist[n] = dist[k] + 1; q.push(n); } }
  const shoreD = (x: number, z: number) => { const i = Math.round((x - x0) / step), j = Math.round((z - z0) / step); if (i < 0 || j < 0 || i >= nx || j >= nz) return -1; const k = j * nx + i; return water[k] ? dist[k] * step : -1; };
  const cand: number[] = []; for (let k = 0; k < N; k++) if (water[k] && dist[k] * step >= 1 && dist[k] * step <= 9) cand.push(k);
  const r = rng(seed); const items: LotusItem[] = []; const seeds: [number, number][] = [];
  if (!cand.length) return items;
  for (let t = 0; t < 1200 && seeds.length < 170; t++) {
    const k = cand[Math.floor(r() * cand.length)]; const x = x0 + (k % nx) * step, z = z0 + Math.floor(k / nx) * step;
    if (seeds.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 3.8)) continue;
    seeds.push([x, z]);
    const R = 1.8 + r() * 2.6, n = Math.round(14 + r() * 26);
    for (let m = 0; m < n; m++) {
      const a = r() * Math.PI * 2, d = R * Math.sqrt(r()); const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (shoreD(px, pz) < 0.6) continue;
      const fl = r(); const flower: LotusItem['flower'] = fl < 0.68 ? 0 : fl < 0.86 ? 1 : fl < 0.94 ? 2 : 3;
      items.push({ x: px, z: pz, r: 0.14 + r() * 0.2, raised: r() < 0.4 ? 0.12 + r() * 0.4 : 0, flower, stalk: 0.3 + r() * 0.5, yaw: r() * Math.PI * 2, tint: r() });
    }
  }
  // одиночные листья между куртинами
  for (let t = 0; t < 500; t++) {
    const k = cand[Math.floor(r() * cand.length)]; const x = x0 + (k % nx) * step + (r() - 0.5) * step, z = z0 + Math.floor(k / nx) * step + (r() - 0.5) * step;
    if (r() > 0.35) continue;
    items.push({ x, z, r: 0.12 + r() * 0.16, raised: 0, flower: r() < 0.08 ? 1 : 0, stalk: 0.3 + r() * 0.3, yaw: r() * Math.PI * 2, tint: r() });
  }
  return items;
}

function petalGeom(len: number, wid: number, tilt: number, around: number, tipCol: Color, baseCol: Color): BufferGeometry {
  const s = new Shape(); s.moveTo(0, 0); s.quadraticCurveTo(wid * 0.7, len * 0.35, 0, len); s.quadraticCurveTo(-wid * 0.7, len * 0.35, 0, 0);
  const g = new ShapeGeometry(s, 4); const pos = g.getAttribute('position'); const col: number[] = [];
  for (let i = 0; i < pos.count; i++) { const t = pos.getY(i) / len; const c = baseCol.clone().lerp(tipCol, t * t); col.push(c.r, c.g, c.b); pos.setZ(i, -Math.pow(pos.getX(i) / (wid * 0.5), 2) * 0.012); } // слегка вогнут
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.rotateX(-Math.PI / 2 + tilt); g.rotateY(around); return g;
}
function flowerGeom(pink: boolean): BufferGeometry {
  const tip = new Color(pink ? '#e97ba8' : '#f3eef0'), base = new Color(pink ? '#fbe7ef' : '#fbf9f5');
  const parts: BufferGeometry[] = [];
  const ring = (n: number, len: number, wid: number, tilt: number, off: number) => { for (let i = 0; i < n; i++) parts.push(petalGeom(len, wid, tilt, off + (i / n) * Math.PI * 2, tip, base)); };
  ring(8, 0.11, 0.06, 1.15, 0); ring(7, 0.1, 0.055, 0.8, 0.4); ring(6, 0.085, 0.05, 0.45, 0.9);
  const rec = new CylinderGeometry(0.02, 0.012, 0.03, 8); rec.translate(0, 0.03, 0); // цветоложе
  const rc = new Color('#e8c23a'); const rcol: number[] = []; for (let i = 0; i < rec.getAttribute('position').count; i++) rcol.push(rc.r, rc.g, rc.b); rec.setAttribute('color', new Float32BufferAttribute(rcol, 3));
  const st = new CylinderGeometry(0.03, 0.028, 0.012, 10); st.translate(0, 0.02, 0); // тычинки — жёлтое кольцо
  const sc = new Color('#f1d35a'); const scol: number[] = []; for (let i = 0; i < st.getAttribute('position').count; i++) scol.push(sc.r, sc.g, sc.b); st.setAttribute('color', new Float32BufferAttribute(scol, 3));
  parts.push(rec, st);
  const strip = parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); q.deleteAttribute('normal'); return q; });
  const g = mergeGeometries(strip, false)!; g.computeVertexNormals(); return g;
}

const UP = new Vector3(0, 1, 0);

export function Lotuses({ items, level }: { items: LotusItem[]; level: number }) {
  const geo = useMemo(() => {
    const leaf = new LatheGeometry([new Vector2(0, 0), new Vector2(0.7, 0.02), new Vector2(1, 0.1)], 9); // 36 треугольников на лист (было 84): листьев почти три тысячи
    const stalk = new CylinderGeometry(0.011, 0.015, 1, 5); stalk.translate(0, 0.5, 0);
    const bud = new SphereGeometry(1, 8, 7); bud.scale(0.035, 0.06, 0.035); bud.translate(0, 0.04, 0);
    const bc: number[] = []; const bp = bud.getAttribute('position'); const b0 = new Color('#f6e6ee'), b1 = new Color('#e47aa6');
    for (let i = 0; i < bp.count; i++) { const c = b0.clone().lerp(b1, Math.max(0, bp.getY(i) / 0.1)); bc.push(c.r, c.g, c.b); } bud.setAttribute('color', new Float32BufferAttribute(bc, 3));
    return { leaf, stalk, bud, pink: flowerGeom(true), white: flowerGeom(false) };
  }, []);
  const mats = useMemo(() => ({
    leaf: new MeshStandardMaterial({ color: '#3e7a38', roughness: 0.75, side: DoubleSide }),
    stalk: new MeshStandardMaterial({ color: '#4f7f3a', roughness: 0.9 }),
    flower: new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: DoubleSide }),
  }), []);
  const leaves = useRef<InstancedMesh>(null), stalks = useRef<InstancedMesh>(null), pinks = useRef<InstancedMesh>(null), whites = useRef<InstancedMesh>(null), buds = useRef<InstancedMesh>(null);
  const counts = useMemo(() => ({
    stalks: items.filter((i) => i.raised > 0).length + items.filter((i) => i.flower > 0).length,
    pink: items.filter((i) => i.flower === 1).length, white: items.filter((i) => i.flower === 2).length, bud: items.filter((i) => i.flower === 3).length,
  }), [items]);
  useEffect(() => {
    const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), tilt = new Quaternion(), c = new Color();
    let ns = 0, np = 0, nw = 0, nb = 0;
    items.forEach((it, i) => {
      const L = leaves.current; if (!L) return;
      q.setFromAxisAngle(UP, it.yaw); if (it.raised > 0) { tilt.setFromAxisAngle(new Vector3(Math.cos(it.yaw), 0, Math.sin(it.yaw)), 0.25); q.multiply(tilt); }
      m.compose(p.set(it.x, level + 0.012 + it.raised, it.z), q, s.set(it.r, it.r, it.r)); L.setMatrixAt(i, m);
      L.setColorAt(i, c.set('#3e7a38').lerp(new Color('#6ea04a'), it.tint * 0.7).offsetHSL(0, 0, (it.tint - 0.5) * 0.06));
      if (it.raised > 0 && stalks.current) { m.compose(p.set(it.x, level - 0.2, it.z), q.identity(), s.set(1, it.raised + 0.2, 1)); stalks.current.setMatrixAt(ns++, m); }
      if (it.flower > 0) {
        const fx = it.x + Math.cos(it.yaw) * it.r * 0.6, fz = it.z + Math.sin(it.yaw) * it.r * 0.6;
        if (stalks.current) { m.compose(p.set(fx, level - 0.2, fz), q.identity(), s.set(1, it.stalk + 0.2, 1)); stalks.current.setMatrixAt(ns++, m); }
        q.setFromAxisAngle(UP, it.yaw * 1.7); const sc = 0.85 + it.tint * 0.4; m.compose(p.set(fx, level + it.stalk, fz), q, s.set(sc, sc, sc));
        if (it.flower === 1 && pinks.current) pinks.current.setMatrixAt(np++, m);
        else if (it.flower === 2 && whites.current) whites.current.setMatrixAt(nw++, m);
        else if (it.flower === 3 && buds.current) buds.current.setMatrixAt(nb++, m);
      }
    });
    for (const ref of [leaves, stalks, pinks, whites, buds]) { const im = ref.current; if (!im) continue; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); }
  }, [items, level, counts]);
  if (!items.length) return null;
  return (
    <group>
      <instancedMesh ref={leaves} args={[geo.leaf, mats.leaf, items.length]} frustumCulled={false} receiveShadow />
      {counts.stalks > 0 && <instancedMesh ref={stalks} args={[geo.stalk, mats.stalk, counts.stalks]} frustumCulled={false} />}
      {counts.pink > 0 && <instancedMesh ref={pinks} args={[geo.pink, mats.flower, counts.pink]} frustumCulled={false} />}
      {counts.white > 0 && <instancedMesh ref={whites} args={[geo.white, mats.flower, counts.white]} frustumCulled={false} />}
      {counts.bud > 0 && <instancedMesh ref={buds} args={[geo.bud, mats.flower, counts.bud]} frustumCulled={false} />}
    </group>
  );
}
