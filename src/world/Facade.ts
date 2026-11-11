// Отделка фасадов. Стены вилл в Revit — крупные меши, где наружные и внутренние грани под одним материалом, поэтому
// фасад нельзя отделить заменой материала, а пометка целых треугольников даёт диагональные границы (стена из двух
// треугольников, часть которой внутри дома) и красит внутреннюю грань наружной стены. Фасад определяется в каждой точке
// шейдером отделки (textures.ts, applyInteriorFinish): мировая точка переводится в план ближайшего дома, и по маске
// «внутри дома» своего этажа проверяется точка в 0,3 м перед гранью. Здесь — палитра, маски по типам вилл и список домов.
import { ClampToEdgeWrapping, DataTexture, LinearFilter, type Matrix4, RGBAFormat, UnsignedByteType } from 'three';
import type { IndoorMask } from './Indoor';
import { facadeHouses, makeFacadeMask, type FacadeFinish, type FacadeMask } from './textures';

type Tones = Omit<FacadeFinish, 'plinth' | 'mask'>;
/** Палитра по типам вилл: два близких оттенка (соседние дома одного типа чередуются) и тон верхних этажей. */
export const FACADE_TONES: Record<string, Tones> = {
  villa1: { tones: ['#e6d3b3', '#ddc7a4'], plinthH: 0.55 },
  villa21: { tones: ['#e7d6ba', '#e0ccae'], upper: '#f4eee2', upperFrom: 3.05, plinthH: 0.55 },
  villa22: { tones: ['#dccdb6', '#e4d3b8'], upper: '#f4eee2', upperFrom: 3.05, plinthH: 0.55 },
  villa3: { tones: ['#cfc7b7', '#cfc7b7'], plinthH: 0.55 },
};

const masks: Record<string, FacadeMask> = {};
/** Сведения для проверки smoke: число уровней маски по типам вилл и число домов, переданных шейдеру. */
export const facadeStats: { masks: Record<string, number>; houses: number } = { masks: {}, houses: 0 };

/** Параметры отделки фасада для материалов модели (маска заполнится позже, когда разобран план). */
export function facadeOptions(model: string): Omit<FacadeFinish, 'plinth'> | undefined {
  const t = FACADE_TONES[model]; if (!t) return undefined;
  return { ...t, mask: masks[model] ??= makeFacadeMask() };
}

/** Маска плана → текстура: канал = уровень (до четырёх, снизу вверх), 1 пиксель = клетка 0,1 м. */
export function setFacadeMask(model: string, m: IndoorMask) {
  const fm = masks[model] ??= makeFacadeMask(); const lv = m.levels.slice(0, 4); if (!lv.length) return;
  const px = new Uint8Array(m.nx * m.nz * 4);
  lv.forEach((l, c) => { for (let k = 0; k < m.nx * m.nz; k++) if (l.data[k]) px[k * 4 + c] = 255; });
  const t = new DataTexture(px, m.nx, m.nz, RGBAFormat, UnsignedByteType); t.magFilter = t.minFilter = LinearFilter; t.wrapS = t.wrapT = ClampToEdgeWrapping; t.generateMipmaps = false; t.needsUpdate = true;
  fm.uMask.value?.dispose(); fm.uMask.value = t;
  fm.uMaskRect.value.set(m.x0 - m.step / 2, m.z0 - m.step / 2, 1 / (m.nx * m.step), 1 / (m.nz * m.step));
  fm.uLevels.value.set(lv[0].level, lv[1]?.level ?? 1e6, lv[2]?.level ?? 1e6, lv[3]?.level ?? 1e6);
  fm.uMaskTop.value = lv[lv.length - 1].level + 3.4; // выше верхнего этажа (надстройки и парапеты кровли) всё наружное
  fm.uMaskOn.value = 1; facadeStats.masks[model] = lv.length;
}

/** Дома комплекса: матрица «мир → план дома» (поворот вокруг вертикали и сдвиг), пятно в плане, оттенок (дома одного типа чередуются). */
export function setFacadeHouses(houses: { matrix: Matrix4; fp: number[]; model: string }[]) {
  const seen: Record<string, number> = {}; facadeStats.houses = Math.min(houses.length, 16);
  for (let i = 0; i < 16; i++) {
    const h = houses[i]; if (!h) { facadeHouses.r.value[i].set(1e6, 1e6, 1e6, 1e6); continue; }
    const e = h.matrix.clone().invert().elements; const k = seen[h.model] = (seen[h.model] ?? -1) + 1;
    facadeHouses.a.value[i].set(e[0], e[8], e[12], k % 2); facadeHouses.b.value[i].set(e[2], e[10], e[14], e[13]);
    facadeHouses.r.value[i].set(h.fp[0], h.fp[1], h.fp[2], h.fp[3]);
  }
}
