// Склейка мешей упрощённой копии дома по материалу: у модели Revit 30–40 мешей, у каждого свой клон материала с теми же
// параметрами. Для дальних уровней детализации (без теней и коллизий) это лишние вызовы отрисовки: 11 домов × 36 мешей.
// Меши с одинаковыми ролью, текстурой и прозрачностью объединяются в один (геометрия — в координатах корня). Цвет
// материала переносится в вершины: в Revit у каждого меша свой цвет, без этого склеивать почти нечего (42 → 37).
import { BufferAttribute, BufferGeometry, Box3, Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Атрибут в Float32 без нормализации (модели сжаты meshopt: позиции и UV квантованы в Int16). */
function f32(a: BufferAttribute, size: number): BufferAttribute {
  const out = new Float32Array(a.count * size);
  for (let i = 0; i < a.count; i++) { out[i * size] = a.getX(i); out[i * size + 1] = a.getY(i); if (size > 2) out[i * size + 2] = a.getZ(i); }
  return new BufferAttribute(out, size);
}

/** Возвращает число мешей до и после. Крупные меши (> maxSize м — площадка участка) не трогаются: их режет keepInside. */
export function mergeByMaterial(root: Object3D, maxSize = 32): [number, number] {
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert();
  const groups = new Map<string, Mesh[]>(); const box = new Box3(), sz = new Vector3(); let before = 0;
  root.traverse((o) => {
    const m = o as Mesh; if (!m.isMesh || Array.isArray(m.material) || !m.geometry.getAttribute('position')) return; before++;
    box.setFromObject(m).getSize(sz); if (Math.max(sz.x, sz.z) > maxSize) return;
    const mat = m.material as MeshStandardMaterial; const map = mat.map;
    const key = [m.userData.role, m.userData.curtain ? 'c' : '', mat.type, map ? (map.source?.uuid ?? map.uuid) + '@' + map.repeat.x.toFixed(3) + ',' + map.repeat.y.toFixed(3) : '', mat.normalMap ? 'n' : '', mat.transparent ? mat.opacity.toFixed(2) : '1', mat.side, mat.roughness.toFixed(1), m.renderOrder, m.visible ? 1 : 0, mat.vertexColors ? 'vc' : '', mat.emissive && mat.emissive.getHex() ? mat.emissive.getHexString() : ''].join('|');
    const list = groups.get(key); if (list) list.push(m); else groups.set(key, [m]);
  });
  let after = before;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const mat = list[0].material as MeshStandardMaterial; const needUv = !!(mat.map || mat.normalMap) && list.every((m) => !!m.geometry.getAttribute('uv'));
    const indexed = list.every((m) => !!m.geometry.index); const parts: BufferGeometry[] = [];
    for (const m of list) {
      const src = indexed ? m.geometry : m.geometry.index ? m.geometry.toNonIndexed() : m.geometry; const g = new BufferGeometry();
      g.setAttribute('position', f32(src.getAttribute('position') as BufferAttribute, 3));
      const n = src.getAttribute('normal') as BufferAttribute | undefined; if (n) g.setAttribute('normal', f32(n, 3));
      if (needUv) g.setAttribute('uv', f32(src.getAttribute('uv') as BufferAttribute, 2));
      if (indexed) g.setIndex(src.index!.clone());
      g.applyMatrix4(inv.clone().multiply(m.matrixWorld)); if (!n) g.computeVertexNormals(); else g.normalizeNormals();
      { const c = (m.material as MeshStandardMaterial).color; const cnt = g.getAttribute('position').count; const col = new Float32Array(cnt * 3); for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; } g.setAttribute('color', new BufferAttribute(col, 3)); }
      parts.push(g);
    }
    const merged = mergeGeometries(parts, false); for (const p of parts) p.dispose(); if (!merged) continue;
    mat.color.set(0xffffff); mat.vertexColors = true; mat.needsUpdate = true; // материал первого меша (не клон: при клонировании теряется правка шейдера отделки)
    const nm = new Mesh(merged, mat); nm.name = 'merged-' + String(list[0].userData.role ?? ''); nm.userData = { ...list[0].userData, merged: true };
    nm.castShadow = list[0].castShadow; nm.receiveShadow = list[0].receiveShadow; nm.renderOrder = list[0].renderOrder; nm.visible = list[0].visible;
    for (const m of list) m.parent?.remove(m); root.add(nm); after -= list.length - 1;
  }
  return [before, after];
}
