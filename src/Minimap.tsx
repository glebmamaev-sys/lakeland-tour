// Мини-план этажа в углу экрана: стены из DWG, подписи комнат, точка «вы здесь» с направлением взгляда.
// Клик по комнате — перенос игрока в неё. Этаж выбирается по высоте игрока, можно переключить вручную.
import { useEffect, useMemo, useState } from 'react';
import { input } from './input';
import { levelForY, loadPlan, roomTitle, type Plan, type PlanLevel, type Seg } from './plan';

const SIZE = 260; // px
const PAD = 10;

function segPath(segs: Seg[], tx: (x: number) => number, tz: (z: number) => number) {
  let dstr = '';
  for (const [x1, z1, x2, z2] of segs) dstr += `M${tx(x1).toFixed(1)} ${tz(z1).toFixed(1)}L${tx(x2).toFixed(1)} ${tz(z2).toFixed(1)}`;
  return dstr;
}

export function Minimap({ villaId }: { villaId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pose, setPose] = useState({ x: 0, y: 0, z: 0, yaw: 0 });
  const [manual, setManual] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => { setPlan(null); setManual(null); loadPlan(villaId).then(setPlan); }, [villaId]);

  // позиция игрока: читаем из глобального дебаг-хэндла 10 раз в секунду
  useEffect(() => {
    const id = setInterval(() => {
      const t = (window as unknown as { __tour?: { pos: { x: number; y: number; z: number } } }).__tour;
      if (t) setPose({ x: t.pos.x, y: t.pos.y, z: t.pos.z, yaw: input.yaw });
    }, 100);
    return () => clearInterval(id);
  }, []);

  const auto = plan ? levelForY(plan, pose.y) : null;
  const lvl: PlanLevel | null = plan ? (plan.levels.find((l) => l.id === manual) ?? auto) : null;

  const geom = useMemo(() => {
    if (!plan) return null;
    const [x0, z0, x1, z1] = plan.bbox;
    const w = x1 - x0, h = z1 - z0;
    const s = Math.min((SIZE - 2 * PAD) / w, (SIZE - 2 * PAD) / h);
    const ox = (SIZE - w * s) / 2, oz = (SIZE - h * s) / 2;
    const tx = (x: number) => ox + (x - x0) * s;
    const tz = (z: number) => oz + (z - z0) * s;
    return { s, tx, tz };
  }, [plan]);

  if (!plan || !lvl || !geom) return null;
  const { s, tx, tz } = geom;

  const teleport = (x: number, z: number) => {
    input.teleport = [x, lvl.level + 0.4, z];
  };

  return (
    <div className={`minimap${open ? '' : ' collapsed'}`}>
      <div className="minimap-head">
        <select value={lvl.id} onChange={(e) => setManual(e.target.value === auto?.id ? null : e.target.value)} aria-label="Этаж">
          {plan.levels.map((l) => <option key={l.id} value={l.id}>{l.title}{l.id === auto?.id ? ' · вы здесь' : ''}</option>)}
        </select>
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Свернуть план' : 'Развернуть план'}>{open ? '–' : '+'}</button>
      </div>
      {open && (
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <rect x="0" y="0" width={SIZE} height={SIZE} rx="12" className="mm-bg" />
          {lvl.wallPolys?.map((poly, i) => {
            let d = '';
            for (let k = 0; k < poly.length; k += 2) d += `${k ? 'L' : 'M'}${tx(poly[k]).toFixed(1)} ${tz(poly[k + 1]).toFixed(1)}`;
            return <path key={i} d={d + 'Z'} className="mm-wallpoly" />;
          })}
          <path d={segPath(lvl.slabs, tx, tz)} className="mm-slab" />
          <path d={segPath(lvl.stairs, tx, tz)} className="mm-stair" />
          <path d={segPath(lvl.walls, tx, tz)} className="mm-wall" />
          {lvl.rooms.map((r, i) => (
            <g key={i} className="mm-room" onClick={() => teleport(r.x, r.z)}>
              <circle cx={tx(r.x)} cy={tz(r.z)} r={9} className="mm-room-hit" />
              <text x={tx(r.x)} y={tz(r.z) - 2} textAnchor="middle">{roomTitle(r.name)}</text>
              {r.area && <text x={tx(r.x)} y={tz(r.z) + 9} textAnchor="middle" className="mm-area">{r.area} м²</text>}
            </g>
          ))}
          {/* вы здесь: точка и сектор взгляда (yaw=0 смотрит на −z = вверх карты) */}
          {lvl.id === auto?.id && (
            <g transform={`translate(${tx(pose.x).toFixed(1)} ${tz(pose.z).toFixed(1)}) rotate(${(-pose.yaw * 180) / Math.PI})`}>
              <path d="M0 0 L-9 -16 A18 18 0 0 1 9 -16 Z" className="mm-fov" />
              <circle r="4.5" className="mm-me" />
            </g>
          )}
          <text x={SIZE - 8} y={SIZE - 6} textAnchor="end" className="mm-scale">{Math.round(10 * s)} px = 10 м · N ↑</text>
        </svg>
      )}
    </div>
  );
}
