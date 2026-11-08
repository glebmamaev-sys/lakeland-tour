// Персонажи комплекса (этап 4): низкополигональные люди с процедурной анимацией — гуляющие гости по сети
// дорожек, садовник с газонокосилкой на газоне, пловцы в бассейнах вилл. Всё процедурно, без скачанных моделей.
// Человек собран из коробок лицом на +z, ступни в y=0, рост ~1,7 м; руки и ноги — отдельные меши с шарниром
// в плече/бедре, чтобы крутить их по кадрам. Один материал с вершинными цветами на всех.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { playerState } from '../Player';
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationMixer, LoopRepeat, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { useGLTF } from '@react-three/drei';
import { box, col, merge, C } from './Furniture';
import * as F from './Furniture';
import { distToPaths, type PathNet } from './Paths';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

const SKIN = ['#8d5a3b', '#a56b47', '#6e4529', '#c4906a', '#b07a55'];
const SHIRT = ['#f4f1ea', '#b7792f', '#3b4a6b', '#7a9a6a', '#d8c9a8', '#c45f4a', '#e9e2d2'];
const PANTS = ['#d9d2c0', '#3b4a6b', '#5a3f2b', '#8c8c80', '#2a2927'];
const HAIR = ['#1d1612', '#2a1e16', '#3a2a1e', '#0f0d0c'];

export type HumanOpts = { seed?: number; hat?: boolean; swimwear?: boolean };
export type Skin = { mixer: AnimationMixer; actions: Record<string, AnimationAction>; cur: string; hand: Object3D | null };
export type Human = { root: Group; body: Mesh; armL: Group; armR: Group; legL: Group; legR: Group; opts: HumanOpts; female: boolean; skin?: Skin };

/** Персонажи Quaternius (CC0, «Ultimate Modular Men/Women»): public/models/chars/<id>.glb, клипы Idle, Idle_Neutral, Walk, Run, Wave, Interact. */
export const CHAR_IDS = ['m_beach', 'm_casual', 'm_hoodie', 'm_worker', 'm_farmer', 'f_casual', 'f_formal', 'f_adventurer', 'f_worker'] as const;
export type CharId = typeof CHAR_IDS[number];
export const GUEST_IDS: CharId[] = ['m_beach', 'm_casual', 'm_hoodie', 'f_casual', 'f_adventurer'];
export type CharGltf = { scene: Object3D; animations: AnimationClip[] };

/** Скелетный человек из glTF: клон с общим скелетом (SkeletonUtils), микшер, экшены по именам клипов; рост 1,88 → 1,72–1,78. */
export function makeSkinnedHuman(g: CharGltf, female: boolean, seed = 1): Human {
  const r = rng(seed * 7919 + 17);
  const root = new Group(); root.rotation.order = 'YXZ';
  const model = skeletonClone(g.scene) as Object3D;
  const h = (female ? 1.66 : 1.76) + (r() - 0.5) * 0.08; model.scale.setScalar(h / 1.88);
  model.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
  root.add(model);
  const mixer = new AnimationMixer(model); const actions: Record<string, AnimationAction> = {};
  for (const c of g.animations) { const a = mixer.clipAction(c); a.setLoop(LoopRepeat, Infinity); actions[c.name] = a; }
  const idle = actions.Idle_Neutral ?? actions.Idle; if (idle) { idle.play(); }
  const hand = model.getObjectByName('Wrist.R') ?? model.getObjectByName('WristR') ?? null; // GLTFLoader убирает точки из имён узлов
  const dummy = new Group();
  return { root, body: new Mesh(), armL: dummy, armR: dummy, legL: dummy, legR: dummy, opts: { seed }, female, skin: { mixer, actions, cur: idle ? (actions.Idle_Neutral ? 'Idle_Neutral' : 'Idle') : '', hand } };
}
/** Переключение клипа с кроссфейдом 0,25 с. */
function play(sk: Skin, name: string, timeScale = 1) {
  const next = sk.actions[name] ?? sk.actions.Idle; if (!next) return;
  next.timeScale = timeScale;
  if (sk.cur === name) return;
  const prev = sk.actions[sk.cur]; next.reset().fadeIn(0.25).play(); if (prev && prev !== next) prev.fadeOut(0.25);
  sk.cur = name;
}

const MAT = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: DoubleSide });

/** Собирает человека; limb-группы стоят в шарнирах (плечо y=1.42, бедро y=0.9). */
/** Однотонная раскраска с сохранением индекса (гладкие нормали цилиндров и сфер остаются). */
function colIdx(g: BufferGeometry, color: string): BufferGeometry {
  const c = new Color(color); const n = g.getAttribute('position').count; const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new BufferAttribute(a, 3)); return g;
}
/** Слияние индексированных частей без пересчёта нормалей — гладкие тела, рёбра только у коробок. */
function mergeSmooth(parts: BufferGeometry[]): BufferGeometry { return mergeGeometries(parts, false)!; }
const cylS = (rt: number, rb: number, h: number, color: string, x = 0, y = 0, z = 0, sz = 1, seg = 14) => { const g = new CylinderGeometry(rt, rb, h, seg); g.scale(1, 1, sz); g.translate(x, y + h / 2, z); return colIdx(g, color); };
const sphS = (r: number, color: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, seg = 16) => { const g = new SphereGeometry(r, seg, Math.round(seg * 0.75)); g.scale(sx, sy, sz); g.translate(x, y, z); return colIdx(g, color); };
const boxS = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => { const g = new BoxGeometry(w, h, d); g.translate(x, y, z); return colIdx(g, color); };
const DRESS = ['#e8705f', '#7a9a6a', '#f4f1ea', '#b7792f', '#3b4a6b', '#d9a5b3'];

/** Собирает человека: гладкие цилиндры и сферы, лицо (глаза, брови, нос, рот, уши), причёска, рубашка с воротником
 *  и рукавами, шорты/брюки/платье, сандалии; limb-группы стоят в шарнирах (плечо y=1.42, бедро y=0.9). */
export function makeHuman(opts: HumanOpts = {}): Human {
  const r = rng((opts.seed ?? 1) * 7919 + 17);
  const skin = SKIN[Math.floor(r() * SKIN.length)], shirt = SHIRT[Math.floor(r() * SHIRT.length)];
  const pants = opts.swimwear ? (r() < 0.5 ? '#3b4a6b' : '#c45f4a') : PANTS[Math.floor(r() * PANTS.length)], hair = HAIR[Math.floor(r() * HAIR.length)];
  const female = r() < 0.5; const tall = 0.94 + r() * 0.12;
  const dress = female && !opts.swimwear && !opts.hat && r() < 0.55; const dressCol = DRESS[Math.floor(r() * DRESS.length)];
  const shorts = !dress && (opts.swimwear || r() < 0.6); const longHair = female && r() < 0.7; const glasses = !opts.hat && r() < 0.25;
  const skinDark = new Color(skin).multiplyScalar(0.82).getStyle();
  const root = new Group(); root.scale.setScalar(tall); root.rotation.order = 'YXZ'; // наклон (лежать/плыть) после поворота по курсу
  const bp: BufferGeometry[] = [];
  // таз и торс
  const topCol = opts.swimwear ? skin : dress ? dressCol : shirt;
  bp.push(cylS(0.19, 0.17, 0.2, opts.swimwear || dress ? (dress ? dressCol : pants) : pants, 0, 0.78, 0, 0.62));
  bp.push(cylS(female ? 0.19 : 0.21, 0.19, 0.52, topCol, 0, 0.96, 0, 0.62));
  if (dress) bp.push(cylS(0.2, 0.33, 0.5, dressCol, 0, 0.32, 0, 0.7)); // юбка
  if (opts.swimwear && female) bp.push(cylS(0.2, 0.2, 0.14, '#c45f4a', 0, 1.2, 0, 0.64)); // верх купальника
  if (!opts.swimwear) bp.push(cylS(0.09, 0.075, 0.05, topCol, 0, 1.47, 0, 0.8)); // воротник
  bp.push(cylS(0.05, 0.055, 0.1, skin, 0, 1.46, 0));                            // шея
  // голова и лицо (лицом на +z)
  bp.push(sphS(0.12, skin, 0, 1.7, 0, 1, 1.08, 1));
  for (const sx of [-1, 1]) {
    bp.push(sphS(0.026, skin, sx * 0.118, 1.7, -0.01, 0.5, 1, 1, 8));            // ухо
    bp.push(sphS(0.022, '#f4f1ea', sx * 0.045, 1.72, 0.1, 1, 1, 0.6, 8));         // белок
    bp.push(sphS(0.011, '#1d1612', sx * 0.045, 1.72, 0.115, 1, 1, 0.6, 8));       // зрачок
    bp.push(boxS(0.05, 0.012, 0.012, hair, sx * 0.045, 1.757, 0.108));            // бровь
  }
  bp.push(boxS(0.026, 0.045, 0.03, skinDark, 0, 1.695, 0.118));                   // нос
  bp.push(boxS(0.05, 0.012, 0.012, '#8a4a3a', 0, 1.652, 0.11));                   // рот
  if (glasses) { bp.push(boxS(0.15, 0.035, 0.02, '#1d1612', 0, 1.72, 0.112)); }     // солнечные очки
  // причёска
  const cap = new SphereGeometry(0.127, 16, 10, 0, Math.PI * 2, 0, Math.PI * (female ? 0.56 : 0.5)); cap.scale(1, 1.05, 1); cap.translate(0, 1.71, -0.012); bp.push(colIdx(cap, hair));
  if (longHair && !opts.hat) bp.push(cylS(0.1, 0.085, 0.36, hair, 0, 1.36, -0.06, 0.55));  // длинные волосы сзади
  else if (female && !opts.hat) bp.push(sphS(0.06, hair, 0, 1.76, -0.1, 1, 0.8, 1, 10));     // пучок
  if (opts.hat) { // широкополая соломенная шляпа садовника
    bp.push(cylS(0.3, 0.3, 0.02, C.rattan, 0, 1.78, 0)); bp.push(cylS(0.12, 0.14, 0.12, C.rattan, 0, 1.8, 0));
  }
  const body = new Mesh(mergeSmooth(bp), MAT); body.castShadow = true;
  root.add(body);
  // конечности: геометрия вниз от шарнира
  const limb = (parts: BufferGeometry[], x: number, y: number) => { const g = new Group(); g.position.set(x, y, 0); const m = new Mesh(mergeSmooth(parts), MAT); m.castShadow = true; g.add(m); return g; };
  const arm = (side: number) => limb([
    ...(opts.swimwear ? [] : [cylS(0.07, 0.062, 0.16, topCol, 0, -0.16, 0)]),      // короткий рукав
    sphS(0.06, opts.swimwear ? skin : topCol, 0, -0.01, 0, 1, 0.8, 1, 10),         // плечо
    cylS(0.052, 0.046, 0.3, skin, 0, -0.31, 0),                                     // плечо-рука
    cylS(0.046, 0.04, 0.28, skin, 0, -0.6, 0),                                      // предплечье
    sphS(0.045, skin, 0, -0.63, 0.01, 0.8, 1, 0.6, 10),                             // кисть
  ], side * 0.26, 1.42);
  const leg = (side: number) => limb([
    ...(dress ? [cylS(0.075, 0.065, 0.42, skin, 0, -0.44, 0)]
      : shorts ? [cylS(0.085, 0.078, 0.3, pants, 0, -0.32, 0), cylS(0.07, 0.062, 0.14, skin, 0, -0.44, 0)]
      : [cylS(0.085, 0.07, 0.44, pants, 0, -0.46, 0)]),
    cylS(0.06, 0.045, 0.45, dress || shorts ? skin : pants, 0, -0.9, 0),            // голень
    boxS(0.1, 0.035, 0.25, opts.swimwear ? skin : C.walnut, 0, -0.9, 0.05),         // сандалия
  ], side * 0.1, 0.9);
  const armL = arm(-1), armR = arm(1), legL = leg(-1), legR = leg(1);
  root.add(armL, armR, legL, legR);
  return { root, body, armL, armR, legL, legR, opts, female };
}

/** Газонокосилка: корпус, 4 колеса, ручка назад-вверх. Лицом на +z (толкают сзади, ручка в −z). */
export function makeMower(): Mesh {
  const p: BufferGeometry[] = [];
  p.push(box(0.5, 0.22, 0.62, '#3a7d44', 0, 0.12, 0.05));
  p.push(box(0.46, 0.08, 0.3, '#2a2927', 0, 0.34, 0.0));                                  // мотор
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const w = new CylinderGeometry(0.1, 0.1, 0.06, 10); w.rotateZ(Math.PI / 2); w.translate(sx * 0.27, 0.1, sz * 0.25 + 0.05); p.push(col(w, '#2a2927')); }
  for (const sx of [-1, 1]) { const h = new BoxGeometry(0.03, 0.95, 0.03); h.translate(0, 0.475, 0); h.rotateX(0.75); h.translate(sx * 0.2, 0.25, -0.2); p.push(col(h, '#8c8c80')); }
  p.push(box(0.46, 0.04, 0.04, '#2a2927', 0, 0.86, -0.85));                                 // перекладина ручки
  const m = new Mesh(merge(p), MAT); m.castShadow = true; return m;
}

/** Лейка (в руке садовника): корпус, носик, ручка. Крепится к кисти правой руки. */
export function makeWateringCan(): Mesh {
  const p: BufferGeometry[] = [];
  const body = new CylinderGeometry(0.11, 0.1, 0.22, 10); body.translate(0, 0.11, 0); p.push(col(body, '#3a7d44'));
  const spout = new CylinderGeometry(0.02, 0.03, 0.3, 6); spout.rotateZ(Math.PI / 2); spout.rotateY(0.6); spout.translate(0.17, 0.17, 0.12); p.push(col(spout, '#3a7d44'));
  p.push(box(0.03, 0.12, 0.03, '#2a2927', 0, 0.22, 0));
  const m = new Mesh(merge(p), MAT); m.castShadow = true; return m;
}
/** Птица: тело-«капля» и два крыла, крылья — отдельные меши для взмаха. Лицом на +z. */
export function makeBird(): { root: Group; wl: Mesh; wr: Mesh } {
  const root = new Group();
  const body = new SphereGeometry(0.09, 6, 5); body.scale(1, 0.8, 2.2); const bm = new Mesh(col(body, '#2a2927'), MAT); root.add(bm);
  const wing = () => { const g = new BoxGeometry(0.55, 0.02, 0.22); g.translate(0.27, 0, 0); return col(g, '#333436'); };
  const wl = new Mesh(wing(), MAT); wl.scale.x = -1; const wr = new Mesh(wing(), MAT); root.add(wl, wr);
  return { root, wl, wr };
}
export type Pose = 'walk' | 'idle' | 'idle2' | 'swim' | 'mow' | 'wave' | 'lie' | 'water' | 'interact' | 'sit';
/** Реплики по ролям (по-английски): гости, садовники, администратор. Клипы — public/audio/<role>_<f|m>_<i>.mp3. */
export const GREETINGS = [
  'Hello there! So glad to see you in this little corner of paradise. Enjoy your stay at Lake Land!',
  'Welcome! It is wonderful to see you here, in our little piece of paradise by the lagoon.',
  'Hi! Great to see you. Isn\'t this place heavenly? Make yourself at home.',
  'Good day! So happy you came to visit this corner of paradise. Have a lovely walk!',
  'Oh, hello! Lovely day for a walk, isn\'t it? Enjoy every minute here.',
  'Hi there! Have you seen the lagoon at sunset yet? It is pure magic.',
  'Welcome, friend! The pool is wonderful this afternoon. Come join us later!',
  'Good to see you! This place feels like home already. I hope you love it as much as we do.',
  'Hello! Take your time, breathe the sea air. You are on paradise time now.',
  'Hey! If you are heading to the villas, the view from the upper terrace is stunning.',
  'Hi! What a beautiful morning. Wishing you a wonderful stay at Lake Land.',
  'Welcome! Everyone here is so friendly, you will feel at home in no time.',
];
export const GREETINGS_GARDENER = [
  'Good day! Just tending the lawn. The grass grows fast in this sun. Enjoy the gardens!',
  'Hello there! Mind the sprinklers, the frangipani loves them. Have a lovely walk!',
  'Welcome! Beautiful day to be outside, isn\'t it? The garden is at its best this time of year.',
];
export const GREETINGS_RECEPTION = [
  'Welcome to Lake Land! I am at reception if you need anything: a map, a coffee, or just a chat.',
  'Hello and welcome! So glad you found us. Shall I show you around the villas?',
  'Good day! Welcome to our little corner of paradise. Make yourself at home, the coffee is on us.',
];
export type GreetRole = 'guest' | 'gardener' | 'reception';
const ROLE_SETS: Record<GreetRole, { lines: string[]; prefix: string }> = { guest: { lines: GREETINGS, prefix: 'greet' }, gardener: { lines: GREETINGS_GARDENER, prefix: 'gard' }, reception: { lines: GREETINGS_RECEPTION, prefix: 'rec' } };
let current: HTMLAudioElement | null = null;
export function speak(text: string, female = true, index = 0, base = '', prefix = 'greet') {
  try {
    if (current) { current.pause(); current = null; }
    const a = new Audio(`${base}audio/${prefix}_${female ? 'f' : 'm'}_${index}.mp3`); a.volume = 0.9; current = a;
    a.play().catch(() => speakSynth(text, female));
  } catch { speakSynth(text, female); }
}
function speakSynth(text: string, female: boolean) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; u.rate = 0.92; u.pitch = female ? 1.05 : 0.9;
    const vs = speechSynthesis.getVoices().filter((x) => x.lang.startsWith('en'));
    const v = vs.find((x) => /premium|enhanced|natural|neural|siri/i.test(x.name)) ?? vs.find((x) => /google/i.test(x.name)) ?? vs[0];
    if (v) u.voice = v; speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch { /* без голоса */ }
}
/** Процедурная анимация: t — время, speed — скорость движения (частота шага). */
export function animate(h: Human, pose: Pose, t: number, speed = 1.2) {
  if (h.skin) { // клипы Quaternius; «лежать»/«плыть» для скелетных не используются
    const sk = h.skin;
    if (pose === 'walk' || pose === 'mow') play(sk, 'Walk', Math.max(0.6, speed / 1.15));
    else if (pose === 'wave') play(sk, 'Wave');
    else if (pose === 'water' || pose === 'interact') play(sk, 'Interact', 0.8);
    else if (pose === 'idle2' || pose === 'sit') play(sk, 'Idle');
    else play(sk, sk.actions.Idle_Neutral ? 'Idle_Neutral' : 'Idle');
    h.root.rotation.x = 0; return;
  }
  const f = speed * 4.6; const ph = t * f;
  const s = Math.sin(ph);
  if (pose === 'walk' || pose === 'mow') {
    h.legL.rotation.x = s * 0.55; h.legR.rotation.x = -s * 0.55;
    if (pose === 'walk') { h.armL.rotation.x = -s * 0.4; h.armR.rotation.x = s * 0.4; }
    else { h.armL.rotation.x = h.armR.rotation.x = -0.95; }                      // руки на ручке косилки
    h.body.position.y = Math.abs(Math.sin(ph)) * 0.03; h.root.rotation.x = 0; h.body.rotation.z = 0;
  } else if (pose === 'swim') {
    // кроль: тело горизонтально лицом вниз, руки мельницей, ноги работают
    h.root.rotation.x = Math.PI / 2;
    const p2 = t * 3.2; h.armL.rotation.x = p2 % (Math.PI * 2); h.armR.rotation.x = (p2 + Math.PI) % (Math.PI * 2);
    h.legL.rotation.x = Math.sin(t * 9) * 0.25; h.legR.rotation.x = -Math.sin(t * 9) * 0.25;
    h.body.position.y = 0;
  } else if (pose === 'lie') {
    // загорает на шезлонге: лицом вверх, головой к спинке (−z), руки вдоль тела, дышит
    h.root.rotation.x = -Math.PI / 2; h.legL.rotation.x = h.legR.rotation.x = 0; h.armL.rotation.x = h.armR.rotation.x = 0.08; h.armR.rotation.z = 0;
    h.body.position.y = Math.sin(t * 1.1) * 0.01;
  } else if (pose === 'water') {
    // поливает: правая рука вперёд-вниз с лейкой, слегка покачивается
    h.root.rotation.x = 0; h.legL.rotation.x = h.legR.rotation.x = 0; h.armL.rotation.x = -0.15;
    h.armR.rotation.x = 1.1 + Math.sin(t * 1.6) * 0.12; h.armR.rotation.z = -0.25; h.body.position.y = 0;
  } else if (pose === 'wave') {
    // стоит, правая рука поднята и машет
    h.legL.rotation.x = h.legR.rotation.x = 0; h.armL.rotation.x = -0.1; h.root.rotation.x = 0;
    h.armR.rotation.x = 2.75; h.armR.rotation.z = Math.sin(t * 9) * 0.35 - 0.2;
    h.body.position.y = Math.sin(t * 1.3) * 0.01;
  } else {
    h.legL.rotation.x = h.legR.rotation.x = 0; h.armL.rotation.x = Math.sin(t * 0.8) * 0.05 - 0.1; h.armR.rotation.x = -Math.sin(t * 0.9) * 0.05 - 0.1; h.armR.rotation.z = 0;
    h.body.position.y = Math.sin(t * 1.3) * 0.01; h.root.rotation.x = 0;
  }
}

// ---------- поведение ----------
type Edge = { a: number; b: number };
type Graph = { nodes: Vector3[]; adj: number[][]; edges: Edge[] };
function buildGraph(net: PathNet): Graph {
  const nodes = net.nodes.map((n) => n.clone()); const edges: Edge[] = []; const adj: number[][] = nodes.map(() => []);
  const idx = (p: Vector3) => { let best = 0, bd = Infinity; nodes.forEach((n, i) => { const d = n.distanceTo(p); if (d < bd) { bd = d; best = i; } }); return best; };
  for (const l of net.lines) for (let i = 0; i < l.length - 1; i++) {
    const a = idx(l[i]), b = idx(l[i + 1]); if (a === b) continue;
    const e = edges.length; edges.push({ a, b }); adj[a].push(e); adj[b].push(e);
  }
  return { nodes, adj, edges };
}

type HouseLite = { fp: [number, number, number, number]; matrix: Matrix4 };
type Walker = { h: Human; edge: number; from: number; t: number; speed: number; yaw: number; pause: number; greet: number; cool: number; leader?: number; side: number };
type Sunbather = { h: Human; lounger: Mesh; x: number; y: number; z: number; yaw: number };
type Waterer = { h: Human; can: Mesh; spots: Vector3[]; i: number; x: number; z: number; yaw: number; watering: number; greet: number; cool: number };
type Idler = { h: Human; x: number; y: number; z: number; yaw: number; cur: number; greet: number; cool: number; role: GreetRole; anim: 'idle' | 'idle2' | 'interact' | 'sit' };
/** Стоящий/сидящий персонаж: где, куда смотрит, какой клип, кто по роли (приветствие), какая модель. */
export type IdlerSpec = { x: number; y: number; z: number; yaw: number; char?: CharId; role?: GreetRole; anim?: Idler['anim'] };
export type TerraceSpotW = { x: number; y: number; z: number; yaw: number; kind: 'rail' | 'sit'; house: string };
// поза «сидит»: клип Idle, после шага микшера бёдра направлены вперёд (чуть вниз), голени вертикально вниз, стопы
// (отдельные кости под Root в риге Quaternius) переставлены к концу голени; корень опущен так, чтобы тазобедренный
// сустав оказался на 0,66 м над сиденьем (стоя он на 0,932·масштаб)
const SIT = { hip: 0.932, seat: 0.66, shin: 0.5, tilt: 0.15 };
(window as unknown as { __sit: unknown }).__sit = SIT;
const qTmp = new Quaternion(), qPar = new Quaternion(), vA = new Vector3(), vB = new Vector3(), vC = new Vector3();
/** Поворот кости в мировых осях: world' = q · world. */
function rotateBoneWorld(bone: Object3D, q: Quaternion) {
  bone.parent!.getWorldQuaternion(qPar); const loc = qPar.clone().invert().multiply(q).multiply(qPar); bone.quaternion.premultiply(loc);
}
/** Направление кости (локальная +Y) в мире. */
function boneDir(bone: Object3D, out: Vector3) { bone.getWorldPosition(vA); bone.localToWorld(out.set(0, 1, 0)); return out.sub(vA).normalize(); }
function aimBone(bone: Object3D, target: Vector3) { boneDir(bone, vB); qTmp.setFromUnitVectors(vB, target); rotateBoneWorld(bone, qTmp); bone.updateMatrixWorld(true); }
function applySit(h: Human) {
  const m = h.root.children[0]; if (!m) return;
  m.updateMatrixWorld(true);
  const fwd = vC.set(Math.sin(h.root.rotation.y), 0, Math.cos(h.root.rotation.y));
  const thighT = fwd.clone().setY(-SIT.tilt).normalize(), shinT = fwd.clone().multiplyScalar(0.08).setY(-1).normalize();
  for (const side of ['L', 'R']) {
    const up = m.getObjectByName('UpperLeg' + side), lo = m.getObjectByName('LowerLeg' + side), foot = m.getObjectByName('Foot' + side);
    if (!up || !lo) continue;
    aimBone(up, thighT); aimBone(lo, shinT);
    if (foot && foot.parent) { lo.getWorldPosition(vA); vA.addScaledVector(shinT, SIT.shin); foot.parent.worldToLocal(vA); foot.position.copy(vA); }
  }
}
type Bird = { root: Group; wl: Mesh; wr: Mesh; r: number; w: number; ph: number; y: number; cx: number; cz: number };
type Swimmer = { h: Human; box: Box3; along: 'x' | 'z'; dir: number; pos: number; speed: number; y: number };
type Gardener = { h: Human; mower: Mesh; rect: [number, number, number, number]; x: number; z: number; dir: number; row: number; speed: number; turning: number; yaw: number; greet: number; cool: number };

const tmp = new Vector3(), tmp2 = new Vector3(), inv = new Matrix4();
function distToHouses(houses: HouseLite[], x: number, z: number): number {
  let best = Infinity;
  for (const h of houses) {
    inv.copy(h.matrix).invert(); tmp.set(x, 0, z).applyMatrix4(inv);
    const dx = Math.max(h.fp[0] - tmp.x, 0, tmp.x - h.fp[2]), dz = Math.max(h.fp[1] - tmp.z, 0, tmp.z - h.fp[3]);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Ищет ровный газон 12×8 м: внутри участка, ≥4 м от домов, ≥3 м от дорожек, перепад по углам < 1 м. */
export function findLawn(houses: HouseLite[], net: PathNet, heightAt: (x: number, z: number) => number | null, inSite: (x: number, z: number) => boolean, seed = 3): [number, number, number, number] | null {
  const r = rng(seed); let best: { s: number; rect: [number, number, number, number] } | null = null;
  const dbg = { site: 0, house: 0, path: 0, null: 0, slope: 0, ok: 0 }; (window as unknown as { __lawnDbg: unknown }).__lawnDbg = dbg;
  for (let k = 0; k < 1500; k++) {
    const cx = -90 + r() * 180, cz = -70 + r() * 140; const w = 10, d = 7;
    const corners: [number, number][] = [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx - w / 2, cz + d / 2], [cx + w / 2, cz + d / 2], [cx, cz]];
    if (!corners.every(([x, z]) => inSite(x, z))) { dbg.site++; continue; }
    const dh = Math.min(...corners.map(([x, z]) => distToHouses(houses, x, z))); if (dh < 3) { dbg.house++; continue; }
    const dp = Math.min(...corners.map(([x, z]) => distToPaths(net, x, z))); if (dp < 2.5) { dbg.path++; continue; }
    const hs = corners.map(([x, z]) => heightAt(x, z)); if (hs.some((v) => v === null)) { dbg.null++; continue; }
    const range = Math.max(...(hs as number[])) - Math.min(...(hs as number[])); if (range > 1.2) { dbg.slope++; continue; }
    dbg.ok++;
    const s = Math.min(dh, 10) + Math.min(dp, 6) - range * 3;
    if (!best || s > best.s) best = { s, rect: [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2] };
  }
  return best?.rect ?? null;
}

export function Npcs({ net, heightAt, houses, pools, inSite, audioBase = '', shrubs = [], lagoon = [120, 0], idlers = [], terraceSpots = [] }: {
  net: PathNet; heightAt: (x: number, z: number) => number | null; houses: HouseLite[]; pools: Box3[]; inSite: (x: number, z: number) => boolean; audioBase?: string;
  shrubs?: { x: number; y: number; z: number }[]; lagoon?: [number, number]; idlers?: IdlerSpec[]; terraceSpots?: TerraceSpotW[];
}) {
  const root = useRef<Group>(null);
  const chars = useGLTF(CHAR_IDS.map((id) => `${audioBase}models/chars/${id}.glb`)) as unknown as CharGltf[];
  const charOf = (id: CharId) => chars[CHAR_IDS.indexOf(id)];
  const state = useMemo(() => {
    const graph = buildGraph(net); const r = rng(11);
    const walkers: Walker[] = [];
    const n = graph.edges.length;
    for (let i = 0; i < 6 && n; i++) {
      const gid = GUEST_IDS[(i * 7 + 3) % GUEST_IDS.length]; const h = makeSkinnedHuman(charOf(gid), gid.startsWith('f_'), 100 + i);
      const edge = Math.floor(r() * n); const e = graph.edges[edge];
      // гости 1 и 3 идут парой со своим «ведущим» (0 и 2): тем же путём, на шаг позади и чуть сбоку
      const leader = i === 1 || i === 3 ? i - 1 : undefined;
      walkers.push({ h, edge, from: r() < 0.5 ? e.a : e.b, t: r(), speed: 0.9 + r() * 0.5, yaw: 0, pause: 0, greet: 0, cool: 0, leader, side: i % 2 ? 0.7 : 0 });
    }
    // пловцы: в бассейнах длиной ≥ 5 м, по одному; в самом большом — двое
    const big = pools.filter((b) => { const s = b.getSize(tmp2); return Math.max(s.x, s.z) >= 5 && Math.min(s.x, s.z) >= 2.2; })
      .sort((p, q) => q.getSize(tmp2).lengthSq() - p.getSize(tmp).lengthSq());
    const swimmers: Swimmer[] = [];
    big.slice(0, 4).forEach((b, i) => {
      const s = b.getSize(tmp2); const along = s.x >= s.z ? 'x' : 'z';
      const count = i === 0 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const h = makeHuman({ seed: 300 + i * 3 + k, swimwear: true });
        swimmers.push({ h, box: b, along, dir: k ? -1 : 1, pos: 0.2 + r() * 0.6, speed: 0.7 + r() * 0.3, y: b.max.y - 0.05 });
      }
    });
    // садовник с косилкой на самом ровном газоне
    const lawn = findLawn(houses, net, heightAt, inSite);
    let gardener: Gardener | null = null;
    if (lawn) {
      const h = makeSkinnedHuman(charOf('m_farmer'), false, 500); const mower = makeMower();
      gardener = { h, mower, rect: lawn, x: lawn[0] + 0.5, z: lawn[1] + 0.5, dir: 1, row: 0, speed: 0.75, turning: 0, yaw: 0, greet: 0, cool: 0 };
    }
    // загорающие: два шезлонга у длинной стороны бассейна, дальней от дома, если там не стена
    const sunbathers: Sunbather[] = [];
    const housePos = houses.map((h) => new Vector3().setFromMatrixPosition(h.matrix));
    big.slice(0, 3).forEach((b, i) => {
      const s = b.getSize(tmp2); const c = b.getCenter(new Vector3()); const along = s.x >= s.z ? 'x' : 'z';
      const hp = housePos.slice().sort((p, q) => p.distanceTo(c) - q.distanceTo(c))[0] ?? c;
      // стороны бассейна (дальняя от дома первой), отступ 1,4 или 2,2 м; нужна ровная площадка на уровне борта и не в стене
      const sides: { x: number; z: number; yaw: number }[][] = [];
      const mk = (sx: number, sz: number, off: number) => [0, 1].map((k) => {
        const u = (k - 0.5) * 1.7;
        if (sx) return { x: (sx > 0 ? b.max.x : b.min.x) + sx * off, z: c.z + u, yaw: sx > 0 ? Math.PI / 2 : -Math.PI / 2 };
        return { x: c.x + u, z: (sz > 0 ? b.max.z : b.min.z) + sz * off, yaw: sz > 0 ? Math.PI : 0 }; // ногами к воде
      });
      const order = along === 'x' ? [[0, c.z >= hp.z ? 1 : -1], [0, c.z >= hp.z ? -1 : 1], [1, 0], [-1, 0]] : [[c.x >= hp.x ? 1 : -1, 0], [c.x >= hp.x ? -1 : 1, 0], [0, 1], [0, -1]];
      for (const [sx, sz] of order) for (const off of [1.4, 2.2]) sides.push(mk(sx, sz, off));
      const flat = (x: number, z: number) => { const ys = [[-0.5, -0.8], [0.5, -0.8], [-0.5, 0.8], [0.5, 0.8]].map(([dx, dz]) => heightAt(x + dx, z + dz)); if (ys.some((y) => y === null)) return false; const v = ys as number[]; return Math.max(...v) - Math.min(...v) < 0.3 && Math.abs((v[0] + v[3]) / 2 - b.max.y) < 1.6; };
      const pick = sides.find((pair) => pair.every((p) => distToHouses(houses, p.x, p.z) > 0.6 && flat(p.x, p.z) && inSite(p.x, p.z)));
      if (!pick) return;
      pick.forEach((p, k) => {
        const y = (heightAt(p.x, p.z) ?? b.max.y) + 0.02;
        const lounger = new Mesh(F.lounger(), MAT); lounger.castShadow = true; lounger.position.set(p.x, y, p.z); lounger.rotation.y = p.yaw;
        const h = makeHuman({ seed: 700 + i * 2 + k, swimwear: true });
        sunbathers.push({ h, lounger, x: p.x, y, z: p.z, yaw: p.yaw });
      });
    });
    // второй садовник: поливает кусты из лейки, обходя 3–4 ближних куста
    let waterer: Waterer | null = null;
    const inside = shrubs.filter((p) => inSite(p.x, p.z) && distToPaths(net, p.x, p.z) > 1.2 && distToHouses(houses, p.x, p.z) > 1.2);
    if (inside.length > 3) {
      const start = inside[Math.floor(inside.length * 0.37)];
      const spots = inside.slice().sort((p, q) => Math.hypot(p.x - start.x, p.z - start.z) - Math.hypot(q.x - start.x, q.z - start.z)).slice(0, 4).map((p) => new Vector3(p.x, p.y, p.z));
      const h = makeSkinnedHuman(charOf('f_worker'), true, 520); const can = makeWateringCan();
      if (h.skin?.hand) { can.scale.setScalar(1 / (h.root.children[0].scale.x || 1)); can.position.set(0.05, -0.1, 0.05); can.rotation.z = -Math.PI / 2; h.skin.hand.add(can); }
      waterer = { h, can, spots, i: 0, x: spots[0].x + 0.9, z: spots[0].z, yaw: 0, watering: 5, greet: 0, cool: 0 };
    }
    // птицы: стая кружит над лагуной
    const birds: Bird[] = [];
    for (let i = 0; i < 9; i++) { const b = makeBird(); birds.push({ ...b, r: 22 + r() * 30, w: (0.09 + r() * 0.05) * (i % 3 ? 1 : -1), ph: r() * Math.PI * 2, y: 28 + r() * 18, cx: lagoon[0] + (r() - 0.5) * 60, cz: lagoon[1] + (r() - 0.5) * 60 }); }
    (window as unknown as { __npcDbg: unknown }).__npcDbg = { distToHouses: (x: number, z: number) => distToHouses(houses, x, z), distToPaths: (x: number, z: number) => distToPaths(net, x, z) };
    // стоящие персонажи (администратор за стойкой): стоят, здороваются, возвращаются к своему направлению
    const standing: Idler[] = idlers.map((p, i) => { const id = p.char ?? 'f_formal'; return { h: makeSkinnedHuman(charOf(id), id.startsWith('f_'), 900 + i), x: p.x, y: p.y, z: p.z, yaw: p.yaw, cur: p.yaw, greet: 0, cool: 0, role: p.role ?? 'reception', anim: p.anim ?? 'idle' }; });
    // гости на террасах вилл: в каждом доме не больше двух мест (диван + кромка), всего до 12; у кромки иногда пара беседует
    {
      const rt = rng(23); const byHouse = new Map<string, TerraceSpotW[]>();
      for (const sp of terraceSpots) (byHouse.get(sp.house) ?? byHouse.set(sp.house, []).get(sp.house)!).push(sp);
      const chosen: TerraceSpotW[] = [];
      for (const [, list] of byHouse) {
        const sit = list.filter((p) => p.kind === 'sit'), rail = list.filter((p) => p.kind === 'rail');
        if (sit.length && rt() < 0.8) chosen.push(sit[Math.floor(rt() * sit.length)]);
        if (rail.length && rt() < 0.85) chosen.push(rail[Math.floor(rt() * rail.length)]);
      }
      let gi = 0;
      for (const sp of chosen.slice(0, 12)) {
        const mk = (x: number, z: number, yaw: number, anim: Idler['anim']) => { const id = GUEST_IDS[(gi * 3 + 1) % GUEST_IDS.length]; gi++; /* шаг 3 взаимно прост с длиной списка (5) — соседи разные */ standing.push({ h: makeSkinnedHuman(charOf(id), id.startsWith('f_'), 950 + gi), x, y: sp.y, z, yaw, cur: yaw, greet: 0, cool: 0, role: 'guest', anim }); };
        if (sp.kind === 'sit') mk(sp.x, sp.z, sp.yaw, 'sit');
        else if (rt() < 0.45) { const px = Math.cos(sp.yaw), pz = -Math.sin(sp.yaw); mk(sp.x - px * 0.42, sp.z - pz * 0.42, sp.yaw + 0.75, 'idle'); mk(sp.x + px * 0.42, sp.z + pz * 0.42, sp.yaw - 0.75, 'idle2'); } // пара беседует, глядя на вид
        else mk(sp.x, sp.z, sp.yaw, rt() < 0.5 ? 'idle' : 'idle2');
      }
    }
    return { graph, walkers, swimmers, gardener, sunbathers, waterer, birds, standing };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net, heightAt, houses, pools, inSite, shrubs, lagoon, idlers, terraceSpots, chars]);

  useEffect(() => {
    const g = root.current; if (!g) return;
    for (const w of state.walkers) g.add(w.h.root);
    for (const s of state.swimmers) g.add(s.h.root);
    if (state.gardener) { g.add(state.gardener.h.root); g.add(state.gardener.mower); }
    for (const s of state.sunbathers) { g.add(s.h.root); g.add(s.lounger); }
    if (state.waterer) g.add(state.waterer.h.root);
    for (const b of state.birds) g.add(b.root);
    for (const i of state.standing) g.add(i.h.root);
    (window as unknown as { __npcs: unknown }).__npcs = state;
    return () => { g.clear(); };
  }, [state]);

  const clock = useRef(0);
  // приветствие: игрок остановился рядом (< 3,2 м, почти не двигается 0,5 с) — персонаж поворачивается, машет,
  // говорит по-английски (пузырь + synthesis), через 6 с идёт дальше; один говорящий за раз, пауза 40 с на персонажа
  const [bubble, setBubble] = useState<{ pos: [number, number, number]; text: string } | null>(null);
  const playerTrack = useRef({ x: 0, z: 0, still: 0 });
  const greetingActive = useRef(false);
  const GREET_T = 6.5;
  const tryGreet = (h: Human, cool: number, d: number, role: GreetRole = 'guest'): string | null => {
    const pos = h.root.position; const P = playerState.pos; if (!P || cool > 0 || greetingActive.current) return null;
    if (Math.hypot(P.x - pos.x, P.z - pos.z) > 3.2 || Math.abs(P.y - pos.y) > 2.2 || playerTrack.current.still < 0.5) return null;
    const set = ROLE_SETS[role]; const i = Math.floor(Math.random() * set.lines.length); const text = set.lines[i];
    greetingActive.current = true; setBubble({ pos: [pos.x, pos.y + 2.05, pos.z], text }); speak(text, h.female, i, audioBase, set.prefix);
    setTimeout(() => { greetingActive.current = false; setBubble(null); }, GREET_T * 1000 - 200);
    void d; return text;
  };
  const faceTo = (pos: Vector3, cur: number, d: number) => { const P = playerState.pos; if (!P) return cur; const yaw = Math.atan2(P.x - pos.x, P.z - pos.z); let dy = yaw - cur; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); return cur + dy * Math.min(1, d * 5); };
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1); clock.current += d; const t = clock.current;
    const { graph } = state;
    const P = playerState.pos; const pt = playerTrack.current;
    if (P) { if (Math.hypot(P.x - pt.x, P.z - pt.z) < 0.12) pt.still += d; else { pt.still = 0; pt.x = P.x; pt.z = P.z; } } else pt.still = 0;
    for (const w of state.walkers) {
      const e = graph.edges[w.edge]; const a = graph.nodes[w.from], b = graph.nodes[w.from === e.a ? e.b : e.a];
      const L = Math.max(0.01, a.distanceTo(b));
      w.cool = Math.max(0, w.cool - d);
      if (w.greet <= 0 && tryGreet(w.h, w.cool, d)) w.greet = GREET_T;
      if (w.greet > 0) { w.greet -= d; if (w.greet <= 0) w.cool = 40; animate(w.h, 'wave', t); w.yaw = faceTo(w.h.root.position, w.yaw, d); w.h.root.rotation.y = w.yaw; continue; }
      const lead = w.leader !== undefined ? state.walkers[w.leader] : null;
      if (lead) { // идёт за ведущим тем же путём, на 1,1 м позади; стоит, когда стоит он
        const le = graph.edges[lead.edge]; const la = graph.nodes[lead.from], lb = graph.nodes[lead.from === le.a ? le.b : le.a];
        w.edge = lead.edge; w.from = lead.from; w.t = Math.max(0, lead.t - 1.1 / Math.max(0.01, la.distanceTo(lb)));
        if (lead.pause > 0 || lead.greet > 0) animate(w.h, 'idle', t + w.h.opts.seed!); else animate(w.h, 'walk', t + w.h.opts.seed!, lead.speed);
      }
      else if (w.pause > 0) { w.pause -= d; animate(w.h, 'idle', t + w.h.opts.seed!); }
      else {
        w.t += (w.speed * d) / L;
        if (w.t >= 1) { // в узле: следующее ребро (не назад, если есть выбор), иногда постоять
          const to = w.from === e.a ? e.b : e.a; const opts = graph.adj[to].filter((k) => k !== w.edge);
          const next = opts.length ? opts[Math.floor(Math.random() * opts.length)] : w.edge;
          w.edge = next; w.from = to; w.t = 0; if (Math.random() < 0.25) w.pause = 2 + Math.random() * 4;
        }
        animate(w.h, 'walk', t + w.h.opts.seed!, w.speed);
      }
      const e2 = graph.edges[w.edge]; const a2 = graph.nodes[w.from], b2 = graph.nodes[w.from === e2.a ? e2.b : e2.a];
      const yaw = Math.atan2(b2.x - a2.x, b2.z - a2.z); let dy = yaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); w.yaw += dy * Math.min(1, d * 6);
      const x = a2.x + (b2.x - a2.x) * w.t + Math.cos(yaw) * w.side, z = a2.z + (b2.z - a2.z) * w.t - Math.sin(yaw) * w.side;
      const y = heightAt(x, z); w.h.root.position.set(x, (y ?? w.h.root.position.y) + 0.02, z); w.h.root.rotation.y = w.yaw;
    }
    for (const s of state.swimmers) {
      const b = s.box; const len = (s.along === 'x' ? b.max.x - b.min.x : b.max.z - b.min.z) - 2.6; // запас на длину тела
      s.pos += (s.dir * s.speed * d) / Math.max(1, len);
      if (s.pos > 1) { s.pos = 1; s.dir = -1; } else if (s.pos < 0) { s.pos = 0; s.dir = 1; }
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2; const off = s.pos * len - len / 2 - 0.8 * s.dir; // голова впереди, origin в ступнях
      if (s.along === 'x') { s.h.root.position.set(cx + off, s.y, cz + (s.h.opts.seed! % 2 ? 0.7 : -0.7)); s.h.root.rotation.y = s.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      else { s.h.root.position.set(cx + (s.h.opts.seed! % 2 ? 0.7 : -0.7), s.y, cz + off); s.h.root.rotation.y = s.dir > 0 ? 0 : Math.PI; }
      animate(s.h, 'swim', t + s.h.opts.seed!);
    }
    const g = state.gardener;
    if (g) {
      const [x0, z0, x1, z1] = g.rect; const rowStep = 0.55;
      g.cool = Math.max(0, g.cool - d);
      if (g.greet <= 0 && tryGreet(g.h, g.cool, d, 'gardener')) g.greet = GREET_T;
      if (g.greet > 0) { g.greet -= d; if (g.greet <= 0) g.cool = 40; animate(g.h, 'wave', t); g.yaw = faceTo(g.h.root.position, g.yaw, d); g.h.root.rotation.y = g.yaw; }
      else if (g.turning > 0) { g.turning -= d; animate(g.h, 'idle', t); }
      else {
        g.x += g.dir * g.speed * d;
        if (g.x > x1 - 0.5 || g.x < x0 + 0.5) { g.x = Math.max(x0 + 0.5, Math.min(x1 - 0.5, g.x)); g.dir *= -1; g.row++; g.turning = 1.2; if (z0 + 0.5 + g.row * rowStep > z1 - 0.5) g.row = 0; }
        g.z = z0 + 0.5 + g.row * rowStep;
        animate(g.h, 'mow', t, g.speed);
      }
      if (g.greet <= 0) { const yaw = g.dir > 0 ? Math.PI / 2 : -Math.PI / 2; let dy = yaw - g.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.yaw += dy * Math.min(1, d * 4); }
      const y = heightAt(g.x, g.z) ?? g.h.root.position.y;
      g.h.root.position.set(g.x, y + 0.02, g.z); g.h.root.rotation.y = g.yaw;
      const mx = g.x + Math.sin(g.yaw) * 0.85, mz = g.z + Math.cos(g.yaw) * 0.85; const my = heightAt(mx, mz) ?? y;
      if (g.greet <= 0) { g.mower.position.set(mx, my + 0.02, mz); g.mower.rotation.y = g.yaw; }
    }
    for (const s of state.sunbathers) {
      // origin — ступни; после поворота тело уходит в −z локально: ставим ступни у ножного края шезлонга
      s.h.root.position.set(s.x + Math.sin(s.yaw) * 0.72, s.y + 0.42, s.z + Math.cos(s.yaw) * 0.72); s.h.root.rotation.y = s.yaw; // ступни у ножного края, голова к спинке
      animate(s.h, 'lie', t + s.h.opts.seed!);
    }
    const wt = state.waterer;
    if (wt) {
      wt.cool = Math.max(0, wt.cool - d);
      if (wt.greet <= 0 && tryGreet(wt.h, wt.cool, d, 'gardener')) wt.greet = GREET_T;
      if (wt.greet > 0) { wt.greet -= d; if (wt.greet <= 0) wt.cool = 40; animate(wt.h, 'wave', t); wt.yaw = faceTo(wt.h.root.position, wt.yaw, d); }
      else {
        const sp = wt.spots[wt.i]; const tx = sp.x + 0.9, tz = sp.z; const dist = Math.hypot(tx - wt.x, tz - wt.z);
        if (dist > 0.15) { // идёт к следующему кусту
          const yaw = Math.atan2(tx - wt.x, tz - wt.z); let dy = yaw - wt.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); wt.yaw += dy * Math.min(1, d * 5);
          const st = Math.min(dist, 0.8 * d); wt.x += Math.sin(yaw) * st; wt.z += Math.cos(yaw) * st; animate(wt.h, 'walk', t, 0.8);
        } else { // поливает, повернувшись к кусту
          const yaw = Math.atan2(sp.x - wt.x, sp.z - wt.z); let dy = yaw - wt.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); wt.yaw += dy * Math.min(1, d * 5);
          wt.watering -= d; animate(wt.h, 'water', t);
          if (wt.watering <= 0) { wt.i = (wt.i + 1) % wt.spots.length; wt.watering = 5 + Math.random() * 3; }
        }
      }
      const y = heightAt(wt.x, wt.z) ?? wt.h.root.position.y; wt.h.root.position.set(wt.x, y + 0.02, wt.z); wt.h.root.rotation.y = wt.yaw;
    }
    for (const st of state.standing) {
      st.cool = Math.max(0, st.cool - d);
      const sitting = st.anim === 'sit';
      if (st.greet <= 0 && tryGreet(st.h, st.cool, d, st.role)) st.greet = GREET_T;
      if (st.greet > 0) { st.greet -= d; if (st.greet <= 0) st.cool = 40; animate(st.h, sitting ? 'sit' : 'wave', t); if (!sitting) st.cur = faceTo(st.h.root.position, st.cur, d); }
      else { animate(st.h, st.anim, t + st.h.opts.seed!); let dy = st.yaw - st.cur; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); st.cur += dy * Math.min(1, d * 3); }
      const sc = st.h.root.children[0]?.scale.x ?? 1;
      st.h.root.position.set(st.x, sitting ? st.y + SIT.seat - SIT.hip * sc : st.y, st.z); st.h.root.rotation.y = st.cur;
    }
    for (const b of state.birds) {
      const a = b.ph + t * b.w; const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r;
      b.root.position.set(x, b.y + Math.sin(t * 0.7 + b.ph) * 2, z);
      b.root.rotation.y = Math.atan2(-Math.sin(a) * b.w, Math.cos(a) * b.w) ; // по касательной
      const flap = Math.sin(t * 7 + b.ph) * 0.6; b.wl.rotation.z = -flap; b.wr.rotation.z = flap;
    }
    // скелетные персонажи: шаг микшеров
    for (const h of [...state.walkers.map((w) => w.h), ...(state.gardener ? [state.gardener.h] : []), ...(wt ? [wt.h] : []), ...state.standing.map((i) => i.h)]) h.skin?.mixer.update(d);
    for (const st of state.standing) if (st.anim === 'sit') applySit(st.h); // поза «сидит» поверх клипа
    // игрок не проходит сквозь людей: мягкий толчок наружу
    if (P) {
      const all = [...state.walkers.map((w) => w.h), ...(state.gardener ? [state.gardener.h] : []), ...(wt ? [wt.h] : []), ...state.standing.map((i) => i.h)];
      for (const h of all) {
        const dx = P.x - h.root.position.x, dz = P.z - h.root.position.z; const dist = Math.hypot(dx, dz);
        if (dist < 0.7 && dist > 1e-4 && Math.abs(P.y - h.root.position.y) < 2) { const k = (0.7 - dist) / dist; P.x += dx * k; P.z += dz * k; }
      }
    }
  });
  return (
    <group ref={root}>
      {bubble && <Html position={bubble.pos} center zIndexRange={[50, 0]} style={{ pointerEvents: 'none' }}><div className="npc-bubble">{bubble.text}</div></Html>}
    </group>
  );
}
