import { config } from '../config';
import { buildNoiseLayers, buildSmoothLuminance, sampleNoiseLayers } from './noise';
import { isMobile } from '../device';

const C = config.cover;
const PR = config.particles;
const V = config.vibration;
const CAM = config.camera;
const RND = config.render;
const BT = config.beat;

const DISP_GRID = RND.dispGridSize || 128;
const TRE_GRID = RND.trebleGridSize || 96;
const TREBLE_BANDS = RND.trebleBands || 4;
const DISP_INTERVAL = Math.max(1, RND.dispGridInterval || 2);
const COLOR_SETTLE_FRAMES = 150;
const BUCKETS = Math.min(255, Math.max(1, RND.depthBuckets || 24));

export function createParticleEngine(canvas, lyricCanvas, fxCanvas, energySource) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  let dpr = 1;
  let particles = [];
  let coverData = null, coverW = 1, coverH = 1;
  let lumField = null;
  let planeW = 0, planeH = 0, cx = 0, cy = 0;
  let midNoise = null;
  let punch = 0;
  let bgCanvas = null;
  let layer = null, layerCtx = null;
  let imageData = null, data = null;
  let projX = null, projY = null, projZ = null;

  let midGrid = null, treGrid = null;
  let dispFrame = 0;
  let colorFrames = 0;

  let particleFlash = 0;
  let lyricShake = 0;

  let beatPulseTime = 0;

  let bucketIdx = null;
  let bucketCount = null;
  let bucketStart = null;
  let bucketCur = null;
  let sortedIdx = null;

  const DEFAULT_SCALE = isMobile() ? 1 : CAM.zoomMin;

  let isMobileScreen = isMobile();
  const state = {
    dragging: false,
    startX: 0, startY: 0,
    startTargetY: 0, startTargetX: 0,
    targetRotY: 0, targetRotX: 0,
    rotY: 0, rotX: 0,
    scale: DEFAULT_SCALE, targetScale: DEFAULT_SCALE,
  };

  let lyricLines = [];
  let lyricTime = 0;
  let lyricVisible = true;
  let timeSource = null;

  const DEFAULT_LYRIC_PALETTE = {
    primary: [240, 248, 255],
    secondary: [180, 220, 255],
    highlight: [255, 236, 180],
    glow: [180, 230, 255],
  };
  let lyricPalette = { ...DEFAULT_LYRIC_PALETTE };
  let coverTinyData = null;

  let smoothedScroll = null;
  const lyricCanvasCache = new Map();
  const LYRIC_CACHE_MAX = 160;
  const LYRIC_FONT = 900;
  const LYRIC_FONT_SIZE = 160;

  const LYRIC_MOBILE_SCALE = 0.65;
  const warmQueue = [];
  let warmPtr = 0;

  let warmSettled = false;
  let hadWarmWork = false;
  let warmResolve: () => void = () => {};
  const lyricWarmReady: Promise<void> = new Promise((res) => {
    warmResolve = res;
  });

  let gl = null;
  let glOk = false;
  let glLyricCanvas = null;
  let L = null;
  let G = null;

  const defaultCoverSrc = C.url ? new URL(C.url, document.baseURI).href : '';
  let currentSrc = null;
  let loadToken = 0;
  let requestedSrc = null;

  let resolveReady!: () => void;
  const ready = new Promise<void>((res) => (resolveReady = res));

  function loadCoverImage(src, onDone) {
    const token = ++loadToken;
    if (!src) {
      coverData = null;
      lumField = null;
      coverTinyData = null;
      computeLyricAccent();
      onDone?.(false);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    img.onload = () => {
      if (token !== loadToken) return;
      const off = document.createElement('canvas');
      off.width = coverW = img.naturalWidth || 600;
      off.height = coverH = img.naturalHeight || 600;
      const octx = off.getContext('2d', { willReadFrequently: true });
      octx.drawImage(img, 0, 0);
      coverData = octx.getImageData(0, 0, coverW, coverH).data;
      lumField = buildSmoothLuminance(coverData, coverW, coverH);

      const tiny = document.createElement('canvas');
      tiny.width = 32;
      tiny.height = 32;
      const tctx = tiny.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(img, 0, 0, 32, 32);
      coverTinyData = tctx.getImageData(0, 0, 32, 32).data;
      computeLyricAccent();
      currentSrc = src;
      onDone?.(true);
    };
    img.onerror = () => {
      if (token !== loadToken) return;
      if (src === defaultCoverSrc) {
        coverData = null;
        lumField = null;
        coverTinyData = null;
        computeLyricAccent();
        onDone?.(false);
      } else {
        loadCoverImage(defaultCoverSrc, onDone);
      }
    };
  }

  function updateParticleColors() {
    const count = particles.length;
    if (!count) return;
    colorFrames = COLOR_SETTLE_FRAMES;
    for (let i = 0; i < count; i++) {
      const p = particles[i];

      const nx = p.px / planeW + 0.5;
      const ny = p.py / planeH + 0.5;
      const sx = Math.min(coverW - 1, Math.max(0, Math.floor(nx * coverW)));
      const sy = Math.min(coverH - 1, Math.max(0, Math.floor(ny * coverH)));
      const li = sy * coverW + sx;
      let rC = PR.defaultColor[0], gC = PR.defaultColor[1], bC = PR.defaultColor[2];
      if (coverData) {
        const pi = li * 4;
        rC = Math.min(255, coverData[pi] + PR.colorBoost);
        gC = Math.min(255, coverData[pi + 1] + PR.colorBoost);
        bC = Math.min(255, coverData[pi + 2] + PR.colorBoost);
      }
      const lum = lumField
        ? lumField[li]
        : (0.2126 * rC + 0.7152 * gC + 0.0722 * bC) / 255;
      p.tr = rC;
      p.tg = gC;
      p.tb = bC;
      p.tzBase = (0.5 - lum) * planeW * PR.coverThickness;
    }
  }

  function setCover(src) {
    const target = src || defaultCoverSrc;
    if (target === currentSrc) return Promise.resolve();
    requestedSrc = target;
    return new Promise<void>((res) => {
      loadCoverImage(target, () => {
        clearLyricCanvasCache();
        updateParticleColors();
        queueLyricWarm(lyricLines);
        res();
      });
    });
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      switch (mx) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        default: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h, s, l };
  }
  function hslToRgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const t = (k, n) => {
      if (n < 0) n += 1;
      if (n > 1) n -= 1;
      if (n < 1 / 6) return p + (q - p) * 6 * n;
      if (n < 1 / 2) return q;
      if (n < 2 / 3) return p + (q - p) * (2 / 3 - n) * 6;
      return p;
    };
    return [t(0, h + 1 / 3) * 255, t(0, h) * 255, t(0, h - 1 / 3) * 255];
  }
  function pickHslSample(coverCanvas) {
    if (!coverCanvas || !coverCanvas.width) {
      return { r: 200, g: 220, b: 255, hsl: rgbToHsl(200, 220, 255), chroma: 0.2, lum: 0.85 };
    }
    const ctx = coverCanvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
    const w = coverCanvas.width, h = coverCanvas.height;
    let best = { score: -1, r: 200, g: 220, b: 255 };
    let warm = { score: -1, r: 240, g: 200, b: 180 };
    let cool = { score: -1, r: 160, g: 210, b: 240 };
    let light = { score: -1, r: 240, g: 245, b: 250 };
    let dark = { score: -1, r: 22, g: 28, b: 40 };
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    const step = Math.max(2, Math.floor(Math.min(w, h) / 28));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const a = img[i + 3] / 255;
        if (a < 0.45) continue;
        const r = img[i], g = img[i + 1], b = img[i + 2];
        const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
        const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
        const chroma = (maxC - minC) / 255;
        if (chroma < 0.04) continue;

        const dx = (x / w - 0.5) * 2;
        const dy = (y / h - 0.5) * 2;
        const radial = Math.max(0.25, 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy)));
        const baseScore = chroma * 1.6 + (0.5 - Math.abs(lum - 0.55)) * 0.45;
        const score = baseScore * radial;
        sumR += r; sumG += g; sumB += b; count++;
        if (lum > 0.10 && lum < 0.92 && score > best.score) {
          best = { score, r, g, b };
        }
        const isWarm = maxC === r && chroma > 0.07;
        const isCool = maxC === b && chroma > 0.07;
        if (isWarm && lum > 0.12 && lum < 0.88 && score * 1.15 > warm.score) {
          warm = { score: score * 1.15, r, g, b };
        }
        if (isCool && lum > 0.12 && lum < 0.88 && score * 1.15 > cool.score) {
          cool = { score: score * 1.15, r, g, b };
        }
        if (lum > 0.58 && score > light.score) {
          light = { score, r, g, b };
        }
        if (lum < 0.26 && score * 0.85 > dark.score) {
          dark = { score: score * 0.85, r, g, b };
        }
      }
    }
    if (!count) return { r: 200, g: 220, b: 255, hsl: rgbToHsl(200, 220, 255), chroma: 0.2, lum: 0.85 };
    const hsl = rgbToHsl(best.r, best.g, best.b);
    return { r: best.r, g: best.g, b: best.b, warm, cool, light, dark, hsl, avgR: sumR / count, avgG: sumG / count, avgB: sumB / count };
  }
  function buildPaletteFromSample(sample) {

    const hsl = sample.hsl;

    const baseS = Math.max(0.55, hsl.s);
    const baseL = Math.max(0.80, hsl.l + 0.18);

    const primary = hslToRgb(hsl.h, baseS, baseL);

    const secondary = hslToRgb((hsl.h + 0.06) % 1, baseS * 0.95, Math.min(0.92, baseL + 0.05));

    const highlight = hslToRgb((hsl.h + 0.025) % 1, Math.min(1, baseS * 1.05), Math.min(0.96, baseL + 0.10));

    const glow = hslToRgb((hsl.h - 0.04 + 1) % 1, Math.min(1, baseS + 0.1), Math.min(0.92, baseL - 0.02));
    return {
      primary,
      secondary,
      highlight,
      glow,
    };
  }
  function computeLyricAccent() {
    if (!coverTinyData) {
      lyricPalette = {
        primary: [...DEFAULT_LYRIC_PALETTE.primary],
        secondary: [...DEFAULT_LYRIC_PALETTE.secondary],
        highlight: [...DEFAULT_LYRIC_PALETTE.highlight],
        glow: [...DEFAULT_LYRIC_PALETTE.glow],
      };
      return;
    }
    const tiny = document.createElement('canvas');
    tiny.width = 32;
    tiny.height = 32;
    const tctx = tiny.getContext('2d', { willReadFrequently: true });

    tctx.putImageData(new ImageData(new Uint8ClampedArray(coverTinyData), 32, 32), 0, 0);
    const sample = pickHslSample(tiny);
    const pal = buildPaletteFromSample(sample);
    lyricPalette = {
      primary: pal.primary.map((v) => Math.min(255, Math.round(v))),
      secondary: pal.secondary.map((v) => Math.min(255, Math.round(v))),
      highlight: pal.highlight.map((v) => Math.min(255, Math.round(v))),
      glow: pal.glow.map((v) => Math.min(255, Math.round(v))),
    };

    for (const k of ['highlight', 'glow', 'secondary', 'primary']) {
      const [r, g, b] = lyricPalette[k];
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);
      if (lum < 180) {
        const k2 = (200 - lum) / 255;
        lyricPalette[k] = [
          Math.min(255, Math.round(r + 255 * k2 * 0.4)),
          Math.min(255, Math.round(g + 255 * k2 * 0.4)),
          Math.min(255, Math.round(b + 255 * k2 * 0.4)),
        ];
      }
    }
  }

  const LYRIC_BASE_ALPHA = 0.66;
  const LYRIC_FONT_FAMILY = '"Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif';
  let probeCtx = null;
  function getProbeCtx() {
    if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
    return probeCtx;
  }

  function buildLyricCanvas(text, fontSize) {
    const padX = Math.round(fontSize * 0.5);
    const H = Math.round(fontSize * 1.58) + Math.round(fontSize * 0.34);
    const probe = getProbeCtx();
    const font = `${LYRIC_FONT} ${fontSize}px ${LYRIC_FONT_FAMILY}`;
    probe.font = font;
    const textW = Math.max(1, Math.ceil(probe.measureText(text).width));
    const W = textW + padX * 2;

    const [pr, pg, pb] = lyricPalette.primary;
    const [sr, sg, sb] = lyricPalette.secondary;
    const [hr, hg, hb] = lyricPalette.highlight;
    const [gr, gg, gb] = lyricPalette.glow;

    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const bctx = base.getContext('2d');
    bctx.font = font;
    bctx.textAlign = 'center';
    bctx.textBaseline = 'middle';

    bctx.shadowColor = `rgba(${sr},${sg},${sb},${LYRIC_BASE_ALPHA * 0.85})`;
    bctx.shadowBlur = Math.round(fontSize * 0.22);
    bctx.fillStyle = `rgba(${pr},${pg},${pb},${LYRIC_BASE_ALPHA})`;
    bctx.fillText(text, W / 2, H / 2);
    bctx.shadowBlur = 0;
    bctx.fillStyle = `rgba(255,255,255,${LYRIC_BASE_ALPHA * 0.42})`;
    bctx.fillText(text, W / 2, H / 2);

    const active = document.createElement('canvas');
    active.width = W;
    active.height = H;
    const actx = active.getContext('2d');
    actx.font = font;
    actx.textAlign = 'center';
    actx.textBaseline = 'middle';

    actx.shadowColor = `rgba(${gr},${gg},${gb},0.92)`;
    actx.shadowBlur = Math.round(fontSize * 0.42);
    actx.fillStyle = `rgba(${hr},${hg},${hb},0.96)`;
    actx.fillText(text, W / 2, H / 2);

    actx.shadowBlur = Math.round(fontSize * 0.18);
    actx.fillStyle = `rgba(${hr},${hg},${hb},0.96)`;
    actx.fillText(text, W / 2, H / 2);

    actx.shadowBlur = 0;
    actx.fillStyle = '#fff';
    actx.fillText(text, W / 2, H / 2);

    const glowPad = Math.round(fontSize * 0.6);
    const gW = W + glowPad * 2;
    const gH = H + glowPad * 2;

    const GS = 0.5;
    const halfW = Math.max(1, Math.round(gW * GS));
    const halfH = Math.max(1, Math.round(gH * GS));
    const half = document.createElement('canvas');
    half.width = halfW;
    half.height = halfH;
    const hctx = half.getContext('2d');
    hctx.font = `${LYRIC_FONT} ${fontSize * GS}px ${LYRIC_FONT_FAMILY}`;
    hctx.textAlign = 'center';
    hctx.textBaseline = 'middle';
    hctx.shadowColor = `rgba(${gr},${gg},${gb},0.80)`;
    hctx.shadowBlur = Math.round(fontSize * 0.62 * GS);
    hctx.fillStyle = `rgba(${hr},${hg},${hb},0.85)`;
    hctx.fillText(text, halfW / 2, halfH / 2);
    hctx.shadowBlur = Math.round(fontSize * 0.32 * GS);
    hctx.fillStyle = `rgba(${gr},${gg},${gb},0.95)`;
    hctx.fillText(text, halfW / 2, halfH / 2);

    const glow = document.createElement('canvas');
    glow.width = gW;
    glow.height = gH;
    const gctx = glow.getContext('2d');
    gctx.imageSmoothingEnabled = true;
    gctx.imageSmoothingQuality = 'high';
    gctx.drawImage(half, 0, 0, gW, gH);
    half.width = half.height = 0;

    return { base, active, glow, w: W, h: H, gw: gW, gh: gH };
  }

  function uploadLyricTexture(srcCanvas) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  function disposeLyricEntry(c) {
    if (!c) return;
    if (glOk && c.gl) {
      if (c.gl.base) gl.deleteTexture(c.gl.base);
      if (c.gl.active) gl.deleteTexture(c.gl.active);
      if (c.gl.glow) gl.deleteTexture(c.gl.glow);
      c.gl = null;
    }
    if (c.base) c.base.width = c.base.height = 0;
    if (c.active) c.active.width = c.active.height = 0;
    if (c.glow) c.glow.width = c.glow.height = 0;
  }

  function clearLyricCanvasCache() {
    for (const c of lyricCanvasCache.values()) disposeLyricEntry(c);
    lyricCanvasCache.clear();
    warmQueue.length = 0;
    warmPtr = 0;
  }

  function trimLyricCache() {
    if (lyricCanvasCache.size <= LYRIC_CACHE_MAX) return;
    const need = lyricCanvasCache.size - LYRIC_CACHE_MAX;
    const it = lyricCanvasCache.keys();
    for (let i = 0; i < need; i++) {
      const k = it.next().value;
      disposeLyricEntry(lyricCanvasCache.get(k));
      lyricCanvasCache.delete(k);
    }
  }

  function getLyricCanvas(text, fontSize) {
    const key = text + '|' + fontSize;
    let c = lyricCanvasCache.get(key);
    if (c) {
      lyricCanvasCache.delete(key);
      lyricCanvasCache.set(key, c);
      return c;
    }
    c = buildLyricCanvas(text, fontSize);
    if (glOk) {
      c.gl = {
        base: uploadLyricTexture(c.base),
        active: uploadLyricTexture(c.active),
        glow: uploadLyricTexture(c.glow),
      };
    }
    lyricCanvasCache.set(key, c);
    trimLyricCache();
    return c;
  }

  const WARM_BUDGET_MS = 2.5;
  const WARM_IMMEDIATE = 3;

  function queueLyricWarm(lines) {
    warmQueue.length = 0;
    warmPtr = 0;
    for (const l of lines) {
      if (l && l.text) warmQueue.push(l.text);
      if (l && l.trans) warmQueue.push(l.trans);
    }
    hadWarmWork = warmQueue.length > 0;
  }

  function warmLyricStep(budgetMs) {
    if (warmPtr >= warmQueue.length) {

      if (hadWarmWork && !warmSettled) {
        warmSettled = true;
        warmResolve();
      }
      return;
    }
    const end = performance.now() + budgetMs;
    do {
      getLyricCanvas(warmQueue[warmPtr], LYRIC_FONT_SIZE);
      warmPtr++;
    } while (warmPtr < warmQueue.length && performance.now() < end);
  }

  const LYRIC_QUAD = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
  const LYRIC_UV = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);

  const LYRIC_VS = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec3 uCenter;
uniform float uCosY, uSinY, uCosX, uSinX;
uniform float uFocal, uPlaneW, uScale, uPixel;
uniform vec2 uScreen;
uniform vec2 uHalf;
varying vec2 vUv;
void main() {
  vUv = aUv;
  vec3 w = uCenter + vec3(aPos * uHalf, 0.0);
  float x3 = w.x * uCosY - w.z * uSinY;
  float z3 = w.x * uSinY + w.z * uCosY;
  float y3b = w.y * uCosX - z3 * uSinX;
  float z3b = w.y * uSinX + z3 * uCosX;
  float persp = uFocal / max(0.1, uFocal + z3b / uPlaneW);
  float sx = uScreen.x * 0.5 + x3 * persp * uScale * uPixel;
  float sy = uScreen.y * 0.5 + y3b * persp * uScale * uPixel;
  float pw = 1.0 / persp;
  gl_Position = vec4((sx / uScreen.x * 2.0 - 1.0) * pw, (1.0 - sy / uScreen.y * 2.0) * pw, 0.0, pw);
}`;

  const LYRIC_FS_MAIN = `
precision mediump float;
uniform sampler2D uBase;
uniform sampler2D uActive;
uniform float uAlpha;
uniform float uProgress;
uniform float uFlash;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uBase, vUv);
  if (uProgress >= 0.0 && vUv.x <= uProgress) {
    c = texture2D(uActive, vUv);
  }
  float a = min(1.0, c.a * uAlpha * (1.0 + uFlash * 0.55));
  gl_FragColor = vec4(c.rgb * uAlpha * (1.0 + uFlash), a);
}`;

  const LYRIC_FS_GLOW = `
precision mediump float;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uFlash;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uTex, vUv);
  float a = min(1.0, c.a * uAlpha * (1.0 + uFlash));
  gl_FragColor = vec4(c.rgb * uAlpha * (1.0 + uFlash * 1.6), a);
}`;

  function compileLyricShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log);
    }
    return s;
  }

  function buildLyricProgram(vsSrc, fsSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compileLyricShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compileLyricShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(log);
    }
    return p;
  }

  function initLyricGL(cv) {
    glLyricCanvas = cv;
    if (!cv) return;
    gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true }) ||
         cv.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) return;
    try {
      const mainProg = buildLyricProgram(LYRIC_VS, LYRIC_FS_MAIN);
      const glowProg = buildLyricProgram(LYRIC_VS, LYRIC_FS_GLOW);
      const quadBuf = gl.createBuffer();
      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, LYRIC_QUAD, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, LYRIC_UV, gl.STATIC_DRAW);
      L = {
        prog: mainProg,
        buf: quadBuf, uvBuf,
        aPos: gl.getAttribLocation(mainProg, 'aPos'),
        aUv: gl.getAttribLocation(mainProg, 'aUv'),
        half: gl.getUniformLocation(mainProg, 'uHalf'),
        center: gl.getUniformLocation(mainProg, 'uCenter'),
        cosY: gl.getUniformLocation(mainProg, 'uCosY'),
        sinY: gl.getUniformLocation(mainProg, 'uSinY'),
        cosX: gl.getUniformLocation(mainProg, 'uCosX'),
        sinX: gl.getUniformLocation(mainProg, 'uSinX'),
        focal: gl.getUniformLocation(mainProg, 'uFocal'),
        planeW: gl.getUniformLocation(mainProg, 'uPlaneW'),
        scale: gl.getUniformLocation(mainProg, 'uScale'),
        screen: gl.getUniformLocation(mainProg, 'uScreen'),
        pixel: gl.getUniformLocation(mainProg, 'uPixel'),
        base: gl.getUniformLocation(mainProg, 'uBase'),
        active: gl.getUniformLocation(mainProg, 'uActive'),
        alpha: gl.getUniformLocation(mainProg, 'uAlpha'),
        progress: gl.getUniformLocation(mainProg, 'uProgress'),
        flash: gl.getUniformLocation(mainProg, 'uFlash'),
      };
      G = {
        prog: glowProg,
        buf: quadBuf, uvBuf,
        aPos: gl.getAttribLocation(glowProg, 'aPos'),
        aUv: gl.getAttribLocation(glowProg, 'aUv'),
        center: gl.getUniformLocation(glowProg, 'uCenter'),
        cosY: gl.getUniformLocation(glowProg, 'uCosY'),
        sinY: gl.getUniformLocation(glowProg, 'uSinY'),
        cosX: gl.getUniformLocation(glowProg, 'uCosX'),
        sinX: gl.getUniformLocation(glowProg, 'uSinX'),
        focal: gl.getUniformLocation(glowProg, 'uFocal'),
        planeW: gl.getUniformLocation(glowProg, 'uPlaneW'),
        scale: gl.getUniformLocation(glowProg, 'uScale'),
        screen: gl.getUniformLocation(glowProg, 'uScreen'),
        pixel: gl.getUniformLocation(glowProg, 'uPixel'),
        half: gl.getUniformLocation(glowProg, 'uHalf'),
        tex: gl.getUniformLocation(glowProg, 'uTex'),
        alpha: gl.getUniformLocation(glowProg, 'uAlpha'),
        flash: gl.getUniformLocation(glowProg, 'uFlash'),
      };
      glOk = true;
    } catch (e) {
      glOk = false;
      gl = null;
      console.warn('[lyrics] WebGL 初始化失败，歌词 3D 渲染不可用:', e);
    }
  }

  const LYRIC_TRANS_OFFSET = 0.35;

  function computeRowGeom(row, R, worldScale, lineStep, dzCur, dzFalloff, centerY, safeW) {
    const c = row.c;

    let fit = 1;
    const naturalW = c.w * worldScale;
    if (naturalW > safeW) fit = safeW / naturalW;

    const delta = row.delta;

    const srcDelta = row.srcDelta != null ? row.srcDelta : delta;
    const lineAbs = Math.min(4.0, Math.abs(srcDelta));

    const lineScale = Math.min(1.02, Math.max(0.86, 1 - lineAbs * 0.016));
    const fontScale = row.transl ? 0.8 : 1;

    let cy3 = centerY + delta * lineStep;

    const halfSpan = R.planeH * 0.42;
    if (cy3 > halfSpan) cy3 = halfSpan;
    else if (cy3 < -halfSpan) cy3 = -halfSpan;

    const dz = dzCur + Math.pow(lineAbs, 1.06) * dzFalloff;

    const depth = Math.min(1, Math.pow(lineAbs / 2, 1.06));

    let alpha = 1 - depth * 0.3;

    const FADE_OUT = 3.0;
    const FADE_IN = 2.0;
    if (lineAbs > FADE_IN) {
      let env = Math.max(0, (FADE_OUT - lineAbs) / (FADE_OUT - FADE_IN));
      env = env * env * (3 - 2 * env);
      alpha *= env;
    }

    const z3 = dz * R.cosY;
    const z3b = cy3 * R.sinX + z3 * R.cosX;
    return { fit, lineScale, fontScale, cy3, dz, alpha, z3b };
  }

  function findLyricIndex(t) {
    let lo = 0, hi = lyricLines.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lyricLines[mid].time <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  function drawLyrics() {
    const lines = lyricLines;
    const count = lines.length;
    if (!count || !planeW || !planeH) return;
    const idx = findLyricIndex(lyricTime);
    if (idx < 0) return;
    const cur = lines[idx];
    if (!cur || !cur.text) return;

    const next = lines[Math.min(count - 1, idx + 1)];
    const t0 = cur.time;
    const t1 = next ? next.time : t0 + 4;
    const progress = t1 > t0 ? Math.min(1, Math.max(0, (lyricTime - t0) / (t1 - t0))) : 1;

    const targetScroll = idx;
    if (smoothedScroll == null) {
      smoothedScroll = targetScroll;
    } else {
      const diff = targetScroll - smoothedScroll;
      smoothedScroll = Math.abs(diff) > 0.01 ? smoothedScroll + diff * 0.2 : targetScroll;
    }
    const scrollPos = smoothedScroll;

    const from = Math.max(0, idx - 3);
    const to = Math.min(count - 1, idx + 3);
    const rows = [];
    for (let i = from; i <= to; i++) {
      const line = lines[i];
      if (!line || !line.text) continue;
      const delta = i - scrollPos;
      rows.push({
        c: getLyricCanvas(line.text, LYRIC_FONT_SIZE),
        delta,
        srcDelta: delta,
        isActive: i === idx,
        transl: false,
        bloom: i === idx || (lyricShake > 0.3 && Math.abs(delta) < 1.6),
      });

      if (line.trans) {
        rows.push({
          c: getLyricCanvas(line.trans, LYRIC_FONT_SIZE),
          delta: delta + LYRIC_TRANS_OFFSET,
          srcDelta: delta,
          transl: true,
          isActive: false,
          bloom: false,
        });
      }
    }

    const beatPulse = Math.sin(beatPulseTime * BT.shakeFreq * Math.PI * 2);
    const beatOsc = beatPulse * lyricShake * 0.6;
    const beatPump = lyricShake * BT.lyricScale;

    const lyricMobileScale = isMobileScreen ? LYRIC_MOBILE_SCALE : 1;
    const worldScale = (planeW / 3200) * (1 + beatPump) * lyricMobileScale;
    const safeW = W * 0.96;

    const R = {
      cosY: Math.cos(state.rotY), sinY: Math.sin(state.rotY),
      cosX: Math.cos(state.rotX), sinX: Math.sin(state.rotX),
      focal: CAM.focal, scale: state.scale, planeW, planeH, cx, cy, pixel: dpr,
    };
    const mainH = Math.round(LYRIC_FONT_SIZE * 1.58) + Math.round(LYRIC_FONT_SIZE * 0.34);

    const lineStep = mainH * worldScale * 1.45;

    const centerY = -planeH * 0.04;

    const dzCur = -planeW * 0.34 + beatOsc * planeW * 0.038;
    const dzFalloff = planeW * 0.05;

    if (glOk) {
      drawLyricsGL(rows, null, R, worldScale, lineStep, dzCur, dzFalloff, centerY, progress, safeW);
    }
  }

  function lyricGLBeginFrame() {
    gl.viewport(0, 0, Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)));
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
  }

  function drawLyricQuadGL(tex, cw, ch, worldScale, fontScale, fit, lineScale, cy3, dz, alpha, progress, R) {
    const isMain = !!tex.active;
    const prog = isMain ? L : G;
    const w2 = (cw * worldScale * fontScale * fit * lineScale) / 2;
    const h2 = (ch * worldScale * fontScale * fit * lineScale) / 2;
    gl.useProgram(prog.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.buf);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.uvBuf);
    gl.enableVertexAttribArray(prog.aUv);
    gl.vertexAttribPointer(prog.aUv, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(prog.half, w2, h2);
    gl.uniform3f(prog.center, 0, cy3, dz);
    gl.uniform1f(prog.cosY, R.cosY);
    gl.uniform1f(prog.sinY, R.sinY);
    gl.uniform1f(prog.cosX, R.cosX);
    gl.uniform1f(prog.sinX, R.sinX);
    gl.uniform1f(prog.focal, R.focal);
    gl.uniform1f(prog.planeW, R.planeW);
    gl.uniform1f(prog.scale, R.scale);
    gl.uniform2f(prog.screen, W * dpr, H * dpr);
    gl.uniform1f(prog.pixel, dpr);
    gl.uniform1f(prog.alpha, alpha);
    if (isMain) {
      gl.uniform1f(prog.flash, particleFlash * BT.lyricBright);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.base);
      gl.uniform1i(prog.base, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex.active);
      gl.uniform1i(prog.active, 1);
      gl.uniform1f(prog.progress, progress);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.uniform1f(prog.flash, particleFlash * BT.lyricGlow);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.tex, 0);
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function drawLyricsGL(rows, translRow, R, worldScale, lineStep, dzCur, dzFalloff, centerY, progress, safeW) {
    if (!glOk || !gl) return;
    lyricGLBeginFrame();
    const items = rows.slice();
    if (translRow) items.push(translRow);
    for (const row of items) {
      row.geom = computeRowGeom(row, R, worldScale, lineStep, dzCur, dzFalloff, centerY, safeW);
    }

    items.sort((a, b) => b.geom.z3b - a.geom.z3b);
    for (const row of items) {
      const g = row.geom;
      if (g.alpha <= 0.003) continue;
      const gc = row.c.gl;
      if (!gc) continue;

      if (row.bloom) {
        drawLyricQuadGL(gc.glow, row.c.gw, row.c.gh, worldScale, g.fontScale, g.fit, g.lineScale, g.cy3, g.dz - 0.005, Math.min(1, g.alpha * 0.82), -1, R);
      }
      drawLyricQuadGL(gc, row.c.w, row.c.h, worldScale, g.fontScale, g.fit, g.lineScale, g.cy3, g.dz, g.alpha, row.isActive ? progress : -1, R);
    }
  }

  function setLyrics(lines) {
    lyricLines = lines || [];
    lyricTime = 0;
    smoothedScroll = null;
    queueLyricWarm(lyricLines);
    const pre = Math.min(warmQueue.length, WARM_IMMEDIATE);
    for (let i = 0; i < pre; i++) {
      getLyricCanvas(warmQueue[warmPtr], LYRIC_FONT_SIZE);
      warmPtr++;
    }
  }
  function setLyricTime(t) {
    lyricTime = t || 0;
  }
  function setLyricVisible(v) {
    lyricVisible = !!v;
  }
  function setTimeSource(fn) {
    timeSource = typeof fn === 'function' ? fn : null;
  }

  let pgl = null;
  let pglOk = false;
  let pProgram = null;
  let pBuf = null;
  let pBufBytes = -1;
  let pVertexData = null;
  let zDisp = null;
  let pPointMax = 64;
  let pFbo = null;
  let pFboTex = null;
  let pBlitProg = null;
  let pBlitBuf = null;
  let pZMin = 0, pZRange = 1;
  const P_STRIDE = 8;

  const P_VS = `
attribute vec3 aPos;
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
uniform float uCosY, uSinY, uCosX, uSinX;
uniform float uFocal, uPlaneW, uScale;
uniform vec2 uScreen;
uniform float uPointMax, uPixel, uDotScale;
uniform float uFlash, uFlashSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float x3 = aPos.x * uCosY - aPos.z * uSinY;
  float z3 = aPos.x * uSinY + aPos.z * uCosY;
  float y3 = aPos.y;
  float y3b = y3 * uCosX - z3 * uSinX;
  float z3b = y3 * uSinX + z3 * uCosX;
  float persp = uFocal / max(0.1, uFocal + z3b / uPlaneW);
  vec2 scr = vec2(uScreen.x * 0.5 + x3 * persp * uScale, uScreen.y * 0.5 + y3b * persp * uScale);
  gl_Position = vec4(scr.x / uScreen.x * 2.0 - 1.0, 1.0 - scr.y / uScreen.y * 2.0, 0.0, 1.0);

  gl_PointSize = min(max(aSize * (1.0 + uFlash * uFlashSize) * 2.0 * max(uScale, 1.0) * uDotScale, 1.0) * uPixel, uPointMax);
  vColor = aColor;
  vAlpha = aAlpha * (1.0 + uFlash);
}`;

  const P_FS = `
precision mediump float;
uniform sampler2D uDotTex;
varying vec3 vColor;
varying float vAlpha;
void main() {

  float cov = texture2D(uDotTex, gl_PointCoord).a;
  if (cov < 0.02) discard;
  float a = min(1.0, (vAlpha / 255.0) * cov);

  gl_FragColor = vec4((vColor / 255.0) * a, a);
}`;

  const P_BLIT_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const P_BLIT_FS = `
precision mediump float;
uniform sampler2D uTex;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uTex, vUv); }`;

  function pCompile(type, src) {
    const s = pgl.createShader(type);
    pgl.shaderSource(s, src);
    pgl.compileShader(s);
    if (!pgl.getShaderParameter(s, pgl.COMPILE_STATUS)) {
      const log = pgl.getShaderInfoLog(s);
      pgl.deleteShader(s);
      throw new Error(log);
    }
    return s;
  }
  function pBuildProg(vsSrc, fsSrc) {
    const p = pgl.createProgram();
    pgl.attachShader(p, pCompile(pgl.VERTEX_SHADER, vsSrc));
    pgl.attachShader(p, pCompile(pgl.FRAGMENT_SHADER, fsSrc));
    pgl.linkProgram(p);
    if (!pgl.getProgramParameter(p, pgl.LINK_STATUS)) {
      const log = pgl.getProgramInfoLog(p);
      pgl.deleteProgram(p);
      throw new Error(log);
    }
    return p;
  }

  let pLocs = null;
  let pBlitLocs = null;
  let pDotTex = null;

  function pMakeDotTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 31);
    g.addColorStop(0.00, 'rgba(255,255,255,0.96)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.78)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.22)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    const tex = pgl.createTexture();
    pgl.bindTexture(pgl.TEXTURE_2D, tex);
    pgl.pixelStorei(pgl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    pgl.texImage2D(pgl.TEXTURE_2D, 0, pgl.RGBA, pgl.RGBA, pgl.UNSIGNED_BYTE, cv);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_MIN_FILTER, pgl.LINEAR);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_MAG_FILTER, pgl.LINEAR);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_WRAP_S, pgl.CLAMP_TO_EDGE);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_WRAP_T, pgl.CLAMP_TO_EDGE);
    return tex;
  }

  function pResizeFbo() {
    if (!pgl) return;
    const fw = Math.max(1, Math.round(W * dpr));
    const fh = Math.max(1, Math.round(H * dpr));
    if (pFboTex) pgl.deleteTexture(pFboTex);
    if (pFbo) pgl.deleteFramebuffer(pFbo);
    pFboTex = pgl.createTexture();
    pgl.bindTexture(pgl.TEXTURE_2D, pFboTex);
    pgl.texImage2D(pgl.TEXTURE_2D, 0, pgl.RGBA, fw, fh, 0, pgl.RGBA, pgl.UNSIGNED_BYTE, null);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_MIN_FILTER, pgl.LINEAR);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_MAG_FILTER, pgl.LINEAR);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_WRAP_S, pgl.CLAMP_TO_EDGE);
    pgl.texParameteri(pgl.TEXTURE_2D, pgl.TEXTURE_WRAP_T, pgl.CLAMP_TO_EDGE);
    pFbo = pgl.createFramebuffer();
    pgl.bindFramebuffer(pgl.FRAMEBUFFER, pFbo);
    pgl.framebufferTexture2D(pgl.FRAMEBUFFER, pgl.COLOR_ATTACHMENT0, pgl.TEXTURE_2D, pFboTex, 0);
    pgl.bindFramebuffer(pgl.FRAMEBUFFER, null);
  }

  function initParticleGL(cv) {
    if (!cv) return;

    const attrs = { alpha: true, antialias: false, premultipliedAlpha: true, depth: false, stencil: false, preserveDrawingBuffer: false };
    pgl = cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs);
    if (!pgl) return;
    try {
      pProgram = pBuildProg(P_VS, P_FS);
      pBlitProg = pBuildProg(P_BLIT_VS, P_BLIT_FS);
      pBuf = pgl.createBuffer();
      pBlitBuf = pgl.createBuffer();
      pgl.bindBuffer(pgl.ARRAY_BUFFER, pBlitBuf);
      pgl.bufferData(pgl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), pgl.STATIC_DRAW);
      pPointMax = (pgl.getParameter(pgl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1] || 64;
      pDotTex = pMakeDotTexture();
      pLocs = {
        pos: pgl.getAttribLocation(pProgram, 'aPos'),
        size: pgl.getAttribLocation(pProgram, 'aSize'),
        color: pgl.getAttribLocation(pProgram, 'aColor'),
        alpha: pgl.getAttribLocation(pProgram, 'aAlpha'),
        cosY: pgl.getUniformLocation(pProgram, 'uCosY'),
        sinY: pgl.getUniformLocation(pProgram, 'uSinY'),
        cosX: pgl.getUniformLocation(pProgram, 'uCosX'),
        sinX: pgl.getUniformLocation(pProgram, 'uSinX'),
        focal: pgl.getUniformLocation(pProgram, 'uFocal'),
        planeW: pgl.getUniformLocation(pProgram, 'uPlaneW'),
        scale: pgl.getUniformLocation(pProgram, 'uScale'),
        screen: pgl.getUniformLocation(pProgram, 'uScreen'),
        pointMax: pgl.getUniformLocation(pProgram, 'uPointMax'),
        pixel: pgl.getUniformLocation(pProgram, 'uPixel'),
        dotScale: pgl.getUniformLocation(pProgram, 'uDotScale'),
        dotTex: pgl.getUniformLocation(pProgram, 'uDotTex'),
        flash: pgl.getUniformLocation(pProgram, 'uFlash'),
        flashSize: pgl.getUniformLocation(pProgram, 'uFlashSize'),
      };
      pBlitLocs = {
        pos: pgl.getAttribLocation(pBlitProg, 'aPos'),
        tex: pgl.getUniformLocation(pBlitProg, 'uTex'),
      };
      pResizeFbo();
      pglOk = true;
    } catch (e) {
      pglOk = false;
      pgl = null;
      console.warn('[particles] WebGL 初始化失败，回退 CPU 渲染:', e);
    }
  }

  function renderParticlesGL(cosY, sinY, cosX, sinX, stateScale, globalAlpha) {
    if (!pglOk || !pgl) return;
    const vd = pVertexData;
    const count = particles.length;
    if (!vd || !count) return;
    let vo = 0;

    const zInv = 1 / pZRange;
    for (let b = BUCKETS - 1; b >= 0; b--) {
      const s = bucketStart[b], e = bucketStart[b + 1];
      for (let k = s; k < e; k++) {
        const i = sortedIdx[k];
        const p = particles[i];
        const alpha = (150 + (projZ[i] - pZMin) * zInv * 105) * globalAlpha;

        vd[vo++] = p.px;
        vd[vo++] = p.py;
        vd[vo++] = zDisp ? zDisp[i] : p.zBase;
        vd[vo++] = p.radius;
        vd[vo++] = p.r;
        vd[vo++] = p.g;
        vd[vo++] = p.b;
        vd[vo++] = alpha;
      }
    }

    const dw = Math.max(1, Math.round(W * dpr));
    const dh = Math.max(1, Math.round(H * dpr));
    pgl.bindFramebuffer(pgl.FRAMEBUFFER, pFbo);
    pgl.viewport(0, 0, dw, dh);
    pgl.disable(pgl.DEPTH_TEST);
    pgl.disable(pgl.CULL_FACE);

    pgl.enable(pgl.BLEND);
    pgl.blendFuncSeparate(pgl.ONE, pgl.ONE_MINUS_SRC_ALPHA, pgl.ONE, pgl.ONE_MINUS_SRC_ALPHA);
    pgl.clearColor(0, 0, 0, 0);
    pgl.clear(pgl.COLOR_BUFFER_BIT);

    pgl.useProgram(pProgram);
    pgl.bindBuffer(pgl.ARRAY_BUFFER, pBuf);
    if (pBufBytes !== vd.byteLength) {
      pgl.bufferData(pgl.ARRAY_BUFFER, vd, pgl.DYNAMIC_DRAW);
      pBufBytes = vd.byteLength;
    } else {
      pgl.bufferSubData(pgl.ARRAY_BUFFER, 0, vd);
    }
    const L = pLocs;
    const stride = P_STRIDE * 4;
    pgl.enableVertexAttribArray(L.pos);
    pgl.vertexAttribPointer(L.pos, 3, pgl.FLOAT, false, stride, 0);
    pgl.enableVertexAttribArray(L.size);
    pgl.vertexAttribPointer(L.size, 1, pgl.FLOAT, false, stride, 3 * 4);
    pgl.enableVertexAttribArray(L.color);
    pgl.vertexAttribPointer(L.color, 3, pgl.FLOAT, false, stride, 4 * 4);
    pgl.enableVertexAttribArray(L.alpha);
    pgl.vertexAttribPointer(L.alpha, 1, pgl.FLOAT, false, stride, 7 * 4);
    pgl.uniform1f(L.cosY, cosY);
    pgl.uniform1f(L.sinY, sinY);
    pgl.uniform1f(L.cosX, cosX);
    pgl.uniform1f(L.sinX, sinX);
    pgl.uniform1f(L.focal, CAM.focal);
    pgl.uniform1f(L.planeW, planeW);
    pgl.uniform1f(L.scale, stateScale);
    pgl.uniform2f(L.screen, dw, dh);
    pgl.uniform1f(L.pointMax, pPointMax);
    pgl.uniform1f(L.pixel, dpr);
    pgl.uniform1f(L.dotScale, PR.dotSizeScale || 1.5);
    pgl.uniform1f(L.flash, particleFlash);
    pgl.uniform1f(L.flashSize, BT.particleSize);
    pgl.activeTexture(pgl.TEXTURE0);
    pgl.bindTexture(pgl.TEXTURE_2D, pDotTex);
    pgl.uniform1i(L.dotTex, 0);

    let start = 0;
    for (let b = BUCKETS - 1; b >= 0; b--) {
      const n = bucketCount[b];
      if (n > 0) pgl.drawArrays(pgl.POINTS, start, n);
      start += n;
    }

    pgl.bindFramebuffer(pgl.FRAMEBUFFER, null);
    pgl.viewport(0, 0, dw, dh);
    pgl.disable(pgl.BLEND);
    pgl.useProgram(pBlitProg);
    pgl.bindBuffer(pgl.ARRAY_BUFFER, pBlitBuf);
    pgl.enableVertexAttribArray(pBlitLocs.pos);
    pgl.vertexAttribPointer(pBlitLocs.pos, 2, pgl.FLOAT, false, 0, 0);
    pgl.activeTexture(pgl.TEXTURE0);
    pgl.bindTexture(pgl.TEXTURE_2D, pFboTex);
    pgl.uniform1i(pBlitLocs.tex, 0);
    pgl.drawArrays(pgl.TRIANGLES, 0, 6);
  }

  initParticleGL(fxCanvas);

  initLyricGL(lyricCanvas);

  let started = false;
  function startRender() {
    if (!W || !H) {
      resize();
      if (!W || !H) {
        requestAnimationFrame(startRender);
        return;
      }
    }
    if (started) return;
    started = true;
    requestAnimationFrame(draw);
  }
  startRender();
  loadCoverImage(defaultCoverSrc, () => {
    updateParticleColors();
    resolveReady();
  });

  function buildParticles() {
    particles = [];
    if (!W || !H) return;

    const aspect = coverW / coverH;
    if (W / H > aspect) {
      planeH = H * PR.planeFit;
      planeW = planeH * aspect;
    } else {
      planeW = W * PR.planeFit;
      planeH = planeW / aspect;
    }
    cx = W / 2;
    cy = H / 2;

    const cols = Math.max(1, Math.round(Math.sqrt(PR.count * (planeW / planeH))));
    const rows = Math.max(1, Math.round(PR.count / cols));
    const cellW = planeW / cols;
    const cellH = planeH / rows;
    const radius = Math.max(1, Math.round(Math.min(cellW, cellH) * 0.40));

    const jitterX = cellW * 0.08;
    const jitterY = cellH * 0.08;
    const thickness = planeW * PR.coverThickness;
    midNoise = buildNoiseLayers(V.midNoiseW, V.midNoiseW, V.noiseD, 2, 2);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x3d = (c + 0.5) / cols - 0.5;
        const y3d = (r + 0.5) / rows - 0.5;
        const jx = (Math.random() - 0.5) * jitterX;
        const jy = (Math.random() - 0.5) * jitterY;

        const nx = x3d + jx / planeW + 0.5;
        const ny = y3d + jy / planeH + 0.5;
        const sx = Math.min(coverW - 1, Math.max(0, Math.floor(nx * coverW)));
        const sy = Math.min(coverH - 1, Math.max(0, Math.floor(ny * coverH)));
        let rC = PR.defaultColor[0], gC = PR.defaultColor[1], bC = PR.defaultColor[2];
        if (coverData) {
          const i = (sy * coverW + sx) * 4;
          rC = Math.min(255, coverData[i] + PR.colorBoost);
          gC = Math.min(255, coverData[i + 1] + PR.colorBoost);
          bC = Math.min(255, coverData[i + 2] + PR.colorBoost);
        }
        const lum = lumField
          ? lumField[sy * coverW + sx]
          : (0.2126 * rC + 0.7152 * gC + 0.0722 * bC) / 255;

        const wx = x3d * planeW;
        const wy = y3d * planeH;
        const dx = x3d * 2;
        const dy = y3d * 2;
        const distNorm = Math.min(1, Math.sqrt(dx * dx + dy * dy));

        particles.push({
          px: wx + jx,
          py: wy + jy,
          nx: x3d + 0.5,
          ny: y3d + 0.5,
          radial: V.radialInner + V.radialOuter * Math.pow(distNorm, V.radialPow),
          band: (Math.random() * TREBLE_BANDS) | 0,
          radius,
          r: rC, g: gC, b: bC,
          tr: rC, tg: gC, tb: bC,
          zBase: (0.5 - lum) * thickness,
          tzBase: (0.5 - lum) * thickness,
        });
      }
    }
    const n = particles.length;
    projX = new Float32Array(n);
    projY = new Float32Array(n);
    projZ = new Float32Array(n);
    bucketIdx = new Uint8Array(n);
    sortedIdx = new Int32Array(n);
    bucketCount = new Int32Array(BUCKETS);
    bucketStart = new Int32Array(BUCKETS + 1);
    bucketCur = new Int32Array(BUCKETS);

    if (!midGrid || midGrid.length !== DISP_GRID * DISP_GRID) {
      midGrid = new Float32Array(DISP_GRID * DISP_GRID);
    }
    const trebleSize = TREBLE_BANDS * TRE_GRID * TRE_GRID;
    if (!treGrid || treGrid.length !== trebleSize) {
      treGrid = new Float32Array(trebleSize);
    }

    if (pglOk) {
      pVertexData = new Float32Array(n * P_STRIDE);
      zDisp = new Float32Array(n);
    }
    colorFrames = 0;
  }

  function sampleMidGrid(nx, ny) {
    const gw = DISP_GRID, gh = DISP_GRID;
    let fx = nx * gw - 0.5;
    let fy = ny * gh - 0.5;
    if (fx < 0) fx = 0; else if (fx > gw - 1) fx = gw - 1;
    if (fy < 0) fy = 0; else if (fy > gh - 1) fy = gh - 1;
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = x0 + 1 < gw ? x0 + 1 : x0;
    const y1 = y0 + 1 < gh ? y0 + 1 : y0;
    const tx = fx - x0, ty = fy - y0;
    const r0 = y0 * gw, r1 = y1 * gw;
    const a = midGrid[r0 + x0], b = midGrid[r0 + x1];
    const c = midGrid[r1 + x0], d = midGrid[r1 + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  function sampleTrebleGrid(band, nx, ny) {
    const gw = TRE_GRID, gh = TRE_GRID;
    const base = band * gw * gh;
    let fx = nx * gw - 0.5;
    let fy = ny * gh - 0.5;
    if (fx < 0) fx = 0; else if (fx > gw - 1) fx = gw - 1;
    if (fy < 0) fy = 0; else if (fy > gh - 1) fy = gh - 1;
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = x0 + 1 < gw ? x0 + 1 : x0;
    const y1 = y0 + 1 < gh ? y0 + 1 : y0;
    const tx = fx - x0, ty = fy - y0;
    const r0 = base + y0 * gw, r1 = base + y1 * gw;
    const a = treGrid[r0 + x0], b = treGrid[r0 + x1];
    const c = treGrid[r1 + x0], d = treGrid[r1 + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  function buildDispGrids(t) {
    const gw = DISP_GRID, gh = DISP_GRID;
    const nw = V.midNoiseW, nd = V.noiseD;
    const mf = V.midFreq, mt = t * V.midTimeFreq;
    const mt2 = mt * 1.545;
    const mkf = V.midMaskFreq, mtm = t * V.midMaskTimeFreq;
    const w1 = V.midWeight * V.intensity;

    for (let gy = 0; gy < gh; gy++) {
      const ny = (gy + 0.5) / gh;
      const ay = ny * mf;
      const by = ny * mf * 2 - 3;
      const my = ny * mkf + 3;
      const row = gy * gw;
      for (let gx = 0; gx < gw; gx++) {
        const nx = (gx + 0.5) / gw;
        const n1 = sampleNoiseLayers(midNoise, nw, nw, nd, nx * mf, ay, mt);
        const n2 = sampleNoiseLayers(midNoise, nw, nw, nd, nx * mf * 2 + 5, by, mt2);
        const mask = sampleNoiseLayers(midNoise, nw, nw, nd, nx * mkf + 7, my, mtm);
        const midN = (n1 - 0.5) * 1.2 + (n2 - 0.5) * 0.8;
        midGrid[row + gx] = midN * (0.55 + (mask - 0.5) * 0.9) * w1;
      }
    }

    const tw = TRE_GRID, th = TRE_GRID;
    const tf = V.trebleFreq, tt = t * V.trebleTimeFreq;
    const w2 = V.trebleWeight * V.intensity;
    const plane = tw * th;
    for (let b = 0; b < TREBLE_BANDS; b++) {
      const base = b * plane;
      const ro = ((b + 0.5) / TREBLE_BANDS) * V.trebleRand;
      for (let gy = 0; gy < th; gy++) {
        const y = ((gy + 0.5) / th) * tf + 17 + ro;
        const row = base + gy * tw;
        for (let gx = 0; gx < tw; gx++) {
          const x = ((gx + 0.5) / tw) * tf + 31 + ro;
          const n = sampleNoiseLayers(midNoise, nw, nw, nd, x, y, tt);
          treGrid[row + gx] = (n - 0.5) * 2 * w2;
        }
      }
    }
  }

  function writeCircle(d, w, h, px, py, r, rr, gg, bb, aa) {
    if (px < 0 || px >= w || py < 0 || py >= h) return;
    const x0 = px - r, x1 = px + r;
    const y0 = py - r, y1 = py + r;
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= h) continue;
      const row = y * w;
      const dy = y - py;
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= w) continue;
        const dx = x - px;
        if (dx * dx + dy * dy > r2) continue;
        const i = (row + x) * 4;
        d[i] = rr; d[i + 1] = gg; d[i + 2] = bb; d[i + 3] = aa;
      }
    }
  }

  function resize() {
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    isMobileScreen = isMobile();

    const maxDpr = Math.min(window.devicePixelRatio || 1, RND.maxPixelRatio || 2);
    const budget = RND.maxRenderPixels || 9e6;
    dpr = Math.max(1, Math.min(maxDpr, Math.sqrt(budget / Math.max(1, W * H))));
    canvas.width = W;
    canvas.height = H;
    if (glLyricCanvas) {
      glLyricCanvas.width = Math.max(1, Math.round(W * dpr));
      glLyricCanvas.height = Math.max(1, Math.round(H * dpr));
    }
    if (fxCanvas) {
      fxCanvas.width = Math.max(1, Math.round(W * dpr));
      fxCanvas.height = Math.max(1, Math.round(H * dpr));
    }
    if (pglOk) pResizeFbo();

    bgCanvas = document.createElement('canvas');
    bgCanvas.width = W;
    bgCanvas.height = H;
    const bgCtx = bgCanvas.getContext('2d');
    bgCtx.fillStyle = '#05060f';
    bgCtx.fillRect(0, 0, W, H);
    const g = bgCtx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(32, 36, 66, 0.55)');
    g.addColorStop(1, 'rgba(3, 4, 8, 0)');
    bgCtx.fillStyle = g;
    bgCtx.fillRect(0, 0, W, H);

    layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    layerCtx = layer.getContext('2d');
    imageData = layerCtx.createImageData(W, H);
    data = imageData.data;

    buildParticles();
  }

  const ENTER_SCALE = 1.2;
  const ENTER_DURATION = 1.2;
  const enter = { start: -1, done: false };
  let enterArmed = false;

  function enterEase(time) {
    if (enter.done) return 1;

    if (!enterArmed) return 0;
    if (enter.start < 0) enter.start = time;
    const t = Math.min(1, (time - enter.start) / (ENTER_DURATION * 1000));
    if (t >= 1) enter.done = true;
    return 1 - Math.pow(1 - t, 4);
  }

  function startEnter() {
    if (enter.done) return;
    enterArmed = true;
    enter.start = -1;
  }

  let lastTime = 0;
  function draw(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = PR.bgOpacity;
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.globalAlpha = 1;

    if (!enterArmed && !enter.done) {
      warmLyricStep(WARM_BUDGET_MS);
      requestAnimationFrame(draw);
      return;
    }

    const en = energySource ? energySource() : null;
    const bassE = en ? en.bassE : 0;
    const midE = en ? en.midE : 0;
    const trebleE = en ? en.trebleE : 0;
    const hit = en ? en.hit : false;
    const beat = en ? en.beat : null;

    const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 0.016;
    lastTime = time;

    particleFlash *= Math.exp(-BT.flashRelease * dt);
    lyricShake *= Math.exp(-BT.shakeRelease * dt);

    if (beat && beat.hit) {
      if (window.__beatLog) window.__beatLog.push([time, beat.strength, beat.impact, beat.combo]);
      const drive = beat.strength * 0.45 + beat.impact * 0.75;

      const punchTarget = Math.min(V.punchTargetMax, drive * V.punchOvershoot * BT.punchScale);
      punch += (punchTarget - punch) * Math.min(1, dt * 7);

      const flashTarget = Math.min(1, drive * 0.85 * BT.particleBright);
      particleFlash += Math.max(0, flashTarget - particleFlash) * Math.min(1, dt * 8);

      beatPulseTime = 0;
      const shakeTarget = Math.min(1.2, beat.impact * BT.lyricShake);
      lyricShake += Math.max(0, shakeTarget - lyricShake) * Math.min(1, dt * 10);
    } else if (hit) {
      const punchTarget = Math.min(V.punchTargetMax, bassE * V.punchOvershoot);
      punch += (punchTarget - punch) * Math.min(1, dt * 7);
    } else {
      punch *= Math.exp(-V.punchRelease * dt);
    }
    beatPulseTime += dt;

    const k = 1 - Math.pow(1 - CAM.rotSmooth, dt * 60);
    state.rotY += (state.targetRotY - state.rotY) * k;
    state.rotX += (state.targetRotX - state.rotX) * k;
    state.scale += (state.targetScale - state.scale) * k;
    if (state.rotX > CAM.rotXLimit) state.rotX = CAM.rotXLimit;
    else if (state.rotX < -CAM.rotXLimit) state.rotX = -CAM.rotXLimit;
    const rotY = state.rotY, rotX = state.rotX;
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

    const easeIn = enterEase(time);
    const enterScaleMul = 1 + (ENTER_SCALE - 1) * (1 - easeIn);
    const enterAlpha = easeIn;

    if (!pglOk) data.fill(0);

    const w = layer.width, h = layer.height;
    const particlesArr = particles;
    const t = time / 1000;
    const count = particlesArr.length;
    const ck = 1 - Math.pow(1 - PR.coverSmooth, dt * 60);

    const audioOn = !!(en && midNoise);
    if (audioOn && (dispFrame++ % DISP_INTERVAL) === 0) buildDispGrids(t);
    const lerpColor = colorFrames > 0;
    if (lerpColor) colorFrames--;
    const shakeK = V.shakeDepth * punch;
    const pw = planeW;

    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < count; i++) {
      const p = particlesArr[i];

      if (lerpColor) {
        p.r += (p.tr - p.r) * ck;
        p.g += (p.tg - p.g) * ck;
        p.b += (p.tb - p.b) * ck;
        p.zBase += (p.tzBase - p.zBase) * ck;
      }
      let z3d = p.zBase;
      if (audioOn) {
        z3d -= pw * (
          shakeK * p.radial +
          midE * sampleMidGrid(p.nx, p.ny) +
          trebleE * sampleTrebleGrid(p.band, p.nx, p.ny)
        );
      }
      const px3d = p.px;
      const y3 = p.py;
      const x3 = px3d * cosY - z3d * sinY;
      const z3 = px3d * sinY + z3d * cosY;
      const y3b = y3 * cosX - z3 * sinX;
      const z3b = y3 * sinX + z3 * cosX;
      projZ[i] = z3b;
      if (zDisp) zDisp[i] = z3d;
      if (!pglOk) {

        const persp = CAM.focal / Math.max(0.1, CAM.focal + z3b / planeW);
        const scale = state.scale;
        projX[i] = cx + x3 * persp * scale;
        projY[i] = cy + y3b * persp * scale;
      }
      if (z3b < zMin) zMin = z3b;
      if (z3b > zMax) zMax = z3b;
    }
    const zRange = Math.max(1e-4, zMax - zMin);
    if (pglOk) { pZMin = zMin; pZRange = zRange; }

    if (bucketCount && count) {
      bucketCount.fill(0);
      const invZ = (BUCKETS - 1) / zRange;
      for (let i = 0; i < count; i++) {
        let bi = ((projZ[i] - zMin) * invZ) | 0;
        if (bi < 0) bi = 0; else if (bi > BUCKETS - 1) bi = BUCKETS - 1;
        bucketIdx[i] = bi;
        bucketCount[bi]++;
      }
      let acc = 0;
      for (let b = 0; b < BUCKETS; b++) {
        bucketStart[b] = acc;
        bucketCur[b] = acc;
        acc += bucketCount[b];
      }
      bucketStart[BUCKETS] = acc;
      for (let i = 0; i < count; i++) {
        sortedIdx[bucketCur[bucketIdx[i]]++] = i;
      }
    }

    if (pglOk) {
      renderParticlesGL(cosY, sinY, cosX, sinX, state.scale * enterScaleMul, enterAlpha);
    } else {
      const scaleR = Math.max(state.scale * enterScaleMul, 1) * (1 + particleFlash * BT.particleSize);
      const flashA = 1 + particleFlash;
      for (let b = BUCKETS - 1; b >= 0; b--) {
        const s = bucketStart[b], e = bucketStart[b + 1];
        for (let k = s; k < e; k++) {
          const i = sortedIdx[k];
          const p = particlesArr[i];
          const tz = (projZ[i] - zMin) / zRange;

          const alpha = Math.min(255, (150 + tz * 105) * flashA) * enterAlpha;
          writeCircle(data, w, h, projX[i] | 0, projY[i] | 0, Math.max(1, Math.round(p.radius * scaleR)), p.r, p.g, p.b, alpha | 0);
        }
      }

      layerCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(layer, 0, 0);
    }

    if (lyricVisible && lyricLines.length) {
      if (timeSource) lyricTime = timeSource();
      drawLyrics();
    } else if (glOk) {
      gl.viewport(0, 0, Math.max(1, Math.round(W * dpr)), Math.max(1, Math.round(H * dpr)));
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    warmLyricStep(WARM_BUDGET_MS);

    requestAnimationFrame(draw);
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  const activePointers = new Map();
  let pinchDist = 0;
  let pinchStartScale = 1;

  const TAP_SLOP = 12;
  const TAP_MAX_MS = 300;
  const DBLTAP_GAP_MS = 300;
  const DBLTAP_DIST = 48;
  let tapDownX = 0, tapDownY = 0, tapDownTime = 0;
  let lastTapTime = 0, lastTapX = 0, lastTapY = 0;

  const interactCanvas = fxCanvas || canvas;

  function beginDrag(x, y) {
    state.dragging = true;
    state.startX = x;
    state.startY = y;
    state.startTargetY = state.targetRotY;
    state.startTargetX = state.targetRotX;
    interactCanvas.classList.add('dragging');
  }

  function resetView() {
    state.targetRotY = 0;
    state.targetRotX = 0;
    state.targetScale = DEFAULT_SCALE;
  }

  interactCanvas.addEventListener('pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {

      state.dragging = false;
      interactCanvas.classList.remove('dragging');
      const pts = [...activePointers.values()];
      pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartScale = state.targetScale;
      return;
    }
    interactCanvas.setPointerCapture(e.pointerId);
    tapDownX = e.clientX;
    tapDownY = e.clientY;
    tapDownTime = performance.now();
    beginDrag(e.clientX, e.clientY);
  });
  interactCanvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {
      const pts = [...activePointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchDist > 0) {
        const factor = d / pinchDist;
        state.targetScale = Math.min(CAM.zoomMax, Math.max(CAM.zoomMin, pinchStartScale * factor));
      }
      return;
    }
    if (!state.dragging) return;
    state.targetRotY = state.startTargetY + (e.clientX - state.startX) * CAM.rotSens;
    state.targetRotX = state.startTargetX + (e.clientY - state.startY) * CAM.rotSens;
    if (state.targetRotX > CAM.rotXLimit) state.targetRotX = CAM.rotXLimit;
    else if (state.targetRotX < -CAM.rotXLimit) state.targetRotX = -CAM.rotXLimit;
  });
  const endDrag = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchDist = 0;
    interactCanvas.classList.remove('dragging');
    try { interactCanvas.releasePointerCapture(e.pointerId); } catch (err) {}
    if (activePointers.size === 1) {

      const pts = [...activePointers.values()];
      beginDrag(pts[0].x, pts[0].y);
      return;
    }
    state.dragging = false;

    if (e.type !== 'pointerup' || activePointers.size !== 0) return;
    const dx = e.clientX - tapDownX;
    const dy = e.clientY - tapDownY;
    const held = performance.now() - tapDownTime;
    if (Math.hypot(dx, dy) > TAP_SLOP || held > TAP_MAX_MS) {
      lastTapTime = 0;
      return;
    }
    const now = performance.now();
    if (
      lastTapTime > 0 &&
      now - lastTapTime <= DBLTAP_GAP_MS &&
      Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) <= DBLTAP_DIST
    ) {
      resetView();
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    }
  };
  interactCanvas.addEventListener('pointerup', endDrag);
  interactCanvas.addEventListener('pointercancel', endDrag);

  interactCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.pow(1 + CAM.zoomSens, -e.deltaY);
    state.targetScale = Math.min(CAM.zoomMax, Math.max(CAM.zoomMin, state.targetScale * factor));
  }, { passive: false });

  interactCanvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    resetView();
  });

  return { ready, lyricWarmReady, setCover, setLyrics, setLyricTime, setLyricVisible, setTimeSource, startEnter };
}
