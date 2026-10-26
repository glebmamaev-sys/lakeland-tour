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

export const PANO_TOURS: Record<string, Pano[]> = {
  villa1: [
    // Первая настоящая панорама: болванка из тура (клавиша P на террасе у бассейна) → FLUX 3, 26.10.2026
    { id: 'terrace_ai', title: 'Терраса у бассейна · AI-рендер', src: 'panos/villa1_06_terrace_ai.jpg', startYaw: 60,
      links: [{ to: 'entrance', yaw: 110, label: 'Тестовые панорамы' }] },
    { id: 'entrance', title: 'Вход', src: 'panos/villa1_01_entrance.jpg', startYaw: 0,
      links: [{ to: 'living', yaw: 0 }, { to: 'terrace', yaw: 150 }] },
    { id: 'living', title: 'Гостиная', src: 'panos/villa1_02_living_3d.jpg', stereo: 'tb', startYaw: 0,
      links: [{ to: 'entrance', yaw: 180 }, { to: 'kitchen', yaw: 60 }, { to: 'terrace', yaw: -70 }] },
    { id: 'kitchen', title: 'Кухня-столовая', src: 'panos/villa1_03_kitchen.jpg',
      links: [{ to: 'living', yaw: -120 }, { to: 'terrace', yaw: 20 }] },
    { id: 'bedroom', title: 'Спальня 1', src: 'panos/villa1_04_bedroom.jpg',
      links: [{ to: 'living', yaw: 180 }] },
    { id: 'terrace', title: 'Терраса, бассейн', src: 'panos/villa1_05_terrace.jpg',
      links: [{ to: 'living', yaw: 180 }, { to: 'kitchen', yaw: -150 }, { to: 'bedroom', yaw: 100 }, { to: 'terrace_ai', yaw: 0, label: 'AI-рендер' }] },
  ],
};
