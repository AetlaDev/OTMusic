import type { LrcLine } from '../types';

export function parseLRC(text: string): LrcLine[] {
  const lines = (text || '').split(/\r?\n/);
  const out: LrcLine[] = [];
  const timeRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lines) {
    const matches = [...raw.matchAll(timeRe)];
    if (!matches.length) continue;
    const content = raw.replace(timeRe, '').trim();
    if (!content) continue;
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = parseFloat((m[3] || '0').padEnd(3, '0'));
      out.push({ time: min * 60 + sec + ms / 1000, text: content });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export function matchTranslations(lines: LrcLine[], transLines: LrcLine[], maxGap = 3.0): Map<number, string> {
  const map = new Map();
  if (!lines.length || !transLines.length) return map;
  const sorted = [...transLines].sort((a, b) => a.time - b.time);
  const used = new Set();

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].time;
    let best = -1;
    let bestDiff = Infinity;
    for (let j = 0; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const d = Math.abs(sorted[j].time - t);
      if (d <= maxGap && d < bestDiff) {
        bestDiff = d;
        best = j;
      }
    }
    if (best >= 0) {
      map.set(i, sorted[best].text);
      used.add(best);
    }
  }
  return map;
}
