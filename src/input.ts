// Единое состояние ввода: клавиатура + мышь (десктоп), джойстик + тач (телефон).
export const input = {
  fwd: 0, // -1..1  (W/S или джойстик)
  side: 0, // -1..1 (A/D или джойстик)
  run: false,
  yaw: 0, // поворот камеры вокруг вертикали, радианы
  pitch: 0, // наклон камеры, радианы
  locked: false, // pointer lock активен
  fly: false, // режим полёта для осмотра (клавиша F)
  up: 0, // -1..1 (Q/E) в полёте
  teleport: null as [number, number, number] | null, // запрос переноса игрока (мини-план)
  mobile: typeof window !== 'undefined' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0),
};

const keys = new Set<string>();
const LOOK_SPEED = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

function syncKeys() {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  input.fwd = f;
  input.side = s;
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.up = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
}

export function look(dx: number, dy: number) {
  input.yaw -= dx * LOOK_SPEED;
  input.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, input.pitch - dy * LOOK_SPEED));
}

/** Подключает клавиатуру, pointer lock и тач-обзор к canvas. Возвращает функцию отключения. */
export function attachInput(canvas: HTMLCanvasElement) {
  const onKeyDown = (e: KeyboardEvent) => { keys.add(e.code); if (e.code === 'KeyF') input.fly = !input.fly; syncKeys(); };
  const onKeyUp = (e: KeyboardEvent) => { keys.delete(e.code); syncKeys(); };
  const onBlur = () => { keys.clear(); syncKeys(); };
  const onMouseMove = (e: MouseEvent) => { if (input.locked) look(e.movementX, e.movementY); };
  const onLockChange = () => { input.locked = document.pointerLockElement === canvas; };
  const onClick = () => {
    if (input.mobile || input.locked) return;
    // во встроенных браузерах pointer lock может быть запрещён — не падаем, просто без захвата мыши
    try { Promise.resolve(canvas.requestPointerLock() as unknown).catch(() => undefined); } catch { /* ignore */ }
  };

  // Тач: любой палец в правых 60 % экрана управляет взглядом (левая зона — джойстик).
  const touches = new Map<number, { x: number; y: number }>();
  const onTouchStart = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.clientX > window.innerWidth * 0.4) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  };
  const onTouchMove = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const p = touches.get(t.identifier);
      if (!p) continue;
      look((t.clientX - p.x) * 2.2, (t.clientY - p.y) * 2.2);
      p.x = t.clientX; p.y = t.clientY;
    }
    e.preventDefault();
  };
  const onTouchEnd = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier); };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd);
  canvas.addEventListener('touchcancel', onTouchEnd);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('pointerlockchange', onLockChange);
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    canvas.removeEventListener('touchcancel', onTouchEnd);
  };
}
