// Вода лагуны: физический материал с двумя слоями бегущей ряби (процедурная нормал-карта), френель и блик от окружения.
// Прозрачность и цвет — по глубине: у берега сквозь воду виден песчаный уступ дна (карта высот дна участка —
// текстура 8 бит, 3 см на уровень), к середине лагуны вода темнеет и становится непрозрачной. На скользящих углах
// отражение берёт верх (френель), так что дальняя вода не «проваливается» в дно.
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { DataTexture, LinearFilter, MeshPhysicalMaterial, RedFormat, RepeatWrapping, UnsignedByteType, Vector2 } from 'three';
import { makeWaterNormalTexture } from './textures';

/** Общее время воды — им же анимируется каустика на дне (Complex.tsx). */
export const WATER_TIME = { value: 0 };
/** Карта высот дна: 8 бит, h = BOTTOM_BASE(level) + byte / 255 * BOTTOM_RANGE. */
export const BOTTOM_RANGE = 8;
export const bottomBase = (level: number) => level - 6;
export type Bottom = { tex: DataTexture; x0: number; z0: number; w: number; d: number };

/** Текстура дна из сетки участка (все клетки, в т.ч. суша — выше уровня воды глубина = 0). */
export function makeBottomTexture(h: Float32Array, nx: number, nz: number, x0: number, z0: number, step: number, level: number): Bottom {
  const base = bottomBase(level); const data = new Uint8Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) data[k] = Math.max(0, Math.min(255, Math.round(((h[k] - base) / BOTTOM_RANGE) * 255)));
  const tex = new DataTexture(data, nx, nz, RedFormat, UnsignedByteType); tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true;
  return { tex, x0, z0, w: (nx - 1) * step, d: (nz - 1) * step };
}

export function Lagoon({ level, bottom = null }: { level: number; bottom?: Bottom | null }) {
  const mat = useMemo(() => {
    const normalMap = makeWaterNormalTexture(512);
    normalMap.wrapS = normalMap.wrapT = RepeatWrapping; normalMap.repeat.set(12000 / 9, 12000 / 9); // одна плитка ряби — 9 м
    const mat = new MeshPhysicalMaterial({
      color: '#2b6d76', roughness: 0.06, metalness: 0, normalMap, envMapIntensity: 1.3, clearcoat: 0.3, clearcoatRoughness: 0.1,
      transparent: true, opacity: 1,
    });
    mat.normalScale.set(0.22, 0.22);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = WATER_TIME;
      sh.uniforms.uBottom = { value: bottom?.tex ?? null }; sh.uniforms.uHasBottom = { value: bottom ? 1 : 0 };
      sh.uniforms.uB0 = { value: new Vector2(bottom?.x0 ?? 0, bottom?.z0 ?? 0) }; sh.uniforms.uBSize = { value: new Vector2(bottom?.w ?? 1, bottom?.d ?? 1) };
      sh.uniforms.uLevel = { value: level }; sh.uniforms.uBase = { value: bottomBase(level) }; sh.uniforms.uRange = { value: BOTTOM_RANGE };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime; uniform sampler2D uBottom; uniform float uHasBottom; uniform vec2 uB0, uBSize; uniform float uLevel, uBase, uRange; varying vec3 vWp;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float depth = 4.0;
          vec2 uvb = (vWp.xz - uB0) / uBSize;
          if (uHasBottom > 0.5 && uvb.x > 0.0 && uvb.x < 1.0 && uvb.y > 0.0 && uvb.y < 1.0) {
            float dTex = max(0.0, uLevel - (uBase + texture2D(uBottom, uvb).r * uRange));
            vec2 em = min(uvb, 1.0 - uvb) * uBSize;                 // метры до края карты дна
            float edge = smoothstep(0.0, 4.0, min(em.x, em.y));     // у края карты — плавно к «глубоко», без линии
            depth = mix(4.0, dTex, edge);
          }
          float ndv = clamp(normalize(cameraPosition - vWp).y, 0.0, 1.0);
          float fres = pow(1.0 - ndv, 3.0);
          float a = 1.0 - exp(-depth / 0.9);                      // мелко — прозрачно, 1 м — 2/3, 2,5 м — почти непрозрачно
          a = max(a, fres * 0.9);                                  // скользящий угол — отражение
          diffuseColor.rgb = mix(vec3(0.40, 0.70, 0.64), diffuseColor.rgb, clamp(depth / 2.5, 0.0, 1.0)); // мелководье светлее и зеленее
          diffuseColor.a = clamp(a, 0.06, 1.0);`)
        .replace('#include <normal_fragment_maps>', `
          vec2 uvA = vNormalMapUv + vec2(uTime * 0.0045, uTime * 0.0032);
          vec2 uvB = vNormalMapUv * 2.17 - vec2(uTime * 0.0031, -uTime * 0.0041);
          vec3 nA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
          vec3 nB = texture2D(normalMap, uvB).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3((nA.xy + nB.xy) * 0.5 * normalScale, 1.0));
          normal = normalize(tbn * mapN); // tbn уже объявлена в normal_fragment_begin
        `);
    };
    mat.customProgramCacheKey = () => 'lagoon-' + (bottom ? 'b' : 'n');
    return mat;
  }, [bottom, level]);
  useFrame((_, dt) => { WATER_TIME.value += dt; });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, level, 0]} material={mat} receiveShadow renderOrder={5}>
      <planeGeometry args={[12000, 12000, 1, 1]} />
    </mesh>
  );
}
