import { useEffect } from 'react';
import { blurService } from '../../blur/blurService';

type DebugWindow = Window & { blurService?: typeof blurService };

/**
 * Development helper: exposes the shared `blurService` singleton as
 * `window.blurService` while mounted, for inspection in the browser console.
 * Does not augment the global `Window` type of consuming apps.
 */
export function BlurServiceDebugger() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const target = window as DebugWindow;
    target.blurService = blurService;
    return () => {
      if (target.blurService === blurService) {
        delete target.blurService;
      }
    };
  }, []);

  return null;
}

export default BlurServiceDebugger;
