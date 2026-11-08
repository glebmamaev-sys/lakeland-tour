// Растения из glTF-моделей (CC0 Kenney Nature Kit, public/models/nature/*.glb): инстансирование по мешам модели —
// у каждого меша (ствол, листва…) свой InstancedMesh с теми же матрицами экземпляров × матрица меша внутри модели.
// Высота модели нормируется: place() даёт позицию/поворот/желаемую высоту в метрах.
import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { Box3, Color, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three';
import type { Plant } from './Vegetation';

export type Placement = { x: number; y: number; z: number; yaw: number; height: number; lean?: number; leanDir?: number };
export type ModelPlantsProps = { url: string; items: Plant[]; place: (p: Plant) => Placement; castShadow?: boolean };

const up = new Vector3(0, 1, 0);

export function ModelPlants({ url, items, place, castShadow = true }: ModelPlantsProps) {
  const gltf = useGLTF(url) as unknown as { scene: Object3D };
  const parts = useMemo(() => {
    gltf.scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(gltf.scene); const h = Math.max(0.01, box.max.y - box.min.y); const base = box.min.y;
    const list: { geometry: Mesh['geometry']; material: MeshStandardMaterial; local: Matrix4 }[] = [];
    gltf.scene.traverse((o) => {
      const m = o as Mesh; if (!m.isMesh) return;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as MeshStandardMaterial;
      // палитра Kenney (бирюзовая листва, unlit, metalness 1) → наши тона: листва зелёная, кора коричневая, цветы как есть
      const name = (mat.name || '').toLowerCase(); const src = mat.color ? mat.color.clone() : new Color('#888');
      // текстурные модели (Quaternius): карта цвета, нормали, листва с вырезом по альфе; палитровые (Kenney) — перекрас
      const textured = !!mat.map;
      const color = textured ? new Color('#ffffff') : /leaf|grass|foliage/.test(name) ? new Color('#4f8a3c') : /wood|bark|trunk/.test(name) ? new Color('#7a5a3c') : src;
      const mm = new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: DoubleSide, map: mat.map ?? null, normalMap: mat.normalMap ?? null });
      if (textured && /leaf|leaves|flower|plant/.test(name)) { mm.alphaTest = 0.5; mm.transparent = false; }
      list.push({ geometry: m.geometry, material: mm, local: m.matrixWorld.clone() });
    });
    return { list, h, base };
  }, [gltf]);
  const refs = useRef<(InstancedMesh | null)[]>([]);
  useEffect(() => {
    const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3(), tilt = new Quaternion();
    items.forEach((p, i) => {
      const pl = place(p); const s = pl.height / parts.h;
      q.setFromAxisAngle(up, pl.yaw);
      if (pl.lean) { tilt.setFromAxisAngle(new Vector3(Math.cos(pl.leanDir ?? 0), 0, Math.sin(pl.leanDir ?? 0)), pl.lean); q.premultiply(tilt); }
      m.compose(pos.set(pl.x, pl.y - parts.base * s, pl.z), q, scl.set(s, s, s));
      parts.list.forEach((part, k) => { const im = refs.current[k]; if (!im) return; im.setMatrixAt(i, new Matrix4().multiplyMatrices(m, part.local)); });
    });
    for (const im of refs.current) { if (!im) continue; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); }
  }, [items, place, parts]);
  if (!items.length) return null;
  return (
    <>
      {parts.list.map((part, k) => (
        <instancedMesh key={k} ref={(el) => { refs.current[k] = el; }} args={[part.geometry, part.material, items.length]} castShadow={castShadow} receiveShadow frustumCulled={false} />
      ))}
    </>
  );
}
