// ============================================================================
// autoTune.js — Bộ máy Auto-Tune Khóa Tông Thế Hệ Mới (Parabolic YIN 2048/256 + TD-PSOLA)
// - Đo cao độ chính xác từng khung (windowSize = 2048, hopSize = 256) có nội suy Parabol
// - Lọc trung vị 5 khung + chống nhảy quãng tám, tính nốt mục tiêu độc lập cho từng khung
//   (bám sát giai điệu người hát qua từng nốt trong âm giai, tuyệt đối không ép cứng 1 nốt)
// - Tái tổng hợp TD-PSOLA cửa sổ Hann đối xứng 2*T0 nội suy pha liên tục + Crossfade 15ms
//   + Soft Limiter trần 0.92 giúp tiếng hát trong trẻo, tròn trịa, hết sạch tiếng rè/lách tách
// ============================================================================

import { freqToMidi, midiToFreq, snapMidiToScale } from './theory.js?v=10';
import { bandpassVocalPcm, encodePcmToWavBlob } from './pitchToMidi.js?v=10';

const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));

const MIN_F0_HZ = 75;   // ~D2
const MAX_F0_HZ = 980;  // ~B5

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
 * Bộ chặn đỉnh mềm (Soft Limiter) giới hạn biên độ tối đa ở ceiling (mặc định 0.92)
 * Giúp sóng âm đầu ra tròn trịa, không bao giờ bị vỡ hay rè đỉnh.
 */
export function softLimitPcm(pcm, ceiling = 0.92) {
  const knee = ceiling * 0.82;
  const span = Math.max(0.05, ceiling - knee);
  for (let i = 0; i < pcm.length; i++) {
    const x = pcm[i];
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
 * Thuật toán YIN chuẩn xác trên cửa sổ 2048 mẫu kèm Nội suy Parabol (Parabolic Interpolation).
 * Bước quét tinh chỉnh 1-sample quanh cực tiểu CMNDF giúp đo chính xác f0 tới dưới 0.1 Hz.
 */
export function detectPitchYIN2048(frame, sampleRate, yinThreshold = 0.16) {
  const N = frame.length;
  const halfW = N >> 1; // 1024 khi N = 2048
  const minLag = Math.max(4, Math.floor(sampleRate / MAX_F0_HZ));
  const maxLag = Math.min(halfW - 4, Math.ceil(sampleRate / MIN_F0_HZ));
  if (maxLag <= minLag + 4) return null;

  // Khử DC offset
  let mean = 0;
  for (let i = 0; i < N; i++) mean += frame[i];
  mean /= N;

  let energy = 0;
  for (let i = 0; i < halfW; i++) {
    const v = frame[i] - mean;
    energy += v * v;
  }
  if (energy < 1e-8) return null;

  // Tính hàm sai biệt d(tau) (quét bước 2 trên toàn dải lag để tăng tốc gấp đôi, sau đó tính chính xác bước 1 quanh cực tiểu)
  const diff = new Float32Array(maxLag + 3);
  for (let tau = 1; tau <= maxLag + 2; tau++) {
    let sum = 0;
    for (let j = 0; j < halfW; j += 2) {
      const d = frame[j] - frame[j + tau];
      sum += d * d;
    }
    diff[tau] = sum * 2;
  }

  // CMNDF: d'(tau) = d(tau) / ((1/tau) * sum_{k=1..tau} d(k))
  const cmndf = new Float32Array(maxLag + 3);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag + 2; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 1e-12 ? diff[tau] / (runningSum / tau) : 1;
  }

  // Tìm cực tiểu cục bộ đầu tiên dưới ngưỡng yinThreshold
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

  // Dự phòng cực tiểu toàn cục nếu độ rõ vẫn tốt (< 0.24)
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

  // Tinh chỉnh chính xác từng mẫu (step = 1) trong vùng [bestTau - 2 .. bestTau + 2]
  const refLo = Math.max(minLag, bestTau - 2);
  const refHi = Math.min(maxLag + 1, bestTau + 2);
  const exactDiff = new Float32Array(refHi - refLo + 1);
  for (let tau = refLo; tau <= refHi; tau++) {
    let sum = 0;
    for (let j = 0; j < halfW; j++) {
      const d = frame[j] - frame[j + tau];
      sum += d * d;
    }
    exactDiff[tau - refLo] = sum;
  }

  // Cập nhật lại bestTau theo exactDiff
  let localMinIdx = bestTau;
  let localMinVal = exactDiff[bestTau - refLo];
  for (let tau = Math.max(minLag, bestTau - 1); tau <= Math.min(maxLag, bestTau + 1); tau++) {
    const val = exactDiff[tau - refLo];
    if (val < localMinVal) {
      localMinVal = val;
      localMinIdx = tau;
    }
  }
  bestTau = localMinIdx;

  // Nội suy Parabol (Parabolic Interpolation) trên 3 điểm lân cận
  let refinedTau = bestTau;
  if (bestTau > refLo && bestTau < refHi) {
    const s0 = exactDiff[bestTau - 1 - refLo];
    const s1 = exactDiff[bestTau - refLo];
    const s2 = exactDiff[bestTau + 1 - refLo];
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

/**
 * Chỉnh cao độ Auto-Tune bằng thuật toán TD-PSOLA (Time-Domain Pitch-Synchronous Overlap-Add)
 * kết hợp bộ dò cao độ Parabolic YIN (windowSize = 2048, hopSize = 256).
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

  // Bản lọc thông dải giọng hát (70Hz - 950Hz) chỉ dùng để dò f0 và định vị đỉnh chu kỳ sóng âm (Pitch Marks)
  const bpPcm = bandpassVocalPcm(rawPcm, sr);

  // --- BƯỚC 1: Phân tích cao độ trên cửa sổ 2048 mẫu, bước nhảy hopSize = 256 mẫu ---
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
    if (winEnd - winStart === windowSize && rms >= 0.004) {
      const slice = bpPcm.subarray(winStart, winEnd);
      det = detectPitchYIN2048(slice, sr, 0.16);
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

    if (i > 0 && i % 160 === 0) {
      if (onProgress) onProgress(Math.min(40, Math.round((i / numFrames) * 40)));
      await yieldUi();
    }
  }

  // Xác định ngưỡng năng lượng giọng hát (Voiced Gate) và loại bỏ phụ âm gió (s, t, ch, kh có ZCR cao)
  const sortedRms = Array.from(rmsList).sort((a, b) => a - b);
  const p95Rms = sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95))] || 0;
  const voiceGate = Math.max(0.006, p95Rms * 0.08);

  let voicedFramesCount = 0;
  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (f.rms >= voiceGate && f.rawMidi !== null && f.clarity >= 0.76 && f.zcr < 0.21) {
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

  // --- BƯỚC 2: Chống nhảy quãng tám cục bộ & Bộ lọc trung vị 5 khung (Median Filter 5 frames) ---
  // 2a. Khử các khung nhảy vọt quãng tám đơn lẻ (±12 bán cung) so với vùng lân cận ngắn (±4 khung ~ 23ms)
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
      } else if (Math.abs(diff) > 7.5 && local.every((v) => Math.abs(v - med) < 2.0)) {
        // Khử gai tần số đơn lẻ nhảy vọt bất thường giữa một nốt đang ngân ổn định
        f.midi = med;
      }
    }
  }

  // 2b. Bộ lọc trung vị 5 khung (Median Filter 5 frames) làm sạch đường f0 mà vẫn giữ nguyên vẹn từng nốt giai điệu
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

  // 2c. Tính độc lập nốt mục tiêu trong Tông & Âm giai cho TỪNG KHUNG + Làm mượt chuyển nốt (Glide)
  // Tốc độ chuyển nốt tỷ lệ thuận với Retune Strength:
  // - Strength cao (80-100%): bám sang nốt mới cực nhanh (glideAlpha ~ 0.65..0.92)
  // - Strength vừa (30-60%): luyến mềm mại tự nhiên giữa các nốt (glideAlpha ~ 0.18..0.42)
  const glideAlpha = 0.12 + 0.80 * Math.pow(normStrength, 1.5);
  let smoothedTargetMidi = null;
  let correctionSumCents = 0;

  for (let i = 0; i < numFrames; i++) {
    const f = frames[i];
    if (!f.voiced || medianMidis[i] === null) {
      smoothedTargetMidi = null;
      continue;
    }

    const curMidi = medianMidis[i];
    f.midi = curMidi;
    f.f0 = midiToFreq(curMidi);

    // Tìm nốt thuộc âm giai gần nhất với chính khung hiện tại (tuyệt đối không khóa cứng 1 nốt!)
    const nearestScaleMidi = snapMidiToScale(curMidi, keyPc, scaleType, null, 0);

    // Giới hạn khoảng kéo tối đa ±3.5 bán cung so với giọng thực tại khung đó
    const clampedScaleMidi = Math.max(
      curMidi - 3.5,
      Math.min(curMidi + 3.5, nearestScaleMidi)
    );

    if (smoothedTargetMidi === null) {
      smoothedTargetMidi = clampedScaleMidi;
    } else if (Math.abs(clampedScaleMidi - smoothedTargetMidi) >= 0.85) {
      // Người hát đã chuyển sang bậc nốt mới trong âm giai -> luyến mượt theo glideAlpha
      smoothedTargetMidi =
        smoothedTargetMidi + glideAlpha * (clampedScaleMidi - smoothedTargetMidi);
    } else {
      smoothedTargetMidi =
        smoothedTargetMidi + Math.max(0.35, glideAlpha) * (clampedScaleMidi - smoothedTargetMidi);
    }

    // Pha trộn giữa cao độ gốc và cao độ mục tiêu theo thanh Retune Strength
    const finalTargetMidi = curMidi + normStrength * (smoothedTargetMidi - curMidi);
    f.targetMidi = finalTargetMidi;
    f.targetF0 = midiToFreq(finalTargetMidi);

    correctionSumCents += Math.abs(finalTargetMidi - curMidi) * 100;
  }

  // Gom các khung hữu thanh liên tiếp thành các phân đoạn (Voiced Islands >= 4 khung ~ 23ms)
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

  // --- BƯỚC 3: Tái tổng hợp Time-Domain PSOLA (Pitch-Synchronous Overlap-Add) ---
  // Khởi tạo từ bản gốc để bảo toàn 100% phụ âm gió (s, t, ch, kh) và tiếng lấy hơi
  const outPcm = new Float32Array(rawPcm);

  const getFrameAtSample = (sampleIdx) => {
    const idx = Math.max(0, Math.min(numFrames - 1, Math.round(sampleIdx / hopSize)));
    return frames[idx];
  };

  for (let islIdx = 0; islIdx < islands.length; islIdx++) {
    const [fStart, fEnd] = islands[islIdx];
    const startSample = Math.max(0, fStart * hopSize);
    const endSample = Math.min(rawPcm.length, (fEnd + 1) * hopSize);
    if (endSample - startSample < 256) continue;

    // Kiểm tra độ lệch cao độ lớn nhất trong đoạn; nếu đã chuẩn sẵn (< 3 cents) thì giữ nguyên sóng gốc
    let maxShiftSemis = 0;
    for (let fi = fStart; fi <= fEnd; fi++) {
      const fr = frames[fi];
      if (fr.voiced && fr.targetMidi !== null && fr.midi !== null) {
        const d = Math.abs(fr.targetMidi - fr.midi);
        if (d > maxShiftSemis) maxShiftSemis = d;
      }
    }
    if (maxShiftSemis < 0.03) continue;

    // Xác định cực tính đỉnh chu kỳ thanh quản ổn định nhất trong đoạn
    let posSum = 0;
    let negSum = 0;
    for (let s = startSample; s < endSample; s += 2) {
      const v = bpPcm[s];
      if (v > 0) posSum += v * v;
      else negSum += v * v;
    }
    const polarity = negSum > posSum * 1.15 ? -1 : 1;

    const findSmoothedPeak = (lo, hi) => {
      const a = Math.max(1, lo);
      const b = Math.min(bpPcm.length - 2, hi);
      if (b <= a) return a;
      let bestIdx = a;
      let bestScore = -Infinity;
      for (let s = a; s <= b; s++) {
        // Trung bình 3 điểm đỉnh giúp Pitch Mark miễn nhiễm với nhiễu tần số cao
        const score =
          polarity * (0.25 * bpPcm[s - 1] + 0.5 * bpPcm[s] + 0.25 * bpPcm[s + 1]);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = s;
        }
      }
      return bestIdx;
    };

    // 3a. Tìm chuỗi Pitch Marks cách nhau đúng chu kỳ thực T0 = sampleRate / f0
    const marks = [];
    const firstF0 = frames[fStart].f0 || 180;
    const firstT0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / firstF0));

    let curMark = findSmoothedPeak(startSample, startSample + Math.round(firstT0 * 0.9));
    marks.push(curMark);

    while (curMark < endSample) {
      const fr = getFrameAtSample(curMark);
      const localF0 = (fr && fr.f0) || firstF0;
      const t0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / localF0));
      const searchLo = curMark + Math.round(t0 * 0.78);
      const searchHi = curMark + Math.round(t0 * 1.22);
      if (searchLo >= endSample + Math.round(t0 * 0.5)) break;

      const nextMark = findSmoothedPeak(searchLo, Math.min(rawPcm.length - 2, searchHi));
      if (nextMark <= curMark) break;
      marks.push(nextMark);
      curMark = nextMark;
    }

    if (marks.length < 3) continue;

    // 3b. Xếp chồng và cộng dồn (Overlap-Add) với cửa sổ Hann đối xứng rộng 2*T0 tại chu kỳ mới T1 = sampleRate / targetF0
    const padSamples = Math.ceil(sr / MIN_F0_HZ) + 16;
    const segLo = Math.max(0, startSample - padSamples);
    const segHi = Math.min(rawPcm.length, endSample + padSamples);
    const segLen = segHi - segLo;
    const synBuf = new Float32Array(segLen);
    const winSum = new Float32Array(segLen);

    let q = marks[0];
    let kPtr = 0;

    while (q <= endSample) {
      // Tìm Pitch Mark gốc p_k gần nhất với vị trí thời gian q
      while (
        kPtr + 1 < marks.length &&
        Math.abs(marks[kPtr + 1] - q) <= Math.abs(marks[kPtr] - q)
      ) {
        kPtr++;
      }

      const pCenter = marks[kPtr];

      const fr = getFrameAtSample(q);
      const localF0 = (fr && fr.f0) || firstF0;
      const localTargetF0 = (fr && fr.targetF0) || localF0;

      const t0 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / localF0));
      const t1 = Math.max(24, Math.min(sr / MIN_F0_HZ, sr / localTargetF0));

      // Bán kính cửa sổ Hann = T0 (tổng độ rộng cửa sổ đối xứng = 2 * T0)
      const halfW = Math.max(24, Math.min(padSamples - 4, Math.round(t0)));
      const qInt = Math.round(q);

      for (let j = -halfW; j <= halfW; j++) {
        const dstIdx = qInt + j;
        if (dstIdx < segLo || dstIdx >= segHi) continue;

        const srcIdx = pCenter + j;
        if (srcIdx < 0 || srcIdx >= rawPcm.length) continue;

        const grainSample = rawPcm[srcIdx];
        const hann = 0.5 * (1 + Math.cos((Math.PI * j) / halfW));

        const loc = dstIdx - segLo;
        synBuf[loc] += grainSample * hann;
        winSum[loc] += hann;
      }

      q += t1;
    }

    // 3c. Chuẩn hóa biên độ cửa sổ Hann & Trộn chuyển tiếp êm ái (Cosine Crossfade 15ms) với vùng không Auto-Tune
    const fadeSamples = Math.min(
      Math.round(sr * 0.015),
      Math.floor((endSample - startSample) / 3)
    );

    for (let s = startSample; s < endSample; s++) {
      const loc = s - segLo;
      const w = winSum[loc];
      if (w < 0.15) continue;

      // Chuẩn hóa hệ số biên độ sau khi cộng dồn cửa sổ Hann (giữ sàn 0.65 ở rìa để không khuếch đại nhiễu biên)
      const normSample = synBuf[loc] / Math.max(0.65, w);

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

      outPcm[s] = rawPcm[s] * (1 - fadeEnv) + normSample * fadeEnv;
    }

    if (islIdx > 0 && islIdx % 4 === 0) {
      if (onProgress) onProgress(45 + Math.round((islIdx / islands.length) * 50));
      await yieldUi();
    }
  }

  // Đặt bộ chặn đỉnh mềm (Soft Limiter) ở 0.92 để đầu ra luôn tròn trịa, không bao giờ bị rè
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
