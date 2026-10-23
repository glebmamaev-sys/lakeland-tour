// Данные плана этажей (из DWG) для мини-карты и подписей комнат.
import { asset } from './assets';
// Координаты в мире three.js: x вправо, z — на юг (= −Revit y). Уровень — высота пола, м.
export type Seg = [number, number, number, number]; // x1, z1, x2, z2
export type Room = { name: string; x: number; z: number; area: number | null };
export type PlanLevel = {
  id: string;
  level: number;
  title: string;
  walls: Seg[];
  slabs: Seg[];
  stairs: Seg[];
  rails: Seg[];
  /** Заливки стен: полигоны, плоские массивы [x, z, x, z, …] */
  wallPolys?: number[][];
  rooms: Room[];
};
export type Plan = { villa: string; bbox: [number, number, number, number]; levels: PlanLevel[] };

const cache = new Map<string, Promise<Plan | null>>();

export function loadPlan(villaId: string): Promise<Plan | null> {
  if (!cache.has(villaId)) {
    cache.set(villaId, fetch(asset(`plans/${villaId}.json`)).then(async (r) => {
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || ct.includes('text/html')) return null;
      return (await r.json()) as Plan;
    }).catch(() => null));
  }
  return cache.get(villaId)!;
}

/** Уровень, на котором стоит игрок: ближайший уровень не выше ног + 1.2 м. */
export function levelForY(plan: Plan, y: number): PlanLevel {
  let best = plan.levels[0];
  for (const l of plan.levels) if (l.level <= y + 1.2 && l.level >= best.level) best = l;
  return best;
}

/** Русские названия комнат для подписей (имена в DWG английские). */
export const ROOM_RU: Record<string, string> = {
  'Kitchen': 'Кухня',
  'Bedroom': 'Спальня',
  'Toilet & Bathroom': 'Санузел',
  'Covered Terrace': 'Крытая терраса',
  'Open Terrace': 'Открытая терраса',
  'Swiming pool': 'Бассейн',
  'Swimming pool': 'Бассейн',
  'recreation area': 'Зона отдыха',
  'Technical room': 'Техническое помещение',
};
export const roomTitle = (name: string) => ROOM_RU[name] ?? name;
