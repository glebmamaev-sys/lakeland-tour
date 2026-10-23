// Панорамный режим: сфера с equirectangular-текстурой, стерео для VR, хотспоты-переходы,
// обзор перетаскиванием (мышь/тач) и зум колесом.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { BackSide, CanvasTexture, Mesh, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three';
import type { Pano, PanoLink } from './panos';
import { asset } from './assets';

const R = 50; // радиус сферы
const HOT_R = 12; // радиус размещения хотспотов

// Состояние обзора (одно на приложение)
export const panoView = { yaw: Math.PI / 2, pitch: 0, fov: 75, target: null as string | null };
(window as unknown as { __pano: unknown }).__pano = panoView;

/** Направление по yaw/pitch в градусах относительно центра картинки → мировые координаты. */
export function dirFromImage(yawDeg: number, pitchDeg = 0, r = 1) {
  const theta = Math.PI / 2 - (yawDeg * Math.PI) / 180; // yaw камеры, при котором эта точка в центре
  const p = (pitchDeg * Math.PI) / 180;
  return new Vector3(-Math.sin(theta) * Math.cos(p), Math.sin(p), -Math.cos(theta) * Math.cos(p)).multiplyScalar(r);
}

function Sphere({ texture, layer, uvOffset, uvRepeat }: { texture: Texture; layer: number; uvOffset: number; uvRepeat: number }) {
  const ref = useRef<Mesh>(null);
  const tex = useMemo(() => {
    const t = texture.clone();
    t.colorSpace = SRGBColorSpace;
    t.repeat.set(1, uvRepeat);
    t.offset.set(0, uvOffset);
    t.needsUpdate = true;
    return t;
  }, [texture, uvOffset, uvRepeat]);
  useEffect(() => { ref.current?.layers.set(layer); }, [layer]);
  return (
    <mesh ref={ref} scale={[-1, 1, 1]}>
      <sphereGeometry args={[R, 64, 40]} />
      <meshBasicMaterial map={tex} side={BackSide} toneMapped={false} />
    </mesh>
  );
}

export function makeLabelTexture(text: string) {
  const dpr = 2, pad = 18, fs = 30;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `600 ${fs * dpr}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + pad * 2 * dpr, h = (fs + 20) * dpr;
  c.width = w; c.height = h;
  ctx.font = `600 ${fs * dpr}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(15,21,18,0.75)';
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, h / 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
  return { t, aspect: w / h };
}

function Label({ text }: { text: string }) {
  const { t, aspect } = useMemo(() => makeLabelTexture(text), [text]);
  useEffect(() => () => t.dispose(), [t]);
  const h = 0.55;
  return (
    <sprite position={[0, 1.1, 0]} scale={[h * aspect, h, 1]}>
      <spriteMaterial map={t} transparent depthTest={false} />
    </sprite>
  );
}

function Hotspot({ link, title, onJump }: { link: PanoLink; title: string; onJump: (id: string) => void }) {
  const pos = useMemo(() => dirFromImage(link.yaw, link.pitch ?? -8, HOT_R), [link]);
  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onJump(link.to); };
  return (
    <group position={pos} onUpdate={(g) => g.lookAt(0, 0, 0)}>
      <mesh onClick={onClick} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
        <ringGeometry args={[0.45, 0.7, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} />
      </mesh>
      <mesh onClick={onClick}>
        <circleGeometry args={[0.45, 48]} />
        <meshBasicMaterial color="#c9742f" transparent opacity={0.55} depthTest={false} />
      </mesh>
      <Label text={link.label ?? title} />
    </group>
  );
}

/** Обзор: перетаскивание мышью/пальцем, колесо — зум. Камера в центре сферы. */
function PanoControls() {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    let dragging = false, lx = 0, ly = 0;
    const down = (e: PointerEvent) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const k = (panoView.fov / 75) * 0.0028;
      panoView.yaw += (e.clientX - lx) * k;
      panoView.pitch = Math.max(-1.45, Math.min(1.45, panoView.pitch + (e.clientY - ly) * k));
      lx = e.clientX; ly = e.clientY;
    };
    const up = () => { dragging = false; };
    const wheel = (e: WheelEvent) => { panoView.fov = Math.max(35, Math.min(100, panoView.fov + e.deltaY * 0.05)); e.preventDefault(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [gl]);

  useFrame(({ gl: r }) => {
    if (r.xr.isPresenting) return; // в VR камерой управляет шлем
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.rotation.y = panoView.yaw;
    camera.rotation.x = panoView.pitch;
    const pc = camera as { fov?: number; updateProjectionMatrix: () => void };
    if (pc.fov !== undefined && Math.abs(pc.fov - panoView.fov) > 0.01) { pc.fov = panoView.fov; pc.updateProjectionMatrix(); }
  });
  return null;
}

export function PanoScene({ pano, all, onJump }: { pano: Pano; all: Pano[]; onJump: (id: string) => void }) {
  const texture = useLoader(TextureLoader, asset(pano.src));
  const { camera } = useThree();
  const titles = useMemo(() => Object.fromEntries(all.map((p) => [p.id, p.title])), [all]);

  // при смене панорамы повернуться в стартовое направление; обычная камера видит слой 1 (левый глаз)
  useEffect(() => {
    camera.layers.enable(1);
    camera.layers.disable(2);
    const theta = Math.PI / 2 - ((pano.startYaw ?? 0) * Math.PI) / 180;
    panoView.yaw = theta;
    panoView.pitch = 0;
  }, [pano, camera]);

  const stereo = pano.stereo === 'tb';
  return (
    <group>
      {stereo ? (
        <>
          <Sphere texture={texture} layer={1} uvOffset={0.5} uvRepeat={0.5} />
          <Sphere texture={texture} layer={2} uvOffset={0} uvRepeat={0.5} />
        </>
      ) : (
        <Sphere texture={texture} layer={1} uvOffset={0} uvRepeat={1} />
      )}
      {pano.links.map((l) => <Hotspot key={l.to} link={l} title={titles[l.to] ?? l.to} onJump={onJump} />)}
      <PanoControls />
    </group>
  );
}
