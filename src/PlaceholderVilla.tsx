// Временная «коробка» виллы для отладки движка, пока нет модели из Revit.
// Два этажа 12 x 8 м, перегородки с проёмами, лестница, терраса, бассейн.
import { useMemo } from 'react';
import { DoubleSide } from 'three';

type BoxProps = { pos: [number, number, number]; size: [number, number, number]; color?: string; noCollide?: boolean; opacity?: number };

function B({ pos, size, color = '#d9d4c7', noCollide, opacity }: BoxProps) {
  return (
    <mesh position={pos} castShadow receiveShadow userData={{ noCollide }}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent={opacity !== undefined} opacity={opacity} side={DoubleSide} roughness={0.9} />
    </mesh>
  );
}

const T = 0.2; // толщина стен
const H = 3.0; // высота этажа
const L = 12; // длина по X
const W = 8; // ширина по Z

export function PlaceholderVilla() {
  const stairs = useMemo(() => {
    const steps: BoxProps[] = [];
    const rise = 0.167, tread = 0.28, n = 18;
    for (let i = 0; i < n; i++) {
      steps.push({ pos: [-5.2 + i * tread, ((i + 1) * rise) / 2, -2.5], size: [tread, (i + 1) * rise, 1.2], color: '#b9a98a' });
    }
    return steps;
  }, []);

  return (
    <group>
      {/* участок */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#7f9a63" roughness={1} />
      </mesh>
      {/* плита 1 этажа и перекрытие */}
      <B pos={[0, 0.1, 0]} size={[L + 6, 0.2, W + 6]} color="#cfc6b4" />
      {/* перекрытие 2 этажа из двух плит, между ними проём над лестницей (x -6..-0.3, z -4..-1.8) */}
      <B pos={[2.85, H + 0.1, 0]} size={[6.3, 0.2, W]} color="#e5e0d5" />
      <B pos={[-2.75, H + 0.1, 1.1]} size={[6.5, 0.2, 5.8]} color="#e5e0d5" />
      {/* наружные стены 1 этаж (с проёмами-витражами со стороны +Z) */}
      <B pos={[0, H / 2, -W / 2]} size={[L, H, T]} />
      <B pos={[-L / 2, H / 2, 0]} size={[T, H, W]} />
      <B pos={[L / 2, H / 2, 0]} size={[T, H, W]} />
      <B pos={[-4.5, H / 2, W / 2]} size={[3, H, T]} />
      <B pos={[4.5, H / 2, W / 2]} size={[3, H, T]} />
      <B pos={[0, H - 0.3, W / 2]} size={[6, 0.6, T]} />
      {/* витраж 1 этажа: стекло без коллизии (вход через него разрешён для теста) */}
      <B pos={[0, (H - 0.6) / 2, W / 2]} size={[6, H - 0.6, 0.02]} color="#9fd1e8" opacity={0.25} noCollide />
      {/* перегородка 1 этажа (z -1.8..1.6, не пересекает лестницу) с дверным проёмом у z≈3.4 */}
      <B pos={[-1, H / 2, -0.1]} size={[T, H, 3.4]} color="#efe9dc" />
      <B pos={[-1, H - 0.4, 3.4]} size={[T, 0.8, 1.2]} color="#efe9dc" />
      {/* 2 этаж: наружные стены */}
      <B pos={[0, H + H / 2, -W / 2]} size={[L, H, T]} />
      <B pos={[-L / 2, H + H / 2, 0]} size={[T, H, W]} />
      <B pos={[L / 2, H + H / 2, 0]} size={[T, H, W]} />
      <B pos={[-3.5, H + H / 2, W / 2]} size={[5, H, T]} />
      <B pos={[3.5, H + H / 2, W / 2]} size={[5, H, T]} />
      <B pos={[0, H + H - 0.3, W / 2]} size={[2, 0.6, T]} />
      <B pos={[0, H + (H - 0.6) / 2, W / 2]} size={[2, H - 0.6, 0.02]} color="#9fd1e8" opacity={0.25} noCollide />
      {/* крыша */}
      <B pos={[0, 2 * H + 0.15, 0]} size={[L + 1, 0.3, W + 1]} color="#8a8378" />
      {/* лестница вдоль стены -Z, подъём с 1 на 2 этаж */}
      {stairs.map((s, i) => <B key={i} {...s} />)}
      {/* ограждение лестницы */}
      <B pos={[-2.7, 2, -1.85]} size={[5.2, 0.05, 0.05]} color="#555" noCollide />
      {/* терраса и бассейн */}
      <B pos={[0, 0.25, 8]} size={[14, 0.1, 6]} color="#c9b48e" />
      <B pos={[0, 0.05, 13]} size={[8, 0.3, 4]} color="#3aa3c9" opacity={0.7} noCollide />
      <B pos={[0, 0.06, 13]} size={[8.4, 0.12, 4.4]} color="#e8e4da" />
      {/* колонны террасы */}
      {[-6, 6].map((x) => <B key={x} pos={[x, 1.5, 10.5]} size={[0.3, 3, 0.3]} color="#bfb7a6" />)}
      <B pos={[0, 3.1, 10.5]} size={[12.6, 0.2, 0.4]} color="#bfb7a6" />
      {/* «мебель» */}
      <B pos={[3, 0.45, 1]} size={[2.4, 0.5, 1]} color="#d2c7b3" />
      <B pos={[3, 0.85, 1.6]} size={[2.4, 0.3, 0.2]} color="#d2c7b3" />
      <B pos={[3.5, 0.6, -2]} size={[1.6, 0.8, 0.9]} color="#8a6a4b" />
      <B pos={[-3.5, 0.4, 2]} size={[1.8, 0.4, 2]} color="#e2dccd" />
    </group>
  );
}
