// Загружает GLB виллы из /models/<id>.glb, если он есть; иначе показывает заглушку.
// После монтирования собирает коллайдер для контроллера.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Vector3 } from 'three';
import type { RampHelper } from './models';
import { useGLTF, useTexture } from '@react-three/drei';
import { buildCollider, colliderStore } from './collider';
import { PlaceholderVilla } from './PlaceholderVilla';
import { MODELS } from './models';
import { applyMaterialRules } from './materials';
import { asset } from './assets';

const hiddenMat = new MeshBasicMaterial({ visible: false });

/** Невидимый пандус: плоскость по осевой линии from→to заданной ширины (попадает в коллайдер, не рисуется). */
function makeRamp(h: RampHelper): Mesh {
  const a = new Vector3(...h.from), b = new Vector3(...h.to);
  const len = a.distanceTo(b);
  const g = new PlaneGeometry(h.width, len);
  const m = new Mesh(g, hiddenMat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  // PlaneGeometry лежит в XY, нормаль +Z: направим +Y плоскости вдоль a→b, нормаль — вверх-перпендикулярно
  const dir = b.clone().sub(a).normalize();
  const side = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();
  const normal = new Vector3().crossVectors(side, dir).normalize();
  m.matrix.makeBasis(side, dir, normal).setPosition(m.position);
  m.matrixAutoUpdate = false;
  m.updateMatrixWorld(true);
  m.userData.helper = 'ramp';
  m.visible = false;
  return m;
}

/** Невидимые стены по границе участка (bbox земли/рельефа с отступом 1 м) и страховочный пол под ним. */
function makeBounds(root: Object3D): Group {
  const box = new Box3();
  const ground = new Box3();
  let hasGround = false;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const b = new Box3().setFromObject(m);
    box.union(b);
    if (m.userData.role === 'ground' || m.userData.role === 'terrain') { ground.union(b); hasGround = true; }
  });
  const b = hasGround ? ground : box;
  const inset = 1;
  const minX = b.min.x + inset, maxX = b.max.x - inset, minZ = b.min.z + inset, maxZ = b.max.z - inset;
  const h = (b.max.y - b.min.y) + 40, cy = b.min.y - 5 + h / 2;
  const g = new Group();
  g.name = 'bounds';
  const wall = (w: number, x: number, z: number, ry: number) => {
    const m = new Mesh(new BoxGeometry(w, h, 0.2), hiddenMat);
    m.position.set(x, cy, z); m.rotation.y = ry; m.visible = false; m.userData.helper = 'bounds';
    g.add(m);
  };
  wall(maxX - minX, (minX + maxX) / 2, minZ, 0);
  wall(maxX - minX, (minX + maxX) / 2, maxZ, 0);
  wall(maxZ - minZ, minX, (minZ + maxZ) / 2, Math.PI / 2);
  wall(maxZ - minZ, maxX, (minZ + maxZ) / 2, Math.PI / 2);
  // страховочный пол на 3 м ниже самой низкой точки, чтобы не провалиться в бесконечность
  const floor = new Mesh(new BoxGeometry(maxX - minX, 0.2, maxZ - minZ), hiddenMat);
  floor.position.set((minX + maxX) / 2, b.min.y - 3, (minZ + maxZ) / 2); floor.visible = false; floor.userData.helper = 'bounds';
  g.add(floor);
  g.updateMatrixWorld(true);
  return g;
}

function GlbVilla({ id, onLoaded }: { id: string; onLoaded: () => void }) {
  const cfg = MODELS[id];
  const { scene } = useGLTF(asset(cfg.url));
  const grass = useTexture(asset('textures/grass.jpg'));
  useEffect(() => {
    // Материалы по ролям (стекло, вода, земля, потолки, текстуры Revit); статистика в консоль
    scene.updateMatrixWorld(true);
    const stats = applyMaterialRules(scene, { grass }, cfg.terrainCuts ?? []);
    console.info('[villa materials]', cfg.title, stats);
    (window as unknown as { __villaScene: unknown }).__villaScene = scene;
    // вспомогательные невидимые коллайдеры: пандусы из конфига и границы участка
    const parent = scene.parent ?? scene;
    for (const old of parent.children.filter((c) => c.name === 'helpers')) parent.remove(old); // StrictMode: не дублировать
    const helpers = new Group(); helpers.name = 'helpers';
    for (const h of cfg.helpers ?? []) helpers.add(makeRamp(h));
    helpers.add(makeBounds(scene));
    parent.add(helpers);
    helpers.updateMatrixWorld(true);
    (window as unknown as { __helpers: unknown }).__helpers = helpers;
    // сцена смонтирована — можно строить коллайдер (на следующий кадр, когда обновятся матрицы)
    const r = requestAnimationFrame(onLoaded);
    return () => cancelAnimationFrame(r);
  }, [scene, grass, onLoaded, cfg.title]);
  return <primitive object={scene} rotation={cfg.rotation} position={cfg.offset} />;
}

export function Villa({ id, onReady }: { id: string; onReady?: (hasModel: boolean) => void }) {
  const group = useRef<Group>(null);
  const [hasGlb, setHasGlb] = useState<boolean | null>(null);
  const url = asset(MODELS[id]?.url ?? `models/${id}.glb`);

  useEffect(() => {
    let alive = true;
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        const ct = r.headers.get('content-type') || '';
        if (alive) setHasGlb(!!MODELS[id] && r.ok && !ct.includes('text/html'));
      })
      .catch(() => alive && setHasGlb(false));
    return () => { alive = false; };
  }, [url, id]);

  const rebuild = useCallback(() => {
    if (!group.current) return;
    colliderStore.current = buildCollider(group.current, MODELS[id]?.passages ?? []);
    (window as unknown as { __passages: unknown }).__passages = MODELS[id]?.passages ?? [];
    onReady?.(!!hasGlb);
  }, [hasGlb, onReady, id]);

  // заглушка: коллайдер сразу после монтирования; GLB: по сигналу onLoaded из GlbVilla
  useEffect(() => {
    if (hasGlb !== false) return;
    const t = setTimeout(rebuild, 50);
    return () => clearTimeout(t);
  }, [hasGlb, rebuild]);

  if (hasGlb === null) return null;
  return (
    <group ref={group}>
      {hasGlb ? (
        <Suspense fallback={null}>
          <GlbVilla id={id} onLoaded={rebuild} />
        </Suspense>
      ) : (
        <PlaceholderVilla />
      )}
    </group>
  );
}
