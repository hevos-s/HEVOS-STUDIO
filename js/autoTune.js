// ============================================================================
// autoTune.js — Bộ máy Auto-Tune Khóa Tông Thế Hệ Mới
// - Lọc thông dải 2 chiều không lệch pha (Zero-Phase 2nd-Order Butterworth 80–1100 Hz)
// - Dò cao độ chính xác cao bằng Radix-2 FFT-YIN (windowSize = 2048, hopSize = 256,
//   step = 1 mẫu, không bỏ mẫu) + Nội suy Parabol + Lọc trung vị 5 khung
// - Tính độc lập nốt mục tiêu theo Tông & Âm giai cho TỪNG KHUNG kèm trễ chuyển bậc
//   (hysteresis) & làm mượt tỷ lệ nghịch Retune Strength -> bám mượt từng nốt hát
// - Tái tổng hợp TD-PSOLA khóa pha bằng tương quan chéo (Phase-Locked Cross-Correlation),
//   đọc mẫu nội suy tuyến tính sub-sample, cửa sổ Hann đối xứng 2*T0 mở rộng vượt biên,
//   Raised-Cosine Crossfade 15ms bảo toàn phụ âm gió & Soft Limiter trần 0.92
// ============================================================================

import { freqToMidi, midiToFreq, snapMidiToScale } from './theory.js?v=11';
import { encodePcmToWavBlob } from './pitchToMidi.js?v=11';

const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));

const MIN_F0_HZ = 75;   // ~D2
const MAX_F0_HZ = 980;  // ~B5

// Cache bảng twiddle & bit-reversal cho Radix-2 FFT kích thước 2048
const FFT_CACHE = new Map();

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

function computeZeroCrossingRate(pcm, start, end) {
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
  return crossings / (hi - lo);
}

/**
 * Chạy bộ lọc Biquad theo hai chiều (xuôi rồi ngược) để đạt độ lệch pha bằng 0 tuyệt đối
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

/**
 * Lọc thông dải giọng hát 80 Hz – 1100 Hz với độ lệch pha = 0 (Zero-Phase Butterworth)
 * Khử ù nền 50/60 Hz và phụ âm gió gắt khi dò f0 & khóa pha Pitch Marks.
 */
function zeroPhaseBandpassVocal(pcm, sr) {
  const n = pcm.length;
  if (n < 16) return new Float32Array(pcm);

  const safeSr = Math.max(8000, sr);

  // 1. Biquad High-Pass 80 Hz (Q = 0.7071)
  const wH = (2 * Math.PI * 80) / safeSr;
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

  // 2. Biquad Low-Pass 1100 Hz (Q = 0.7071)
  const wL = (2 * Math.PI * Math.min(1100, safeSr * 0.42)) / safeSr;
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
 * Bộ chặn đỉnh mềm (Soft Limiter) giới hạn biên độ tối đa ở ceiling (mặc định 0.92)
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
 * Thuật toán YIN chuẩn xác từng mẫu (step = 1) bằng Radix-2 FFT (N = 2048)
 * kết hợp Nội suy Parabol (Parabolic Interpolation) trên CMNDF.
 */
export function detectPitchYIN2048(frame, sampleRate, yinThreshold = 0.15) {
  const N = frame.length;
  const isPow2 = (N & (N - 1)) === 0 && N >= 512;
  const halfW = N >> 1; // 1024 khi N = 2048
  const minLag = Math.max(4, Math.floor(sampleRate / MAX_F0_HZ));
  const maxLag = Math.min(halfW - 4, Math.ceil(sampleRate / MIN_F0_HZ));
  if (maxLag <= minLag + 4) return null;

  // Khử thành phần DC trong khung
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
  if (isPow2) {
    // R(tau) = sum_{j=0..halfW-1} x[j] * x[j + tau] via Radix-2 FFT (step = 1 chính xác tuyệt đối)
    const aRe = new Float64Array(N);
    const aIm = new Float64Array(N);
    const bRe = new Float64Array(N);
    const bIm = new Float64Array(N);
    for (let i = 0; i < halfW; i++) aRe[i] = x[i];
    for (let i = 0; i < N; i++) bRe[i] = x[i];

    fftInPlace(aRe, aIm, false);
    fftInPlace(bRe, bIm, false);

    // C = conj(A) * B
    const cRe = new Float64Array(N);
    const cIm = new Float64Array(N);
    for (let k = 0; k < N; k++) {
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

  // CMNDF: d'(tau) = d(tau) / ((1/tau) * sum_{k=1..tau} d(k))
  const cmndf = new Float64Array(maxLag + 3);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag + 2; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 1e-12 ? diff[tau] / (runningSum / tau) : 1;
  }

  // Tìm cực tiểu cục bộ ĐẦU TIÊN dưới ngưỡng yinThreshold
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

  // Dự phòng cực tiểu toàn cục nếu độ tuần hoàn vẫn đủ rõ (< 0.24)
  if (bestTau === -1) {
    let minVal = Infinity;
    let minIdx = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        minIdx = tau;
      }
    }
    if (minVal < 0.24) {
      bestTau = minIdx;
    } else {
      return null;
    }
  }

  // Kiểm tra nhanh tránh nhảy xuống nửa tần số (2*T0) nếu nửa chu kỳ bestTau/2 rất sạch (< 0.14)
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

  // Nội suy Parabol trên 3 điểm CMNDF lân cận
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

  const freq = sampleRate / refinedTau;
  if (freq < MIN_F0_HZ || freq > MAX_F0_HZ) return null;

  const clarity = Math.max(0, Math.min(1, 1 - cmndf[bestTau]));
  return { freq, period: refinedTau, clarity };
}

function readPcmLinear(pcm, pos) {
  if (pos <= 0) return pcm[0];
  const last = pcm.length - 1;
  if (pos >= last) return pcm[last];
  const idx = Math.floor(pos);
  const frac = pos - idx;
  return pcm[idx] + (pcm[idx + 1] - pcm[idx]) * frac;
}

/**
 * Chỉnh cao độ Auto-Tune bằng thuật toán TD-PSOLA khóa pha (Phase-Locked Cross-Correlation)
 * kết hợp bộ dò cao độ chính xác FFT-YIN (windowSize = 2048, hopSize = 256).
 *
 * @param {Float32Array} rawPcm
 * @param {number} sampleRate
 * @param {object} options
 * @returns {Promise<{ pcmData: Float32Array, sampleRate: number, wavBlob: Blob, stats: object }>}
 */
export async function applyAutoTunePcm(rawPcm, sampleRate = 44100, options = {}) {
  const {
    keyPc = 0,
    scaleType = 'major',
    strength = 0.65,
    onProgress = null,
  } = options;

  const sr = Math.max(8000, Math.round(sampleRate || 44100));
  const normStrength = Math.max(0, Math.min(1, Number(strength) || 0));

  if (!rawPcm || rawPcm.length < 2048 || normStrength <= 0.01) {
    const copy = new Float32Array(rawPcm || 0);
    if (onProgress) onProgress(100);
    return {
      pcmData: copy,
      sampleRate: sr,
      wavBlob: encodePcmToWavBlob(copy, sr),
      stats: { voicedFrames: 0, totalFrames: 0, avgCorrectionCents: 0 },
    };
  }

  // Lọc thông dải 2 chiều (Zero-Phase 80–1100 Hz) chỉ phục vụ phân tích f0 & khóa pha Pitch Marks
  const bpPcm = zeroPhaseBandpassVocal(rawPcm, sr);

  // --- BƯỚC 1: Phân tích cao độ từng khung (windowSize = 2048, hopSize = 256) ---
  const windowSize = 2048;
  const hopSize = 256;
  const halfWin = windowSize >> 1;
  const numFrames = Math.max(1, Math.ceil(rawPcm.length / hopSize));

  const frames = new Array(numFrames);
  const rmsList = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const center = i * hopSize;
    const winStart = Math.max(0, Math.min(rawPcm.length - windowSize, center - halfWin));
    const winEnd = Math.min(rawPcm.length, winStart + windowSize);

    const rms = computeSliceRms(rawPcm, center - hopSize * 2, center + hopSize * 2);
    const zcr = computeZeroCrossingRate(rawPcm, center - hopSize * 2, center + hopSize * 2);
    rmsList[i] = rms;

    let det = null;
    if (winEnd - winStart === windowSize && rms >= 0.0035) {
      const slice = bpPcm.subarray(winStart, winEnd);
      det = detectPitchYIN2048(slice, sr, 0.15);
    }

    frames[i] = {
      center,
      rms,
      zcr,
      rawF0: det ? det.freq : null,
      rawMidi: det ? freqToMidi(det.freq) : null,
      clarity: det ? det.clarity : 0,
      voiced: false,
      f0: null,
      midi: null,
      targetMidi: null,
      targetF0: null,
    };

    if (i > 0 && i % 180 === 0) {
      if (onProgress) onProgress(Math.min(40, Math.round((i / numFrames) * 40)));
      await yieldUi();
    }
  }

  // Phân loại Hữu thanh (Nguyên âm hát) / Vô thanh (Phụ âm gió s, t, ch, kh & lấy hơi)
  const sortedRms = Array.from(rmsList).sort((a, b) => a - b);
  const p95Rms = sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95))] || 0;
  const voiceGate = Math.max(0.0055, p95Rms * 0.065);

  let voicedFramesCount = 0;
  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (f.rms >= voiceGate && f.rawMidi !== null && f.clarity >= 0.72 && f.zcr < 0.22) {
      f.voiced = true;
      f.midi = f.rawMidi;
      f.f0 = f.rawF0;
      voicedFramesCount++;
    }
  }

  if (voicedFramesCount < 4) {
    const copy = new Float32Array(rawPcm);
    if (onProgress) onProgress(100);
    return {
      pcmData: copy,
      sampleRate: sr,
      wavBlob: encodePcmToWavBlob(copy, sr),
      stats: { voicedFrames: 0, totalFrames: numFrames, avgCorrectionCents: 0 },
    };
  }

  // --- BƯỚC 2: Chống nhảy quãng tám cục bộ, Lọc trung vị 5 khung & Hàn khe đứt ngắn ---
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
      if (Math.abs(diff - 12) <= 1.4) {
        f.midi -= 12;
      } else if (Math.abs(diff + 12) <= 1.4) {
        f.midi += 12;
      } else if (Math.abs(diff) > 7.5 && local.every((v) => Math.abs(v - med) < 2.2)) {
        f.midi = med;
      }
    }
  }

  // Hàn khe đứt 1–2 khung giữa nguyên âm đang ngân ổn định để tránh cắt ngang gây khựng
  for (let i = 1; i < numFrames - 2; i++) {
    if (frames[i].voiced) continue;
    if (frames[i].rms < voiceGate * 1.1 || frames[i].zcr >= 0.2) continue;
    const prev = frames[i - 1];
    const next1 = frames[i + 1];
    const next2 = frames[i + 2];
    if (prev.voiced && next1.voiced && Math.abs(prev.midi - next1.midi) <= 2.5) {
      frames[i].voiced = true;
      frames[i].midi = (prev.midi + next1.midi) * 0.5;
      frames[i].f0 = midiToFreq(frames[i].midi);
      voicedFramesCount++;
    } else if (
      prev.voiced &&
      !next1.voiced &&
      next1.rms >= voiceGate * 1.1 &&
      next1.zcr < 0.2 &&
      next2 &&
      next2.voiced &&
      Math.abs(prev.midi - next2.midi) <= 2.5
    ) {
      frames[i].voiced = true;
      frames[i + 1].voiced = true;
      frames[i].midi = prev.midi + (next2.midi - prev.midi) / 3;
      frames[i + 1].midi = prev.midi + ((next2.midi - prev.midi) * 2) / 3;
      frames[i].f0 = midiToFreq(frames[i].midi);
      frames[i + 1].f0 = midiToFreq(frames[i + 1].midi);
      voicedFramesCount += 2;
    }
  }

  // Bộ lọc trung vị 5 khung (Median Filter 5 frames)
  const medianMidis = new Array(numFrames).fill(null);
  for (let i = 0; i < numFrames; i++) {
    if (!frames[i].voiced) continue;
    const win5 = [];
    for (let k = -2; k <= 2; k++) {
      const nb = frames[i + k];
      if (nb && nb.voiced && nb.midi !== null) win5.push(nb.midi);
    }
    medianMidis[i] = win5.length >= 2 ? medianOf(win5) : frames[i].midi;
  }

  // --- BƯỚC 3: Tính nốt mục tiêu độc lập cho TỪNG KHUNG + làm mượt tỷ lệ nghịch Retune Strength ---
  const hopSec = hopSize / sr;
  const glideTimeSec = 0.005 + 0.075 * Math.pow(1 - normStrength, 1.55);
  const shiftAlpha = 1 - Math.exp(-hopSec / glideTimeSec);

  let prevScaleMidi = null;
  let prevCurMidi = null;
  let smoothedShift = 0;
  let correctionSumCents = 0;

  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (!f.voiced || medianMidis[i] === null) {
      prevScaleMidi = null;
      prevCurMidi = null;
      smoothedShift = 0;
      continue;
    }

    const curMidi = medianMidis[i];
    f.midi = curMidi;
    f.f0 = midiToFreq(curMidi);

    // Tính độc lập nốt gần nhất trong đúng Tông & Âm giai cho chính khung này
    let chosenScaleMidi = snapMidiToScale(curMidi, keyPc, scaleType, null, 0);

    // Hysteresis ±0.12 bán cung ở ranh giới giữa hai bậc nốt kế nhau để tránh rung giật
    if (prevScaleMidi !== null && chosenScaleMidi !== prevScaleMidi) {
      const distOld = Math.abs(curMidi - prevScaleMidi);
      const distNew = Math.abs(curMidi - chosenScaleMidi);
      if (distOld - distNew < 0.12 && distOld <= 1.25) {
        chosenScaleMidi = prevScaleMidi;
      }
    }

    const rawShift = normStrength * (chosenScaleMidi - curMidi);
    if (prevCurMidi === null || Math.abs(curMidi - prevCurMidi) > 1.8) {
      // Nhảy quãng lớn sang nốt mới -> không mang độ trễ cũ kéo sai cao độ
      smoothedShift = rawShift;
    } else {
      smoothedShift = smoothedShift + shiftAlpha * (rawShift - smoothedShift);
    }

    const clampedShift = Math.max(-1.25, Math.min(1.25, smoothedShift));
    const finalTargetMidi = curMidi + clampedShift;

    f.targetMidi = finalTargetMidi;
    f.targetF0 = midiToFreq(finalTargetMidi);

    prevScaleMidi = chosenScaleMidi;
    prevCurMidi = curMidi;
    correctionSumCents += Math.abs(finalTargetMidi - curMidi) * 100;
  }

  // Gom các khung hữu thanh liên tiếp thành phân đoạn (>= 4 khung ~ 23ms)
  const islands = [];
  let segStart = -1;
  for (let i = 0; i <= numFrames; i++) {
    const isV = i < numFrames && frames[i].voiced;
    if (isV && segStart === -1) {
      segStart = i;
    } else if (!isV && segStart !== -1) {
      const segEnd = i - 1;
      if (segEnd - segStart + 1 >= 4) {
        islands.push([segStart, segEnd]);
      }
      segStart = -1;
    }
  }

  // --- BƯỚC 4: Tái tổng hợp TD-PSOLA khóa pha & nội suy sub-sample ---
  const outPcm = new Float32Array(rawPcm);

  const getInterpFrameParams = (samplePos) => {
    const fPos = Math.max(0, Math.min(numFrames - 1, samplePos / hopSize));
    const i0 = Math.floor(fPos);
    const i1 = Math.min(numFrames - 1, i0 + 1);
    const frac = fPos - i0;
    const f0A = frames[i0].f0;
    const f0B = frames[i1].f0;
    const tf0A = frames[i0].targetF0;
    const tf0B = frames[i1].targetF0;

    if (f0A && f0B && tf0A && tf0B) {
      return {
        f0: f0A + (f0B - f0A) * frac,
        targetF0: tf0A + (tf0B - tf0A) * frac,
      };
    }
    const valid = frames[i0].f0 ? frames[i0] : frames[i1];
    return {
      f0: valid.f0 || 180,
      targetF0: valid.targetF0 || valid.f0 || 180,
    };
  };

  for (let islIdx = 0; islIdx < islands.length; islIdx++) {
    const [fStart, fEnd] = islands[islIdx];
    const startSample = Math.max(0, fStart * hopSize);
    const endSample = Math.min(rawPcm.length, (fEnd + 1) * hopSize);
    if (endSample - startSample < 256) continue;

    let maxShiftSemis = 0;
    for (let fi = fStart; fi <= fEnd; fi++) {
      const fr = frames[fi];
      if (fr.voiced && fr.targetMidi !== null && fr.midi !== null) {
        const d = Math.abs(fr.targetMidi - fr.midi);
        if (d > maxShiftSemis) maxShiftSemis = d;
      }
    }
    if (maxShiftSemis < 0.025) continue;

    // Cực tính ổn định nhất trong phân đoạn trên tín hiệu không lệch pha bpPcm
    let posSum = 0;
    let negSum = 0;
    for (let s = startSample; s < endSample; s += 2) {
      const v = bpPcm[s];
      if (v > 0) posSum += v * v;
      else negSum += v * v;
    }
    const polarity = negSum > posSum * 1.15 ? -1 : 1;

    const firstF0 = frames[fStart].f0 || 180;
    const lastF0 = frames[fEnd].f0 || firstF0;
    const firstT0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / firstF0));
    const lastT0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / lastF0));

    // Tìm Pitch Mark neo đầu tiên trong vùng đầu đoạn có năng lượng cao
    const anchorSearchLo = Math.max(2, startSample);
    const anchorSearchHi = Math.min(bpPcm.length - 3, startSample + Math.round(firstT0 * 1.35));
    let anchorMark = anchorSearchLo;
    let bestAnchorScore = -Infinity;
    for (let s = anchorSearchLo; s <= anchorSearchHi; s++) {
      const score = polarity * (0.25 * bpPcm[s - 1] + 0.5 * bpPcm[s] + 0.25 * bpPcm[s + 1]);
      if (score > bestAnchorScore) {
        bestAnchorScore = score;
        anchorMark = s;
      }
    }

    // Dò Pitch Mark kế tiếp theo hướng dir (+1 hoặc -1) bằng tương quan chéo khóa pha + tinh chỉnh Parabol
    const trackNextMark = (curPos, t0, dir) => {
      const curInt = Math.round(curPos);
      const halfT = Math.max(8, Math.min(180, Math.round(t0 * 0.42)));
      const stepLo = Math.round(t0 * 0.84);
      const stepHi = Math.round(t0 * 1.16);

      // Chuẩn hóa năng lượng template quanh đỉnh hiện tại
      let tplNorm = 0;
      for (let k = -halfT; k <= halfT; k++) {
        const idx = curInt + k;
        if (idx >= 0 && idx < bpPcm.length) {
          const v = bpPcm[idx];
          tplNorm += v * v;
        }
      }
      tplNorm = Math.max(1e-9, tplNorm);

      let bestOffset = Math.round(t0);
      let bestScore = -Infinity;
      const scores = new Float64Array(stepHi - stepLo + 3);

      for (let off = stepLo - 1; off <= stepHi + 1; off++) {
        const candInt = curInt + dir * off;
        if (candInt <= 2 || candInt >= bpPcm.length - 3) continue;

        let dot = 0;
        let candNorm = 0;
        for (let k = -halfT; k <= halfT; k++) {
          const idxA = curInt + k;
          const idxB = candInt + k;
          if (idxA >= 0 && idxA < bpPcm.length && idxB >= 0 && idxB < bpPcm.length) {
            const a = bpPcm[idxA];
            const b = bpPcm[idxB];
            dot += a * b;
            candNorm += b * b;
          }
        }
        const ncc = dot / Math.sqrt(tplNorm * Math.max(1e-9, candNorm));
        const peakBonus = polarity * bpPcm[candInt];
        const score = ncc + peakBonus * 0.15;
        scores[off - (stepLo - 1)] = score;

        if (off >= stepLo && off <= stepHi && score > bestScore) {
          bestScore = score;
          bestOffset = off;
        }
      }

      // Nội suy Parabol sub-sample trên hàm tương quan
      let refinedOffset = bestOffset;
      const sIdx = bestOffset - (stepLo - 1);
      if (sIdx > 0 && sIdx < scores.length - 1) {
        const y0 = scores[sIdx - 1];
        const y1 = scores[sIdx];
        const y2 = scores[sIdx + 1];
        const denom = 2 * (y0 - 2 * y1 + y2);
        if (Math.abs(denom) > 1e-10) {
          const delta = (y0 - y2) / denom;
          if (delta >= -0.5 && delta <= 0.5) {
            refinedOffset = bestOffset + delta;
          }
        }
      }

      return curPos + dir * refinedOffset;
    };

    // Mở rộng Pitch Marks qua CẢ HAI BIÊN (>= 1.8 * T0) để winSum phủ kín 100% đoạn
    const leftBound = Math.max(2, startSample - Math.ceil(firstT0 * 1.9));
    const rightBound = Math.min(rawPcm.length - 3, endSample + Math.ceil(lastT0 * 1.9));

    const leftMarks = [];
    let backPos = anchorMark;
    while (backPos > leftBound) {
      const p = getInterpFrameParams(backPos);
      const t0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / p.f0));
      const prevPos = trackNextMark(backPos, t0, -1);
      if (prevPos < leftBound - t0 * 0.5 || prevPos >= backPos - 12) break;
      leftMarks.push(prevPos);
      backPos = prevPos;
    }
    leftMarks.reverse();

    const rightMarks = [anchorMark];
    let fwdPos = anchorMark;
    while (fwdPos < rightBound) {
      const p = getInterpFrameParams(fwdPos);
      const t0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / p.f0));
      const nextPos = trackNextMark(fwdPos, t0, 1);
      if (nextPos > rightBound + t0 * 0.5 || nextPos <= fwdPos + 12) break;
      rightMarks.push(nextPos);
      fwdPos = nextPos;
    }

    const marks = [...leftMarks, ...rightMarks];
    if (marks.length < 4) continue;

    // 4b. Xếp chồng cộng dồn với cửa sổ Hann đối xứng 2*T0 & nội suy tuyến tính sub-sample
    const maxT0 = Math.ceil(sr / MIN_F0_HZ);
    const padSamples = maxT0 * 2 + 32;
    const segLo = Math.max(0, startSample - padSamples);
    const segHi = Math.min(rawPcm.length, endSample + padSamples);
    const segLen = segHi - segLo;
    const synBuf = new Float32Array(segLen);
    const winSum = new Float32Array(segLen);

    let q = marks[0];
    let kPtr = 0;

    while (q <= endSample + lastT0 * 1.2) {
      while (
        kPtr + 1 < marks.length &&
        Math.abs(marks[kPtr + 1] - q) <= Math.abs(marks[kPtr] - q)
      ) {
        kPtr++;
      }

      const pCenter = marks[kPtr];
      const { f0: localF0, targetF0: localTargetF0 } = getInterpFrameParams(q);

      const t0 = Math.max(24, Math.min(maxT0, sr / localF0));
      const t1 = Math.max(24, Math.min(maxT0, sr / localTargetF0));

      // Cửa sổ Hann đối xứng bán kính R = T0 (độ rộng toàn cửa sổ = 2 * T0)
      const halfW = Math.max(24, Math.min(padSamples - 8, t0));
      const dstFrom = Math.max(segLo, Math.ceil(q - halfW));
      const dstTo = Math.min(segHi - 1, Math.floor(q + halfW));

      for (let dstIdx = dstFrom; dstIdx <= dstTo; dstIdx++) {
        const delta = dstIdx - q;
        const u = delta / halfW;
        if (u <= -1 || u >= 1) continue;

        const hann = 0.5 * (1 + Math.cos(Math.PI * u));
        const srcPos = pCenter + delta;
        const grainSample = readPcmLinear(rawPcm, srcPos);

        const loc = dstIdx - segLo;
        synBuf[loc] += grainSample * hann;
        winSum[loc] += hann;
      }

      q += t1;
    }

    // 4c. Chuẩn hóa Hann & Raised-Cosine Crossfade 15ms hai đầu đoạn
    const fadeSamples = Math.min(
      Math.round(sr * 0.015),
      Math.floor((endSample - startSample) / 3)
    );

    for (let s = startSample; s < endSample; s++) {
      const loc = s - segLo;
      const w = winSum[loc];
      let synSample;
      if (w >= 0.25) {
        synSample = synBuf[loc] / w;
      } else if (w > 1e-4) {
        const blend = w / 0.25;
        synSample = (synBuf[loc] / w) * blend + rawPcm[s] * (1 - blend);
      } else {
        synSample = rawPcm[s];
      }

      let fadeEnv = 1.0;
      if (fadeSamples > 0) {
        const dStart = s - startSample;
        const dEnd = endSample - 1 - s;
        if (dStart < fadeSamples) {
          fadeEnv = 0.5 * (1 - Math.cos((Math.PI * dStart) / fadeSamples));
        } else if (dEnd < fadeSamples) {
          fadeEnv = 0.5 * (1 - Math.cos((Math.PI * dEnd) / fadeSamples));
        }
      }

      outPcm[s] = rawPcm[s] * (1 - fadeEnv) + synSample * fadeEnv;
    }

    if (islIdx > 0 && islIdx % 4 === 0) {
      if (onProgress) onProgress(45 + Math.round((islIdx / islands.length) * 50));
      await yieldUi();
    }
  }

  // Đặt Soft Limiter ở 0.92 bảo vệ đầu ra sạch sẽ, không méo vỡ
  softLimitPcm(outPcm, 0.92);

  if (onProgress) onProgress(100);
  return {
    pcmData: outPcm,
    sampleRate: sr,
    wavBlob: encodePcmToWavBlob(outPcm, sr),
    stats: {
      voicedFrames: voicedFramesCount,
      totalFrames: numFrames,
      avgCorrectionCents: Math.round(correctionSumCents / Math.max(1, voicedFramesCount)),
    },
  };
}
