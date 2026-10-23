// Сборка единого коллайдера (BVH) из всех мешей виллы для капсульного контроллера.
import { BufferAttribute, BufferGeometry, Box3, DoubleSide, Float32BufferAttribute, Mesh, Object3D, Ray, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';

export type Collider = { geometry: BufferGeometry; bvh: MeshBVH };

export const colliderStore: { current: Collider | null } = { current: null };
// отладка из консоли: __collider.current, __collider.groundAt(x, z) -> y поверхности или null
(window as unknown as { __collider: unknown }).__collider = Object.assign(colliderStore, {
  groundAt(x: number, z: number, fromY = 50) {
    const c = colliderStore.current; if (!c) return 'no collider';
    const hit = c.bvh.raycastFirst(new Ray(new Vector3(x, fromY, z), new Vector3(0, -1, 0)), DoubleSide);
    return hit ? +(fromY - hit.distance).toFixed(3) : null;
  },
  hitsAt(x: number, z: number, fromY = 60) {
    const c = colliderStore.current; if (!c) return 'no collider';
    const hits = c.bvh.raycast(new Ray(new Vector3(x, fromY, z), new Vector3(0, -1, 0)), DoubleSide);
    return [...new Set(hits.map((h) => +(fromY - h.distance).toFixed(2)))].sort((a, b) => b - a);
  },
  bbox() { const c = colliderStore.current; if (!c) return null; const b = new Box3(); c.bvh.getBoundingBox(b); return [b.min.toArray(), b.max.toArray()]; },
  tris() { const c = colliderStore.current; return c ? c.geometry.getAttribute('position').count / 3 : 0; },
});

export type PassageBox = { min: [number, number, number]; max: [number, number, number] };

/** Объединяет геометрию всех мешей (кроме userData.noCollide) в мировых координатах и строит BVH.
 *  Треугольники, центр которых попадает в passages (проёмы закрытых дверей), в коллайдер не попадают. */
export function buildCollider(root: Object3D, passages: PassageBox[] = []): Collider | null {
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || m.userData.noCollide || !m.geometry.attributes.position) return;
    const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    // Квантованные (Int16/Int8, KHR_mesh_quantization) позиции переводим в Float32:
    // иначе applyMatrix4 обрежет координаты до целых чисел.
    const pos = src.getAttribute('position') as BufferAttribute;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = pos.getY(i); arr[i * 3 + 2] = pos.getZ(i); }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(arr, 3));
    g.applyMatrix4(m.matrixWorld);
    if (passages.length) {
      const a = g.getAttribute('position') as BufferAttribute;
      const keep: number[] = [];
      for (let t = 0; t < a.count / 3; t++) {
        const cx = (a.getX(t * 3) + a.getX(t * 3 + 1) + a.getX(t * 3 + 2)) / 3;
        const cy = (a.getY(t * 3) + a.getY(t * 3 + 1) + a.getY(t * 3 + 2)) / 3;
        const cz = (a.getZ(t * 3) + a.getZ(t * 3 + 1) + a.getZ(t * 3 + 2)) / 3;
        const inside = passages.some((p) => cx >= p.min[0] && cx <= p.max[0] && cy >= p.min[1] && cy <= p.max[1] && cz >= p.min[2] && cz <= p.max[2]);
        if (!inside) for (let k = 0; k < 3; k++) keep.push(a.getX(t * 3 + k), a.getY(t * 3 + k), a.getZ(t * 3 + k));
      }
      g.setAttribute('position', new Float32BufferAttribute(keep, 3));
    }
    parts.push(g);
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  if (!merged) return null;
  const bvh = new MeshBVH(merged);
  return { geometry: merged, bvh };
}
