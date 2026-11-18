export interface Song {
  id: number | string;
  name: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
}

export interface LrcLine {
  time: number;
  text: string;
}

export interface LyricLine {
  time: number;
  text: string;
  trans: string;
}

export interface BeatResult {
  hit: boolean;
  pending?: boolean;
  score: number;
  strength?: number;
  impact?: number;
  transient?: number;
  transientRel?: number;
  drumRef?: number;
  combo?: string;
  low?: number;
  body?: number;
  vocal?: number;
  snap?: number;
  tempoGap?: number;
  tempoConfidence?: number;
}

export interface EnergySnapshot {
  bassE: number;
  midE: number;
  trebleE: number;
  hit: boolean;
  beat: BeatResult | null;
}

export interface AudioVisualizer {
  bind(el: HTMLAudioElement | null): void;
  ensureGraph(): void;
  getEnergies(): EnergySnapshot | null;
  resetBeat(): void;
}

export interface ParticleEngine {
  ready: Promise<void>;
  readonly lyricWarmReady: Promise<void>;
  setCover(url: string): Promise<void>;
  setLyrics(lines: LyricLine[]): void;
  setLyricVisible(visible: boolean): void;
  setTimeSource(fn: () => number): void;
  startEnter(): void;
}
