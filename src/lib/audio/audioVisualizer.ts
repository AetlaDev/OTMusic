import { config } from '../config';
import { createBeatEngine } from './beatEngine';
import type { AudioVisualizer, EnergySnapshot, BeatResult } from '../types';

const A = config.audio;

function env(prev, next, attack, release) {
  const k = next > prev ? attack : release;
  return prev + (next - prev) * k;
}

export function createAudioVisualizer(): AudioVisualizer {
  let audioCtx!: AudioContext;
  let source!: MediaElementAudioSourceNode;
  let analyser!: AnalyserNode;
  let freqData!: Uint8Array<ArrayBuffer>;
  let beatAnalyser!: AnalyserNode;
  let beatFreqData!: Float32Array<ArrayBuffer>;
  let timeData!: Uint8Array<ArrayBuffer>;
  let audio: HTMLAudioElement | null = null;
  let prevBassE = 0;
  let lastBeatAt = 0;
  let initialized = false;

  let midPeak = 0.026, treblePeak = 0.018;
  let smoothMid = 0, smoothTreb = 0;

  const beatEngine = createBeatEngine();
  let lastFrameAt = 0;

  function bind(el: HTMLAudioElement | null) {
    audio = el;
  }

  function ensureGraph() {
    if (!audio) return;
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = A.fftSize;
    analyser.smoothingTimeConstant = A.smoothingTimeConstant;
    source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);

    
    
    
    
    beatAnalyser = audioCtx.createAnalyser();
    beatAnalyser.fftSize = A.beatFftSize;
    beatAnalyser.smoothingTimeConstant = A.beatSmoothing;
    source.connect(beatAnalyser);
    beatFreqData = new Float32Array(beatAnalyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);

    beatEngine.reset();
  }

  function resetBeat() {
    beatEngine.reset();
    lastFrameAt = 0;
    prevBassE = 0;
    initialized = false;
  }

  function bandMean(fromHz, toHz) {
    const binHz = audioCtx.sampleRate / analyser.fftSize;
    const f = Math.max(0, Math.round(fromHz / binHz));
    const t = Math.min(freqData.length - 1, Math.round(toHz / binHz));
    let s = 0;
    for (let i = f; i <= t; i++) s += freqData[i];
    return s / Math.max(1, t - f + 1) / 255;
  }

  function timeRms() {
    let s = 0;
    const n = timeData.length;
    for (let i = 0; i < n; i++) {
      const v = (timeData[i] - 128) / 128;
      s += v * v;
    }
    return Math.sqrt(s / n);
  }

  function getEnergies(): EnergySnapshot | null {
    if (!analyser) return null;
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(timeData);
    let bs = 0;
    for (let i = A.bassFrom; i <= A.bassTo; i++) bs += freqData[i];
    const bassE = Math.min(A.bassMax, (bs / (A.bassTo - A.bassFrom + 1) / 255) * A.bassBoost);

    const mRaw = bandMean(A.midHzFrom, A.midHzTo);
    const tRaw = bandMean(A.trebleHzFrom, A.trebleHzTo);
    midPeak = Math.max(midPeak * 0.993, mRaw, 0.026);
    treblePeak = Math.max(treblePeak * 0.992, tRaw, 0.018);
    const rm = Math.min(1, Math.pow(mRaw / Math.max(0.025, midPeak * 0.70), 0.86));
    const rt = Math.min(1, Math.pow(tRaw / Math.max(0.020, treblePeak * 0.74), 0.92));
    smoothMid = env(smoothMid, Math.min(0.68, rm * 0.64), 0.18, 0.060);
    smoothTreb = env(smoothTreb, Math.min(0.56, rt * 0.54), 0.18, 0.055);
    const midE = Math.min(A.midMax, smoothMid * A.midBoost);
    const trebleE = Math.min(A.trebleMax, smoothTreb * A.trebleBoost);

    const now = performance.now();
    const dt = lastFrameAt ? Math.min(0.08, (now - lastFrameAt) / 1000) : 0.016;
    lastFrameAt = now;

    let beat: BeatResult | null = null;
    if (config.beat.enabled && beatAnalyser) {
      beatAnalyser.getFloatFrequencyData(beatFreqData);
      beat = beatEngine.process(
        dt,
        audio ? audio.currentTime : 0,
        audioCtx.sampleRate,
        beatAnalyser.fftSize,
        beatFreqData,
        timeRms()
      );
    }

    if (!initialized) {
      initialized = true;
      prevBassE = bassE;
      return { bassE, midE, trebleE, hit: false, beat: beat ? { ...beat, hit: false } : null };
    }
    const hit =
      bassE >= A.beatMinEnergy &&
      bassE - prevBassE > A.beatRiseDelta &&
      now - lastBeatAt > A.beatMinInterval;
    if (hit) lastBeatAt = now;
    prevBassE = bassE;
    return { bassE, midE, trebleE, hit, beat };
  }

  return { bind, ensureGraph, getEnergies, resetBeat };
}
