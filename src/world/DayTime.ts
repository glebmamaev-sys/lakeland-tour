// Время суток комплекса: день или вечер. Вечером солнце низкое и тёплое, небо и рассеянный свет приглушены, а светятся
// окна, потолки, абажуры, вода бассейнов и светильники вдоль дорожек. Источников света не прибавляется: всё на
// излучении материалов (плюс bloom), поэтому вечер не дороже дня. k плавно идёт 0 → 1 за ~1,5 с.
export const day = { evening: false, k: 0, listeners: new Set<(v: boolean) => void>() };
/** Общая uniform для шейдеров отделки: одна ссылка на всех, значение меняется на месте. */
export const uEve = { value: 0 };
const regs: ((k: number) => void)[] = [];
/** Подписать материал или объект на смену времени суток; вызывается сразу с текущим k. */
export function onEve(apply: (k: number) => void) { regs.push(apply); apply(day.k); }
export function applyEve(k: number) { day.k = k; uEve.value = k; for (const r of regs) r(k); }
export function setEvening(v: boolean) { if (day.evening === v) return; day.evening = v; day.listeners.forEach((l) => l(v)); }
