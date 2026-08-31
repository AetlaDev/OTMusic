import { config } from '../config';
import { LiquidGlass } from '@ybouane/liquidglass';

 
export async function initLiquidGlass(
  card: HTMLElement | HTMLElement[],
  root: HTMLElement,
  glassConfig: object | object[] = config.liquidGlass,
) {
  const elements = Array.isArray(card) ? card : [card];
  const configs = Array.isArray(glassConfig) ? glassConfig : elements.map(() => glassConfig);
  elements.forEach((el, i) => {
    el.dataset.config = JSON.stringify(configs[i]);
  });
  
  const instance: any = await LiquidGlass.init({
    root,
    glassElements: elements,
  });

  
  const MAX_CAPTURE_DPR = 1.5;
  const origCaptureResize = instance.capture.resize.bind(instance.capture);
  instance.capture.resize = (dpr: number) => {
    origCaptureResize(Math.min(dpr, MAX_CAPTURE_DPR));
  };
  
  
  instance.capture.dpr = Math.min(window.devicePixelRatio || 1, MAX_CAPTURE_DPR);

  
  
  
  
  
  const origCaptureMedia = instance._captureMediaDescendants.bind(instance);
  instance._captureMediaDescendants = (
    parent: HTMLElement,
    targetCtx: CanvasRenderingContext2D,
    sampleRect: any,
    rootRect: DOMRect,
    dpr: number,
  ) => {
    if (
      !parent.hasAttribute('data-dynamic')
      && !parent.querySelector('[data-dynamic], video')
    ) {
      const imgs = parent.querySelectorAll('img');
      let needLive = false;
      for (let i = 0; i < imgs.length; i++) {
        if (!(imgs[i] as HTMLImageElement).complete) {
          needLive = true;
          break;
        }
      }
      if (!needLive) return;
    }
    origCaptureMedia(parent, targetCtx, sampleRect, rootRect, dpr);
  };

  
  const MAX_FBO_SETS = 16;
  const origSetActiveSize = instance.renderer._setActiveSize.bind(instance.renderer);
  instance.renderer._setActiveSize = (w: number, h: number) => {
    const ok = origSetActiveSize(w, h);
    const cache: Map<string, unknown> | undefined = instance.renderer.fboCache;
    if (cache && cache.size > MAX_FBO_SETS) {
      const key = cache.keys().next().value;
      if (key !== undefined) {
        const entry = cache.get(key);
        if (entry && typeof instance.renderer._freeFBOSet === 'function') {
          instance.renderer._freeFBOSet(entry);
        }
        cache.delete(key);
      }
    }
    return ok;
  };

  const origCheckSize = instance._checkGlassSizeChanges.bind(instance);
  const origCapture = instance._captureGlassContent.bind(instance);

  instance.setAnimating = (animating) => {
    if (animating && !instance._animating) {
      instance._animating = true;
      instance._checkGlassSizeChanges = () => {
        for (const el of instance.glassSet) {
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const last = instance._glassLastSize.get(el);
          if (!last || Math.abs(last.w - w) > 0.5 || Math.abs(last.h - h) > 0.5) {
            instance._updateGlassCanvasSize(el);
          }
        }
        return false;
      };
      instance._captureGlassContent = async () => {};
    } else if (!animating && instance._animating) {
      instance._animating = false;
      instance._checkGlassSizeChanges = origCheckSize;
      instance._captureGlassContent = origCapture;
      if (instance._glassLastSize) elements.forEach((el) => instance._glassLastSize.delete(el));
    }
  };

  return instance;
}
