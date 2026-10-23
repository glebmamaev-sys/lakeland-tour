// Капсульный контроллер от первого лица: гравитация, лестницы, скольжение вдоль стен.
// Основан на примере characterMovement из three-mesh-bvh.
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, Line3, Matrix4, Object3D, Vector3 } from 'three';
import { colliderStore } from './collider';
import { input, attachInput } from './input';

const RADIUS = 0.3; // радиус капсулы, м
const HEIGHT = 1.75; // полная высота капсулы, м
const EYE = 1.62; // высота глаз от пола, м
const WALK = 2.2; // м/с
const RUN = 4.5;
const GRAVITY = -18;
const UP = new Vector3(0, 1, 0);

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpBox = new Box3();
const tmpMat = new Matrix4();
const tmpSeg = new Line3();
const dir = new Vector3();

export function Player({ spawn = [0, 0.5, 0] as [number, number, number], yaw = 0 }: { spawn?: [number, number, number]; yaw?: number }) {
  const { camera, gl } = useThree();
  const player = useRef(new Object3D()).current;
  const vel = useRef(new Vector3()).current;
  const onGround = useRef(false);
  // сегмент капсулы в локальных координатах игрока (position = точка под ногами)
  const segment = useRef(new Line3(new Vector3(0, RADIUS, 0), new Vector3(0, HEIGHT - RADIUS, 0))).current;

  useEffect(() => {
    player.position.set(...spawn);
    vel.set(0, 0, 0);
    input.yaw = yaw; input.pitch = 0;
    // отладочный доступ из консоли: __tour.pos, __tour.input
    (window as unknown as { __tour: unknown }).__tour = { pos: player.position, input, onGround };
    return attachInput(gl.domElement);
  }, [gl, player, vel, spawn, yaw]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 30);
    const collider = colliderStore.current;

    if (input.teleport) { player.position.set(...input.teleport); vel.set(0, 0, 0); input.teleport = null; }

    // Пока коллайдер не собран (модель грузится), игрок стоит на месте: иначе он проваливается сквозь пол.
    if (!collider && !input.fly) {
      vel.set(0, 0, 0);
      camera.position.copy(player.position).y += EYE;
      camera.rotation.set(0, 0, 0, 'YXZ');
      camera.rotation.y = input.yaw;
      camera.rotation.x = input.pitch;
      return;
    }

    // гравитация (в полёте отключена)
    if (input.fly) { vel.set(0, 0, 0); player.position.y += input.up * (input.run ? 12 : 5) * dt; }
    else { if (onGround.current) vel.y = dt * GRAVITY; else vel.y += dt * GRAVITY; player.position.addScaledVector(vel, dt); }

    // движение в плоскости по направлению взгляда (yaw)
    dir.set(0, 0, 0);
    tmpV.set(0, 0, -1).applyAxisAngle(UP, input.yaw);
    dir.addScaledVector(tmpV, input.fwd);
    tmpV.set(1, 0, 0).applyAxisAngle(UP, input.yaw);
    dir.addScaledVector(tmpV, input.side);
    if (dir.lengthSq() > 0) {
      dir.normalize();
      player.position.addScaledVector(dir, (input.fly ? (input.run ? 25 : 8) : input.run ? RUN : WALK) * dt);
    }
    player.updateMatrixWorld();

    if (collider && !input.fly) {
      // капсула в координатах коллайдера (коллайдер в мировых координатах, матрица единичная)
      tmpMat.identity();
      tmpSeg.copy(segment);
      tmpSeg.start.applyMatrix4(player.matrixWorld);
      tmpSeg.end.applyMatrix4(player.matrixWorld);
      const startBefore = tmpV2.copy(tmpSeg.start);
      tmpBox.makeEmpty();
      tmpBox.expandByPoint(tmpSeg.start);
      tmpBox.expandByPoint(tmpSeg.end);
      tmpBox.min.addScalar(-RADIUS);
      tmpBox.max.addScalar(RADIUS);

      const triPoint = new Vector3();
      const capPoint = new Vector3();
      collider.bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(tmpBox),
        intersectsTriangle: (tri) => {
          const distance = tri.closestPointToSegment(tmpSeg, triPoint, capPoint);
          if (distance < RADIUS) {
            const depth = RADIUS - distance;
            const direction = capPoint.sub(triPoint).normalize();
            tmpSeg.start.addScaledVector(direction, depth);
            tmpSeg.end.addScaledVector(direction, depth);
          }
        },
      });

      const deltaVector = tmpV.subVectors(tmpSeg.start, startBefore);
      onGround.current = deltaVector.y > Math.abs(dt * vel.y * 0.25);
      const offset = Math.max(0, deltaVector.length() - 1e-5);
      deltaVector.normalize().multiplyScalar(offset);
      player.position.add(deltaVector);
      if (!onGround.current) {
        deltaVector.normalize();
        vel.addScaledVector(deltaVector, -deltaVector.dot(vel));
      } else {
        vel.set(0, 0, 0);
      }
    }

    // провалился — вернуть на спавн
    if (player.position.y < -20) { player.position.set(...spawn); vel.set(0, 0, 0); }

    camera.position.copy(player.position).y += EYE;
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.rotation.y = input.yaw;
    camera.rotation.x = input.pitch;
  });

  return null;
}
