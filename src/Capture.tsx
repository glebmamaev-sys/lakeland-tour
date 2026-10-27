// Съёмка из тура: ракурс (клавиша O) и панорама 360° (клавиша P) в высоком разрешении.
// Файлы скачиваются браузером; в dev-режиме window.__capture.*({ save: true }) кладёт их в app/captures/
// через эндпоинт /__save (см. vite.config.ts). Это «болванки» для фотореалистичных рендеров нейросетью.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  Box3, CubeCamera, DoubleSide, Plane, HalfFloatType, Ray, Vector3, type Mesh as MeshT, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  WebGLCubeRenderTarget, WebGLRenderTarget, type WebGLRenderer, type Camera, type Object3D, type PerspectiveCamera,
} from 'three';
import { input } from './input';
import { buildCollider } from './collider';

// кубическая карта → равнопромежуточная проекция; тонмаппинг ACES и sRGB как у основного рендера
// (в render target three.js их не применяет)
const EQUIRECT = new ShaderMaterial({
  uniforms: { tCube: { value: null }, exposure: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform samplerCube tCube; uniform float exposure; varying vec2 vUv;
    vec3 rrt(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }
    vec3 aces(vec3 c){
      const mat3 IN = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
      const mat3 OUT = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
      c *= exposure / 0.6; c = IN * c; c = rrt(c); c = OUT * c; return clamp(c, 0.0, 1.0);
    }
    vec3 srgb(vec3 c){ return mix(pow(c, vec3(1.0/2.4))*1.055-0.055, c*12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
    void main(){
      float lon = (vUv.x - 0.5) * 6.28318530718;
      float lat = (vUv.y - 0.5) * 3.14159265359;
      vec3 dir = vec3(cos(lat)*cos(lon), sin(lat), cos(lat)*sin(lon));
      vec3 c = textureCube(tCube, dir).rgb;
      gl_FragColor = vec4(srgb(aces(c)), 1.0);
    }`,
  depthTest: false, depthWrite: false,
});

/** На время съёмки прячем подписи комнат (спрайты) и шторы (userData.curtain из materials.ts). */
function hideSprites(root: Object3D): Object3D[] {
  const hidden: Object3D[] = [];
  root.traverse((o) => {
    if (((o as { isSprite?: boolean }).isSprite || o.userData.curtain) && o.visible) { o.visible = false; hidden.push(o); }
  });
  return hidden;
}

/**
 * Автоподбор интерьерного ракурса: перебирает точки сетки вокруг центра комнаты и 24 направления,
 * бросает веер лучей по BVH из видимой геометрии без стекла и штор и выбирает самый «глубокий» вид.
 * prefer — точка (x,z), к которой желательно смотреть (бассейн, окно, лагуна).
 */
function bestView(scene: Object3D, o: { center: [number, number]; level: number; radius?: number; eye?: number; prefer?: [number, number]; max?: number; w?: number; mode?: 'depth' | 'room' }) {
  const toggled: Object3D[] = [];
  scene.traverse((m) => {
    const mm = m as MeshT;
    if (mm.isMesh && (mm.userData.curtain || mm.userData.role === 'glass' || mm.userData.role === 'water' || !mm.visible) && !mm.userData.noCollide) { mm.userData.noCollide = true; toggled.push(mm); }
  });
  const col = buildCollider(scene);
  for (const m of toggled) delete m.userData.noCollide;
  if (!col) return null;
  const R = o.radius ?? 2.5, eye = o.eye ?? 1.45, y0 = o.level;
  const ray = new Ray(), v = new Vector3(), d = new Vector3();
  const dist = (x: number, y: number, z: number, dx: number, dy: number, dz: number, max = 30) => {
    ray.origin.set(x, y, z); ray.direction.set(dx, dy, dz).normalize();
    const h = col.bvh.raycastFirst(ray, DoubleSide); return h ? Math.min(h.distance, max) : max;
  };
  let best: { pos: [number, number, number]; yaw: number; score: number } | null = null;
  for (let gx = -R; gx <= R + 1e-6; gx += 0.5) for (let gz = -R; gz <= R + 1e-6; gz += 0.5) {
    const x = o.center[0] + gx, z = o.center[1] + gz;
    const floor = dist(x, y0 + 1, z, 0, -1, 0, 3); if (Math.abs(floor - 1) > 0.25) continue; // нет пола на этом уровне
    if (dist(x, y0 + 0.3, z, 0, 1, 0, 5) < 2.2) continue; // мебель/лестница над головой
    let minH = 99; const ring: number[] = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; const dd = dist(x, y0 + eye, z, Math.sin(a), 0, Math.cos(a)); ring.push(dd); minH = Math.min(minH, dd); }
    if (minH < 0.7) continue; // слишком близко к стене
    for (let k = 0; k < 24; k++) {
      const yaw = (k / 24) * Math.PI * 2; // направление взгляда -z повернуть на yaw: (-sin, -cos)
      let sum = 0, n = 0, near = 99;
      for (let f = -3; f <= 3; f++) {
        const a = yaw + f * 0.12; d.set(-Math.sin(a), 0, -Math.cos(a));
        const dd = dist(x, y0 + eye, z, d.x, 0, d.z); near = Math.min(near, dd);
        // depth: чем глубже вид, тем лучше; room: в кадре должна быть дальняя стена комнаты (2,5–9 м), а не пустота снаружи
        sum += o.mode === 'room' ? (dd >= 2.5 && dd <= 9 ? 10 : dd > 9 ? 2 : 0) : Math.min(dd, o.max ?? 18);
        n++;
      }
      let score = sum / n - (near < 1.5 ? 6 : 0);
      if (o.prefer) { v.set(o.prefer[0] - x, 0, o.prefer[1] - z).normalize(); score += (o.w ?? 3) * (v.x * -Math.sin(yaw) + v.z * -Math.cos(yaw)); }
      if (!best || score > best.score) best = { pos: [x, y0, z], yaw, score };
    }
  }
  col.geometry.dispose();
  return best;
}

function pixelsToBlob(data: Uint8Array, w: number, h: number, type: string, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(data.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // WebGL: Y снизу вверх
  ctx.putImageData(img, 0, 0);
  return new Promise((res) => canvas.toBlob((b) => res(b!), type, quality));
}

async function deliver(blob: Blob, name: string, save: boolean): Promise<string> {
  if (save && import.meta.env.DEV) {
    const r = await fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    return await r.text();
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

/** Панорама 360° из точки глаз игрока: куб 2048 → 4096×2048 JPEG. */
async function capturePano(gl: WebGLRenderer, scene: Scene, camera: Camera, opts: { name?: string; size?: number; save?: boolean } = {}) {
  const face = opts.size ?? 2048, W = face * 2, H = face;
  const hidden = hideSprites(scene);
  const cubeRT = new WebGLCubeRenderTarget(face, { type: HalfFloatType, generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const cubeCam = new CubeCamera(0.05, 600, cubeRT);
  cubeCam.position.copy(camera.position);
  scene.add(cubeCam);
  cubeCam.update(gl, scene);
  scene.remove(cubeCam);
  const rt = new WebGLRenderTarget(W, H);
  const quadScene = new Scene();
  EQUIRECT.uniforms.tCube.value = cubeRT.texture;
  EQUIRECT.uniforms.exposure.value = gl.toneMappingExposure;
  quadScene.add(new Mesh(new PlaneGeometry(2, 2), EQUIRECT));
  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = gl.getRenderTarget();
  gl.setRenderTarget(rt); gl.render(quadScene, ortho); gl.setRenderTarget(prevTarget);
  const px = new Uint8Array(W * H * 4);
  gl.readRenderTargetPixels(rt, 0, 0, W, H, px);
  rt.dispose(); cubeRT.dispose();
  for (const o of hidden) o.visible = true;
  const blob = await pixelsToBlob(px, W, H, 'image/jpeg', 0.92);
  const p = camera.position;
  return deliver(blob, opts.name ?? `pano_${p.x.toFixed(1)}_${p.y.toFixed(1)}_${p.z.toFixed(1)}.jpg`, !!opts.save);
}

/** Ракурс с текущей камеры в заданном разрешении (по умолчанию 2560×1440). */
async function captureShot(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, opts: { name?: string; width?: number; height?: number; save?: boolean; fov?: number } = {}) {
  const W = opts.width ?? 2560, H = opts.height ?? 1440;
  const hidden = hideSprites(scene);
  const size = gl.getSize(new (await import('three')).Vector2());
  const pr = gl.getPixelRatio();
  const aspect = camera.aspect, fov = camera.fov;
  gl.setPixelRatio(1); gl.setSize(W, H, false);
  // в туре fov 70 (широко, ~14 мм) — для продающих кадров 45–60 (≈28–35 мм), вертикали остаются вертикальными при pitch≈0
  camera.aspect = W / H; camera.fov = opts.fov ?? 50; camera.updateProjectionMatrix();
  gl.render(scene, camera);
  const dataUrl = gl.domElement.toDataURL('image/jpeg', 0.92);
  gl.setPixelRatio(pr); gl.setSize(size.x, size.y, false);
  camera.aspect = aspect; camera.fov = fov; camera.updateProjectionMatrix();
  for (const o of hidden) o.visible = true;
  const blob = await (await fetch(dataUrl)).blob();
  const p = camera.position;
  return deliver(blob, opts.name ?? `shot_${p.x.toFixed(1)}_${p.y.toFixed(1)}_${p.z.toFixed(1)}.jpg`, !!opts.save);
}


/** План этажа сверху: ортокамера, всё выше cutY отрезано. Нужен, чтобы найти помещения (ванные) на модели. */
async function capturePlan(gl: WebGLRenderer, scene: Scene, cutY: number, name: string, px = 40) {
  const root = (window as unknown as { __villaScene?: Object3D }).__villaScene ?? scene;
  const b = new Box3();
  root.traverse((o) => { const m = o as MeshT; if (m.isMesh && m.userData.role !== 'ground' && m.userData.role !== 'paving') b.expandByObject(m); });
  const W = Math.ceil((b.max.x - b.min.x) * px), H = Math.ceil((b.max.z - b.min.z) * px);
  const cam = new OrthographicCamera(b.min.x, b.max.x, -b.min.z, -b.max.z, 0.1, 200);
  cam.position.set(0, cutY + 50, 0); cam.up.set(0, 0, -1); cam.lookAt(0, cutY, 0); cam.updateProjectionMatrix();
  const size = gl.getSize(new (await import('three')).Vector2()); const pr = gl.getPixelRatio();
  const planes = gl.clippingPlanes; gl.clippingPlanes = [new Plane(new Vector3(0, -1, 0), cutY)]; gl.localClippingEnabled = true;
  gl.setPixelRatio(1); gl.setSize(W, H, false); gl.render(scene, cam);
  const dataUrl = gl.domElement.toDataURL('image/jpeg', 0.9);
  gl.clippingPlanes = planes; gl.setPixelRatio(pr); gl.setSize(size.x, size.y, false);
  const blob = await (await fetch(dataUrl)).blob();
  await deliver(blob, name, true);
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, px, W, H };
}

type ShotItem = { villa: string; id: string; kind: 'shot' | 'pano'; title: string; pos: [number, number, number]; look?: [number, number, number]; fov?: number; auto?: Parameters<typeof bestView>[1] };

/** Пакетная съёмка по public/shotlist.json: телепорт в точку (полёт), взгляд на цель, кадр или панорама, сохранение в app/captures/. */
async function runShotlist(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, villa: string, only?: string[]) {
  const list = (await (await fetch('/shotlist.json')).json()) as ShotItem[];
  const out: string[] = [];
  for (const s of list) {
    if (s.villa !== villa || (only && !only.includes(s.id))) continue;
    input.fly = true;
    let autoYaw: number | null = null;
    if (s.auto) { const b = bestView(scene, s.auto); if (b) { s.pos = b.pos; autoYaw = b.yaw; console.info('[bestView]', s.id, b); } }
    input.teleport = [s.pos[0], s.pos[1], s.pos[2]];
    if (autoYaw !== null) { input.yaw = autoYaw; input.pitch = 0.02; }
    else if (s.look) {
      const dx = s.look[0] - s.pos[0], dy = s.look[1] - (s.pos[1] + 1.62), dz = s.look[2] - s.pos[2];
      input.yaw = Math.atan2(-dx, -dz);
      input.pitch = Math.max(-0.12, Math.min(0.12, Math.atan2(dy, Math.hypot(dx, dz)))); // почти горизонт — вертикали вертикальны
    } else { input.yaw = 0; input.pitch = 0; }
    // ждём, пока Player применит телепорт и камера обновится: пауза + два кадра rAF
    await new Promise((r) => setTimeout(r, 400));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const name = `${villa}_${s.id}.jpg`;
    out.push(s.kind === 'pano'
      ? await capturePano(gl, scene, camera, { name, save: true })
      : await captureShot(gl, scene, camera, { name, save: true, fov: s.fov }));
  }
  return out;
}

/**
 * Та же съёмка по шот-листу, но внутри сцены комплекса (режим «Комплекс»): точки шот-листа заданы в
 * координатах модели виллы, здесь они переводятся в координаты дома `house-<id>` на генплане.
 * В окнах получается настоящее окружение: лагуна, берег, соседние дома.
 */
async function runShotlistComplex(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, villa: string, houseId: string, only?: string[], prefix?: string) {
  const list = (await (await fetch('/shotlist.json')).json()) as ShotItem[];
  const house = scene.getObjectByName(`house-${houseId}`);
  const drone = (window as unknown as { __drone?: { set: (p: [number, number, number], t: [number, number, number]) => void } }).__drone;
  if (!house || !drone) throw new Error('нет дома ' + houseId + ' или сцены комплекса');
  const out: string[] = [];
  const toW = (v: Vector3) => house.localToWorld(v.clone());
  for (const s of list) {
    if (s.villa !== villa || (only && !only.includes(s.id))) continue;
    let pos = new Vector3(...s.pos), dir = new Vector3(0, 0, -1);
    if (s.auto) {
      // bestView работает в координатах модели: временно ставим дом в начало координат
      const saved = { p: house.position.clone(), r: house.rotation.y };
      house.position.set(0, 0, 0); house.rotation.y = 0; house.updateMatrixWorld(true);
      const b = bestView(house, s.auto);
      house.position.copy(saved.p); house.rotation.y = saved.r; house.updateMatrixWorld(true);
      if (b) { pos = new Vector3(...b.pos); dir.set(-Math.sin(b.yaw), 0.02, -Math.cos(b.yaw)); }
    } else if (s.look) {
      dir = new Vector3(...s.look).sub(new Vector3(s.pos[0], s.pos[1] + 1.62, s.pos[2]));
      const hz = Math.hypot(dir.x, dir.z); dir.y = Math.max(-0.12, Math.min(0.12, Math.atan2(dir.y, hz))) * hz; dir.normalize();
    }
    const eye = toW(pos.clone().add(new Vector3(0, 1.62, 0)));
    const tgt = toW(pos.clone().add(new Vector3(0, 1.62, 0)).add(dir.clone().multiplyScalar(10)));
    drone.set([eye.x, eye.y, eye.z], [tgt.x, tgt.y, tgt.z]);
    await new Promise((r) => setTimeout(r, 300));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const name = `${prefix ?? 'c_'}${villa}_${s.id}.jpg`;
    out.push(s.kind === 'pano'
      ? await capturePano(gl, scene, camera, { name, save: true })
      : await captureShot(gl, scene, camera, { name, save: true, fov: s.fov }));
  }
  return out;
}

export function Capture() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const api = {
      pano: (o?: Parameters<typeof capturePano>[3]) => capturePano(gl, scene, camera, o),
      shot: (o?: Parameters<typeof captureShot>[3]) => captureShot(gl, scene, camera as PerspectiveCamera, o),
      run: (villa: string, only?: string[]) => runShotlist(gl, scene, camera as PerspectiveCamera, villa, only),
      best: (o: Parameters<typeof bestView>[1]) => bestView(scene, o),
      plan: (cutY: number, name: string, px?: number) => capturePlan(gl, scene, cutY, name, px),
      runComplex: (villa: string, houseId: string, only?: string[], prefix?: string) => runShotlistComplex(gl, scene, camera as PerspectiveCamera, villa, houseId, only, prefix),
    };
    (window as unknown as { __capture: unknown }).__capture = api;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'KeyP') api.pano();
      if (e.code === 'KeyO') api.shot();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [gl, scene, camera]);
  return null;
}
