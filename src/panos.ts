// Описание панорамных туров. yaw — градусы от центра картинки (вправо положительно),
// pitch — градусы вверх. Для Twinmotion 3D-панорам stereo: 'tb' (левый глаз сверху).
export type PanoLink = { to: string; yaw: number; pitch?: number; label?: string };
export type Pano = {
  id: string;
  title: string;
  src: string;
  hi?: string; // та же панорама в 8К: догружается на компьютере после обычной
  stereo?: 'tb';
  startYaw?: number; // куда смотрим при входе, градусы от центра картинки
  links: PanoLink[];
};

// Панорамы 360°: болванки из тура (Capture.tsx, шот-лист public/shotlist.json) → FLUX 3 в Higgsfield, 26.10.2026.
// Переход между панорамами — кнопками внизу экрана; точки-переходы внутри панорам не ставим
// (нейросеть не гарантирует точное положение дверей). Художественная визуализация.
// Панорамы, пересобранные по граням в 8К (с 16.11.2026): у них есть файл <имя>_8k.jpg
const HI = new Set(['villa1_p1_pool', 'villa1_p2_covered_terrace', 'villa1_p3_kitchen', 'villa1_p4_bedroom', 'villa1_p5_roof']);
// Куда смотрим при входе: бассейн — на террасу с диваном и фасад; крытая терраса — на лагуну; кухня — на стол и гостиную;
// спальня — на кровать; крыша — сад с дорожкой слева, лагуна справа
const START: Record<string, number> = { villa1_p1_pool: 45, villa1_p2_covered_terrace: -95, villa1_p3_kitchen: -100, villa1_p4_bedroom: 84, villa1_p5_roof: -50 };
const tour = (villa: string, items: [string, string][]): Pano[] =>
  items.map(([id, title]) => ({ id, title, src: `panos/${villa}_${id}.jpg`, ...(HI.has(`${villa}_${id}`) ? { hi: `panos/${villa}_${id}_8k.jpg` } : {}), ...(`${villa}_${id}` in START ? { startYaw: START[`${villa}_${id}`] } : {}), links: [] }));

export const PANO_TOURS: Record<string, Pano[]> = {
  villa1: [{ id: 'complex', title: 'Весь комплекс с дрона', src: 'panos/complex_p1_drone.jpg', links: [] }, ...tour('villa1', [['p1_pool', 'Терраса у бассейна'], ['p2_covered_terrace', 'Крытая терраса'], ['p3_kitchen', 'Кухня-гостиная'], ['p4_bedroom', 'Спальня'], ['p5_roof', 'Терраса на крыше']])],
  villa21: tour('villa21', [['p1_pool', 'Терраса у бассейна'], ['p2_living', 'Гостиная'], ['p3_bedroom', 'Спальня'], ['p4_terrace_l2', 'Терраса 2 этажа']]),
  villa22: tour('villa22', [['p1_pool', 'Терраса у бассейна'], ['p2_living', 'Гостиная'], ['p3_bedroom', 'Спальня'], ['p4_terrace_l2', 'Терраса 2 этажа']]),
  villa3: tour('villa3', [['p1_pool', 'Сад и бассейн'], ['p2_living', 'Гостиная'], ['p3_bedroom', 'Спальня'], ['p4_terrace_upper', 'Верхняя терраса']]),
};
