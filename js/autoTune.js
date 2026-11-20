// ============================================================================
// autoTune.js — Bộ máy Auto-Tune khóa tông thời gian thực trên PCM thuần JS
// Phiên bản TD-PSOLA cửa sổ Hann: giữ nguyên âm sắc formant & các phụ âm gió (s, t, ch, kh)
// ============================================================================

import { freqToMidi, snapMidiToScale } from './theory.js?v=8';
import {
  bandpassVocalPcm,
  detectPitchYIN,
  downsampleBuffer,
  encodePcmToWavBlob,
} from './pitchToMidi.js?v=8';

const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));

function medianOf(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function computeZeroCrossingRate(pcm, start, end) {
  let crossings = 0;
  const lo = Math.max(1, start + 1);
  const hi = Math.min(pcm.length, end);
  if (hi <= lo) return 0;
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
 * Chỉnh cao độ Auto-Tune khóa tông trên mảng PCM Float32 theo tông/âm giai của Studio.
 * - Chỉ kéo cao độ ở các đoạn hữu thanh rõ tiếng hát; giữ nguyên nguyên vẹn phụ âm gió & khoảng lặng.
 * - Giới hạn bước kéo tối đa ±4 bán cung mỗi khung để tránh nhảy quãng tám méo tiếng.
 * - Độ ép tông (strength 0..1): 0.3–0.5 giữ rung tự nhiên; 0.8–1.0 khóa chặt chuẩn Melodic R&B / Pop.
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

  if (!rawPcm || rawPcm.length < Math.round(sr * 0.05) || normStrength <= 0.01) {
    const copy = new Float32Array(rawPcm || 0);
    if (onProgress) onProgress(100);
    return {
      pcmData: copy,
      sampleRate: sr,
      wavBlob: encodePcmToWavBlob(copy, sr),
      stats: { voicedFrames: 0, totalFrames: 0, avgCorrectionCents: 0 },
    };
  }

  // --- BƯỚC 1: Phân tích cao độ từng khung 10ms ---
  const factor = sr >= 40000 ? 4 : sr >= 20000 ? 2 : 1;
  const dsSr = sr / factor;
  const dsAll = bandpassVocalPcm(downsampleBuffer(rawPcm, factor), dsSr);
  const dsWin = 512;
  const hopSec = 0.01;
  const hopFull = Math.max(64, Math.round(sr * hopSec));
  const numFrames = Math.ceil(rawPcm.length / hopFull);

  const rawFrames = new Array(numFrames);
  const rmsValues = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    const center = i * hopFull;
    const winStart = center - hopFull;
    const winEnd = center + hopFull;
    const rms = computeSliceRms(rawPcm, winStart, winEnd);
    const zcr = computeZeroCrossingRate(rawPcm, winStart, winEnd);
    rmsValues[i] = rms;

    let pitchRes = null;
    if (dsAll.length >= dsWin) {
      const dsCenter = Math.round(center / factor);
      const dsStart = Math.max(0, Math.min(dsAll.length - dsWin, dsCenter - (dsWin >> 1)));
      const slice = dsAll.subarray(dsStart, dsStart + dsWin);
      pitchRes = detectPitchYIN(slice, dsSr, 0.18);
    }

    rawFrames[i] = {
      center,
      rms,
      zcr,
      freq: pitchRes ? pitchRes.freq : null,
      midi: pitchRes ? freqToMidi(pitchRes.freq) : null,
      clarity: pitchRes ? pitchRes.clarity : 0,
      voiced: false,
      targetMidi: null,
      finalShift: 0,
      ratio: 1,
    };

    if (i > 0 && i % 80 === 0) {
      if (onProgress) onProgress(Math.min(40, Math.round((i / numFrames) * 40)));
      await yieldUi();
    }
  }

  const sortedRms = Array.from(rmsValues).sort((a, b) => a - b);
  const p95Rms = sortedRms[Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95))] || 0;
  const voiceGate = Math.max(0.008, p95Rms * 0.10);

  let voicedFramesCount = 0;
  for (let i = 0; i < numFrames; i++) {
    const f = rawFrames[i];
    // Loại bỏ phụ âm xì / sibilant (zcr >= 0.19) và khoảng im lặng
    if (f.rms >= voiceGate && f.midi !== null && f.clarity >= 0.78 && f.zcr < 0.19) {
      f.voiced = true;
      voicedFramesCount++;
    } else {
      f.voiced = false;
      f.midi = null;
      f.freq = null;
    }
  }

  if (voicedFramesCount < 3) {
    const copy = new Float32Array(rawPcm);
    if (onProgress) onProgress(100);
    return {
      pcmData: copy,
      sampleRate: sr,
      wavBlob: encodePcmToWavBlob(copy, sr),
      stats: { voicedFrames: 0, totalFrames: numFrames, avgCorrectionCents: 0 },
    };
  }

  // Khử nhảy nhầm quãng tám đơn lẻ (±12 bán cung) theo trung vị lân cận ±18 khung
  for (let i = 0; i < numFrames; i++) {
    const f = rawFrames[i];
    if (!f.voiced) continue;
    const local = [];
    for (let k = -18; k <= 18; k++) {
      const nb = rawFrames[i + k];
      if (nb && nb.voiced && nb.midi !== null) local.push(nb.midi);
    }
    if (local.length >= 5) {
      const med = medianOf(local);
      const diff = f.midi - med;
      if (Math.abs(diff - 12) <= 1.2) f.midi -= 12;
      else if (Math.abs(diff + 12) <= 1.2) f.midi += 12;
      f.freq = 440 * Math.pow(2, (f.midi - 69) / 12);
    }
  }

  // Làm mượt quỹ đạo cao độ bằng trung vị 5 khung trước khi tính lượng kéo tông
  const smoothedMidis = new Array(numFrames).fill(null);
  for (let i = 0; i < numFrames; i++) {
    if (!rawFrames[i].voiced) continue;
    const neigh = [];
    for (let k = -2; k <= 2; k++) {
      const nb = rawFrames[i + k];
      if (nb && nb.voiced && nb.midi !== null) neigh.push(nb.midi);
    }
    smoothedMidis[i] = neigh.length >= 2 ? medianOf(neigh) : rawFrames[i].midi;
  }

  // Tốc độ bám tông (Retune speed) tỷ lệ thuận với normStrength
  const alpha = 0.14 + 0.80 * Math.pow(normStrength, 1.8);
  let prevShift = 0;
  let wasVoiced = false;
  let correctionSumCents = 0;

  for (let i = 0; i < numFrames; i++) {
    const f = rawFrames[i];
    if (!f.voiced || smoothedMidis[i] === null) {
      wasVoiced = false;
      prevShift = 0;
      continue;
    }
    const midiVal = smoothedMidis[i];
    const target = snapMidiToScale(midiVal, keyPc, scaleType, null, 0);
    // Giới hạn tối đa ±4 bán cung để tránh lỗi quãng tám
    const rawShift = Math.max(-4, Math.min(4, target - midiVal));
    if (!wasVoiced) {
      prevShift = rawShift;
      wasVoiced = true;
    } else {
      prevShift = prevShift + alpha * (rawShift - prevShift);
    }
    const appliedShift = prevShift * normStrength;
    f.midi = midiVal;
    f.freq = 440 * Math.pow(2, (midiVal - 69) / 12);
    f.targetMidi = target;
    f.finalShift = appliedShift;
    f.ratio = Math.pow(2, appliedShift / 12);
    correctionSumCents += Math.abs(appliedShift) * 100;
  }

  // Gom các khung hữu thanh liên tiếp thành từng đảo (island), bỏ qua các nốt thoáng < 30ms
  const islands = [];
  let curStart = -1;
  for (let i = 0; i <= numFrames; i++) {
    const v = i < numFrames && rawFrames[i].voiced;
    if (v && curStart === -1) {
      curStart = i;
    } else if (!v && curStart !== -1) {
      const curEnd = i - 1;
      if (curEnd - curStart + 1 >= 3) {
        islands.push([curStart, curEnd]);
      }
      curStart = -1;
    }
  }

  // --- BƯỚC 2: Tái tổng hợp TD-PSOLA giữ nguyên phụ âm & biên độ gốc ---
  const outPcm = new Float32Array(rawPcm); // Bản sao gốc: phụ âm gió & im lặng giữ nguyên 100%
  const bpFull = bandpassVocalPcm(rawPcm, sr);

  const frameAtSample = (sIdx) => {
    const fi = Math.max(0, Math.min(numFrames - 1, Math.round(sIdx / hopFull)));
    return rawFrames[fi];
  };

  for (let islIdx = 0; islIdx < islands.length; islIdx++) {
    const [fStart, fEnd] = islands[islIdx];
    const startSample = Math.max(0, fStart * hopFull);
    const endSample = Math.min(rawPcm.length, (fEnd + 1) * hopFull);
    if (endSample - startSample < 128) continue;

    let maxAbsShift = 0;
    for (let f = fStart; f <= fEnd; f++) {
      const a = Math.abs(rawFrames[f].finalShift);
      if (a > maxAbsShift) maxAbsShift = a;
    }
    if (maxAbsShift < 0.04) continue; // Đã đúng cao độ sẵn -> giữ nguyên chất mộc hoàn toàn

    // Xác định cực tính xung thanh quản mạnh nhất trong đảo hữu thanh
    let maxPos = 0;
    let maxNeg = 0;
    for (let s = startSample; s < endSample; s++) {
      const v = bpFull[s];
      if (v > maxPos) maxPos = v;
      else if (-v > maxNeg) maxNeg = -v;
    }
    const polarity = maxNeg > maxPos * 1.15 ? -1 : 1;

    // Đánh dấu chu kỳ (Pitch Marks) bám theo đỉnh sóng đã lọc dải giọng hát
    const marks = [];
    const firstFrame = rawFrames[fStart];
    const t0First = Math.max(24, Math.min(sr / 65, sr / (firstFrame.freq || 180)));

    const pickPeak = (lo, hi) => {
      const a = Math.max(0, lo);
      const b = Math.min(bpFull.length - 1, hi);
      if (b < a) return a;
      let bestIdx = a;
      let bestVal = -Infinity;
      for (let s = a; s <= b; s++) {
        const val = polarity * bpFull[s];
        if (val > bestVal) {
          bestVal = val;
          bestIdx = s;
        }
      }
      return bestIdx;
    };

    let m = pickPeak(startSample, startSample + Math.round(t0First * 0.85));
    marks.push(m);

    while (true) {
      const f = frameAtSample(m);
      const t0 = Math.max(24, Math.min(sr / 65, sr / (f.freq || 180)));
      const nextLo = m + Math.round(t0 * 0.72);
      const nextHi = m + Math.round(t0 * 1.28);
      if (nextLo >= endSample) break;
      const nextMark = pickPeak(nextLo, Math.min(rawPcm.length - 1, nextHi));
      if (nextMark <= m) break;
      marks.push(nextMark);
      m = nextMark;
    }

    if (marks.length < 3) continue;

    // Cấp phát bộ đệm tổng hợp cục bộ đủ rộng che kín đảo + 1 chu kỳ biên
    const maxW = Math.round(sr / 50);
    const segLo = Math.max(0, startSample - maxW);
    const segHi = Math.min(rawPcm.length, endSample + maxW);
    const segLen = segHi - segLo;
    const syn = new Float32Array(segLen);
    const wSum = new Float32Array(segLen);

    let q = marks[0];
    let markPtr = 0;

    while (q <= endSample) {
      while (
        markPtr + 1 < marks.length &&
        Math.abs(marks[markPtr + 1] - q) < Math.abs(marks[markPtr] - q)
      ) {
        markPtr++;
      }

      const f = frameAtSample(q);
      const t0 = Math.max(24, Math.min(sr / 65, sr / (f.freq || 180)));
      const ratio = f.ratio || 1;
      const tSyn = Math.max(20, t0 / ratio);
      const halfW = Math.max(24, Math.min(maxW - 2, Math.round(Math.max(t0, tSyn) * 1.05)));

      const qInt = Math.round(q);
      const pInt = marks[markPtr];

      for (let j = -halfW; j <= halfW; j++) {
        const sIdx = pInt + j;
        const dIdx = qInt + j;
        if (sIdx < 0 || sIdx >= rawPcm.length || dIdx < segLo || dIdx >= segHi) continue;
        const w = 0.5 * (1 + Math.cos((Math.PI * j) / halfW));
        const loc = dIdx - segLo;
        syn[loc] += rawPcm[sIdx] * w;
        wSum[loc] += w;
      }

      q += tSyn;
    }

    // Trộn mượt vào bản xuất với Cosine Crossfade ~15ms hai đầu để loại bỏ mọi tiếng tách
    const fadeLen = Math.min(
      Math.round(sr * 0.015),
      Math.floor((endSample - startSample) / 3)
    );
    for (let s = startSample; s < endSample; s++) {
      const loc = s - segLo;
      if (wSum[loc] <= 1e-3) continue;
      const shifted = syn[loc] / wSum[loc];
      let env = 1;
      if (fadeLen > 0) {
        const distStart = s - startSample;
        const distEnd = endSample - 1 - s;
        if (distStart < fadeLen) {
          env = 0.5 * (1 - Math.cos((Math.PI * distStart) / fadeLen));
        } else if (distEnd < fadeLen) {
          env = 0.5 * (1 - Math.cos((Math.PI * distEnd) / fadeLen));
        }
      }
      outPcm[s] = rawPcm[s] * (1 - env) + shifted * env;
    }

    if (islIdx > 0 && islIdx % 4 === 0) {
      if (onProgress) onProgress(45 + Math.round((islIdx / islands.length) * 50));
      await yieldUi();
    }
  }

  for (let i = 0; i < outPcm.length; i++) {
    if (outPcm[i] > 0.99) outPcm[i] = 0.99;
    else if (outPcm[i] < -0.99) outPcm[i] = -0.99;
  }

  if (onProgress) onProgress(100);
  return {
    pcmData: outPcm,
    sampleRate: sr,
    wavBlob: encodePcmToWavBlob(outPcm, sr),
    stats: {
      voicedFrames: voicedFramesCount,
      totalFrames: numFrames,
      avgCorrectionCents: Math.round(correctionSumCents / voicedFramesCount),
    },
  };
}
