import { Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Sky } from '@react-three/drei';
import type { WebGLRenderer } from 'three';
import { Villa } from './Villa';
import { Player } from './Player';
import { Joystick } from './Joystick';
import { input } from './input';
import { PANO_TOURS } from './panos';
import { PanoScene } from './PanoScene';
import { VRButton } from './VRButton';
import { Minimap } from './Minimap';
import { RoomLabels } from './RoomLabels';
import { Capture } from './Capture';

import { MODELS } from './models';

// Для каждой виллы: заголовок и точка старта на заглушке (если GLB не загрузился)
const VILLAS: Record<string, { title: string; spawn: [number, number, number] }> = Object.fromEntries(
  Object.entries(MODELS).map(([id, m]) => [id, { title: m.title, spawn: [0, 0.3, 12] as [number, number, number] }]),
);

type Mode = 'pano' | 'walk';

export default function App() {
  const [villaId, setVillaId] = useState<keyof typeof VILLAS>('villa1');
  const [mode, setMode] = useState<Mode>('pano');
  const [status, setStatus] = useState<'loading' | 'placeholder' | 'model'>('loading');
  const [locked, setLocked] = useState(false);
  const [gl, setGl] = useState<WebGLRenderer | null>(null);
  const villa = VILLAS[villaId];
  const tour = PANO_TOURS[villaId] ?? [];
  const hasPanos = tour.length > 0;
  const [panoId, setPanoId] = useState(tour[0]?.id ?? '');

  const selectVilla = (id: string) => {
    if (id === villaId) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setStatus('loading');
    setVillaId(id);
    const t = PANO_TOURS[id] ?? [];
    setPanoId(t[0]?.id ?? '');
    if (!t.length) setMode('walk');
  };
  const [fade, setFade] = useState(false);
  const pano = tour.find((p) => p.id === panoId) ?? tour[0];

  useEffect(() => {
    const id = setInterval(() => setLocked(input.locked), 200);
    return () => clearInterval(id);
  }, []);

  const onReady = useCallback((hasModel: boolean) => setStatus(hasModel ? 'model' : 'placeholder'), []);

  const jump = useCallback((id: string) => {
    setFade(true);
    setTimeout(() => { setPanoId(id); setTimeout(() => setFade(false), 120); }, 220);
  }, []);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    if (document.pointerLockElement) document.exitPointerLock();
    setMode(m);
  };

  return (
    <>
      <Canvas
        shadows
        camera={{ fov: 70, near: 0.05, far: 500 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl: r }) => { r.xr.enabled = true; setGl(r); }}
      >
        {mode === 'walk' ? (
          <>
            <Sky sunPosition={[30, 40, 45]} turbidity={6} rayleigh={1.5} />
            <Suspense fallback={null}>
              <Environment preset="park" background={false} environmentIntensity={0.4} /> {/* 0.9 красило потолки в зелень травы HDRI */}
            </Suspense>
            <hemisphereLight args={['#dfefff', '#cfcbc3', 1.1]} /> {/* светлый нейтральный «низ»: потолки освещаются снизу; с оливковым (#8a9470) они зеленели */}
            <ambientLight intensity={0.65} />
            <directionalLight
              position={[30, 40, 45]}
              intensity={2.4}
              castShadow
              shadow-bias={-0.0004}
              shadow-normalBias={0.03}
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-30}
              shadow-camera-right={30}
              shadow-camera-top={30}
              shadow-camera-bottom={-30}
            />
            <Villa key={`villa-${villaId}`} id={villaId} onReady={onReady} />
            <RoomLabels villaId={villaId} />
            <Capture />
            <Player
              key={`player-${villaId}`}
              spawn={status === 'placeholder' ? villa.spawn : MODELS[villaId]?.spawn ?? villa.spawn}
              yaw={status === 'placeholder' ? 0 : MODELS[villaId]?.spawnYaw ?? 0}
            />
          </>
        ) : (
          pano && (
            <Suspense fallback={null}>
              <PanoScene pano={pano} all={tour} onJump={jump} />
            </Suspense>
          )
        )}
      </Canvas>

      <div className={`fade${fade ? ' on' : ''}`} />

      <div className="hud">
        <div className="hud-title">
          <div className="brand">Lake Land · Serendib</div>
          <select className="villa-select" value={villaId} onChange={(e) => selectVilla(e.target.value)} aria-label="Вилла">
            {Object.entries(MODELS).map(([id, m]) => <option key={id} value={id}>{m.title}</option>)}
          </select>
          <div className="villa">
            {mode === 'pano' && pano ? pano.title : ''}
            {mode === 'walk' && status === 'placeholder' ? 'заглушка (ждём модель Revit)' : ''}
            {mode === 'walk' && status === 'model' ? 'модель Revit' : ''}
          </div>
        </div>

        <div className="hud-topright">
          <div className="seg">
            <button className={mode === 'pano' ? 'on' : ''} onClick={() => switchMode('pano')} disabled={!hasPanos} title={hasPanos ? '' : 'Панорам для этой виллы пока нет'}>Панорамы</button>
            <button className={mode === 'walk' ? 'on' : ''} onClick={() => switchMode('walk')}>Прогулка</button>
          </div>
          {mode === 'pano' && <VRButton gl={gl} />}
        </div>

        {mode === 'pano' && (
          <div className="hud-bottom chips">
            {tour.map((p) => (
              <button key={p.id} className={`chip${p.id === pano?.id ? ' on' : ''}`} onClick={() => jump(p.id)}>{p.title}</button>
            ))}
          </div>
        )}

        {mode === 'walk' && status === 'loading' && <div className="hud-center">Загрузка…</div>}
        {mode === 'walk' && !input.mobile && status !== 'loading' && !locked && (
          <div className="hud-center">
            <div className="hint-card">
              <div>Кликните, чтобы войти</div>
              <small>W A S D — ходить · мышь — смотреть · Shift — быстрее · F — полёт (Q/E вниз/вверх) · Esc — выйти</small>
            </div>
          </div>
        )}
        {mode === 'walk' && input.mobile && <div className="hud-bottom">Левый джойстик — ходить · правая половина экрана — смотреть</div>}
        {mode === 'pano' && <div className="hud-hint">Тяните, чтобы осмотреться · колесо — зум · кружки — переход в соседнюю комнату</div>}
      </div>
      {mode === 'walk' && status === 'model' && <Minimap villaId={villaId} />}
      {mode === 'walk' && input.mobile && <Joystick />}
    </>
  );
}
