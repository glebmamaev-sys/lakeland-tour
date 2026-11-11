// Отделка фасадов. Белая оболочка каждой виллы в Revit — один меш на 150–280 тыс. треугольников (стены снаружи и
// внутри, плиты, парапеты) с одним материалом, поэтому фасад нельзя отделить заменой материала. Наружные грани находятся
// по планам этажей: вертикальная грань — фасад, если точка в 0,3 м перед ней лежит вне маски «внутри дома» своего уровня
// (уровень — по высоте центра треугольника: стена второго этажа над комнатой первого остаётся наружной). В вершины
// пишется атрибут aFac (байты): x — фасад или нет, y — высота над полом нижнего уровня в этой точке плана (для цоколя).
// Дальше работает шейдер отделки (textures.ts, applyInteriorFinish): каменный цоколь и тон штукатурки по типу виллы.
import { BufferAttribute, type Mesh, type MeshStandardMaterial, type Object3D, Vector3 } from 'three';
import type { IndoorMask } from './Indoor';
import { facadeHouses, type FacadeFinish } from './textures';

/** Палитра по типам вилл: два близких оттенка (соседние дома одного типа чередуются) и тон верхних этажей. */
export const FACADE_TONES: Record<string, Omit<FacadeFinish, 'plinth'>> = {
  villa1: { tones: ['#e6d3b3', '#ddc7a4'], plinthH: 0.55 },
  villa21: { tones: ['#e7d6ba', '#e0ccae'], upper: '#f4eee2', upperFrom: 3.05, plinthH: 0.55 },
  villa22: { tones: ['#dccdb6', '#e4d3b8'], upper: '#f4eee2', upperFrom: 3.05, plinthH: 0.55 },
  villa3: { tones: ['#cfc7b7', '#cfc7b7'], plinthH: 0.55 },
};

/** Число размеченных фасадных вершин по типам вилл (полная модель) — для проверки smoke. */
export const facadeStats: Record<string, number> = {};

const H_MIN = -2, H_RANGE = 10; // высота над полом кодируется байтом: −2…+8 м, шаг 4 см
const encH = (h: number) => Math.max(0, Math.min(255, Math.round((h - H_MIN) / H_RANGE * 255)));

/** Размечает наружные грани мешей с шейдером отделки. root — в координатах плана (matrixWorld обновлена). Возвращает число фасадных вершин. */
export function markFacade(root: Object3D, mask: IndoorMask): number {
  const at = (data: Uint8Array, x: number, z: number) => { const i = Math.round((x - mask.x0) / mask.step), j = Math.round((z - mask.z0) / mask.step); return i >= 0 && j >= 0 && i < mask.nx && j < mask.nz && data[j * mask.nx + i] === 1; };
  const floorAt = (x: number, z: number) => { const i = Math.round((x - mask.x0) / mask.step), j = Math.round((z - mask.z0) / mask.step); if (i < 0 || j < 0 || i >= mask.nx || j >= mask.nz) return Infinity; return mask.floor[j * mask.nx + i]; };
  // выше верхнего этажа (надстройки и парапеты кровли) маски нет — всё наружное
  const empty = new Uint8Array(mask.data.length); const top = mask.levels.length ? mask.levels[mask.levels.length - 1].level + 3.4 : Infinity;
  const levelData = (y: number) => { if (y > top) return empty; let d = mask.levels[0]?.data ?? mask.data; for (const l of mask.levels) if (l.level <= y) d = l.data; return d; };
  let marked = 0; const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), ab = new Vector3(), ac = new Vector3(), ctr = new Vector3(); const P = [a, b, c];
  root.traverse((o) => {
    const m = o as Mesh; if (!m.isMesh || Array.isArray(m.material) || !(m.material as MeshStandardMaterial).userData.finish) return;
    if (m.geometry.getAttribute('aFac')) return;
    // небольшие меши (стены вилл 2.x и 3) — без общих вершин: метка у треугольника своя, без перетекания на соседние грани
    if (m.geometry.index && m.geometry.getAttribute('position').count < 60000) m.geometry = m.geometry.toNonIndexed();
    const g = m.geometry; const pos = g.getAttribute('position'); if (!pos) return;
    const out = new Uint8Array(pos.count * 2); const idx = g.index; const tris = (idx ? idx.count : pos.count) / 3;
    for (let t = 0; t < tris; t++) {
      const ids = [0, 1, 2].map((k) => idx ? idx.getX(t * 3 + k) : t * 3 + k);
      for (let k = 0; k < 3; k++) P[k].fromBufferAttribute(pos, ids[k]).applyMatrix4(m.matrixWorld);
      n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)); const len = n.length(); if (len < 1e-9) continue; n.divideScalar(len);
      if (Math.abs(n.y) > 0.5) continue;
      const hl = Math.hypot(n.x, n.z); const nx = n.x / hl, nz = n.z / hl;
      ctr.copy(a).add(b).add(c).divideScalar(3); const data = levelData(ctr.y - 0.05);
      // решение на весь треугольник по большинству из 7 проб (у вершин, на серединах сторон, в центре): грани двусторонние,
      // фасад — если хотя бы с одной стороны улица; обе стороны внутри дома — перегородка или внутренняя грань стены
      let ext = 0, base = Infinity;
      for (let q = 0; q < 7; q++) {
        let px: number, pz: number;
        if (q < 3) { px = P[q].x + (ctr.x - P[q].x) * 0.15; pz = P[q].z + (ctr.z - P[q].z) * 0.15; }
        else if (q < 6) { const u = P[q - 3], v = P[(q - 2) % 3]; px = (u.x + v.x) / 2 * 0.85 + ctr.x * 0.15; pz = (u.z + v.z) / 2 * 0.85 + ctr.z * 0.15; }
        else { px = ctr.x; pz = ctr.z; }
        if (!(at(data, px + nx * 0.3, pz + nz * 0.3) && at(data, px - nx * 0.3, pz - nz * 0.3))) ext++;
        base = Math.min(base, floorAt(px + nx * 0.3, pz + nz * 0.3), floorAt(px - nx * 0.3, pz - nz * 0.3), floorAt(px, pz));
      }
      if (ext < 5) continue;
      // пол для цоколя: нижний уровень дома в этой точке плана. Стена начинается ниже него больше чем на 0,5 м (столб под
      // нависающим этажом, стенка лестницы по склону) — берём уровень, на котором она стоит; стоит ещё ниже (навесы у
      // бассейна, подпорные части) — цоколя нет
      const minY = Math.min(a.y, b.y, c.y);
      if (Number.isFinite(base) && minY < base - 0.5) { let lv = mask.levels[0]?.level ?? base; for (const l of mask.levels) if (l.level <= minY + 0.5) lv = l.level; base = lv; }
      const plinth = Number.isFinite(base) && minY >= base - 1.8;
      for (let k = 0; k < 3; k++) { const o2 = ids[k] * 2; if (!out[o2]) marked++; out[o2] = 255; out[o2 + 1] = plinth ? encH(P[k].y - base) : 255; }
    }
    g.setAttribute('aFac', new BufferAttribute(out, 2, true));
  });
  return marked;
}

/** Оттенки домов комплекса: дома одного типа чередуются по порядку вдоль ряда. centers — центры пятен в мировых координатах. */
export function setFacadeHouses(centers: { x: number; z: number; model: string }[]) {
  const seen: Record<string, number> = {};
  facadeHouses.value.forEach((v, i) => { const h = centers[i]; if (!h) { v.set(1e6, 1e6, 0, 0); return; } const k = seen[h.model] = (seen[h.model] ?? -1) + 1; v.set(h.x, h.z, k % 2, 0); });
}
