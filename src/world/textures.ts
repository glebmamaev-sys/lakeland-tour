// Процедурные текстуры мира (без скачивания чужих файлов): облака, нормали воды, шум для вариации газона.
import { uEve } from './DayTime';
import { CanvasTexture, Color, Vector4, RepeatWrapping, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter, type MeshStandardMaterial, type Texture } from 'three';

function rng(seed: number) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/** Бесшовный value-noise на сетке n×n с периодом; fbm из нескольких октав. 0..1 */
export function noiseField(n: number, octaves = 4, seed = 1): Float32Array {
  const out = new Float32Array(n * n);
  let amp = 1, freq = 4, total = 0;
  const r = rng(seed);
  for (let o = 0; o < octaves; o++) {
    const g = freq; const grid = new Float32Array(g * g); for (let i = 0; i < g * g; i++) grid[i] = r();
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = (x / n) * g, fy = (y / n) * g; const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy; const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = (ix0: number, iy0: number) => grid[((iy0 % g) * g) + (ix0 % g)];
      const a = v(ix, iy), b = v(ix + 1, iy), c = v(ix, iy + 1), d = v(ix + 1, iy + 1);
      out[y * n + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
    }
    total += amp; amp *= 0.5; freq *= 2;
  }
  for (let i = 0; i < n * n; i++) out[i] /= total;
  return out;
}

/** Нормал-карта ряби для воды (бесшовная, по высотному полю шума). */
export function makeWaterNormalTexture(n = 512): CanvasTexture {
  const h = noiseField(n, 5, 11);
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
  const H = (x: number, y: number) => h[((y + n) % n) * n + ((x + n) % n)];
  const k = 6; // сила рельефа
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1); const i = (y * n + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 4;
  return t;
}

/** Мягкое облако (альфа-пятно из шума) для спрайтов облаков. */
export function makeCloudCanvas(n = 256): HTMLCanvasElement {
  const f = noiseField(n, 4, 5);
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x / n - 0.5, dy = y / n - 0.5; const rad = Math.hypot(dx, dy) * 2; // 0 в центре, 1 на краю
    const fall = Math.max(0, 1 - rad * rad); const v = Math.max(0, (f[y * n + x] - 0.35) * 1.8) * fall;
    const a = Math.min(1, v); const i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Крупный шум для вариации газона (бесшовный, серый). */
export function makeNoiseTexture(n = 256, seed = 3): CanvasTexture {
  const f = noiseField(n, 3, seed);
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const v = f[i] * 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; return t;
}

/** Две абстрактные картины в земляных тонах (охра, уголь, песок) рядом: 1024×512, каждому холсту половина. */
export function makeArtTexture(): CanvasTexture {
  const W = 1024, H = 512; const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d')!;
  const r = rng(41);
  for (let k = 0; k < 2; k++) {
    const x0 = k * W / 2; ctx.fillStyle = k ? '#e9e2d2' : '#ddd3bf'; ctx.fillRect(x0, 0, W / 2, H);
    const pal = ['#b7792f', '#8b5a2b', '#3a3836', '#d8c9a8', '#6b5a48', '#c9a66b'];
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = pal[Math.floor(r() * pal.length)]; ctx.globalAlpha = 0.35 + r() * 0.5;
      const w = 40 + r() * 220, h = 20 + r() * 160; const x = x0 + r() * (W / 2 - w), y = r() * (H - h);
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate((r() - 0.5) * 0.5); ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.globalAlpha = 0.9; ctx.strokeStyle = '#2f2d2b'; ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x0 + r() * W / 2, r() * H); ctx.bezierCurveTo(x0 + r() * W / 2, r() * H, x0 + r() * W / 2, r() * H, x0 + r() * W / 2, r() * H); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

/** Мелкое переплетение ткани (лён/джут): бесшовная серая текстура с нитями по двум осям и шумом. */
export function makeWeaveTexture(n = 256, seed = 9): CanvasTexture {
  const f = noiseField(n, 3, seed);
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const wx = 0.5 + 0.5 * Math.sin((x / n) * Math.PI * 2 * 48), wy = 0.5 + 0.5 * Math.sin((y / n) * Math.PI * 2 * 48);
    const v = (0.72 + 0.16 * Math.max(wx, wy) + (f[y * n + x] - 0.5) * 0.25) * 255; const i = (y * n + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; return t;
}

export type DetailMaps = { wood: Texture; fabric: Texture };
/** Накладывает на материал с вершинными цветами текстуру-деталь: коричневые тона (дерево, ротанг, терракота)
 *  получают рисунок дерева, остальные (лён, джут, полосы, кожа) — переплетение ткани. UV — по мировым координатам
 *  (трипланарно по доминирующей нормали), так что плотность одинаковая на любой детали. */
export function applyDetailMaps(m: MeshStandardMaterial, maps: DetailMaps, woodScale = 0.9, fabricScale = 6) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWood = { value: maps.wood }; sh.uniforms.uFabric = { value: maps.fabric };
    sh.uniforms.uWoodScale = { value: woodScale }; sh.uniforms.uFabricScale = { value: fabricScale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDPos; varying vec3 vDNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vDNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDPos; varying vec3 vDNrm; uniform sampler2D uWood; uniform sampler2D uFabric; uniform float uWoodScale; uniform float uFabricScale;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(vDNrm); vec2 duv = an.y > an.x && an.y > an.z ? vDPos.xz : (an.x > an.z ? vDPos.zy : vDPos.xy);
          vec3 c = diffuseColor.rgb; float mx = max(c.r, max(c.g, c.b)); float mn = min(c.r, min(c.g, c.b)); float sat = (mx - mn) / max(mx, 1e-3);
          bool woodish = c.r > c.g && c.g >= c.b && sat > 0.3 && mx < 0.85;
          bool greenish = c.g > c.r && c.g > c.b; bool dark = mx < 0.22;
          if (!greenish && !dark) {
            if (woodish) { float w = texture2D(uWood, duv * uWoodScale).g; diffuseColor.rgb *= mix(0.72, 1.18, w); }
            else { float f = texture2D(uFabric, duv * uFabricScale).r; diffuseColor.rgb *= mix(0.9, 1.06, f); }
          }
        }`);
  };
  m.needsUpdate = true;
}

/** Пол из крупноформатного известняка: 4×4 плитки на текстуру (при повторе 1 текстура = 2,4 м → плитка 0,6 м),
 *  тёплый бежевый с лёгкой вариацией по плиткам, прожилки шумом, тонкие швы. */
export function makeTileTexture(n = 512, seed = 21): CanvasTexture {
  const f = noiseField(n, 4, seed), f2 = noiseField(n, 2, seed + 7); const r = rng(seed);
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
  const tiles = 4, T = n / tiles; const tileTone: number[] = []; for (let i = 0; i < tiles * tiles; i++) tileTone.push((r() - 0.5) * 0.08);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T); const gx = x % T, gy = y % T;
    const grout = gx < 2 || gy < 2;
    let v = 0.86 + tileTone[ty * tiles + tx] + (f[y * n + x] - 0.5) * 0.12 + (f2[y * n + x] - 0.5) * 0.06;
    if (grout) v = 0.62;
    const i = (y * n + x) * 4; img.data[i] = v * 240; img.data[i + 1] = v * 228; img.data[i + 2] = v * 205; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8; return t;
}

/** Глазурованная плитка ручной работы для стен санузлов: 8×8 плиток на текстуру (текстура = 0,8 м → плитка 10 см),
 *  селадоновый зелёный с заметным разбросом тона от плитки к плитке, светлые швы. */
export function makeZelligeTexture(n = 512, seed = 33): CanvasTexture {
  const f = noiseField(n, 3, seed); const r = rng(seed);
  const c = document.createElement('canvas'); c.width = c.height = n; const ctx = c.getContext('2d')!; const img = ctx.createImageData(n, n);
  const tiles = 8, T = n / tiles; const tone: number[] = [], hue: number[] = []; for (let i = 0; i < tiles * tiles; i++) { tone.push((r() - 0.5) * 0.22); hue.push((r() - 0.5) * 0.1); }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T), gx = x % T, gy = y % T, k = ty * tiles + tx; const i = (y * n + x) * 4;
    if (gx < 2 || gy < 2) { img.data[i] = 226; img.data[i + 1] = 222; img.data[i + 2] = 210; img.data[i + 3] = 255; continue; }
    const edge = Math.min(gx, gy, T - gx, T - gy) / T; const v = 0.86 + tone[k] + (f[y * n + x] - 0.5) * 0.1 - (edge < 0.08 ? 0.06 : 0); // к краю плитки глазурь тоньше
    img.data[i] = Math.max(0, Math.min(255, v * (150 + hue[k] * 120))); img.data[i + 1] = Math.max(0, Math.min(255, v * (186 + hue[k] * 40))); img.data[i + 2] = Math.max(0, Math.min(255, v * (170 - hue[k] * 90))); img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = SRGBColorSpace; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = 8; return t;
}

/** Отделка «по умолчанию» для мешей Revit без текстур (один меш на материал: полы, стены, лестницы, парапеты):
 *  горизонтальные поверхности сверху — плитка известняка, вертикальные — рельеф штукатурки, низ (потолки) —
 *  гладкая. Трипланарно по мировым координатам; тёмные материалы (перила, рамы) не трогаются. */
/** Отделка фасада: тон штукатурки (два оттенка — дома одного типа чередуются), тон верхних этажей и камень цоколя. */
export type FacadeFinish = { tones: [string, string]; upper?: string; upperFrom?: number; plinth: Texture; plinthH?: number; plinthTint?: string };
/** Центры домов комплекса и номер оттенка (x, z, 0…1, —): по ближайшему центру шейдер выбирает оттенок фасада. */
export const facadeHouses = { value: Array.from({ length: 16 }, () => new Vector4(1e6, 1e6, 0, 0)) };

/** Отладка: 1 — поверхности с шейдером отделки красятся по метке фасада (красный — фасад, зелёный — высота над полом). */
export const facadeDebug = { value: 0 };

export function applyInteriorFinish(m: MeshStandardMaterial, tile: Texture, stucco: Texture, tileScale = 1 / 2.4, stuccoScale = 0.5, facade?: FacadeFinish, facadeOnly = false) {
  m.userData.finish = true;
  const fac = { uFacHouses: facadeHouses, uToneA: { value: new Color(facade?.tones[0] ?? '#ffffff') }, uToneB: { value: new Color(facade?.tones[1] ?? '#ffffff') }, uToneUp: { value: new Color(facade?.upper ?? facade?.tones[0] ?? '#ffffff') },
    uUpperFrom: { value: facade?.upper ? facade.upperFrom ?? 3 : 1e3 }, uPlinth: { value: facade?.plinth ?? stucco }, uPlinthH: { value: facade ? facade.plinthH ?? 0.5 : -1e3 }, uPlinthTint: { value: new Color(facade?.plinthTint ?? '#ffffff') }, uFacOnly: { value: facadeOnly ? 1 : 0 }, uFacDbg: facadeDebug };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEve = uEve; sh.uniforms.uTile = { value: tile }; sh.uniforms.uStucco = { value: stucco }; sh.uniforms.uTileScale = { value: tileScale }; sh.uniforms.uStuccoScale = { value: stuccoScale };
    Object.assign(sh.uniforms, fac);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFPos; varying vec3 vFNrm; attribute vec2 aFac; varying vec2 vFac; varying float vTone; uniform vec4 uFacHouses[16];')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vFPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vFNrm = normalize(mat3(modelMatrix) * objectNormal); vFac = aFac; vTone = 0.0;
        if (aFac.x > 0.0) { float best = 1e12; for (int i = 0; i < 16; i++) { vec2 d = vFPos.xz - uFacHouses[i].xy; float q = dot(d, d); if (q < best) { best = q; vTone = uFacHouses[i].z; } } }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFPos; varying vec3 vFNrm; varying vec2 vFac; varying float vTone; uniform sampler2D uTile; uniform sampler2D uStucco; uniform sampler2D uPlinth; uniform float uTileScale; uniform float uStuccoScale; uniform float uEve; uniform vec3 uToneA; uniform vec3 uToneB; uniform vec3 uToneUp; uniform vec3 uPlinthTint; uniform float uUpperFrom; uniform float uPlinthH; uniform float uFacOnly; uniform float uFacDbg;')
      // вечер: потолки и подшивки навесов светятся тёплым (как от ламп под ними), стены и полы — едва заметно
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float ny = normalize(vFNrm).y; float lum2 = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); if (lum2 > 0.3) totalEmissiveRadiance += uEve * vec3(1.0, 0.74, 0.46) * (ny < -0.6 ? 0.62 : 0.07) * diffuseColor.rgb; }')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb; float lum = dot(c, vec3(0.3, 0.59, 0.11));
          if (lum > 0.45 && (uFacOnly < 0.5 || vFac.x > 0.5)) { // uFacOnly: материал без общей отделки (шторы вместе со стенами) — только фасадные грани
            vec3 n = normalize(vFNrm); vec3 an = abs(n);
            if (n.y > 0.6) { vec3 t = texture2D(uTile, vFPos.xz * uTileScale).rgb; diffuseColor.rgb = t * mix(vec3(1.0), c / max(lum, 0.3), 0.25); }
            else if (n.y < -0.6) { diffuseColor.rgb = c * 1.02; }
            else {
              vec2 uv = an.x > an.z ? vFPos.zy : vFPos.xy; float w = texture2D(uStucco, uv * uStuccoScale).g; vec3 wall = c * mix(0.9, 1.06, w);
              // фасад (метка aFac: наружная грань по планам этажей, высота над полом нижнего уровня): каменный цоколь, выше — тон дома
              if (vFac.x > 0.5) {
                float h = vFac.y * 10.0 - 2.0;
                if (h < uPlinthH) wall = texture2D(uPlinth, uv * 0.8).rgb * uPlinthTint * mix(0.92, 1.0, w);
                else { vec3 tone = h > uUpperFrom ? uToneUp : mix(uToneA, uToneB, vTone); wall *= tone * mix(0.94, 1.0, smoothstep(uPlinthH, uPlinthH + 1.4, h)); }
              }
              diffuseColor.rgb = wall;
            }
          }
          if (uFacDbg > 0.5) diffuseColor.rgb = vec3(vFac.x, vFac.y, uFacOnly);
        }`);
  };
  m.needsUpdate = true;
}
