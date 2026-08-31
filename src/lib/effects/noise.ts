export function blurField(field: Float32Array, w: number, h: number, blurR: number, passes: number) {
  const n = w * h;
  const tmp = new Float32Array(n);
  const norm = 1 / (blurR * 2 + 1);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -blurR; x <= blurR; x++) acc += field[row + Math.min(Math.max(x, 0), w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc * norm;
        acc += field[row + Math.min(x + blurR + 1, w - 1)];
        acc -= field[row + Math.max(x - blurR, 0)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -blurR; y <= blurR; y++) acc += tmp[Math.min(Math.max(y, 0), h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        field[y * w + x] = acc * norm;
        acc += tmp[Math.min(y + blurR + 1, h - 1) * w + x];
        acc -= tmp[Math.max(y - blurR, 0) * w + x];
      }
    }
  }
}

export function buildNoiseLayers(w: number, h: number, d: number, blurR: number, passes: number): Float32Array[] {
  const layers = new Array(d);
  for (let z = 0; z < d; z++) {
    const field = new Float32Array(w * h);
    for (let i = 0; i < field.length; i++) field[i] = Math.random();
    blurField(field, w, h, blurR, passes);
    layers[z] = field;
  }
  return layers;
}

export function sampleField(field: Float32Array, fw: number, fh: number, x: number, y: number): number {
  const x0 = Math.min(fw - 1, Math.max(0, x | 0));
  const y0 = Math.min(fh - 1, Math.max(0, y | 0));
  const x1 = Math.min(x0 + 1, fw - 1), y1 = Math.min(y0 + 1, fh - 1);
  const fx = x - x0, fy = y - y0;
  const a = field[y0 * fw + x0], b = field[y0 * fw + x1];
  const c = field[y1 * fw + x0], d = field[y1 * fw + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

export function sampleNoiseLayers(layers: Float32Array[], fw: number, fh: number, fd: number, x: number, y: number, t: number): number {
  const td = Math.floor(t);
  let z0 = td % fd;
  if (z0 < 0) z0 += fd;
  const z1 = (z0 + 1) % fd;
  const ft = t - td;
  const a = sampleField(layers[z0], fw, fh, x, y);
  const b = sampleField(layers[z1], fw, fh, x, y);
  return a + (b - a) * ft;
}

export function buildSmoothLuminance(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    lum[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) / 255;
  }
  blurField(lum, w, h, Math.max(1, Math.round(w * 0.03)), 3);
  const gain = 1.25;
  for (let i = 0; i < n; i++) {
    lum[i] = Math.max(0, Math.min(1, 0.5 + (lum[i] - 0.5) * gain));
  }
  return lum;
}
