// Карта комплекса в углу экрана (режим «Комплекс · пешком»): граница участка, вода, контуры 12 строений,
// точка «вы здесь» с направлением взгляда. Клик по дому — перенос ко входу в него.
import { useEffect, useMemo, useState } from 'react';
import { input } from './input';
import { complexStore, type HouseInfo } from './Complex';

const SIZE = 260; // px
const PAD = 10;

export function ComplexMap() {
  const [pose, setPose] = useState({ x: 0, z: 0, yaw: 0 });
  const [open, setOpen] = useState(true);
  const [tick, setTick] = useState(0);

  // позиция игрока и готовность данных: читаем по таймеру 10 раз в секунду
  useEffect(() => {
    const id = setInterval(() => {
      const t = (window as unknown as { __tour?: { pos: { x: number; y: number; z: number } } }).__tour;
      if (t) setPose({ x: t.pos.x, z: t.pos.z, yaw: input.yaw });
      if (complexStore.data) setTick((k) => (k === 0 ? 1 : k));
    }, 100);
    return () => clearInterval(id);
  }, []);

  const geom = useMemo(() => {
    const d = complexStore.data; if (!d || !tick) return null;
    const b = d.site.boundary;
    const x0 = Math.min(...b.map((p) => p[0])), x1 = Math.max(...b.map((p) => p[0]));
    const z0 = Math.min(...b.map((p) => p[1])), z1 = Math.max(...b.map((p) => p[1]));
    const w = x1 - x0, h = z1 - z0;
    const s = Math.min((SIZE - 2 * PAD) / w, (SIZE - 2 * PAD) / h);
    const ox = (SIZE - w * s) / 2, oz = (SIZE - h * s) / 2;
    const tx = (x: number) => ox + (x - x0) * s;
    const tz = (z: number) => oz + (z - z0) * s;
    const poly = (pts: [number, number][]) => pts.map(([x, z], i) => `${i ? 'L' : 'M'}${tx(x).toFixed(1)} ${tz(z).toFixed(1)}`).join('') + 'Z';
    const shop = d.buildings.find((x) => x.model === 'shop');
    return { s, tx, tz, boundary: poly(b), houses: complexStore.houses, shop };
  }, [tick]);

  if (!geom) return null;
  const { s, tx, tz } = geom;

  const teleport = (h: HouseInfo) => {
    const [x, y, z] = h.entry;
    const g = complexStore.heightAt?.(x, z);
    input.teleport = [x, (g ?? y) + 0.4, z];
    input.yaw = h.entryYaw; input.pitch = 0;
  };

  return (
    <div className={`minimap${open ? '' : ' collapsed'}`}>
      <div className="minimap-head">
        <span className="mm-title">Lake Land · весь комплекс</span>
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Свернуть карту' : 'Развернуть карту'}>{open ? '–' : '+'}</button>
      </div>
      {open && (
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <rect x="0" y="0" width={SIZE} height={SIZE} rx="12" className="mm-water" />
          <path d={geom.boundary} className="mm-site" />
          {geom.shop && (
            <g transform={`translate(${tx(geom.shop.pos[0]).toFixed(1)} ${tz(geom.shop.pos[1]).toFixed(1)}) rotate(${(-geom.shop.rot * 180) / Math.PI})`}>
              <rect x={-(geom.shop.size?.[0] ?? 9) * s / 2} y={-(geom.shop.size?.[1] ?? 8) * s / 2} width={(geom.shop.size?.[0] ?? 9) * s} height={(geom.shop.size?.[1] ?? 8) * s} className="mm-house" />
              <text textAnchor="middle" dy="3">4</text>
            </g>
          )}
          {geom.houses.map((h) => {
            const cx = h.poly.reduce((a, p) => a + p[0], 0) / 4, cz = h.poly.reduce((a, p) => a + p[1], 0) / 4;
            return (
              <g key={h.id} className="mm-room" onClick={() => teleport(h)}>
                <title>{h.title} — перейти ко входу</title>
                <path d={h.poly.map(([x, z], i) => `${i ? 'L' : 'M'}${tx(x).toFixed(1)} ${tz(z).toFixed(1)}`).join('') + 'Z'} className="mm-house" />
                <text x={tx(cx)} y={tz(cz)} textAnchor="middle" dy="3">{h.id}</text>
              </g>
            );
          })}
          {/* вы здесь: точка и сектор взгляда (yaw=0 смотрит на −z = вверх карты) */}
          <g transform={`translate(${tx(pose.x).toFixed(1)} ${tz(pose.z).toFixed(1)}) rotate(${(-pose.yaw * 180) / Math.PI})`}>
            <path d="M0 0 L-9 -16 A18 18 0 0 1 9 -16 Z" className="mm-fov" />
            <circle r="4.5" className="mm-me" />
          </g>
          <text x={SIZE - 8} y={SIZE - 6} textAnchor="end" className="mm-scale">{Math.round(20 * s)} px = 20 м · N ↑</text>
        </svg>
      )}
    </div>
  );
}
