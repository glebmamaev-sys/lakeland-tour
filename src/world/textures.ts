// Процедурные текстуры мира (без скачивания чужих файлов): облака, нормали воды, шум для вариации газона.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter } from 'three';

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
