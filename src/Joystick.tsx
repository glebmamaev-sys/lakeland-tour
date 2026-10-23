// Экранный джойстик для телефона (nipplejs), пишет в input.fwd / input.side.
import { useEffect, useRef } from 'react';
import nipplejs from 'nipplejs';
import { input } from './input';

export function Joystick() {
  const zone = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!zone.current) return;
    const mgr = nipplejs.create({ zone: zone.current, mode: 'static', position: { left: '70px', bottom: '80px' }, color: '#fff', size: 110, restOpacity: 0.6 });
    mgr.on('move', (evt) => {
      const d = evt.data;
      const f = d.vector.y, s = d.vector.x; // -1..1
      input.fwd = Math.abs(f) < 0.15 ? 0 : f;
      input.side = Math.abs(s) < 0.15 ? 0 : s;
      input.run = d.force > 1.4;
    });
    mgr.on('end', () => { input.fwd = 0; input.side = 0; input.run = false; });
    return () => mgr.destroy();
  }, []);
  return <div ref={zone} className="joystick-zone" />;
}
