// Описание панорамных туров. yaw — градусы от центра картинки (вправо положительно),
// pitch — градусы вверх. Для Twinmotion 3D-панорам stereo: 'tb' (левый глаз сверху).
export type PanoLink = { to: string; yaw: number; pitch?: number; label?: string };
export type Pano = {
  id: string;
  title: string;
  src: string;
  stereo?: 'tb';
  startYaw?: number; // куда смотрим при входе, градусы от центра картинки
  links: PanoLink[];
};

// Панорамы 360°: болванки из тура (Capture.tsx, шот-лист public/shotlist.json) → FLUX 3 в Higgsfield, 26.10.2026.
// Переход между панорамами — кнопками внизу экрана; точки-переходы внутри панорам не ставим
// (нейросеть не гарантирует точное положение дверей). Художественная визуализация.
const tour = (villa: string, items: [string, string][]): Pano[] =>
  items.map(([id, title]) => ({ id, title, src: `panos/${villa}_${id}.jpg`, links: [] }));

export const PANO_TOURS: Record<string, Pano[]> = {
  villa1: [{ id: 'complex', title: 'Весь комплекс с дрона', src: 'panos/complex_p1_drone.jpg', links: [] }, ...tour('villa1', [['p1_pool', 'Терраса у бассейна'], ['p2_covered_terrace', 'Крытая терраса'], ['p3_kitchen', 'Кухня-гостиная'], ['p4_bedroom', 'Спальня'], ['p5_roof', 'Терраса на крыше']])],
  villa21: tour('villa21', [['p1_pool', 'Терраса у бассейна'], ['p2_living', 'Гостиная'], ['p3_bedroom', 'Спальня'], ['p4_terrace_l2', 'Терраса 2 этажа']]),
  villa22: tour('villa22', [['p1_pool', 'Терраса у бассейна'], ['p2_living', 'Гостиная'], ['p3_bedroom', 'Спальня'], ['p4_terrace_l2', 'Терраса 2 этажа']]),
  villa3: tour('villa3', [['p1_pool', 'Сад и бассейн'], ['p2_living', 'Гостиная'], ['p3_bedroom', 'Спальня'], ['p4_terrace_upper', 'Верхняя терраса']]),
};
