// Съёмка из тура: ракурс (клавиша O) и панорама 360° (клавиша P) в высоком разрешении.
// Файлы скачиваются браузером; в dev-режиме window.__capture.*({ save: true }) кладёт их в app/captures/
// через эндпоинт /__save (см. vite.config.ts). Это «болванки» для фотореалистичных рендеров нейросетью.
import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  CubeCamera, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  WebGLCubeRenderTarget, WebGLRenderTarget, type WebGLRenderer, type Camera, type Object3D, type PerspectiveCamera,
} from 'three';
import { input } from './input';

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

function hideSprites(root: Object3D): Object3D[] {
  const hidden: Object3D[] = [];
  root.traverse((o) => { if ((o as { isSprite?: boolean }).isSprite && o.visible) { o.visible = false; hidden.push(o); } });
  return hidden;
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
async function captureShot(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, opts: { name?: string; width?: number; height?: number; save?: boolean } = {}) {
  const W = opts.width ?? 2560, H = opts.height ?? 1440;
  const hidden = hideSprites(scene);
  const size = gl.getSize(new (await import('three')).Vector2());
  const pr = gl.getPixelRatio();
  const aspect = camera.aspect;
  gl.setPixelRatio(1); gl.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  gl.render(scene, camera);
  const dataUrl = gl.domElement.toDataURL('image/jpeg', 0.92);
  gl.setPixelRatio(pr); gl.setSize(size.x, size.y, false);
  camera.aspect = aspect; camera.updateProjectionMatrix();
  for (const o of hidden) o.visible = true;
  const blob = await (await fetch(dataUrl)).blob();
  const p = camera.position;
  return deliver(blob, opts.name ?? `shot_${p.x.toFixed(1)}_${p.y.toFixed(1)}_${p.z.toFixed(1)}.jpg`, !!opts.save);
}

export function Capture() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const api = {
      pano: (o?: Parameters<typeof capturePano>[3]) => capturePano(gl, scene, camera, o),
      shot: (o?: Parameters<typeof captureShot>[3]) => captureShot(gl, scene, camera as PerspectiveCamera, o),
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
  void input;
  return null;
}
