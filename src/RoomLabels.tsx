// Подписи комнат в 3D: спрайты над марками помещений из DWG. Видны в радиусе ~14 м от игрока.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { loadPlan, roomTitle, type Plan } from './plan';
import { makeLabelTexture } from './PanoScene';

const VISIBLE_R = 10;

function Label({ text, pos }: { text: string; pos: [number, number, number] }) {
  const { t, aspect } = useMemo(() => makeLabelTexture(text), [text]);
  useEffect(() => () => t.dispose(), [t]);
  const h = 0.26;
  return (
    <sprite position={pos} scale={[h * aspect, h, 1]}>
      <spriteMaterial map={t} transparent depthTest={false} opacity={0.95} />
    </sprite>
  );
}

export function RoomLabels({ villaId }: { villaId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const group = useRef<Group>(null);
  useEffect(() => { setPlan(null); loadPlan(villaId).then(setPlan); }, [villaId]);

  const items = useMemo(() => {
    if (!plan) return [];
    return plan.levels.flatMap((l) => l.rooms.map((r) => ({
      text: r.area ? `${roomTitle(r.name)} · ${r.area} м²` : roomTitle(r.name),
      pos: [r.x, l.level + 2.0, r.z] as [number, number, number],
    })));
  }, [plan]);

  // показывать только ближние подписи, чтобы не засорять вид
  const tmp = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    const g = group.current; if (!g) return;
    g.children.forEach((c) => {
      tmp.copy(c.position);
      const dy = Math.abs(tmp.y - camera.position.y);
      c.visible = tmp.distanceTo(camera.position) < VISIBLE_R && dy < 2.0;
    });
  });

  return <group ref={group}>{items.map((it, i) => <Label key={i} text={it.text} pos={it.pos} />)}</group>;
}
