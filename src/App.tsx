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
import { useAmbient } from './Ambient';
import { Minimap } from './Minimap';
import { RoomLabels } from './RoomLabels';
import { Capture } from './Capture';
import { ComplexScene, complexStage, complexStore } from './Complex';
import { ComplexMap } from './ComplexMap';
import { SkyDome, SUN } from './world/SkyDome';

import { MODELS } from './models';

// Для каждой виллы: заголовок и точка старта на заглушке (если GLB не загрузился)
const VILLAS: Record<string, { title: string; spawn: [number, number, number] }> = Object.fromEntries(
  Object.entries(MODELS).map(([id, m]) => [id, { title: m.title, spawn: [0, 0.3, 12] as [number, number, number] }]),
);

type Mode = 'pano' | 'walk' | 'complex';
const NO_HUD = new URLSearchParams(location.search).has('nohud'); // чистый кадр для съёмки

export default function App() {
  const [villaId, setVillaId] = useState<keyof typeof VILLAS>(() => {
    const v = new URLSearchParams(location.search).get('villa'); return v && v in VILLAS ? (v as keyof typeof VILLAS) : 'villa1';
  });
  const [mode, setMode] = useState<Mode>(() => { const m = new URLSearchParams(location.search).get('mode'); return m === 'walk' || m === 'complex' ? m : 'pano'; });
  const [status, setStatus] = useState<'loading' | 'placeholder' | 'model'>('loading');
  const [locked, setLocked] = useState(false);
  const [complexWalk, setComplexWalk] = useState(() => new URLSearchParams(location.search).has('walk')); // «Комплекс»: с дрона (орбита) или пешком
  const [colliderState, setColliderState] = useState(complexStore.collider);
  // этап загрузки комплекса для индикатора
  const [cStage, setCStage] = useState(complexStage.value);
  useEffect(() => { const l = (v: string) => setCStage(v); complexStage.listeners.add(l); return () => { complexStage.listeners.delete(l); }; }, []);
  const stageLabel = cStage.startsWith('data') ? 'данные участка' : cStage.startsWith('instances') ? 'дома и интерьеры' : cStage === 'terrain:start' ? 'рельеф и газон' : cStage === 'terrain:paths' ? 'дорожки и растения' : cStage === 'terrain:done' ? '' : 'модели вилл';
  const complexLoading = mode === 'complex' && cStage !== 'terrain:done';
  const ambient = useAmbient(mode === 'complex' && !complexLoading);
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
    const id = setInterval(() => { setLocked(input.locked); setColliderState(complexStore.collider); }, 200);
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
        dpr={[1, input.mobile ? 1.25 : 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl: r }) => { r.xr.enabled = true; setGl(r); (window as unknown as { __gl: unknown }).__gl = r; }}
      >
        {mode === 'complex' ? (
          <>
            {new URLSearchParams(location.search).has('oldsky') ? <Sky sunPosition={[60, 35, 80]} turbidity={6} rayleigh={1.5} /> : <Suspense fallback={null}><SkyDome /></Suspense>}
            <Suspense fallback={null}>
              <Environment preset="park" background={false} environmentIntensity={0.45} />
            </Suspense>
            <hemisphereLight args={['#cfe3f5', '#b9b39f', 0.9]} />
            <ambientLight intensity={0.35} />
            <directionalLight position={[SUN.x * 220, SUN.y * 220, SUN.z * 220]} color="#fff1d8" intensity={2.8} castShadow shadow-bias={-0.0004} shadow-normalBias={0.06}
              shadow-mapSize={input.mobile ? [2048, 2048] : [4096, 4096]} shadow-camera-left={-170} shadow-camera-right={170} shadow-camera-top={170}
              shadow-camera-bottom={-170} shadow-camera-near={20} shadow-camera-far={700} />
            <Suspense fallback={null}><ComplexScene walk={complexWalk} /></Suspense>
            <Capture />
          </>
        ) : mode === 'walk' ? (
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
            {!NO_HUD && <RoomLabels villaId={villaId} />}
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

      <div className="hud" style={NO_HUD ? { display: 'none' } : undefined}>
        <div className="hud-title">
          <div className="brand">Lake Land · Serendib</div>
          <select className="villa-select" value={villaId} onChange={(e) => selectVilla(e.target.value)} aria-label="Вилла">
            {Object.entries(MODELS).map(([id, m]) => <option key={id} value={id}>{m.title}</option>)}
          </select>
          <div className="villa">
            {mode === 'pano' && pano ? pano.title : ''}
            {mode === 'walk' && status === 'placeholder' ? 'заглушка (ждём модель Revit)' : ''}
            {mode === 'walk' && status === 'model' ? 'модель Revit' : ''}
            {mode === 'complex' ? (complexWalk ? 'прогулка по комплексу · 12 строений' : 'весь комплекс по генплану · 12 строений') : ''}
          </div>
        </div>

        <div className="hud-topright">
          <div className="seg">
            <button className={mode === 'pano' ? 'on' : ''} onClick={() => switchMode('pano')} disabled={!hasPanos} title={hasPanos ? '' : 'Панорам для этой виллы пока нет'}>Панорамы</button>
            <button className={mode === 'walk' ? 'on' : ''} onClick={() => switchMode('walk')}>Прогулка</button>
            <button className={mode === 'complex' ? 'on' : ''} onClick={() => switchMode('complex')}>Комплекс</button>
          </div>
          {mode === 'pano' && <VRButton gl={gl} />}
          {mode === 'complex' && <button className={'sound' + (ambient.on ? ' on' : '')} onClick={ambient.toggle} title={ambient.on ? 'Выключить звук' : 'Включить звук'}>{ambient.on ? '🔊' : '🔇'}</button>}
          {mode === 'complex' && (
            <div className="seg">
              <button className={!complexWalk ? 'on' : ''} onClick={() => { if (document.pointerLockElement) document.exitPointerLock(); setComplexWalk(false); }}>С дрона</button>
              <button className={complexWalk ? 'on' : ''} onClick={() => setComplexWalk(true)}>Пешком</button>
            </div>
          )}
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
        {mode === 'complex' && !complexWalk && <div className="hud-hint">Тяните — вращать · колесо — приблизить · правая кнопка — сдвинуть</div>}
        {complexLoading && (
          <div className="hud-center"><div className="hint-card"><div>Загружаем комплекс…</div><small>{stageLabel}</small></div></div>
        )}
        {mode === 'complex' && !complexLoading && complexWalk && colliderState !== 'ready' && (
          <div className="hud-center"><div className="hint-card"><div>Готовим прогулку…</div><small>Собираем стены, рельеф и двери всех 12 строений</small></div></div>
        )}
        {mode === 'complex' && complexWalk && colliderState === 'ready' && !input.mobile && !locked && (
          <div className="hud-center">
            <div className="hint-card">
              <div>Кликните, чтобы войти</div>
              <small>W A S D — ходить · мышь — смотреть · Shift — быстрее · F — полёт · карта справа — перейти к вилле · Esc — выйти</small>
            </div>
          </div>
        )}
        {mode === 'complex' && complexWalk && input.mobile && <div className="hud-bottom">Левый джойстик — ходить · правая половина экрана — смотреть</div>}
        {mode === 'pano' && <div className="hud-hint">Тяните, чтобы осмотреться · колесо — зум · кружки — переход в соседнюю комнату</div>}
      </div>
      {mode === 'walk' && status === 'model' && !NO_HUD && <Minimap villaId={villaId} />}
      {mode === 'complex' && complexWalk && !NO_HUD && <ComplexMap />}
      {((mode === 'walk') || (mode === 'complex' && complexWalk)) && input.mobile && <Joystick />}
    </>
  );
}
