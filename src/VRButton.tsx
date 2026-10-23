// Кнопка входа в VR через WebXR. Показывается только если браузер поддерживает immersive-vr.
import { useEffect, useState } from 'react';
import type { WebGLRenderer } from 'three';

type XRNav = Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string, init?: unknown): Promise<XRSession> } };

export function VRButton({ gl }: { gl: WebGLRenderer | null }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const xr = (navigator as XRNav).xr;
    if (!xr) { setSupported(false); return; }
    xr.isSessionSupported('immersive-vr').then(setSupported).catch(() => setSupported(false));
  }, []);

  useEffect(() => {
    if (!gl) return;
    const on = () => setActive(true), off = () => setActive(false);
    gl.xr.addEventListener('sessionstart', on);
    gl.xr.addEventListener('sessionend', off);
    return () => { gl.xr.removeEventListener('sessionstart', on); gl.xr.removeEventListener('sessionend', off); };
  }, [gl]);

  const enter = async () => {
    const xr = (navigator as XRNav).xr;
    if (!xr || !gl) return;
    if (active) { await gl.xr.getSession()?.end(); return; }
    try {
      const session = await xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      gl.xr.setReferenceSpaceType('local');
      await gl.xr.setSession(session);
    } catch (e) {
      console.warn('WebXR session failed', e);
    }
  };

  if (supported === null) return null;
  return (
    <button className="btn vr-btn" onClick={enter} disabled={!supported} title={supported ? 'Открыть в VR-шлеме' : 'Откройте эту страницу в браузере VR-шлема (Meta Quest, Vision Pro, PICO)'}>
      {active ? 'Выйти из VR' : supported ? 'Войти в VR' : 'VR: откройте в шлеме'}
    </button>
  );
}
