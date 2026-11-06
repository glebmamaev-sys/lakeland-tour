// Персонажи комплекса (этап 4): низкополигональные люди с процедурной анимацией — гуляющие гости по сети
// дорожек, садовник с газонокосилкой на газоне, пловцы в бассейнах вилл. Всё процедурно, без скачанных моделей.
// Человек собран из коробок лицом на +z, ступни в y=0, рост ~1,7 м; руки и ноги — отдельные меши с шарниром
// в плече/бедре, чтобы крутить их по кадрам. Один материал с вершинными цветами на всех.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box3, BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { box, col, merge, C } from './Furniture';
import { distToPaths, type PathNet } from './Paths';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

const SKIN = ['#8d5a3b', '#a56b47', '#6e4529', '#c4906a', '#b07a55'];
const SHIRT = ['#f4f1ea', '#b7792f', '#3b4a6b', '#7a9a6a', '#d8c9a8', '#c45f4a', '#e9e2d2'];
const PANTS = ['#d9d2c0', '#3b4a6b', '#5a3f2b', '#8c8c80', '#2a2927'];
const HAIR = ['#1d1612', '#2a1e16', '#3a2a1e', '#0f0d0c'];

export type HumanOpts = { seed?: number; hat?: boolean; swimwear?: boolean };
export type Human = { root: Group; body: Mesh; armL: Group; armR: Group; legL: Group; legR: Group; opts: HumanOpts };

const MAT = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: DoubleSide });

/** Собирает человека; limb-группы стоят в шарнирах (плечо y=1.42, бедро y=0.9). */
export function makeHuman(opts: HumanOpts = {}): Human {
  const r = rng((opts.seed ?? 1) * 7919 + 17);
  const skin = SKIN[Math.floor(r() * SKIN.length)], shirt = SHIRT[Math.floor(r() * SHIRT.length)];
  const pants = opts.swimwear ? PANTS[1] : PANTS[Math.floor(r() * PANTS.length)], hair = HAIR[Math.floor(r() * HAIR.length)];
  const female = r() < 0.5; const tall = 0.94 + r() * 0.12;
  const root = new Group(); root.scale.setScalar(tall);
  // корпус: таз, торс, шея, голова, волосы/шляпа
  const bodyParts: BufferGeometry[] = [];
  bodyParts.push(box(0.34, 0.22, 0.2, pants, 0, 0.82, 0));                      // таз
  if (opts.swimwear) bodyParts.push(box(0.36, 0.5, 0.22, skin, 0, 1.0, 0));    // торс голый
  else bodyParts.push(box(female ? 0.36 : 0.42, 0.52, 0.22, shirt, 0, 1.0, 0)); // торс в рубашке
  bodyParts.push(box(0.1, 0.08, 0.1, skin, 0, 1.52, 0));                        // шея
  const head = new SphereGeometry(0.115, 10, 8); head.translate(0, 1.7, 0); bodyParts.push(col(head, skin, 0.02));
  const hairG = new SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * (female ? 0.62 : 0.5)); hairG.translate(0, 1.71, -0.01); bodyParts.push(col(hairG, hair, 0.02));
  if (female && !opts.hat) bodyParts.push(box(0.12, 0.3, 0.1, hair, 0, 1.4, -0.11, 0.02)); // хвост
  if (opts.hat) { // широкополая соломенная шляпа садовника
    const brim = new CylinderGeometry(0.3, 0.3, 0.02, 14); brim.translate(0, 1.78, 0); bodyParts.push(col(brim, C.rattan));
    const top = new CylinderGeometry(0.12, 0.14, 0.12, 12); top.translate(0, 1.85, 0); bodyParts.push(col(top, C.rattan));
  }
  const body = new Mesh(merge(bodyParts), MAT); body.castShadow = true;
  root.add(body);
  // конечности: геометрия вниз от шарнира
  const limb = (parts: BufferGeometry[], x: number, y: number) => { const g = new Group(); g.position.set(x, y, 0); const m = new Mesh(merge(parts), MAT); m.castShadow = true; g.add(m); return g; };
  const arm = (side: number) => limb([
    box(0.1, 0.28, 0.1, opts.swimwear ? skin : shirt, 0, -0.28, 0),            // плечо (рукав)
    box(0.09, 0.3, 0.09, skin, 0, -0.58, 0),                                   // предплечье
    box(0.08, 0.1, 0.06, skin, 0, -0.66, 0.01),                                // кисть
  ], side * 0.27, 1.42);
  const leg = (side: number) => limb([
    box(0.15, 0.42, 0.16, pants, 0, -0.44, 0),                                 // бедро (шорты/брюки)
    box(0.13, 0.46, 0.13, opts.swimwear || r() < 0.5 ? skin : pants, 0, -0.9, 0), // голень
    box(0.12, 0.05, 0.26, opts.swimwear ? skin : C.walnut, 0, -0.9, 0.05),     // ступня/сандалия
  ], side * 0.1, 0.9);
  const armL = arm(-1), armR = arm(1), legL = leg(-1), legR = leg(1);
  root.add(armL, armR, legL, legR);
  return { root, body, armL, armR, legL, legR, opts };
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

export type Pose = 'walk' | 'idle' | 'swim' | 'mow';
/** Процедурная анимация: t — время, speed — скорость движения (частота шага). */
export function animate(h: Human, pose: Pose, t: number, speed = 1.2) {
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
  } else {
    h.legL.rotation.x = h.legR.rotation.x = 0; h.armL.rotation.x = Math.sin(t * 0.8) * 0.05 - 0.1; h.armR.rotation.x = -Math.sin(t * 0.9) * 0.05 - 0.1;
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
type Walker = { h: Human; edge: number; from: number; t: number; speed: number; yaw: number; pause: number };
type Swimmer = { h: Human; box: Box3; along: 'x' | 'z'; dir: number; pos: number; speed: number; y: number };
type Gardener = { h: Human; mower: Mesh; rect: [number, number, number, number]; x: number; z: number; dir: number; row: number; speed: number; turning: number; yaw: number };

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

export function Npcs({ net, heightAt, houses, pools, inSite }: {
  net: PathNet; heightAt: (x: number, z: number) => number | null; houses: HouseLite[]; pools: Box3[]; inSite: (x: number, z: number) => boolean;
}) {
  const root = useRef<Group>(null);
  const state = useMemo(() => {
    const graph = buildGraph(net); const r = rng(11);
    const walkers: Walker[] = [];
    const n = graph.edges.length;
    for (let i = 0; i < 6 && n; i++) {
      const h = makeHuman({ seed: 100 + i }); const edge = Math.floor(r() * n); const e = graph.edges[edge];
      walkers.push({ h, edge, from: r() < 0.5 ? e.a : e.b, t: r(), speed: 0.9 + r() * 0.5, yaw: 0, pause: 0 });
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
      const h = makeHuman({ seed: 500, hat: true }); const mower = makeMower();
      gardener = { h, mower, rect: lawn, x: lawn[0] + 0.5, z: lawn[1] + 0.5, dir: 1, row: 0, speed: 0.75, turning: 0, yaw: 0 };
    }
    (window as unknown as { __npcDbg: unknown }).__npcDbg = { distToHouses: (x: number, z: number) => distToHouses(houses, x, z), distToPaths: (x: number, z: number) => distToPaths(net, x, z) };
    return { graph, walkers, swimmers, gardener };
  }, [net, heightAt, houses, pools, inSite]);

  useEffect(() => {
    const g = root.current; if (!g) return;
    for (const w of state.walkers) g.add(w.h.root);
    for (const s of state.swimmers) g.add(s.h.root);
    if (state.gardener) { g.add(state.gardener.h.root); g.add(state.gardener.mower); }
    (window as unknown as { __npcs: unknown }).__npcs = state;
    return () => { for (const w of state.walkers) g.remove(w.h.root); for (const s of state.swimmers) g.remove(s.h.root); if (state.gardener) { g.remove(state.gardener.h.root); g.remove(state.gardener.mower); } };
  }, [state]);

  const clock = useRef(0);
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1); clock.current += d; const t = clock.current;
    const { graph } = state;
    for (const w of state.walkers) {
      const e = graph.edges[w.edge]; const a = graph.nodes[w.from], b = graph.nodes[w.from === e.a ? e.b : e.a];
      const L = Math.max(0.01, a.distanceTo(b));
      if (w.pause > 0) { w.pause -= d; animate(w.h, 'idle', t + w.h.opts.seed!); }
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
      const x = a2.x + (b2.x - a2.x) * w.t, z = a2.z + (b2.z - a2.z) * w.t;
      const yaw = Math.atan2(b2.x - a2.x, b2.z - a2.z); let dy = yaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); w.yaw += dy * Math.min(1, d * 6);
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
      if (g.turning > 0) { g.turning -= d; animate(g.h, 'idle', t); }
      else {
        g.x += g.dir * g.speed * d;
        if (g.x > x1 - 0.5 || g.x < x0 + 0.5) { g.x = Math.max(x0 + 0.5, Math.min(x1 - 0.5, g.x)); g.dir *= -1; g.row++; g.turning = 1.2; if (z0 + 0.5 + g.row * rowStep > z1 - 0.5) g.row = 0; }
        g.z = z0 + 0.5 + g.row * rowStep;
        animate(g.h, 'mow', t, g.speed);
      }
      const yaw = g.dir > 0 ? Math.PI / 2 : -Math.PI / 2; let dy = yaw - g.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); g.yaw += dy * Math.min(1, d * 4);
      const y = heightAt(g.x, g.z) ?? g.h.root.position.y;
      g.h.root.position.set(g.x, y + 0.02, g.z); g.h.root.rotation.y = g.yaw;
      const mx = g.x + Math.sin(g.yaw) * 0.85, mz = g.z + Math.cos(g.yaw) * 0.85; const my = heightAt(mx, mz) ?? y;
      g.mower.position.set(mx, my + 0.02, mz); g.mower.rotation.y = g.yaw;
    }
  });
  return <group ref={root} />;
}
