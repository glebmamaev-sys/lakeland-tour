// Вода лагуны: физический материал с двумя слоями бегущей ряби (процедурная нормал-карта), френель и блик от окружения.
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshPhysicalMaterial, RepeatWrapping } from 'three';
import { makeWaterNormalTexture } from './textures';

export function Lagoon({ level }: { level: number }) {
  const { mat, uTime } = useMemo(() => {
    const normalMap = makeWaterNormalTexture(512);
    normalMap.wrapS = normalMap.wrapT = RepeatWrapping; normalMap.repeat.set(12000 / 9, 12000 / 9); // одна плитка ряби — 9 м
    const uTime = { value: 0 };
    const mat = new MeshPhysicalMaterial({
      color: '#2b6d76', roughness: 0.06, metalness: 0, normalMap, envMapIntensity: 1.3, clearcoat: 0.3, clearcoatRoughness: 0.1,
      transparent: false,
    });
    mat.normalScale.set(0.22, 0.22);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <normal_fragment_maps>', `
          vec2 uvA = vNormalMapUv + vec2(uTime * 0.0045, uTime * 0.0032);
          vec2 uvB = vNormalMapUv * 2.17 - vec2(uTime * 0.0031, -uTime * 0.0041);
          vec3 nA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
          vec3 nB = texture2D(normalMap, uvB).xyz * 2.0 - 1.0;
          vec3 mapN = normalize(vec3((nA.xy + nB.xy) * 0.5 * normalScale, 1.0));
          normal = normalize(tbn * mapN); // tbn уже объявлена в normal_fragment_begin
        `);
    };
    return { mat, uTime };
  }, []);
  useFrame((_, dt) => { uTime.value += dt; });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, level, 0]} material={mat} receiveShadow>
      <planeGeometry args={[12000, 12000, 1, 1]} />
    </mesh>
  );
}
