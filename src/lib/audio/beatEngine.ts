 
import { config } from '../config';

const B = config.beat;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const BAND_RANGES = [
  ['sub', 38, 74],
  ['kick', 52, 165],
  ['body', 165, 420],
  ['vocal', 420, 2600],
  ['snap', 1800, 9200],
];

const rangeCache = new Map();


const DB_FLOOR = -140;

function bandRange(dataLen, sampleRate, fftSize, hz0, hz1) {
  const key = `${dataLen}|${sampleRate}|${fftSize}|${hz0}|${hz1}`;
  let r = rangeCache.get(key);
  if (!r) {
    const binHz = sampleRate / fftSize;
    const a = Math.max(1, Math.floor(hz0 / binHz));
    const b = Math.min(dataLen - 1, Math.ceil(hz1 / binHz));
    r = { lo: Math.min(a, b), hi: Math.max(a, b) };
    rangeCache.set(key, r);
  }
  return r;
}

 
export function bandRms(data: Float32Array, sampleRate: number, fftSize: number, hz0: number, hz1: number, gain?: number) {
  const { lo, hi } = bandRange(data.length, sampleRate, fftSize, hz0, hz1);
  const g = gain == null ? 1 : gain;
  let s = 0;
  for (let i = lo; i <= hi; i++) {
    let db = data[i];
    if (!(db > DB_FLOOR)) db = DB_FLOOR;
    const a = Math.pow(10, db * 0.05) * g;
    s += a * a;
  }
  return Math.sqrt(s / Math.max(1, hi - lo + 1));
}

export function createBeatEngine() {
  const s = {
    subFast: 0, subSlow: 0, subPeak: 0.045, prevSub: 0,
    lowFast: 0, lowSlow: 0, lowPeak: 0.060, prevLow: 0,
    bodyFast: 0, bodySlow: 0, bodyPeak: 0.040, prevBody: 0,
    vocalFast: 0, vocalSlow: 0, vocalPeak: 0.040, prevVocal: 0,
    snapFast: 0, snapSlow: 0, snapPeak: 0.035, prevSnap: 0,
    prevRms: 0,
    onsetAvg: 0.012, onsetPeak: 0.050,
    agcRef: 0.15,
    peakPending: 0, drumRef: 0, pending: null as any, pendingFrames: 0,
    lastHitAt: -10, tempoGap: 0, tempoConfidence: 0, beatCount: 0,
    primed: 0,
  };

  function reset() {
    s.subFast = s.subSlow = s.prevSub = 0; s.subPeak = 0.045;
    s.lowFast = s.lowSlow = s.prevLow = 0; s.lowPeak = 0.060;
    s.bodyFast = s.bodySlow = s.prevBody = 0; s.bodyPeak = 0.040;
    s.vocalFast = s.vocalSlow = s.prevVocal = 0; s.vocalPeak = 0.040;
    s.snapFast = s.snapSlow = s.prevSnap = 0; s.snapPeak = 0.035;
    s.prevRms = 0;
    s.onsetAvg = 0.012; s.onsetPeak = 0.050;
    s.agcRef = 0.15;
    s.peakPending = 0; s.drumRef = 0; s.pending = null; s.pendingFrames = 0;
    s.lastHitAt = -10; s.tempoGap = 0; s.tempoConfidence = 0;
    s.beatCount = 0; s.primed = 0;
  }

  
  function follow(cur, next, upTau, downTau, dt) {
    const tau = next > cur ? upTau : downTau;
    return cur + (next - cur) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
  }

  function process(dt, nowT, sampleRate, fftSize, freq, rms) {
    dt = Math.max(0.001, Math.min(0.08, dt || 0.016));

    
    
    
    
    
    const subRaw = bandRms(freq, sampleRate, fftSize, 38, 74, 1);
    const kickRaw = bandRms(freq, sampleRate, fftSize, 52, 165, 1);
    s.agcRef = follow(s.agcRef, kickRaw * 0.86 + subRaw * 0.42, B.agcTau, B.agcTau, dt);
    const agc = Math.min(B.agcMax, Math.max(B.agcMin, B.agcTarget / Math.max(0.004, s.agcRef)));
    const g = agc * B.inputGain;

    const sub = Math.min(1, subRaw * g);
    const kick = Math.min(1, kickRaw * g);
    const body = Math.min(1, bandRms(freq, sampleRate, fftSize, 165, 420, g));
    const vocal = Math.min(1, bandRms(freq, sampleRate, fftSize, 420, 2600, g));
    const snap = Math.min(1, bandRms(freq, sampleRate, fftSize, 1800, 9200, g));
    const low = Math.min(1, kick * 0.86 + sub * 0.42);

    s.subFast = follow(s.subFast, sub, 0.018, 0.064, dt);
    s.subSlow = follow(s.subSlow, sub, 0.320, 0.520, dt);
    s.lowFast = follow(s.lowFast, low, 0.016, 0.070, dt);
    s.lowSlow = follow(s.lowSlow, low, 0.300, 0.540, dt);
    s.bodyFast = follow(s.bodyFast, body, 0.020, 0.082, dt);
    s.bodySlow = follow(s.bodySlow, body, 0.360, 0.600, dt);
    s.vocalFast = follow(s.vocalFast, vocal, 0.026, 0.090, dt);
    s.vocalSlow = follow(s.vocalSlow, vocal, 0.340, 0.580, dt);
    s.snapFast = follow(s.snapFast, snap, 0.012, 0.060, dt);
    s.snapSlow = follow(s.snapSlow, snap, 0.300, 0.520, dt);

    
    const pd = Math.pow(0.990, dt * 60);
    s.subPeak = Math.max(s.subPeak * pd, sub, 0.045);
    s.lowPeak = Math.max(s.lowPeak * Math.pow(0.989, dt * 60), low, 0.060);
    s.bodyPeak = Math.max(s.bodyPeak * pd, body, 0.040);
    s.vocalPeak = Math.max(s.vocalPeak * pd, vocal, 0.040);
    s.snapPeak = Math.max(s.snapPeak * pd, snap, 0.035);

    const subFlux = Math.max(0, sub - s.prevSub);
    const lowFlux = Math.max(0, low - s.prevLow);
    const bodyFlux = Math.max(0, body - s.prevBody);
    const vocalFlux = Math.max(0, vocal - s.prevVocal);
    const snapFlux = Math.max(0, snap - s.prevSnap);
    const rmsFlux = Math.max(0, rms - s.prevRms);

    const subRise = Math.max(0, s.subFast - s.subSlow);
    const lowRise = Math.max(0, s.lowFast - s.lowSlow);
    const bodyRise = Math.max(0, s.bodyFast - s.bodySlow);
    const vocalRise = Math.max(0, s.vocalFast - s.vocalSlow);
    const snapRise = Math.max(0, s.snapFast - s.snapSlow);

    
    const drumOnset = subRise * 0.88 + subFlux * 0.66 + lowRise * 1.62 + lowFlux * 1.34;
    const musicalOnset =
      bodyRise * 0.34 + bodyFlux * 0.24 +
      vocalRise * 0.52 + vocalFlux * 0.36 +
      snapRise * 0.08 + snapFlux * 0.06 +
      rmsFlux * 0.20;
    const onset = drumOnset + musicalOnset * 0.16;

    const avgTau = onset > s.onsetAvg ? 1.10 : 0.34;
    s.onsetAvg = follow(s.onsetAvg, onset, avgTau, avgTau, dt);
    s.onsetPeak = Math.max(s.onsetPeak * Math.pow(0.988, dt * 60), onset, 0.032);
    const floor = s.onsetAvg * B.onsetFloor;
    const score = clamp01((onset - floor) / Math.max(0.014, s.onsetPeak - floor));

    
    
    
    
    
    const drumLevel = low + sub * 0.45;

    const subNorm = clamp01(sub / Math.max(0.045, s.subPeak * 0.70));
    const lowNorm = clamp01(low / Math.max(0.060, s.lowPeak * 0.72));
    const bodyNorm = clamp01(body / Math.max(0.045, s.bodyPeak * 0.72));
    const vocalNorm = clamp01(vocal / Math.max(0.045, s.vocalPeak * 0.72));
    const snapNorm = clamp01(snap / Math.max(0.040, s.snapPeak * 0.72));

    
    
    
    if (s.pending) {
      s.peakPending = Math.max(s.peakPending, drumLevel);
      if (--s.pendingFrames <= 0) {
        const out = s.pending;
        s.pending = null;
        const transient = s.peakPending;
        s.peakPending = 0;
        s.drumRef = s.drumRef ? s.drumRef * 0.82 + transient * 0.18 : transient;
        const rel = clamp01(transient / Math.max(0.004, s.drumRef * 1.6));
        out.strength = clamp01(0.05 + rel * 0.70 + out.score * 0.17 + out.lowPresence * 0.08);
        out.impact = clamp01(out.strength * 0.42 + rel * 0.34 + out.score * 0.14 + out.lowPresence * 0.05);
        out.transient = transient;
        out.drumRef = s.drumRef;
        out.transientRel = rel;
        
        if (out.strength > 0.84 && out.slot !== 0) out.combo = 'accent';
        delete out.slot;
        delete out.lowPresence;
        return out;
      }
      return {
        hit: false, pending: true, score,
        low: lowNorm, body: bodyNorm, vocal: vocalNorm, snap: snapNorm,
        tempoGap: s.tempoGap, tempoConfidence: s.tempoConfidence,
      };
    }
    s.peakPending = drumLevel;

    s.primed++;

    
    if (s.lastHitAt >= 0 && (nowT < s.lastHitAt - 0.15 || nowT - s.lastHitAt > 2.5)) {
      s.lastHitAt = -10;
      s.tempoGap = 0;
      s.tempoConfidence = 0;
    }

    const gapFromLast = nowT - s.lastHitAt;
    const expectedGap = s.tempoGap > 0 ? s.tempoGap : 0;
    const phaseWin = expectedGap > 0 ? Math.max(0.055, Math.min(0.105, expectedGap * 0.16)) : 0;
    const tempoDue = expectedGap > 0 && gapFromLast > expectedGap - phaseWin && gapFromLast < expectedGap + phaseWin;

    
    const lowDominance = low / Math.max(0.001, vocal * 0.84 + body * 0.36 + snap * 0.10);
    const lowFluxDominance =
      (lowFlux + subFlux * 0.58) / Math.max(0.001, vocalFlux * 0.72 + bodyFlux * 0.42 + snapFlux * 0.16);
    const voiceMask = vocalNorm > 0.60 && lowDominance < 0.80 && lowFluxDominance < 1.04;

    const lowPresence = Math.max(lowNorm, subNorm * 0.74);
    const lowAttack = lowRise + lowFlux * 0.72 + subRise * 0.58 + subFlux * 0.40;

    const drumGate =
      lowPresence > B.lowPresenceGate &&
      lowAttack > Math.max(0.011, s.onsetAvg * 0.26) &&
      !voiceMask &&
      (lowDominance > 0.64 || lowFluxDominance > 0.92 || subNorm > 0.48);

    const strongTransient = drumGate && score > 0.46 && drumOnset > s.onsetAvg * 0.66;
    const kickTransient = drumGate && score > B.scoreGate && lowAttack > Math.max(0.014, s.onsetAvg * 0.34);
    
    const tempoAssist =
      tempoDue &&
      s.tempoConfidence > B.tempoConfidenceGate &&
      drumGate &&
      lowPresence > 0.36 &&
      score > 0.18 &&
      lowAttack > Math.max(0.012, s.onsetAvg * 0.26);

    let candidate = strongTransient || kickTransient || tempoAssist;
    if (s.primed < 10) candidate = false;

    const hasTempoLock = expectedGap >= 0.32 && expectedGap <= 0.92 && s.tempoConfidence > 0.38;
    const lockedWin = hasTempoLock ? Math.max(0.070, Math.min(0.110, expectedGap * 0.16)) : 0;
    const gapRaw = nowT - s.lastHitAt;

    let rhythmAccept = false;
    if (candidate) {
      if (s.lastHitAt < 0) {
        rhythmAccept = strongTransient && score > 0.50 && lowPresence > 0.40;
      } else if (hasTempoLock) {
        const oneErr = Math.abs(gapRaw - expectedGap);
        const twoErr = Math.abs(gapRaw - expectedGap * 2);
        rhythmAccept = oneErr <= lockedWin && (kickTransient || strongTransient);
        rhythmAccept = rhythmAccept || (twoErr <= lockedWin * 1.35 && strongTransient && score > 0.58);
        rhythmAccept = rhythmAccept || (gapRaw > expectedGap * 1.20 && strongTransient && lowPresence > 0.38);
      } else {
        const looseMin = Math.max(B.minInterval, 0.255);
        rhythmAccept =
          gapRaw >= looseMin &&
          (strongTransient || (kickTransient && score > 0.40)) &&
          score > 0.42 &&
          lowPresence > 0.38;
      }
    }

    let hit = candidate && rhythmAccept;
    const minGap = hasTempoLock
      ? Math.max(B.minInterval, Math.min(0.460, expectedGap * 0.56))
      : B.minInterval;
    if (hit && gapRaw < minGap) hit = false;

    s.prevSub = sub;
    s.prevLow = low;
    s.prevBody = body;
    s.prevVocal = vocal;
    s.prevSnap = snap;
    s.prevRms = rms;
    s.tempoConfidence *= Math.pow(0.996, dt * 60);

    if (typeof window !== 'undefined' && (window as any).__beatDiag) {
      (window as any).__beatDiag.push([
        nowT, sub, kick, body, vocal, snap, low, onset, s.onsetAvg, s.onsetPeak,
        score, lowNorm, subNorm, vocalNorm, lowPresence, lowAttack,
        lowDominance, voiceMask ? 1 : 0, drumGate ? 1 : 0,
        strongTransient ? 1 : 0, kickTransient ? 1 : 0, tempoAssist ? 1 : 0,
        candidate ? 1 : 0, rhythmAccept ? 1 : 0, hit ? 1 : 0, s.primed,
      ]);
    }

    if (!hit) {
      return {
        hit: false,
        score,
        low: lowNorm, body: bodyNorm, vocal: vocalNorm, snap: snapNorm,
        tempoGap: s.tempoGap,
        tempoConfidence: s.tempoConfidence,
      };
    }

    if (s.lastHitAt > 0) {
      let gap = nowT - s.lastHitAt;
      
      while (gap > 0.88) gap *= 0.5;
      while (gap < 0.42) gap *= 2;
      if (gap >= 0.42 && gap <= 0.88) {
        const ease = hasTempoLock ? 0.10 : 0.22;
        s.tempoGap = s.tempoGap ? s.tempoGap * (1 - ease) + gap * ease : gap;
        s.tempoConfidence = Math.min(1, s.tempoConfidence + (tempoAssist ? 0.04 : 0.18));
      }
    }
    s.lastHitAt = nowT;
    s.beatCount++;

    const slot = (s.beatCount - 1) % 4;
    const toneTotal = Math.max(0.001, lowNorm + bodyNorm * 0.72 + snapNorm * 0.58);
    s.pending = {
      hit: true,
      time: nowT,
      score,
      lowPresence,
      slot,
      low: clamp01(lowNorm),
      body: clamp01((bodyNorm * 0.72) / toneTotal),
      snap: clamp01((snapNorm * 0.58) / toneTotal),
      mass: clamp01(lowPresence * 0.76 + bodyNorm * 0.20),
      sharpness: clamp01(snapNorm * 0.70 + bodyNorm * 0.12),
      confidence: clamp01(score * 0.62 + lowPresence * 0.26 + s.tempoConfidence * 0.12),
      combo: slot === 0 ? 'downbeat' : slot === 1 ? 'push' : slot === 2 ? 'drop' : 'rebound',
      downbeat: slot === 0,
      tempoGap: s.tempoGap,
      tempoConfidence: s.tempoConfidence,
      tempoAssist,
    };
    s.pendingFrames = B.peakHold;
    s.peakPending = drumLevel;
    return {
      hit: false, pending: true, score,
      low: lowNorm, body: bodyNorm, vocal: vocalNorm, snap: snapNorm,
      tempoGap: s.tempoGap, tempoConfidence: s.tempoConfidence,
    };
  }

  return { process, reset, state: s, bands: BAND_RANGES };
}
