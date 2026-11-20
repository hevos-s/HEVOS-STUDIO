// ============================================================================
// autoTune.js — Bộ máy Auto-Tune Khóa Tông TD-PSOLA Động Sample Rate (44.1 / 48 / 96 kHz)
// - Không hardcode 44100: tự động co giãn cửa sổ, bước nhảy & bán kính Pitch Marks theo sampleRate thực tế
// - Gộp trung bình sạch Stereo Mic PC khi phân tích & tổng hợp đồng pha L/R chuẩn xác từng sample (1:1)
// - Radix-2 FFT-YIN zero-padded cho mọi kích thước cửa sổ + Nội suy Parabol (75–850 Hz) + Chống nhảy quãng tám
// - Tách Pitch Trend (~186ms) & Vibrato tự nhiên (4.5–8 Hz) + Trượt Exponential Retune Glide (±2.5 bán cung)
// - Đánh dấu Pitch Marks đồng cực toàn cục & lưới PSOLA liên tục có chuẩn hóa weightSum[i]
//   (tại phụ âm gió/lặng đặt T1 = T0 & neo 1:1 tránh comb-filter, triệt tiêu 100% rè/click)
// ============================================================================

import { freqToMidi, midiToFreq, snapMidiToScale } from './theory.js?v=16';
import { encodePcmToWavBlob } from './pitchToMidi.js?v=16';

const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));

const MIN_F0_HZ = 75;
const MAX_F0_HZ = 850;
const UNVOICED_F0_HZ = 150;
const MAX_SHIFT_SEMIS = 2.5;
const MAX_VOICED_ZCR_HZ = 3800;

// Cache bảng twiddle & bit-reversal cho Radix-2 FFT
const FFT_CACHE = new Map();

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function getFftTables(n) {
  if (FFT_CACHE.has(n)) return FFT_CACHE.get(n);
  const bits = Math.round(Math.log2(n));
  const rev = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }
  const cosTable = new Float64Array(n >> 1);
  const sinTable = new Float64Array(n >> 1);
  for (let i = 0; i < (n >> 1); i++) {
    const angle = (-2 * Math.PI * i) / n;
    cosTable[i] = Math.cos(angle);
    sinTable[i] = Math.sin(angle);
  }
  const entry = { rev, cosTable, sinTable };
  FFT_CACHE.set(n, entry);
  return entry;
}

function fftInPlace(re, im, inverse = false) {
  const n = re.length;
  const { rev, cosTable, sinTable } = getFftTables(n);

  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const idx = j * step;
        const wr = cosTable[idx];
        const wi = inverse ? -sinTable[idx] : sinTable[idx];
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wr - im[i + j + half] * wi;
        const vIm = re[i + j + half] * wi + im[i + j + half] * wr;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
      }
    }
  }

  if (inverse) {
    const invN = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= invN;
      im[i] *= invN;
    }
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function medianOf(arr) {
  if (!arr || !arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function computeSliceRms(pcm, start, end) {
  const lo = Math.max(0, start);
  const hi = Math.min(pcm.length, end);
  const n = hi - lo;
  if (n <= 0) return 0;
  let sumSq = 0;
  for (let i = lo; i < hi; i++) {
    const v = pcm[i];
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / n);
}

/**
 * Tần số cắt không (ZCR tính theo Hz) độc lập với sampleRate 44.1 / 48 / 96 kHz
 */
function computeZeroCrossingHz(pcm, start, end, sr) {
  const lo = Math.max(1, start + 1);
  const hi = Math.min(pcm.length, end);
  if (hi <= lo) return 0;
  let crossings = 0;
  let prevSign = pcm[lo - 1] >= 0;
  for (let i = lo; i < hi; i++) {
    const curSign = pcm[i] >= 0;
    if (curSign !== prevSign) {
      crossings++;
      prevSign = curSign;
    }
  }
  const durSec = (hi - lo) / sr;
  return durSec > 0 ? (crossings / durSec) * 0.5 : 0;
}

/**
 * Chạy Biquad 2 chiều (Zero-Phase) chỉ phục vụ đường phân tích f0 & khóa pha Pitch Marks
 */
function applyBiquadZeroPhase(input, b0, b1, b2, a1, a2) {
  const n = input.length;
  if (n === 0) return new Float32Array(0);

  const fwd = new Float32Array(n);
  let x1 = input[0];
  let x2 = input[0];
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    fwd[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = fwd[i];
  }

  const rev = new Float32Array(n);
  x1 = fwd[n - 1];
  x2 = fwd[n - 1];
  y1 = 0;
  y2 = 0;
  for (let i = n - 1; i >= 0; i--) {
    const x0 = fwd[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    rev[i] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = rev[i];
  }

  return rev;
}

function zeroPhaseBandpassVocal(pcm, sr) {
  const n = pcm.length;
  if (n < 16) return new Float32Array(pcm);

  const safeSr = Math.max(8000, sr);
  const wH = (2 * Math.PI * 75) / safeSr;
  const cosH = Math.cos(wH);
  const alphaH = Math.sin(wH) / (2 * Math.SQRT1_2);
  const a0H = 1 + alphaH;
  const hpf = applyBiquadZeroPhase(
    pcm,
    ((1 + cosH) / 2) / a0H,
    (-(1 + cosH)) / a0H,
    ((1 + cosH) / 2) / a0H,
    (-2 * cosH) / a0H,
    (1 - alphaH) / a0H
  );

  const wL = (2 * Math.PI * Math.min(850, safeSr * 0.42)) / safeSr;
  const cosL = Math.cos(wL);
  const alphaL = Math.sin(wL) / (2 * Math.SQRT1_2);
  const a0L = 1 + alphaL;
  return applyBiquadZeroPhase(
    hpf,
    ((1 - cosL) / 2) / a0L,
    (1 - cosL) / a0L,
    ((1 - cosL) / 2) / a0L,
    (-2 * cosL) / a0L,
    (1 - alphaL) / a0L
  );
}

/**
 * Mạch nén nhẹ liên kết kênh làm ấm giọng hát (Threshold -16dB, Ratio 2:1, Attack 10ms, Release 85ms)
 */
function applyGentleWarmCompression(channels, sr) {
  const chCount = channels.length;
  if (chCount === 0) return;
  const n = channels[0].length;
  const threshold = 0.16;
  const invRatio = 0.5;
  const atk = Math.exp(-1 / Math.max(1, sr * 0.010));
  const rel = Math.exp(-1 / Math.max(1, sr * 0.085));
  let env = 0;

  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let ch = 0; ch < chCount; ch++) {
      const v = channels[ch][i];
      if (!Number.isFinite(v)) {
        channels[ch][i] = 0;
      } else {
        const av = Math.abs(v);
        if (av > peak) peak = av;
      }
    }
    env = peak > env ? atk * env + (1 - atk) * peak : rel * env + (1 - rel) * peak;
    let gain = 1.06;
    if (env > threshold) {
      const targetEnv = threshold + (env - threshold) * invRatio;
      gain *= targetEnv / Math.max(1e-7, env);
    }
    for (let ch = 0; ch < chCount; ch++) {
      channels[ch][i] *= gain;
    }
  }
}

/**
 * Bộ chặn đỉnh mềm (Soft Limiter) khóa trần tối đa ở ceiling (mặc định 0.92)
 */
export function softLimitPcm(pcm, ceiling = 0.92) {
  const knee = ceiling * 0.82;
  const span = Math.max(0.05, ceiling - knee);
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
    if (!Number.isFinite(x)) {
      pcm[i] = 0;
      continue;
    }
    const ax = Math.abs(x);
    if (ax > knee) {
      const sign = x < 0 ? -1 : 1;
      const compressed = knee + span * Math.tanh((ax - knee) / span);
      pcm[i] = sign * Math.min(ceiling, compressed);
    }
  }
  return pcm;
}

/**
 * Dò cao độ Radix-2 FFT YIN zero-padded cho MỌI kích thước khung (~46ms theo 44.1 / 48 / 96 kHz)
 */
export function detectPitchYIN2048(frame, sampleRate, yinThreshold = 0.16) {
  const N = frame ? frame.length : 0;
  if (N < 64) return null;
  const sr = Math.max(8000, Number(sampleRate) || 44100);
  const halfW = N >> 1;
  const minLag = Math.max(4, Math.floor(sr / MAX_F0_HZ));
  const maxLag = Math.min(halfW - 4, Math.ceil(sr / MIN_F0_HZ));
  if (maxLag <= minLag + 4) return null;

  let mean = 0;
  for (let i = 0; i < N; i++) mean += frame[i];
  mean /= N;

  const x = new Float64Array(N);
  const cumSq = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    const v = frame[i] - mean;
    x[i] = v;
    cumSq[i + 1] = cumSq[i] + v * v;
  }

  const energyA = cumSq[halfW];
  if (energyA < 1e-8) return null;

  const diff = new Float64Array(maxLag + 3);
  const fftSize = nextPow2(N);
  if (fftSize >= 256) {
    const aRe = new Float64Array(fftSize);
    const aIm = new Float64Array(fftSize);
    const bRe = new Float64Array(fftSize);
    const bIm = new Float64Array(fftSize);
    for (let i = 0; i < halfW; i++) aRe[i] = x[i];
    for (let i = 0; i < N; i++) bRe[i] = x[i];

    fftInPlace(aRe, aIm, false);
    fftInPlace(bRe, bIm, false);

    const cRe = new Float64Array(fftSize);
    const cIm = new Float64Array(fftSize);
    for (let k = 0; k < fftSize; k++) {
      cRe[k] = aRe[k] * bRe[k] + aIm[k] * bIm[k];
      cIm[k] = aRe[k] * bIm[k] - aIm[k] * bRe[k];
    }
    fftInPlace(cRe, cIm, true);

    for (let tau = 1; tau <= maxLag + 2; tau++) {
      const energyB = cumSq[tau + halfW] - cumSq[tau];
      const d = energyA + energyB - 2 * cRe[tau];
      diff[tau] = d > 0 ? d : 0;
    }
  } else {
    for (let tau = 1; tau <= maxLag + 2; tau++) {
      let sum = 0;
      for (let j = 0; j < halfW; j++) {
        const d = x[j] - x[j + tau];
        sum += d * d;
      }
      diff[tau] = sum;
    }
  }

  const cmndf = new Float64Array(maxLag + 3);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag + 2; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 1e-12 ? diff[tau] / (runningSum / tau) : 1;
  }

  let bestTau = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmndf[tau] < yinThreshold) {
      while (tau + 1 <= maxLag && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  if (bestTau === -1) {
    let minVal = Infinity;
    let minIdx = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        minIdx = tau;
      }
    }
    if (minVal < 0.25) {
      bestTau = minIdx;
    } else {
      return null;
    }
  }

  // Bảo vệ chống nhảy xuống họa âm dưới (2*T0) nếu nửa chu kỳ rất sạch
  const halfCand = Math.round(bestTau / 2);
  if (halfCand >= minLag + 2) {
    let subTau = halfCand;
    for (let t = Math.max(minLag, halfCand - 2); t <= Math.min(maxLag, halfCand + 2); t++) {
      if (cmndf[t] < cmndf[subTau]) subTau = t;
    }
    if (cmndf[subTau] < 0.14 && cmndf[subTau] <= cmndf[bestTau] * 1.45) {
      bestTau = subTau;
    }
  }

  let refinedTau = bestTau;
  if (bestTau > minLag && bestTau < maxLag) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * (s0 - 2 * s1 + s2);
    if (Math.abs(denom) > 1e-11) {
      const delta = (s0 - s2) / denom;
      if (delta >= -0.5 && delta <= 0.5) {
        refinedTau = bestTau + delta;
      }
    }
  }

  const freq = sr / refinedTau;
  if (freq < MIN_F0_HZ || freq > MAX_F0_HZ) return null;

  const clarity = clamp(1 - cmndf[bestTau], 0, 1);
  return { freq, period: refinedTau, clarity };
}

export const detectPitchYIN = detectPitchYIN2048;

/**
 * Lõi xử lý Auto-Tune TD-PSOLA chung cho Mono & Stereo (khóa chung đường Pitch Marks toàn bài)
 */
async function _runAutoTuneChannels(channelArrays, sampleRate, options = {}) {
  const {
    keyPc = 0,
    scaleType = 'major',
    strength = 0.65,
    onProgress = null,
  } = options;

  const sr = Math.max(8000, Math.round(Number(sampleRate) || 44100));
  const chCount = channelArrays ? channelArrays.length : 0;
  const N = chCount > 0 && channelArrays[0] ? channelArrays[0].length : 0;
  const normStrength = clamp(Number(strength) || 0, 0, 1);

  // Kích thước cửa sổ phân tích & bước nhảy co giãn chuẩn theo sampleRate thực tế (44.1 / 48 / 96 kHz)
  const windowSize = Math.max(512, Math.round(sr * 0.046));
  const hopSize = Math.max(64, Math.round(sr * 0.0058));

  if (chCount === 0 || N < windowSize || normStrength <= 0.01) {
    const outChannels = [];
    for (let ch = 0; ch < chCount; ch++) {
      outChannels.push(new Float32Array(channelArrays[ch] || 0));
    }
    if (onProgress) onProgress(100);
    return {
      outChannels,
      sampleRate: sr,
      stats: { voicedFrames: 0, totalFrames: 0, avgCorrectionCents: 0 },
    };
  }

  // --- BƯỚC 1: Khử lệch DC từng kênh & gộp Mono trung bình sạch cho phân tích ---
  const cleanChannels = new Array(chCount);
  for (let ch = 0; ch < chCount; ch++) {
    const raw = channelArrays[ch];
    let dcSum = 0;
    for (let i = 0; i < N; i++) {
      const v = raw[i];
      if (Number.isFinite(v)) dcSum += v;
    }
    const dcMean = dcSum / N;
    const clean = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const v = raw[i];
      clean[i] = Number.isFinite(v) ? v - dcMean : 0;
    }
    cleanChannels[ch] = clean;
  }

  let monoClean;
  if (chCount === 1) {
    monoClean = cleanChannels[0];
  } else {
    monoClean = new Float32Array(N);
    const invCh = 1 / chCount;
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let ch = 0; ch < chCount; ch++) acc += cleanChannels[ch][i];
      monoClean[i] = acc * invCh;
    }
  }

  // Tín hiệu lọc thông dải 75–850 Hz pha 0 chỉ dùng cho phân tích f0 & dò Pitch Marks đồng cực
  const bpPcm = zeroPhaseBandpassVocal(monoClean, sr);

  // --- BƯỚC 2: Phân tích cao độ từng khung (windowSize ~ 46ms, hopSize ~ 5.8ms) ---
  const halfWin = windowSize >> 1;
  const numFrames = Math.max(1, Math.ceil(N / hopSize));

  const frames = new Array(numFrames);
  const rmsList = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const center = i * hopSize;
    const winStart = Math.max(0, Math.min(N - windowSize, center - halfWin));
    const winEnd = Math.min(N, winStart + windowSize);

    const rms = computeSliceRms(monoClean, center - hopSize * 2, center + hopSize * 2);
    const zcrHz = computeZeroCrossingHz(monoClean, center - hopSize * 2, center + hopSize * 2, sr);
    rmsList[i] = rms;

    let det = null;
    if (winEnd - winStart === windowSize && rms >= 0.0028) {
      const slice = bpPcm.subarray(winStart, winEnd);
      det = detectPitchYIN2048(slice, sr, 0.16);
    }

    frames[i] = {
      center,
      rms,
      zcrHz,
      rawF0: det ? det.freq : null,
      rawMidi: det ? freqToMidi(det.freq) : null,
      clarity: det ? det.clarity : 0,
      voiced: false,
      midi: null,
      f0: UNVOICED_F0_HZ,
      pitchRatio: 1.0,
      targetMidi: null,
    };

    if (i > 0 && i % 160 === 0) {
      if (onProgress) onProgress(Math.min(35, Math.round((i / numFrames) * 35)));
      await yieldUi();
    }
  }

  // Ngưỡng năng lượng động phân biệt Nguyên âm vs Phụ âm/Khoảng lặng
  const sortedRms = Array.from(rmsList).sort((a, b) => a - b);
  const p95Rms = sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95))] || 0;
  const voiceGate = Math.max(0.004, p95Rms * 0.045);

  let voicedCount = 0;
  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (
      f.rms >= voiceGate &&
      f.rawMidi !== null &&
      f.clarity >= 0.70 &&
      f.zcrHz < MAX_VOICED_ZCR_HZ
    ) {
      f.voiced = true;
      f.midi = f.rawMidi;
      f.f0 = f.rawF0;
      voicedCount++;
    }
  }

  if (voicedCount < 3) {
    applyGentleWarmCompression(cleanChannels, sr);
    for (let ch = 0; ch < chCount; ch++) softLimitPcm(cleanChannels[ch], 0.92);
    if (onProgress) onProgress(100);
    return {
      outChannels: cleanChannels,
      sampleRate: sr,
      stats: { voicedFrames: 0, totalFrames: numFrames, avgCorrectionCents: 0 },
    };
  }

  // --- BƯỚC 3: Chống nhảy quãng tám, hàn khe đứt ngắn & Lọc trung vị 5 khung ---
  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (!f.voiced) continue;
    const local = [];
    for (let k = -4; k <= 4; k++) {
      if (k === 0) continue;
      const nb = frames[i + k];
      if (nb && nb.voiced && nb.rawMidi !== null) local.push(nb.rawMidi);
    }
    if (local.length >= 3) {
      const med = medianOf(local);
      const diff = f.midi - med;
      if (Math.abs(diff - 12) <= 1.5) {
        f.midi -= 12;
      } else if (Math.abs(diff + 12) <= 1.5) {
        f.midi += 12;
      } else if (Math.abs(diff) > 7.0 && local.every((v) => Math.abs(v - med) < 2.2)) {
        f.midi = med;
      }
    }
  }

  // Hàn khe đứt 1–2 khung giữa âm tiết đang ngân ổn định
  for (let i = 1; i < numFrames - 2; i++) {
    if (frames[i].voiced) continue;
    if (frames[i].rms < voiceGate * 0.95 || frames[i].zcrHz >= MAX_VOICED_ZCR_HZ) continue;
    const prev = frames[i - 1];
    const next1 = frames[i + 1];
    const next2 = frames[i + 2];
    if (prev.voiced && next1.voiced && Math.abs(prev.midi - next1.midi) <= 2.5) {
      frames[i].voiced = true;
      frames[i].midi = (prev.midi + next1.midi) * 0.5;
      voicedCount++;
    } else if (
      prev.voiced &&
      !next1.voiced &&
      next1.rms >= voiceGate * 0.95 &&
      next1.zcrHz < MAX_VOICED_ZCR_HZ &&
      next2 &&
      next2.voiced &&
      Math.abs(prev.midi - next2.midi) <= 2.5
    ) {
      frames[i].voiced = true;
      frames[i + 1].voiced = true;
      frames[i].midi = prev.midi + (next2.midi - prev.midi) / 3;
      frames[i + 1].midi = prev.midi + ((next2.midi - prev.midi) * 2) / 3;
      voicedCount += 2;
    }
  }

  // Lọc trung vị 5 khung cho đường cao độ sạch
  const cleanMidi = new Array(numFrames).fill(null);
  for (let i = 0; i < numFrames; i++) {
    if (!frames[i].voiced) continue;
    const win5 = [];
    for (let k = -2; k <= 2; k++) {
      const nb = frames[i + k];
      if (nb && nb.voiced && nb.midi !== null) win5.push(nb.midi);
    }
    cleanMidi[i] = win5.length >= 2 ? medianOf(win5) : frames[i].midi;
  }

  // --- BƯỚC 4: Tách Pitch Trend & Vibrato tự nhiên (4.5–8 Hz) + Trượt Exponential Glide ---
  const trendMidi = new Array(numFrames).fill(null);
  for (let i = 0; i < numFrames; i++) {
    if (cleanMidi[i] === null) continue;
    const centerVal = cleanMidi[i];
    let wSum = 0;
    let valSum = 0;
    // Cửa sổ ±16 khung (~186ms ở mọi sampleRate) phủ trọn 1 chu kỳ rung 5–6Hz để đường trend ổn định
    for (let k = -16; k <= 16; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= numFrames || cleanMidi[idx] === null) continue;
      if (Math.abs(cleanMidi[idx] - centerVal) > 2.2) continue;
      const w = 1 - Math.abs(k) / 17;
      wSum += w;
      valSum += cleanMidi[idx] * w;
    }
    trendMidi[i] = wSum > 0 ? valSum / wSum : centerVal;
  }

  const hopSec = hopSize / sr;
  const pullAmount = Math.pow(normStrength, 0.65);
  const vibratoKeep = 0.92 - 0.42 * normStrength;
  const glideTimeSec = 0.010 + 0.165 * Math.pow(1 - normStrength, 1.35);
  const glideAlpha = 1 - Math.exp(-hopSec / glideTimeSec);
  const unvoicedDecayAlpha = 1 - Math.exp(-hopSec / 0.018);

  let prevScaleMidi = null;
  let prevTrendMidi = null;
  let smoothedShift = 0;
  let correctionSumCents = 0;
  let lastValidF0 = UNVOICED_F0_HZ;

  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (!f.voiced || cleanMidi[i] === null || trendMidi[i] === null) {
      // Hồi mượt pitchRatio về 1.0 khi sang phụ âm/lặng thay vì cắt ngang
      smoothedShift = smoothedShift + unvoicedDecayAlpha * (0 - smoothedShift);
      if (Math.abs(smoothedShift) < 0.01) smoothedShift = 0;
      f.pitchRatio = smoothedShift === 0 ? 1.0 : Math.pow(2, smoothedShift / 12);
      f.f0 = lastValidF0;
      prevScaleMidi = null;
      prevTrendMidi = null;
      continue;
    }

    const cur = cleanMidi[i];
    const trend = trendMidi[i];
    const vibrato = clamp(cur - trend, -0.7, 0.7);
    f.midi = cur;
    f.f0 = clamp(midiToFreq(cur), MIN_F0_HZ, MAX_F0_HZ);
    lastValidF0 = f.f0;

    let chosenScaleMidi = snapMidiToScale(trend, keyPc, scaleType, null, 0);
    if (prevScaleMidi !== null && chosenScaleMidi !== prevScaleMidi) {
      const dOld = Math.abs(trend - prevScaleMidi);
      const dNew = Math.abs(trend - chosenScaleMidi);
      if (dOld - dNew < 0.24 && dOld <= 1.45) {
        chosenScaleMidi = prevScaleMidi;
      }
    }

    // Kéo tâm đường trend về đúng nốt trong âm giai, giữ lại độ rung tự nhiên của giọng hát
    const targetTrend = trend + pullAmount * (chosenScaleMidi - trend);
    const desiredInstantMidi = targetTrend + vibratoKeep * vibrato;
    const rawShift = clamp(desiredInstantMidi - cur, -MAX_SHIFT_SEMIS, MAX_SHIFT_SEMIS);

    if (prevTrendMidi === null || Math.abs(trend - prevTrendMidi) > 2.2) {
      smoothedShift = smoothedShift + Math.min(1, glideAlpha * 2.5) * (rawShift - smoothedShift);
    } else {
      smoothedShift = smoothedShift + glideAlpha * (rawShift - smoothedShift);
    }

    const clampedShift = clamp(smoothedShift, -MAX_SHIFT_SEMIS, MAX_SHIFT_SEMIS);
    f.targetMidi = cur + clampedShift;
    f.pitchRatio = Math.pow(2, clampedShift / 12);

    prevScaleMidi = chosenScaleMidi;
    prevTrendMidi = trend;
    correctionSumCents += Math.abs(clampedShift) * 100;
  }

  // Lan tỏa mượt giá trị f0 cuối sang các khung unvoiced kế bên để chuyển tiếp liên tục
  let nextValidF0 = UNVOICED_F0_HZ;
  for (let i = numFrames - 1; i >= 0; i--) {
    if (frames[i].voiced) {
      nextValidF0 = frames[i].f0;
    } else if (i + 1 < numFrames && frames[i + 1].voiced) {
      frames[i].f0 = nextValidF0;
    }
  }

  // --- BƯỚC 5: Đặt Pitch Marks Đồng Cực Toàn Cục (Polarity-Locked Cross-Correlation) ---
  let posEnergy = 0;
  let negEnergy = 0;
  for (let i = 0; i < numFrames; i++) {
    if (!frames[i].voiced) continue;
    const lo = Math.max(0, frames[i].center - (hopSize >> 1));
    const hi = Math.min(N, lo + hopSize);
    for (let s = lo; s < hi; s += 2) {
      const v = bpPcm[s];
      if (v >= 0) posEnergy += v * v;
      else negEnergy += v * v;
    }
  }
  const globalPolarity = negEnergy > posEnergy * 1.1 ? -1 : 1;

  const getInterpFrameAt = (samplePos) => {
    const fp = clamp(samplePos / hopSize, 0, numFrames - 1);
    const i0 = Math.floor(fp);
    const i1 = Math.min(numFrames - 1, i0 + 1);
    const frac = fp - i0;
    const a = frames[i0];
    const b = frames[i1];
    return {
      f0: a.f0 + (b.f0 - a.f0) * frac,
      pitchRatio: a.pitchRatio + (b.pitchRatio - a.pitchRatio) * frac,
      voiced: frac < 0.5 ? a.voiced : b.voiced,
    };
  };

  // Xác định các vùng hữu thanh (>= 3 khung ~ 17ms) để khóa dấu chu kỳ chính xác
  const voicedSpans = [];
  let sBegin = -1;
  for (let i = 0; i <= numFrames; i++) {
    const v = i < numFrames && frames[i].voiced;
    if (v && sBegin === -1) sBegin = i;
    else if (!v && sBegin !== -1) {
      if (i - sBegin >= 3) voicedSpans.push([sBegin, i - 1]);
      sBegin = -1;
    }
  }

  const maxT0 = Math.ceil(sr / MIN_F0_HZ);
  const minT0 = Math.floor(sr / MAX_F0_HZ);
  const maxHalfT = Math.max(24, Math.round(sr * 0.0048));
  const minSpanSamples = Math.max(64, Math.round(sr * 0.0015));

  const trackPolarityMark = (curPos, t0, dir) => {
    const curInt = Math.round(curPos);
    const halfT = Math.max(10, Math.min(maxHalfT, Math.round(t0 * 0.45)));
    const tplWidth = 2 * halfT + 1;
    const stepLo = Math.max(minT0, Math.round(t0 * 0.84));
    const stepHi = Math.min(maxT0, Math.round(t0 * 1.16));

    let tplNorm = 0;
    for (let k = -halfT; k <= halfT; k++) {
      const idx = curInt + k;
      if (idx >= 0 && idx < N) {
        const v = bpPcm[idx];
        tplNorm += v * v;
      }
    }
    tplNorm = Math.max(1e-9, tplNorm);

    let bestOff = Math.round(t0);
    let bestScore = -Infinity;
    const scores = new Float64Array(stepHi - stepLo + 3);

    for (let off = stepLo - 1; off <= stepHi + 1; off++) {
      const candInt = curInt + dir * off;
      if (candInt <= 2 || candInt >= N - 3) continue;

      let dot = 0;
      let candNorm = 0;
      for (let k = -halfT; k <= halfT; k++) {
        const iA = curInt + k;
        const iB = candInt + k;
        if (iA >= 0 && iA < N && iB >= 0 && iB < N) {
          const va = bpPcm[iA];
          const vb = bpPcm[iB];
          dot += va * vb;
          candNorm += vb * vb;
        }
      }
      const ncc = dot / Math.sqrt(tplNorm * Math.max(1e-9, candNorm));
      const candRms = Math.sqrt(candNorm / tplWidth);
      const normAmp = (globalPolarity * bpPcm[candInt]) / (candRms + 1e-6);
      const signMatch = globalPolarity * bpPcm[candInt] >= 0 ? 0.12 : -0.28;
      const peakWeight = 0.08 * clamp(normAmp, -1.5, 1.5);
      const score = ncc + signMatch + peakWeight;
      scores[off - (stepLo - 1)] = score;

      if (off >= stepLo && off <= stepHi && score > bestScore) {
        bestScore = score;
        bestOff = off;
      }
    }

    let refinedOff = bestOff;
    const sIdx = bestOff - (stepLo - 1);
    if (sIdx > 0 && sIdx < scores.length - 1) {
      const y0 = scores[sIdx - 1];
      const y1 = scores[sIdx];
      const y2 = scores[sIdx + 1];
      const denom = 2 * (y0 - 2 * y1 + y2);
      if (Math.abs(denom) > 1e-10) {
        const d = (y0 - y2) / denom;
        if (d >= -0.5 && d <= 0.5) refinedOff = bestOff + d;
      }
    }

    return curPos + dir * refinedOff;
  };

  // Dựng 1 dải Pitch Marks liên tục toàn bài từ sample 0 đến N - 1
  const allMarks = [];
  const allMarksVoiced = [];
  const uvStep = Math.max(32, Math.round(sr / UNVOICED_F0_HZ));

  const fillUnvoicedGap = (fromPos, toPos) => {
    const span = toPos - fromPos;
    if (span <= uvStep * 0.45) return;
    const count = Math.max(1, Math.round(span / uvStep));
    const step = span / count;
    for (let k = 1; k < count; k++) {
      allMarks.push(fromPos + k * step);
      allMarksVoiced.push(false);
    }
  };

  let lastMarkPos = -uvStep;
  for (let spIdx = 0; spIdx < voicedSpans.length; spIdx++) {
    const [fS, fE] = voicedSpans[spIdx];
    const sStart = Math.max(2, fS * hopSize);
    const sEnd = Math.min(N - 3, (fE + 1) * hopSize);
    if (sEnd - sStart < minSpanSamples) continue;

    // Chọn điểm neo có năng lượng & cùng cực rõ nhất trong vùng
    let maxRmsFi = fS;
    for (let fi = fS; fi <= fE; fi++) {
      if (frames[fi].rms > frames[maxRmsFi].rms) maxRmsFi = fi;
    }
    const anchorF0 = clamp(frames[maxRmsFi].f0 || 180, MIN_F0_HZ, MAX_F0_HZ);
    const anchorT0 = clamp(sr / anchorF0, minT0, maxT0);
    const aLo = Math.max(2, Math.round(frames[maxRmsFi].center - anchorT0 * 0.7));
    const aHi = Math.min(N - 3, Math.round(frames[maxRmsFi].center + anchorT0 * 0.7));

    let anchorPos = aLo;
    let bestAmp = -Infinity;
    for (let s = aLo; s <= aHi; s++) {
      const score = globalPolarity * (0.25 * bpPcm[s - 1] + 0.5 * bpPcm[s] + 0.25 * bpPcm[s + 1]);
      if (score > bestAmp) {
        bestAmp = score;
        anchorPos = s;
      }
    }

    const leftBound = Math.max(lastMarkPos + minT0 * 0.85, sStart - anchorT0 * 1.2);
    const leftLocal = [];
    let bp = anchorPos;
    while (bp > leftBound) {
      const pInfo = getInterpFrameAt(bp);
      const t0 = clamp(sr / pInfo.f0, minT0, maxT0);
      const prev = trackPolarityMark(bp, t0, -1);
      if (prev < leftBound - 2 || prev >= bp - minT0 * 0.6) break;
      leftLocal.push(prev);
      bp = prev;
    }
    leftLocal.reverse();

    const rightLocal = [anchorPos];
    let fp = anchorPos;
    const rightLimit = Math.min(N - 3, sEnd + anchorT0 * 1.2);
    while (fp < rightLimit) {
      const pInfo = getInterpFrameAt(fp);
      const t0 = clamp(sr / pInfo.f0, minT0, maxT0);
      const next = trackPolarityMark(fp, t0, 1);
      if (next > rightLimit + 2 || next <= fp + minT0 * 0.6) break;
      rightLocal.push(next);
      fp = next;
    }

    const spanMarks = [...leftLocal, ...rightLocal];
    if (spanMarks.length === 0) continue;

    // Lấp mượt khoảng vô thanh phía trước
    if (allMarks.length === 0) {
      const leadAnchor = spanMarks[0];
      const preMarks = [];
      for (let p = leadAnchor - uvStep; p >= 0; p -= uvStep) {
        preMarks.push(p);
      }
      preMarks.reverse();
      for (const pm of preMarks) {
        allMarks.push(pm);
        allMarksVoiced.push(false);
      }
    } else {
      fillUnvoicedGap(lastMarkPos, spanMarks[0]);
    }

    for (const m of spanMarks) {
      if (allMarks.length === 0 || m > allMarks[allMarks.length - 1] + minT0 * 0.5) {
        allMarks.push(m);
        allMarksVoiced.push(true);
      }
    }
    lastMarkPos = allMarks[allMarks.length - 1];
  }

  // Lấp tiếp phần vô thanh tới hết buffer N - 1
  if (allMarks.length === 0) {
    for (let p = 0; p < N; p += uvStep) {
      allMarks.push(p);
      allMarksVoiced.push(false);
    }
  } else {
    for (let p = allMarks[allMarks.length - 1] + uvStep; p < N + uvStep * 0.5; p += uvStep) {
      allMarks.push(p);
      allMarksVoiced.push(false);
    }
  }

  if (onProgress) onProgress(55);
  await yieldUi();

  // --- BƯỚC 6: Lưới Tổng Hợp PSOLA Liên Tục 1:1 + Chuẩn Hóa Trọng Số Từng Mẫu ---
  const outChannels = new Array(chCount);
  for (let ch = 0; ch < chCount; ch++) outChannels[ch] = new Float32Array(N);
  const weightSum = new Float32Array(N);
  const minHalfW = Math.max(16, Math.round(sr * 0.00055));

  let q = allMarks[0];
  let kPtr = 0;
  let stepCounter = 0;
  const lastIdx = N - 1;

  while (q < N + uvStep * 0.5) {
    while (
      kPtr + 1 < allMarks.length &&
      Math.abs(allMarks[kPtr + 1] - q) <= Math.abs(allMarks[kPtr] - q)
    ) {
      kPtr++;
    }

    const pCenter = allMarks[kPtr];
    const markVoiced = allMarksVoiced[kPtr];
    const qClamped = clamp(q, 0, lastIdx);
    const { f0: localF0, pitchRatio: localRatio } = getInterpFrameAt(qClamped);

    const isUnvoicedUnity = !markVoiced && Math.abs(localRatio - 1.0) < 0.003;
    let t0;
    if (markVoiced) {
      t0 = clamp(sr / Math.max(MIN_F0_HZ, localF0), minT0, maxT0);
    } else if (isUnvoicedUnity) {
      t0 = uvStep;
    } else {
      const nextDiff = kPtr + 1 < allMarks.length ? allMarks[kPtr + 1] - pCenter : uvStep;
      const prevDiff = kPtr > 0 ? pCenter - allMarks[kPtr - 1] : uvStep;
      t0 = clamp(Math.max(nextDiff, prevDiff), minT0, maxT0);
    }

    const effectiveRatio = isUnvoicedUnity ? 1.0 : localRatio;
    const t1 = isUnvoicedUnity ? uvStep : clamp(t0 / Math.max(0.5, effectiveRatio), minT0, maxT0);

    // Phụ âm gió/hơi thở unvoiced neo srcCenter = q để khớp 1:1 từng sample, loại bỏ comb-filter
    const srcCenter = isUnvoicedUnity ? q : pCenter;
    const halfW = Math.max(minHalfW, Math.max(t0, t1));
    const dstFrom = Math.max(0, Math.ceil(q - halfW));
    const dstTo = Math.min(lastIdx, Math.floor(q + halfW));

    for (let dst = dstFrom; dst <= dstTo; dst++) {
      const delta = dst - q;
      const u = delta / halfW;
      if (u <= -1 || u >= 1) continue;
      const hann = 0.5 * (1 + Math.cos(Math.PI * u));

      const srcPos = srcCenter + delta;
      if (srcPos <= 0) {
        for (let ch = 0; ch < chCount; ch++) outChannels[ch][dst] += cleanChannels[ch][0] * hann;
      } else if (srcPos >= lastIdx) {
        for (let ch = 0; ch < chCount; ch++) outChannels[ch][dst] += cleanChannels[ch][lastIdx] * hann;
      } else {
        const idx0 = Math.floor(srcPos);
        const frac = srcPos - idx0;
        const idx1 = idx0 + 1;
        for (let ch = 0; ch < chCount; ch++) {
          const chArr = cleanChannels[ch];
          const sample = chArr[idx0] + (chArr[idx1] - chArr[idx0]) * frac;
          outChannels[ch][dst] += sample * hann;
        }
      }
      weightSum[dst] += hann;
    }

    if (isUnvoicedUnity) {
      q += uvStep;
    } else if (!markVoiced && Math.abs(effectiveRatio - 1.0) < 0.008) {
      const alignPull = clamp((pCenter - q) * 0.22, -t0 * 0.15, t0 * 0.15);
      q += Math.max(minT0 * 0.65, t1 + alignPull);
    } else {
      q += t1;
    }

    stepCounter++;
    if (stepCounter % 900 === 0) {
      if (onProgress) onProgress(55 + Math.min(35, Math.round((q / N) * 35)));
      await yieldUi();
    }
  }

  // Chuẩn hóa trọng số từng mẫu (Per-Sample Overlap-Add Normalization)
  for (let i = 0; i < N; i++) {
    const w = weightSum[i];
    if (w > 1e-4) {
      const invW = 1 / w;
      for (let ch = 0; ch < chCount; ch++) {
        outChannels[ch][i] *= invW;
      }
    } else {
      for (let ch = 0; ch < chCount; ch++) {
        outChannels[ch][i] = cleanChannels[ch][i];
      }
    }
  }

  // Làm ấm nhẹ & khóa trần đỉnh an toàn ở 0.92
  applyGentleWarmCompression(outChannels, sr);
  for (let ch = 0; ch < chCount; ch++) softLimitPcm(outChannels[ch], 0.92);

  if (onProgress) onProgress(100);
  return {
    outChannels,
    sampleRate: sr,
    stats: {
      voicedFrames: voicedCount,
      totalFrames: numFrames,
      avgCorrectionCents: Math.round(correctionSumCents / Math.max(1, voicedCount)),
    },
  };
}

/**
 * Chỉnh cao độ Auto-Tune TD-PSOLA cho mảng PCM hoặc AudioBuffer (tự đọc sampleRate động)
 *
 * @param {Float32Array|AudioBuffer} rawInput
 * @param {number} sampleRate
 * @param {object} options
 * @returns {Promise<{ pcmData: Float32Array, sampleRate: number, wavBlob: Blob, stats: object }>}
 */
export async function applyAutoTunePcm(rawInput, sampleRate = 44100, options = {}) {
  if (typeof AudioBuffer !== 'undefined' && rawInput instanceof AudioBuffer) {
    const sr = Math.max(8000, Math.round(rawInput.sampleRate || sampleRate || 44100));
    const chCount = rawInput.numberOfChannels || 1;
    const chArrays = [];
    for (let ch = 0; ch < chCount; ch++) {
      chArrays.push(rawInput.getChannelData(ch));
    }
    const { outChannels, stats } = await _runAutoTuneChannels(chArrays, sr, options);
    const len = rawInput.length;
    let pcmData;
    if (outChannels.length === 1) {
      pcmData = outChannels[0];
    } else {
      pcmData = new Float32Array(len);
      const invCh = 1 / outChannels.length;
      for (let i = 0; i < len; i++) {
        let sum = 0;
        for (let ch = 0; ch < outChannels.length; ch++) sum += outChannels[ch][i];
        pcmData[i] = sum * invCh;
      }
    }
    return {
      pcmData,
      sampleRate: sr,
      wavBlob: encodePcmToWavBlob(pcmData, sr),
      stats,
    };
  }

  const sr = Math.max(8000, Math.round(Number(sampleRate) || 44100));
  const { outChannels, stats } = await _runAutoTuneChannels(
    rawInput ? [rawInput] : [],
    sr,
    options
  );
  const pcmData = outChannels[0] || new Float32Array(0);
  return {
    pcmData,
    sampleRate: sr,
    wavBlob: encodePcmToWavBlob(pcmData, sr),
    stats,
  };
}

/**
 * Hỗ trợ chỉnh trực tiếp AudioBuffer giữ nguyên 100% inputBuffer.sampleRate (44.1 / 48 / 96 kHz),
 * numberOfChannels (Mono/Stereo đồng pha L/R) và length tuyệt đối 1:1
 */
export async function applyAutoTuneAudioBuffer(inputBuffer, options = {}) {
  if (!inputBuffer) return null;
  const sr = Math.max(8000, Math.round(inputBuffer.sampleRate || 44100));
  const len = inputBuffer.length;
  const chCount = Math.max(1, inputBuffer.numberOfChannels || 1);

  const inChannels = [];
  for (let ch = 0; ch < chCount; ch++) {
    inChannels.push(inputBuffer.getChannelData(ch));
  }

  const { outChannels } = await _runAutoTuneChannels(inChannels, sr, options);
  const outBuf = new AudioBuffer({ numberOfChannels: chCount, length: len, sampleRate: sr });

  for (let ch = 0; ch < chCount; ch++) {
    outBuf.getChannelData(ch).set(outChannels[ch].subarray(0, len));
  }
  return outBuf;
}
