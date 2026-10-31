import { useEffect } from 'react';
import { blurService } from '../../blur/blurService';

declare global {
  interface Window {
    blurService?: typeof blurService;
  }
}

export function BlurServiceDebugger() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.blurService = blurService;
    }
  }, []);

  return null;
}

export default BlurServiceDebugger;
