// Проверка земли для smoke.mjs (тело async-функции, выполняется в сцене «Комплекс»):
// 1) дыры — вода лагуны красится в пурпурный, участок снимается плитками строго сверху, пурпурные пиксели на суше считаются;
// 2) ноги — насколько идущие гости ниже поверхности, по которой идут; 3) высота ленты дорожки над землёй.
const C = window.__complex; const B = C.data.site.boundary; let lagoon = null;
window.__scene.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.width > 5000) lagoon = o; });
if (!lagoon) return null;
const M = lagoon.material.constructor; const Basic = Object.getPrototypeOf(Object.getPrototypeOf(lagoon.material)).constructor; // MeshStandardMaterial → Material; ниже берём базовый через клон
const old = lagoon.material; const flat = old.clone(); flat.onBeforeCompile = () => {}; flat.customProgramCacheKey = () => 'flat-magenta'; flat.color.set(0xff00ff); flat.emissive.set(0xff00ff); flat.emissiveIntensity = 1; flat.normalMap = null; flat.envMapIntensity = 0; flat.transparent = false; flat.opacity = 1; flat.roughness = 1; flat.metalness = 0; flat.clearcoat = 0; flat.needsUpdate = true; lagoon.material = flat;
const inPoly = (x, z) => { let c = false; for (let i = 0, j = B.length - 1; i < B.length; j = i++) { const [xi, zi] = B[i], [xj, zj] = B[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const TILE = 40, PX = 800, Y = 200, G = 10; const fov = 2 * Math.atan((TILE / 2) / (Y - G)) * 180 / Math.PI; const ST = 0.25; const cells = new Map(); let shots = 0, sample = null;
const cv = document.createElement('canvas'); cv.width = cv.height = PX; const ctx = cv.getContext('2d', { willReadFrequently: true });
for (let cz = -62 + TILE / 2; cz < 54 + TILE / 2; cz += TILE) for (let cx = -66 + TILE / 2; cx < 94 + TILE / 2; cx += TILE) {
  window.__drone.set([cx, Y, cz], [cx, G, cz - 0.02]); for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => setTimeout(r, 250));
  let blob = null; const oc = URL.createObjectURL, ok = HTMLAnchorElement.prototype.click; URL.createObjectURL = (b) => { blob = b; return 'blob:x'; }; HTMLAnchorElement.prototype.click = function () {};
  try { await window.__capture.shot({ width: PX, height: PX, fov }); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ok; }
  if (!blob) continue; shots++; const bmp = await createImageBitmap(blob); ctx.drawImage(bmp, 0, 0, PX, PX); const d = ctx.getImageData(0, 0, PX, PX).data;
  for (let py = 0; py < PX; py += 2) for (let px = 0; px < PX; px += 2) { const k = (py * PX + px) * 4; const r = d[k], g = d[k + 1], b = d[k + 2]; if (!(r > 140 && b > 140 && g < r * 0.55 && g < b * 0.55)) continue;
    const x = cx + (px / PX - 0.5) * TILE, z = cz + (py / PX - 0.5) * TILE; if (!inPoly(x, z)) continue; const gh = C.heightAt(x, z); if (gh === null || gh < C.data.water_level + 0.4) continue; if (!sample) sample = [r, g, b];
    const key = Math.round(x / ST) + ',' + Math.round(z / ST); cells.set(key, (cells.get(key) || 0) + 1); } }
lagoon.material = old;
const keys = [...cells.keys()].filter((k) => cells.get(k) >= 3); const set = new Set(keys); const seen = new Set(); const comps = [];
for (const k0 of keys) { if (seen.has(k0)) continue; const comp = [k0]; seen.add(k0); for (let qi = 0; qi < comp.length; qi++) { const [i, j] = comp[qi].split(',').map(Number); for (const n of [(i - 1) + ',' + j, (i + 1) + ',' + j, i + ',' + (j - 1), i + ',' + (j + 1)]) if (set.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); } }
  let sx = 0, sz = 0; for (const k of comp) { const [i, j] = k.split(',').map(Number); sx += i * ST; sz += j * ST; } const x = sx / comp.length, z = sz / comp.length;
  let near = '', bd = 1e9; for (const h of C.houses) { const e = h.matrix.elements; const d2 = Math.hypot(x - e[12], z - e[14]); if (d2 < bd) { bd = d2; near = h.id; } }
  comps.push([+(comp.length * ST * ST).toFixed(2), +x.toFixed(1), +z.toFixed(1), near]); }
comps.sort((a, b) => b[0] - a[0]);
const feet = []; const N = window.__npcs; if (N && N.walkers && C.walkAt) for (let s = 0; s < 6; s++) { await new Promise((r) => setTimeout(r, 400)); for (const w of N.walkers) { const p = w.h.root.position; const y = C.walkAt(p.x, p.z); if (y !== null) feet.push(+(y - p.y).toFixed(3)); } }
return { holes: { n: comps.length, area: +comps.reduce((a, c) => a + c[0], 0).toFixed(1), top: comps.slice(0, 6) }, feet: { n: feet.length, sink: feet.length ? Math.max(...feet) : null }, pathFloat: C.pathFloat ?? null };
