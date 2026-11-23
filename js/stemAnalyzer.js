// ============================================================================
// stemAnalyzer.js — Tách 4 Stems (Vocal / Nhạc nền / Bass / Trống) bằng DSP Phổ
// + Phân tích Tự động Tông, BPM & Vòng Hợp Âm theo dòng thời gian ngay trên trình duyệt
// ============================================================================

import { detectKeyFromAudioBuffer, softLimitPcm } from './autoTune.js?v=38';
import { encodeAudioBufferByFormat } from './audioEncode.js?v=38';
import { SCALES, getScaleSet, pcToNoteName, shouldPreferFlats } from './theory.js?v=38';

const FLAT_PREF_ROOTS = new Set([1, 3, 5, 6, 8, 10]);

const CHORD_MATCH_TEMPLATES = [
  { intervals: [0, 4, 7],     quality: 'maj', ext: 'triad', suffix: '',     weight: 1.00 },
  { intervals: [0, 3, 7],     quality: 'min', ext: 'triad', suffix: 'm',    weight: 1.00 },
  { intervals: [0, 3, 7, 10], quality: 'min', ext: 'm7',    suffix: 'm7',   weight: 0.98 },
  { intervals: [0, 4, 7, 11], quality: 'maj', ext: 'maj7',  suffix: 'maj7', weight: 0.98 },
  { intervals: [0, 4, 7, 10], quality: 'maj', ext: '7',     suffix: '7',    weight: 0.97 },
  { intervals: [0, 5, 7],     quality: 'maj', ext: 'sus4',  suffix: 'sus4', weight: 0.91 },
];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function smoothstep(x, edge0, edge1) {
  if (edge1 === edge0) return x >= edge0 ? 1 : 0;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function formatClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mm = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${mm}:${String(rem).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/**
 * Biến đổi Fourier nhanh Radix-2 tại chỗ (Forward & Inverse)
 */
export function fftRadix2(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      const ti = im[i];
      re[i] = re[j];
      im[i] = im[j];
      re[j] = tr;
      im[j] = ti;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wLenCos = Math.cos(ang);
    const wLenSin = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let wCos = 1;
      let wSin = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const idx2 = i + j + half;
        const vRe = re[idx2] * wCos - im[idx2] * wSin;
        const vIm = re[idx2] * wSin + im[idx2] * wCos;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[idx2] = uRe - vRe;
        im[idx2] = uIm - vIm;
        const nextCos = wCos * wLenCos - wSin * wLenSin;
        wSin = wCos * wLenSin + wSin * wLenCos;
        wCos = nextCos;
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

function getMonoMix(audioBuffer, maxSec = 90) {
  const sr = audioBuffer.sampleRate || 44100;
  const len = Math.min(audioBuffer.length, Math.floor(sr * maxSec));
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
  const mono = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mono[i] = 0.5 * (ch0[i] + ch1[i]);
  }
  return { mono, sr, len };
}

/**
 * Dò tốc độ BPM tự động qua Energy Onset Autocorrelation (60–175 BPM)
 */
export function detectBpmFromAudioBuffer(audioBuffer) {
  if (!audioBuffer || audioBuffer.length < 4096) {
    return { bpm: 100, confidence: 50 };
  }

  const { mono, sr, len } = getMonoMix(audioBuffer, 45);
  const hop = 512;
  const numFrames = Math.floor(len / hop);
  if (numFrames < 32) {
    return { bpm: 100, confidence: 50 };
  }

  const energy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = mono[base + i];
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / hop);
  }

  const onset = new Float32Array(numFrames);
  for (let f = 1; f < numFrames; f++) {
    onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  }

  // Khử trung bình trượt để làm nổi đỉnh nhịp
  const avgWin = 8;
  const normOnset = new Float32Array(numFrames);
  let totalEnergy = 0;
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, f - avgWin); k <= Math.min(numFrames - 1, f + avgWin); k++) {
      sum += onset[k];
      cnt++;
    }
    const v = Math.max(0, onset[f] - (cnt > 0 ? sum / cnt : 0));
    normOnset[f] = v;
    totalEnergy += v * v;
  }

  if (totalEnergy < 1e-8) {
    return { bpm: 96, confidence: 50 };
  }

  const fps = sr / hop;
  const minLag = Math.max(4, Math.floor((fps * 60) / 176));
  const maxLag = Math.min(numFrames >> 1, Math.ceil((fps * 60) / 58));

  let bestScore = -1;
  let secondScore = -1;
  let bestLag = Math.round((fps * 60) / 100);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let count = 0;
    for (let f = 0; f < numFrames - lag; f++) {
      corr += normOnset[f] * normOnset[f + lag];
      count++;
    }
    if (count === 0) continue;
    corr /= count;

    const candBpm = (60 * fps) / lag;
    // Ưu tiên nhẹ dải 76–144 BPM để tránh chia đôi/nhân đôi sai quãng nhịp phổ biến
    const prior = candBpm >= 76 && candBpm <= 144 ? 1.15 : candBpm >= 65 && candBpm <= 160 ? 1.02 : 0.88;
    const score = corr * prior;

    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestLag = lag;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }

  let detectedBpm = Math.round((60 * fps) / Math.max(1, bestLag));
  if (detectedBpm < 62) detectedBpm *= 2;
  if (detectedBpm > 174) detectedBpm = Math.round(detectedBpm / 2);
  detectedBpm = clamp(detectedBpm, 58, 175);

  const ratio = secondScore > 0 ? bestScore / secondScore : 1.5;
  const confidence = Math.round(clamp(55 + (ratio - 1) * 55, 55, 98));
  return { bpm: detectedBpm, confidence };
}

/**
 * Phân tích hợp âm theo từng đoạn thời gian trên bản nhạc (Key + Timeline Hợp âm + Studio 4/8 ô)
 */
export function analyzeChordsFromAudioBuffer(audioBuffer, options = {}) {
  if (!audioBuffer || audioBuffer.length < 4096) return null;

  const keyInfo = options.keyInfo || detectKeyFromAudioBuffer(audioBuffer) || {
    keyPc: 0,
    scaleType: 'major',
    confidence: 70,
    label: 'C Trưởng',
  };
  const bpmInfo = options.bpm
    ? { bpm: clamp(Math.round(options.bpm), 50, 185), confidence: 90 }
    : detectBpmFromAudioBuffer(audioBuffer);

  const { mono, sr, len } = getMonoMix(audioBuffer, 60);
  const totalDur = Math.min(60, len / sr);
  const barSec = clamp((60 / bpmInfo.bpm) * 4, 1.4, 3.2);
  const stepSec = Math.max(0.7, barSec * 0.5);

  const fftSize = 4096;
  const minBin = Math.max(2, Math.floor((60 * fftSize) / sr));
  const maxBin = Math.min(fftSize >> 1, Math.ceil((2200 * fftSize) / sr));
  const hann = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const scaleSet = getScaleSet(keyInfo.keyPc, keyInfo.scaleType);
  const preferFlats = shouldPreferFlats(keyInfo.keyPc, keyInfo.scaleType);

  const rawSlices = [];
  for (let startSec = 0; startSec + 0.35 < totalDur; startSec += stepSec) {
    const centerSample = Math.min(len - fftSize, Math.max(0, Math.round((startSec + stepSec * 0.5) * sr - fftSize * 0.5)));
    if (centerSample < 0 || centerSample + fftSize > len) break;

    let sliceEnergy = 0;
    for (let i = 0; i < fftSize; i++) {
      const s = mono[centerSample + i] * hann[i];
      re[i] = s;
      im[i] = 0;
      sliceEnergy += s * s;
    }
    if (sliceEnergy / fftSize < 1e-7) continue;

    fftRadix2(re, im, false);
    const chroma = new Float64Array(12);
    const bassChroma = new Float64Array(12);

    for (let k = minBin; k <= maxBin; k++) {
      const mag = Math.hypot(re[k], im[k]);
      if (mag <= 1e-5) continue;
      const freq = (k * sr) / fftSize;
      const midi = 69 + 12 * Math.log2(freq / 440);
      const nearest = Math.round(midi);
      const detune = Math.abs(midi - nearest);
      if (detune > 0.38) continue;

      const pc = ((nearest % 12) + 12) % 12;
      const weight = mag * (1 - detune * 1.4) * (freq < 520 ? 1.25 : 0.85);
      chroma[pc] += weight;
      if (freq < 185) {
        bassChroma[pc] += mag * 1.4;
      }
    }

    let cSum = 0;
    for (let pc = 0; pc < 12; pc++) cSum += chroma[pc];
    if (cSum <= 1e-9) continue;
    for (let pc = 0; pc < 12; pc++) chroma[pc] /= cSum;

    let bSum = 0;
    for (let pc = 0; pc < 12; pc++) bSum += bassChroma[pc];
    if (bSum > 0) {
      for (let pc = 0; pc < 12; pc++) bassChroma[pc] /= bSum;
    }

    let bestMatch = null;
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      for (const tpl of CHORD_MATCH_TEMPLATES) {
        const ivSet = new Set(tpl.intervals);
        let matchEnergy = 0;
        let outsideEnergy = 0;
        for (let iv = 0; iv < 12; iv++) {
          const val = chroma[(rootPc + iv) % 12];
          if (ivSet.has(iv)) matchEnergy += val;
          else outsideEnergy += val;
        }
        const inKeyBonus = scaleSet.has(rootPc) ? 0.12 : 0;
        const bassBonus = bassChroma[rootPc] * 0.24;
        const score = (matchEnergy - outsideEnergy * 0.65) * tpl.weight + inKeyBonus + bassBonus;

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { rootPc, tpl, score };
        }
      }
    }

    if (bestMatch) {
      const useFlat = preferFlats || FLAT_PREF_ROOTS.has(bestMatch.rootPc);
      const rootName = pcToNoteName(bestMatch.rootPc, useFlat);
      rawSlices.push({
        startSec,
        endSec: Math.min(totalDur, startSec + stepSec),
        symbol: `${rootName}${bestMatch.tpl.suffix}`,
        rootPc: bestMatch.rootPc,
        quality: bestMatch.tpl.quality,
        extension: bestMatch.tpl.ext,
        confidence: Math.round(clamp(55 + bestMatch.score * 35, 52, 97)),
      });
    }
  }

  // Làm mượt các nhiễu đơn lẻ kẹp giữa 2 hợp âm giống nhau
  for (let i = 1; i < rawSlices.length - 1; i++) {
    if (rawSlices[i - 1].symbol === rawSlices[i + 1].symbol && rawSlices[i].symbol !== rawSlices[i - 1].symbol) {
      rawSlices[i] = { ...rawSlices[i], ...rawSlices[i - 1], startSec: rawSlices[i].startSec, endSec: rawSlices[i].endSec };
    }
  }

  // Gộp các đoạn liên tiếp trùng hợp âm
  const timeline = [];
  rawSlices.forEach((sl) => {
    const prev = timeline[timeline.length - 1];
    if (prev && prev.symbol === sl.symbol) {
      prev.endSec = sl.endSec;
      prev.confidence = Math.round((prev.confidence + sl.confidence) * 0.5);
    } else {
      timeline.push({ ...sl });
    }
  });

  // Trích xuất vòng 4 hoặc 8 hợp âm tiêu biểu cho Sáng tác Beat
  const studioCount = timeline.length >= 6 ? 8 : 4;
  const studioChords = [];
  if (timeline.length > 0) {
    for (let i = 0; i < studioCount; i++) {
      const idx = Math.min(timeline.length - 1, Math.floor((i / studioCount) * Math.min(timeline.length, 8)));
      const item = timeline[idx];
      studioChords.push({
        custom: true,
        rootPc: item.rootPc,
        quality: item.quality,
        extension: item.extension,
      });
    }
  }

  return {
    keyInfo,
    bpmInfo,
    timeline,
    studioChords,
    analyzedDurationSec: audioBuffer.duration,
  };
}

function insertionSortWindow(arr, len) {
  for (let i = 1; i < len; i++) {
    const key = arr[i];
    let j = i - 1;
    while (j >= 0 && arr[j] > key) {
      arr[j + 1] = arr[j];
      j--;
    }
    arr[j + 1] = key;
  }
  return arr[len >> 1];
}

/**
 * Tách 4 Stems Stereo (Giọng hát, Nhạc cụ & Hòa âm, Bass, Trống) theo phân hoạch 100% loại trừ lẫn nhau
 * dùng 2D Median-Filter HPSS (11 khung thời gian × 11 dải tần) + Mid/Side Spectral Subtraction
 */
export async function separateAudioStems(audioBuffer, { onProgress = null } = {}) {
  if (!audioBuffer || audioBuffer.length < 2048) {
    throw new Error('Dữ liệu audio quá ngắn để tách Stems.');
  }

  const sr = audioBuffer.sampleRate || 44100;
  const len = Math.min(audioBuffer.length, Math.floor(sr * 90)); // Giới hạn 90s để chạy mượt trên mọi thiết bị
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

  // Kiểm tra file có trường Stereo thực tế hay Mono (L === R)
  let midEnergy = 0;
  let sideEnergy = 0;
  const stepProbe = Math.max(1, Math.floor(len / 8000));
  for (let i = 0; i < len; i += stepProbe) {
    const m = 0.5 * (ch0[i] + ch1[i]);
    const s = 0.5 * (ch0[i] - ch1[i]);
    midEnergy += m * m;
    sideEnergy += s * s;
  }
  const isStereo = Math.sqrt(sideEnergy / (midEnergy + 1e-12)) > 0.015;

  const fftSize = 2048;
  const hop = 1024;
  const halfBins = fftSize >> 1;

  // Periodic Hann đảm bảo win[i]^2 + win[i+hop]^2 === 1.00000 tuyệt đối ở mọi mẫu
  const win = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    win[i] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize)));
  }

  // Phân dải phổ tách bạch 4 Stems:
  // - Bass & Sub (< 165 Hz, cộng pha trung tâm)
  // - Drums (Kick 50–150 Hz, Snare/Clap 180–450 Hz gắt transient, Hi-Hat/Cymbal > 6 kHz; khóa sạch vùng Vocal 460–5600 Hz)
  // - Vocal (Center Mid 180 Hz – 5.5 kHz khi |Mid| > |Side|)
  // - Other / Nhạc nền (Side stereo bù width + Mid ngoài dải vocal, triệt giảm >= 24 dB vùng Vocal trung tâm)
  const bassBand = new Float32Array(halfBins + 1);
  const vocBand = new Float32Array(halfBins + 1);
  const kickBand = new Float32Array(halfBins + 1);
  const snareBand = new Float32Array(halfBins + 1);
  const hihatBand = new Float32Array(halfBins + 1);

  for (let k = 0; k <= halfBins; k++) {
    const freq = (k * sr) / fftSize;
    bassBand[k] = 1 - smoothstep(freq, 130, 165);
    vocBand[k] = smoothstep(freq, 155, 185) * (1 - smoothstep(freq, 5400, 6100));
    kickBand[k] = smoothstep(freq, 35, 50) * (1 - smoothstep(freq, 145, 170));
    snareBand[k] = smoothstep(freq, 165, 195) * (1 - smoothstep(freq, 410, 460));
    hihatBand[k] = smoothstep(freq, 5600, 6200);
  }

  const outLen = len;
  const vocL = new Float32Array(outLen);
  const vocR = new Float32Array(outLen);
  const instL = new Float32Array(outLen);
  const instR = new Float32Array(outLen);
  const bassL = new Float32Array(outLen);
  const bassR = new Float32Array(outLen);
  const drumL = new Float32Array(outLen);
  const drumR = new Float32Array(outLen);

  // Ring buffer 11 khung cho 2D-HPSS (halfT = 5 -> cửa sổ +-5 khung thời gian & +-5 bin tần số)
  const T = 11;
  const halfT = 5;
  const halfF = 5;

  const ringMRe = Array.from({ length: T }, () => new Float64Array(fftSize));
  const ringMIm = Array.from({ length: T }, () => new Float64Array(fftSize));
  const ringMagM = Array.from({ length: T }, () => new Float32Array(halfBins + 1));

  const ringSRe = isStereo ? Array.from({ length: T }, () => new Float64Array(fftSize)) : null;
  const ringSIm = isStereo ? Array.from({ length: T }, () => new Float64Array(fftSize)) : null;
  const ringMagS = isStereo ? Array.from({ length: T }, () => new Float32Array(halfBins + 1)) : null;

  const wRe = new Float64Array(fftSize);
  const wIm = new Float64Array(fftSize);
  const sideTmpRe = new Float64Array(fftSize);
  const sideTmpIm = new Float64Array(fftSize);

  const gVocM = new Float32Array(halfBins + 1);
  const gInstM = new Float32Array(halfBins + 1);
  const gBassM = new Float32Array(halfBins + 1);
  const gDrumM = new Float32Array(halfBins + 1);

  const gInstS = isStereo ? new Float32Array(halfBins + 1) : null;
  const gDrumS = isStereo ? new Float32Array(halfBins + 1) : null;

  const medBuf = new Float32Array(T);

  const applyComplexMaskAndIfft = (srcRe, srcIm, gainArr, dstRe, dstIm) => {
    for (let k = 0; k <= halfBins; k++) {
      const g = gainArr[k];
      dstRe[k] = srcRe[k] * g;
      dstIm[k] = srcIm[k] * g;
      if (k > 0 && k < halfBins) {
        const conj = fftSize - k;
        dstRe[conj] = srcRe[conj] * g;
        dstIm[conj] = srcIm[conj] * g;
      }
    }
    fftRadix2(dstRe, dstIm, true);
  };

  // Bắt đầu từ -hop để WOLA phủ đủ 1.00000 từ mẫu 0 tới len-1
  const totalFrames = Math.ceil(len / hop) + 1;
  const totalSteps = totalFrames + halfT;

  for (let pushIdx = 0; pushIdx < totalSteps; pushIdx++) {
    if (pushIdx < totalFrames) {
      const slot = pushIdx % T;
      const start = (pushIdx - 1) * hop;
      const mRe = ringMRe[slot];
      const mIm = ringMIm[slot];
      const magM = ringMagM[slot];

      if (isStereo) {
        const sRe = ringSRe[slot];
        const sIm = ringSIm[slot];
        const magS = ringMagS[slot];
        for (let i = 0; i < fftSize; i++) {
          const idx = start + i;
          const w = win[i];
          const l = idx >= 0 && idx < len ? ch0[idx] : 0;
          const r = idx >= 0 && idx < len ? ch1[idx] : 0;
          mRe[i] = 0.5 * (l + r) * w;
          mIm[i] = 0;
          sRe[i] = 0.5 * (l - r) * w;
          sIm[i] = 0;
        }
        fftRadix2(mRe, mIm, false);
        fftRadix2(sRe, sIm, false);
        for (let k = 0; k <= halfBins; k++) {
          magM[k] = Math.hypot(mRe[k], mIm[k]);
          magS[k] = Math.hypot(sRe[k], sIm[k]);
        }
      } else {
        for (let i = 0; i < fftSize; i++) {
          const idx = start + i;
          const w = win[i];
          const l = idx >= 0 && idx < len ? ch0[idx] : 0;
          mRe[i] = l * w;
          mIm[i] = 0;
        }
        fftRadix2(mRe, mIm, false);
        for (let k = 0; k <= halfBins; k++) {
          magM[k] = Math.hypot(mRe[k], mIm[k]);
        }
      }
    }

    const centerFrame = pushIdx - halfT;
    if (centerFrame >= 0 && centerFrame < totalFrames) {
      const cSlot = centerFrame % T;
      const cStart = (centerFrame - 1) * hop;
      const cMagM = ringMagM[cSlot];
      const cMagS = isStereo ? ringMagS[cSlot] : null;
      const tMin = Math.max(0, centerFrame - halfT);
      const tMax = Math.min(totalFrames - 1, centerFrame + halfT);
      const tCount = tMax - tMin + 1;

      for (let k = 0; k <= halfBins; k++) {
        // 1. 2D-HPSS trên Mid
        for (let ti = 0, f = tMin; f <= tMax; f++, ti++) {
          medBuf[ti] = ringMagM[f % T][k];
        }
        const hM = insertionSortWindow(medBuf, tCount);

        const kMin = Math.max(0, k - halfF);
        const kMax = Math.min(halfBins, k + halfF);
        let fCount = 0;
        for (let kp = kMin; kp <= kMax; kp++) {
          medBuf[fCount++] = cMagM[kp];
        }
        const pM = insertionSortWindow(medBuf, fCount);

        const hm2 = hM * hM;
        const pm2 = pM * pM;
        const pMid = pm2 / (hm2 + pm2 + 1e-12);

        // 2. 2D-HPSS trên Side (nếu Stereo)
        let hS = 0;
        let pSide = 0;
        if (isStereo) {
          for (let ti = 0, f = tMin; f <= tMax; f++, ti++) {
            medBuf[ti] = ringMagS[f % T][k];
          }
          hS = insertionSortWindow(medBuf, tCount);

          let sCount = 0;
          for (let kp = kMin; kp <= kMax; kp++) {
            medBuf[sCount++] = cMagS[kp];
          }
          const pS = insertionSortWindow(medBuf, sCount);

          const hs2 = hS * hS;
          const ps2 = pS * pS;
          pSide = ps2 / (hs2 + ps2 + 1e-12);
        }

        // 3. Phân hoạch mặt nạ loại bỏ rò giọng hát sang Trống & triệt >= 24 dB Vocal trung tâm trong Other
        const bb = bassBand[k];
        const oneMinusBb = 1 - bb;
        const vb = vocBand[k];

        // Trống: chỉ bắt transient Kick (50–150 Hz), Snare gắt (180–450 Hz) & Hi-Hat (> 6 kHz)
        const snareGate = smoothstep(pMid, 0.72, 0.88) * 0.45;
        gDrumM[k] = Math.min(
          1,
          Math.pow(pMid, 1.25) * kickBand[k] +
            snareGate * snareBand[k] +
            Math.pow(pMid, 1.15) * hihatBand[k]
        );
        const remM = Math.max(0, 1 - gDrumM[k]);

        // Bass & Sub (< 165 Hz) cộng pha trung tâm mượt
        gBassM[k] = remM * bb;

        if (isStereo) {
          gDrumS[k] = Math.min(
            1,
            Math.pow(pSide, 1.2) * (kickBand[k] + snareBand[k] * 0.8 + hihatBand[k])
          );
          const remS = Math.max(0, 1 - gDrumS[k]);

          const mMag = 0.65 * cMagM[k] + 0.35 * hM;
          const sMag = 0.65 * cMagS[k] + 0.35 * hS;
          const vocPres = clamp((mMag - 0.55 * sMag) / (mMag + 1e-9), 0, 1);

          // Giọng hát (Center Mid 180 Hz – 5.5 kHz, |Mid| > |Side|)
          gVocM[k] = remM * oneMinusBb * vb * Math.pow(vocPres, 0.75);

          // Nhạc nền Other: triệt <= 0.06 (-24.4 dB) vùng Vocal trung tâm + giữ & bù nhẹ Side Stereo
          const otherMidVocFloor = 0.035 + 0.025 * smoothstep(sMag / (mMag + 1e-9), 1.2, 2.5);
          const otherMidMask = (1 - vb) + vb * otherMidVocFloor;
          gInstM[k] = remM * oneMinusBb * otherMidMask;

          const widthComp = 1.0 + 0.38 * vb + 0.15 * hihatBand[k];
          gInstS[k] = remS * oneMinusBb * widthComp;
        } else {
          gVocM[k] = remM * oneMinusBb * vb * 0.92;
          gInstM[k] = remM * oneMinusBb * ((1 - vb) + vb * 0.08);
        }
      }

      const cMRe = ringMRe[cSlot];
      const cMIm = ringMIm[cSlot];
      const cSRe = isStereo ? ringSRe[cSlot] : null;
      const cSIm = isStereo ? ringSIm[cSlot] : null;

      // Stem 1: Giọng hát (Center Vocal)
      applyComplexMaskAndIfft(cMRe, cMIm, gVocM, wRe, wIm);
      for (let i = 0; i < fftSize; i++) {
        const idx = cStart + i;
        if (idx >= 0 && idx < outLen) {
          const val = wRe[i] * win[i];
          vocL[idx] += val;
          vocR[idx] += val;
        }
      }

      // Stem 2: Nhạc cụ & Hòa âm (Other — Stereo Side + Mid đã triệt vocal trung tâm)
      applyComplexMaskAndIfft(cMRe, cMIm, gInstM, wRe, wIm);
      if (isStereo) {
        applyComplexMaskAndIfft(cSRe, cSIm, gInstS, sideTmpRe, sideTmpIm);
        for (let i = 0; i < fftSize; i++) {
          const idx = cStart + i;
          if (idx >= 0 && idx < outLen) {
            const w = win[i];
            const midV = wRe[i] * w;
            const sideV = sideTmpRe[i] * w;
            instL[idx] += midV + sideV;
            instR[idx] += midV - sideV;
          }
        }
      } else {
        for (let i = 0; i < fftSize; i++) {
          const idx = cStart + i;
          if (idx >= 0 && idx < outLen) {
            const midV = wRe[i] * win[i];
            instL[idx] += midV;
            instR[idx] += midV;
          }
        }
      }

      // Stem 3: Bass & Sub (cộng pha mượt ở trung tâm < 165 Hz từ L/R)
      applyComplexMaskAndIfft(cMRe, cMIm, gBassM, wRe, wIm);
      for (let i = 0; i < fftSize; i++) {
        const idx = cStart + i;
        if (idx >= 0 && idx < outLen) {
          const midV = wRe[i] * win[i];
          bassL[idx] += midV;
          bassR[idx] += midV;
        }
      }

      // Stem 4: Trống & Bộ gõ
      applyComplexMaskAndIfft(cMRe, cMIm, gDrumM, wRe, wIm);
      if (isStereo) {
        applyComplexMaskAndIfft(cSRe, cSIm, gDrumS, sideTmpRe, sideTmpIm);
        for (let i = 0; i < fftSize; i++) {
          const idx = cStart + i;
          if (idx >= 0 && idx < outLen) {
            const w = win[i];
            const midV = wRe[i] * w;
            const sideV = sideTmpRe[i] * w;
            drumL[idx] += midV + sideV;
            drumR[idx] += midV - sideV;
          }
        }
      } else {
        for (let i = 0; i < fftSize; i++) {
          const idx = cStart + i;
          if (idx >= 0 && idx < outLen) {
            const midV = wRe[i] * win[i];
            drumL[idx] += midV;
            drumR[idx] += midV;
          }
        }
      }

      if (centerFrame % 80 === 0) {
        if (onProgress) {
          onProgress(Math.min(98, Math.round((centerFrame / totalFrames) * 100)));
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  const buildBuf = (lArr, rArr) => {
    softLimitPcm(lArr, 0.985);
    softLimitPcm(rArr, 0.985);
    const buf = new AudioBuffer({ numberOfChannels: 2, length: outLen, sampleRate: sr });
    buf.getChannelData(0).set(lArr);
    buf.getChannelData(1).set(rArr);
    return buf;
  };

  if (onProgress) onProgress(100);

  return {
    vocals: buildBuf(vocL, vocR),
    instrumental: buildBuf(instL, instR),
    bass: buildBuf(bassL, bassR),
    drums: buildBuf(drumL, drumR),
    isStereo,
    durationSec: outLen / sr,
  };
}

// ============================================================================
// Giao diện Studio Tách Stems & Phân Tích Hợp Âm Tự Động (bên trong Dựng bài & Master)
// ============================================================================
export class StemAnalyzerStudio {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    this.cb = callbacks; // { renderStudioBeat, onSendStemsToPlaylist, onApplyChordsToStudio, onPracticeChordsInTrainer, showToast }
    this.sourceBuffer = null;
    this.sourceName = '';
    this.analysis = null;
    this.stems = null; // { vocals, instrumental, bass, drums, isStereo, durationSec }
    this.isProcessing = false;
    this.progressPct = 0;
    this.exportFormat = 'wav';

    this.stemMixer = {
      vocals:       { label: 'Giọng hát (Vocal)',        color: '#EC4899', volume: 100, muted: false, solo: false },
      instrumental: { label: 'Nhạc cụ & Hòa âm (Other)', color: '#67E8F9', volume: 100, muted: false, solo: false },
      bass:         { label: 'Bass & Sub',               color: '#A78BFA', volume: 100, muted: false, solo: false },
      drums:        { label: 'Trống & Bộ gõ',            color: '#F97316', volume: 100, muted: false, solo: false },
    };
    this.activePreset = 'all';

    this.playCtx = null;
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this._playStartCtxTime = 0;
    this._playStartOffset = 0;
    this._playSeq = 0;
    this._activeSources = [];
    this._stemGainNodes = {};
    this._rafId = null;

    this._render();
  }

  _toast(msg, isErr = false) {
    if (this.cb.showToast) this.cb.showToast(msg, isErr);
  }

  _ensurePlayCtx() {
    if (!this.playCtx || this.playCtx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('Trình duyệt không hỗ trợ Web AudioContext.');
      this.playCtx = new AC();
    }
    if (this.playCtx.state !== 'running') {
      try {
        const res = this.playCtx.resume();
        if (res && typeof res.catch === 'function') res.catch(() => {});
        const sBuf = this.playCtx.createBuffer(1, 1, this.playCtx.sampleRate || 44100);
        const s = this.playCtx.createBufferSource();
        s.buffer = sBuf;
        s.connect(this.playCtx.destination);
        s.start(0);
      } catch (_) {}
    }
    return this.playCtx;
  }

  _isStemAudible(key) {
    const anySolo = Object.values(this.stemMixer).some((s) => s.solo);
    const item = this.stemMixer[key];
    return Boolean(item && !item.muted && (!anySolo || item.solo));
  }

  _computeStemGainValue(key) {
    const item = this.stemMixer[key];
    if (!item || !this._isStemAudible(key)) return 0;
    const v = clamp(Number(item.volume) || 0, 0, 125);
    if (v <= 0) return 0;
    return Math.pow(v / 100, 1.45);
  }

  _syncLiveStemGains() {
    if (!this.playCtx) return;
    const now = this.playCtx.currentTime;
    Object.keys(this.stemMixer).forEach((key) => {
      const node = this._stemGainNodes[key];
      if (!node) return;
      const val = this._computeStemGainValue(key);
      try {
        node.gain.cancelScheduledValues(now);
        if (val === 0 || this.playCtx.state !== 'running') {
          node.gain.setValueAtTime(val, now);
          node.gain.value = val;
        } else {
          node.gain.setValueAtTime(node.gain.value, now);
          node.gain.linearRampToValueAtTime(val, now + 0.012);
        }
      } catch (_) {
        node.gain.value = val;
      }
    });
  }

  _detectActivePreset() {
    const m = this.stemMixer;
    const anySolo = Object.values(m).some((s) => s.solo);
    if (!anySolo && !m.vocals.muted && m.vocals.volume === 100 &&
        !m.instrumental.muted && m.instrumental.volume === 100 &&
        !m.bass.muted && m.bass.volume === 100 &&
        !m.drums.muted && m.drums.volume === 100) {
      return 'all';
    }
    if (!anySolo && (m.vocals.muted || m.vocals.volume === 0) &&
        !m.instrumental.muted && m.instrumental.volume === 100 &&
        !m.bass.muted && m.bass.volume === 100 &&
        !m.drums.muted && m.drums.volume === 100) {
      return 'karaoke';
    }
    if (m.vocals.solo && !m.vocals.muted && m.vocals.volume > 0 &&
        !m.instrumental.solo && !m.bass.solo && !m.drums.solo) {
      return 'acapella';
    }
    if (!anySolo && (m.vocals.muted || m.vocals.volume === 0) &&
        (m.instrumental.muted || m.instrumental.volume === 0) &&
        !m.bass.muted && m.bass.volume === 100 &&
        !m.drums.muted && m.drums.volume === 100) {
      return 'rhythm';
    }
    return 'custom';
  }

  applyMixerPreset(presetId) {
    const m = this.stemMixer;
    Object.values(m).forEach((s) => {
      s.muted = false;
      s.solo = false;
      s.volume = 100;
    });
    if (presetId === 'karaoke') {
      m.vocals.volume = 0;
      m.vocals.muted = true;
    } else if (presetId === 'acapella') {
      m.vocals.solo = true;
      m.vocals.volume = 100;
      m.instrumental.muted = true;
      m.instrumental.volume = 0;
      m.bass.muted = true;
      m.bass.volume = 0;
      m.drums.muted = true;
      m.drums.volume = 0;
    } else if (presetId === 'rhythm') {
      m.vocals.muted = true;
      m.vocals.volume = 0;
      m.instrumental.muted = true;
      m.instrumental.volume = 0;
    }
    this.activePreset = this._detectActivePreset();
    this._syncLiveStemGains();
    this._syncMixerDomUI();
  }

  _syncMixerDomUI() {
    if (!this.root) return;
    Object.entries(this.stemMixer).forEach(([key, st]) => {
      const volInp = this.root.querySelector(`[data-stem-vol="${key}"]`);
      if (volInp) volInp.value = String(st.volume);
      const volLbl = this.root.querySelector(`[data-stem-vol-lbl="${key}"]`);
      if (volLbl) volLbl.textContent = `${st.volume}%`;
      const muteBtn = this.root.querySelector(`[data-stem-mute="${key}"]`);
      if (muteBtn) muteBtn.classList.toggle('active-mute', Boolean(st.muted));
      const soloBtn = this.root.querySelector(`[data-stem-solo="${key}"]`);
      if (soloBtn) soloBtn.classList.toggle('active-solo', Boolean(st.solo));
    });
    this.root.querySelectorAll('[data-stem-preset]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.stemPreset === this.activePreset);
    });
  }

  async loadAudioFile(file) {
    if (!file) return;
    try {
      const ctx = this._ensurePlayCtx();
      const arrBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrBuf);
      const cleanName = file.name.replace(/\.[^/.]+$/, '') || 'Bản nhạc nhập';
      await this.processAudioBuffer(decoded, cleanName);
    } catch (err) {
      console.error('[HEVOS Stem Load File]', err);
      this._toast(`Không giải mã được file "${file.name}".`, true);
    }
  }

  async loadFromStudioBeat() {
    if (!this.cb.renderStudioBeat) return;
    try {
      this._toast('Đang lấy Beat từ Sáng tác Beat để tách Stems & phân tích...');
      const res = await this.cb.renderStudioBeat();
      if (!res || !res.audioBuffer) {
        this._toast('Chưa có dữ liệu Beat từ Sáng tác Beat.', true);
        return;
      }
      await this.processAudioBuffer(res.audioBuffer, res.name || 'Beat Sáng tác');
    } catch (err) {
      console.error('[HEVOS Stem Studio Load]', err);
      this._toast(err.message || 'Lỗi khi lấy Beat để phân tích.', true);
    }
  }

  async processAudioBuffer(audioBuffer, name = 'Audio Track') {
    if (!audioBuffer || this.isProcessing) return;
    this.stopPlayback();
    this.isProcessing = true;
    this.progressPct = 4;
    this.sourceBuffer = audioBuffer;
    this.sourceName = name;
    this.analysis = null;
    this.stems = null;
    this.currentTimeSec = 0;
    this.applyMixerPreset('all');
    this._render();

    try {
      await new Promise((r) => setTimeout(r, 20));
      this.analysis = analyzeChordsFromAudioBuffer(audioBuffer);
      this.progressPct = 15;
      this._updateProgressUI(15);

      this.stems = await separateAudioStems(audioBuffer, {
        onProgress: (pct) => {
          const scaled = Math.round(15 + pct * 0.85);
          this.progressPct = scaled;
          this._updateProgressUI(scaled);
        },
      });
      this._toast(`Đã phân tích & tách xong 4 Stems cho "${name}"!`);
    } catch (err) {
      console.error('[HEVOS Stem Process]', err);
      this._toast(err.message || 'Lỗi khi phân tích / tách Stems.', true);
    } finally {
      this.isProcessing = false;
      this._render();
    }
  }

  _updateProgressUI(pct) {
    const fill = this.root?.querySelector('#stem-progress-fill');
    const lbl = this.root?.querySelector('#stem-progress-label');
    if (fill) fill.style.width = `${pct}%`;
    if (lbl) lbl.textContent = `Đang tách Stems DSP & Dò Hợp Âm... ${pct}%`;
  }

  async togglePlay() {
    if (!this.stems) return;
    if (this.isPlaying) {
      this.pausePlayback();
      return;
    }

    const seq = ++this._playSeq;
    const ctx = this._ensurePlayCtx();
    if (ctx.state !== 'running') {
      await Promise.race([
        Promise.resolve().then(() => ctx.resume()).catch(() => {}),
        new Promise((r) => setTimeout(r, 700)),
      ]);
    }
    if (seq !== this._playSeq || !this.stems) return;
    this._stopSources();

    const dur = this.stems.durationSec;
    if (this.currentTimeSec >= dur - 0.05) {
      this.currentTimeSec = 0;
    }
    const startOffset = Math.max(0, this.currentTimeSec);
    const now = ctx.currentTime + 0.02;
    this._playStartCtxTime = now;
    this._playStartOffset = startOffset;

    Object.keys(this.stemMixer).forEach((key) => {
      const buf = this.stems[key];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = this._computeStemGainValue(key);
      src.connect(g);
      g.connect(ctx.destination);
      src.start(now, startOffset);
      this._activeSources.push(src);
      this._stemGainNodes[key] = g;
    });

    this.isPlaying = true;
    this._syncPlayUI();
    this._startTimelineWatch();
  }

  pausePlayback() {
    this._playSeq += 1;
    if (this.isPlaying && this.playCtx) {
      this.currentTimeSec = Math.min(
        this.stems ? this.stems.durationSec : 0,
        this._playStartOffset + Math.max(0, this.playCtx.currentTime - this._playStartCtxTime)
      );
    }
    this._stopSources();
    this.isPlaying = false;
    this._stopTimelineWatch();
    this._syncPlayUI();
  }

  stopPlayback() {
    this._playSeq += 1;
    this._stopSources();
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this._stopTimelineWatch();
    this._syncPlayUI();
  }

  seekTo(sec) {
    if (!this.stems) return;
    const dur = this.stems.durationSec || 0;
    this.currentTimeSec = clamp(Number(sec) || 0, 0, Math.max(0, dur));
    if (this.isPlaying) {
      this.pausePlayback();
      this.togglePlay();
    } else {
      this._syncPlayUI();
    }
  }

  _stopSources() {
    this._activeSources.forEach((s) => {
      try { s.stop(); } catch (_) {}
      try { s.disconnect(); } catch (_) {}
    });
    Object.values(this._stemGainNodes).forEach((g) => {
      try { g.disconnect(); } catch (_) {}
    });
    this._activeSources = [];
    this._stemGainNodes = {};
  }

  _startTimelineWatch() {
    this._stopTimelineWatch();
    const step = () => {
      this._rafId = null;
      if (!this.isPlaying || !this.playCtx || !this.stems) return;
      const t = this._playStartOffset + Math.max(0, this.playCtx.currentTime - this._playStartCtxTime);
      if (t >= this.stems.durationSec) {
        this.stopPlayback();
        return;
      }
      this.currentTimeSec = t;
      this._syncPlayUI();
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  _stopTimelineWatch() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _syncPlayUI() {
    if (!this.root) return;
    const playBtn = this.root.querySelector('#stem-btn-play');
    const scrub = this.root.querySelector('#stem-scrubber');
    const timeLbl = this.root.querySelector('#stem-time-clock');
    const dur = this.stems ? this.stems.durationSec : 0;

    if (playBtn) {
      playBtn.textContent = this.isPlaying ? '⏸ Tạm dừng' : '▶ Phát Mix Stems';
      playBtn.classList.toggle('playing', this.isPlaying);
    }
    if (scrub && dur > 0) {
      scrub.value = String(Math.round((this.currentTimeSec / dur) * 1000));
    }
    if (timeLbl) {
      timeLbl.textContent = `${formatClock(this.currentTimeSec)} / ${formatClock(dur)}`;
    }

    // Tô sáng hợp âm đang phát trên Timeline
    this.root.querySelectorAll('.stem-chord-pill').forEach((pill) => {
      const s = Number(pill.dataset.startSec);
      const e = Number(pill.dataset.endSec);
      pill.classList.toggle('active', this.currentTimeSec >= s && this.currentTimeSec < e);
    });
  }

  async _downloadStem(key) {
    if (!this.stems || !this.stems[key]) return;
    const fmt = this.exportFormat === 'mp3' ? 'mp3' : 'wav';
    try {
      const encoded = await encodeAudioBufferByFormat(this.stems[key], fmt, { kbps: 192 });
      const baseSlug = (this.sourceName || 'track').toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
      const filename = `hevos-stem-${key}-${baseSlug}.${encoded.ext}`;
      const url = URL.createObjectURL(encoded.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this._toast(`Đã tải Stem "${this.stemMixer[key].label}" (.${encoded.ext})`);
    } catch (err) {
      this._toast(err.message || `Lỗi xuất Stem ${fmt.toUpperCase()}.`, true);
    }
  }

  renderCurrentMixBuffer() {
    if (!this.stems) return null;
    const keys = Object.keys(this.stemMixer);
    const gains = {};
    let hasAudible = false;
    keys.forEach((k) => {
      const g = this._computeStemGainValue(k);
      gains[k] = g;
      if (g > 0 && this.stems[k]) hasAudible = true;
    });
    if (!hasAudible) return null;

    const refBuf = this.stems.instrumental || this.stems.vocals;
    const len = refBuf.length;
    const sr = refBuf.sampleRate;
    const outL = new Float32Array(len);
    const outR = new Float32Array(len);

    keys.forEach((k) => {
      const g = gains[k];
      const buf = this.stems[k];
      if (!buf || g <= 0) return;
      const ch0 = buf.getChannelData(0);
      const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
      for (let i = 0; i < len; i++) {
        outL[i] += ch0[i] * g;
        outR[i] += ch1[i] * g;
      }
    });

    softLimitPcm(outL, 0.96);
    softLimitPcm(outR, 0.96);
    const mixBuf = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: sr });
    mixBuf.getChannelData(0).set(outL);
    mixBuf.getChannelData(1).set(outR);
    return mixBuf;
  }

  async _downloadMixedStems() {
    if (!this.stems) return;
    const mixBuf = this.renderCurrentMixBuffer();
    if (!mixBuf) {
      this._toast('Tất cả 4 Stems đang bị tắt (Mute hoặc Volume 0%).', true);
      return;
    }

    const fmt = this.exportFormat === 'mp3' ? 'mp3' : 'wav';
    try {
      const encoded = await encodeAudioBufferByFormat(mixBuf, fmt, { kbps: 192 });
      const baseSlug = (this.sourceName || 'track').toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
      const filename = `hevos-stems-mix-${baseSlug}.${encoded.ext}`;
      const url = URL.createObjectURL(encoded.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this._toast(`Đã xuất bản Mix 4 Stems hiện tại (.${encoded.ext})`);
    } catch (err) {
      this._toast(err.message || `Lỗi xuất Mix ${fmt.toUpperCase()}.`, true);
    }
  }

  _render() {
    if (!this.root) return;

    const processingHtml = this.isProcessing
      ? `
        <div class="stem-progress-box">
          <span id="stem-progress-label" class="stem-progress-label">Đang tách Stems DSP &amp; Dò Hợp Âm... ${this.progressPct}%</span>
          <div class="stem-progress-track">
            <div id="stem-progress-fill" class="stem-progress-fill" style="width: ${this.progressPct}%"></div>
          </div>
        </div>
      `
      : '';

    let resultHtml = '';
    if (this.analysis && this.stems && !this.isProcessing) {
      const { keyInfo, bpmInfo, timeline } = this.analysis;
      const stereoNote = this.stems.isStereo
        ? 'Nguồn Stereo · 2D-HPSS + Mid/Side Partition 4 Stems'
        : 'Nguồn Mono (L=R) · Tách phổ HPSS (dùng file Stereo để xóa Vocal sạch nhất)';

      const chordsTimelineHtml = timeline.length
        ? timeline
            .map(
              (c) => `
            <button type="button" class="stem-chord-pill" data-start-sec="${c.startSec}" data-end-sec="${c.endSec}" title="Nhảy tới ${formatClock(c.startSec)}">
              <strong class="mono-val">${escapeHtml(c.symbol)}</strong>
              <span class="mono-val">${formatClock(c.startSec)}</span>
            </button>
          `
            )
            .join('')
        : '<span class="stem-empty-msg">Chưa phát hiện đủ hợp âm rõ rệt trong đoạn nhạc này.</span>';

      const stemCardsHtml = Object.entries(this.stemMixer)
        .map(([key, st]) => {
          const isMute = st.muted;
          const isSolo = st.solo;
          return `
            <div class="stem-card" data-stem-card="${key}" style="--stem-accent: ${st.color};">
              <div class="stem-card-head">
                <div class="stem-title-wrap">
                  <span class="stem-dot" style="background: ${st.color};"></span>
                  <strong>${st.label}</strong>
                </div>
                <span class="mono-val stem-vol-lbl" data-stem-vol-lbl="${key}">${st.volume}%</span>
              </div>

              <div class="stem-card-controls">
                <input type="range" class="studio-range" min="0" max="125" value="${st.volume}" data-stem-vol="${key}" aria-label="Âm lượng ${st.label}" />
                <div class="stem-ms-btns">
                  <button type="button" class="ms-btn${isMute ? ' active-mute' : ''}" data-stem-mute="${key}" title="Tắt tiếng ${st.label}">M</button>
                  <button type="button" class="ms-btn${isSolo ? ' active-solo' : ''}" data-stem-solo="${key}" title="Nghe riêng ${st.label}">S</button>
                  <button type="button" class="btn btn-ghost btn-xs" data-stem-dl="${key}" title="Tải riêng ${st.label}">↓ Tải</button>
                </div>
              </div>
            </div>
          `;
        })
        .join('');

      resultHtml = `
        <div class="stem-results-wrap">
          <div class="stem-meta-grid">
            <div class="stem-meta-card">
              <span class="stem-meta-lbl">TÔNG PHÁT HIỆN</span>
              <strong id="stem-key-val" class="stem-meta-val accent-cyan">${escapeHtml(keyInfo.label)}</strong>
              <span class="stem-meta-sub">Độ tin cậy ~${keyInfo.confidence}%</span>
            </div>
            <div class="stem-meta-card">
              <span class="stem-meta-lbl">NHỊP ĐỘ (BPM)</span>
              <strong id="stem-bpm-val" class="stem-meta-val">${bpmInfo.bpm} BPM</strong>
              <span class="stem-meta-sub">${stereoNote}</span>
            </div>
            <div class="stem-meta-actions">
              <button type="button" id="stem-btn-apply-chords" class="btn btn-indigo-solid btn-xs">
                Nạp hợp âm vào Sáng tác Beat →
              </button>
              <button type="button" id="stem-btn-practice-chords" class="btn btn-cyan-outline btn-xs">
                Tập đệm ngay bên Phòng Đàn →
              </button>
              <button type="button" id="stem-btn-send-arr" class="btn btn-amber-solid btn-xs">
                Gửi 4 Stems sang Playlist Dựng bài →
              </button>
            </div>
          </div>

          <div class="stem-timeline-section">
            <div class="stem-section-head">
              <span>DÒNG THỜI GIAN HỢP ÂM TỰ ĐỘNG (${timeline.length} chuyển đoạn · Bấm để tua nghe)</span>
              <span class="stem-source-name mono-val">${escapeHtml(this.sourceName)}</span>
            </div>
            <div id="stem-chord-timeline" class="stem-chord-timeline">${chordsTimelineHtml}</div>
          </div>

          <div class="stem-player-bar">
            <button type="button" id="stem-btn-rewind" class="btn btn-ghost btn-xs" title="Về đầu đoạn">⏮</button>
            <button type="button" id="stem-btn-play" class="btn btn-cyan-solid btn-xs">
              ${this.isPlaying ? '⏸ Tạm dừng' : '▶ Phát Mix Stems'}
            </button>
            <input type="range" id="stem-scrubber" class="studio-range stem-scrubber" min="0" max="1000" value="0" aria-label="Tua nghe Stems" />
            <span id="stem-time-clock" class="mono-val stem-time-clock">0:00 / ${formatClock(this.stems.durationSec)}</span>
            <div class="export-fmt-switch" role="group" aria-label="Định dạng tải Stem">
              <button type="button" class="fmt-pill${this.exportFormat === 'wav' ? ' active' : ''}" data-stem-fmt="wav">WAV</button>
              <button type="button" class="fmt-pill${this.exportFormat === 'mp3' ? ' active' : ''}" data-stem-fmt="mp3">MP3</button>
            </div>
            <button type="button" id="stem-btn-dl-mix" class="btn btn-indigo-outline btn-xs" title="Gộp 4 Stems theo Mixer hiện tại và tải xuống">
              ↓ Tải bản Mix hiện tại
            </button>
          </div>

          <div class="stem-quick-presets" role="group" aria-label="Chế độ nghe nhanh Stems">
            <button type="button" class="stem-preset-btn${this.activePreset === 'all' ? ' active' : ''}" data-stem-preset="all">🎧 Toàn bộ (Gốc)</button>
            <button type="button" class="stem-preset-btn${this.activePreset === 'karaoke' ? ' active' : ''}" data-stem-preset="karaoke">🎤 Xóa Vocal (Karaoke)</button>
            <button type="button" class="stem-preset-btn${this.activePreset === 'acapella' ? ' active' : ''}" data-stem-preset="acapella">🗣️ Chỉ Giọng hát</button>
            <button type="button" class="stem-preset-btn${this.activePreset === 'rhythm' ? ' active' : ''}" data-stem-preset="rhythm">🥁 Chỉ Trống &amp; Bass</button>
          </div>

          <div class="stem-mixer-grid">${stemCardsHtml}</div>
        </div>
      `;
    } else if (!this.isProcessing) {
      resultHtml = `
        <div class="stem-empty-hero">
          <h3>Tách 4 Stems &amp; Phân tích Hợp âm Tự động ngay trên trình duyệt</h3>
          <p>
            Nạp bài nhạc MP3 / WAV bất kỳ hoặc lấy trực tiếp vòng Beat vừa tạo ở mục <strong>Sáng tác Beat</strong>. Hệ thống sẽ tự dò <strong>Tông</strong>, <strong>BPM</strong>, vẽ <strong>Dòng thời gian Hợp âm</strong> và tách riêng 4 lớp: <strong>Giọng hát</strong> · <strong>Nhạc nền</strong> · <strong>Bass</strong> · <strong>Trống</strong>.
          </p>
          <span class="stem-dsp-note">Xử lý 100% cục bộ bằng Spectral Mid/Side &amp; Transient Flux DSP · An toàn riêng tư không gửi file lên server</span>
        </div>
      `;
    }

    this.root.innerHTML = `
      <div class="stem-studio">
        <div class="stem-upload-bar">
          <input type="file" id="stem-file-input" class="hidden" accept="audio/*,.mp3,.wav,.m4a,.ogg" />
          <button type="button" id="stem-btn-upload" class="btn btn-cyan-solid btn-xs" ${this.isProcessing ? 'disabled' : ''}>
            📂 Chọn file Audio (MP3/WAV)
          </button>
          <button type="button" id="stem-btn-load-studio" class="btn btn-indigo-outline btn-xs" ${this.isProcessing ? 'disabled' : ''}>
            🎹 Lấy Beat từ Sáng tác
          </button>
          <span class="stem-dsp-badge">Tối ưu 90s đầu · Mid/Side Stereo DSP</span>
        </div>

        ${processingHtml}
        ${resultHtml}
      </div>
    `;

    this._bindEvents();
  }

  _bindEvents() {
    if (!this.root) return;
    const q = (sel) => this.root.querySelector(sel);

    const fileInput = q('#stem-file-input');
    q('#stem-btn-upload')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) await this.loadAudioFile(f);
      fileInput.value = '';
    });

    q('#stem-btn-load-studio')?.addEventListener('click', () => this.loadFromStudioBeat());

    q('#stem-btn-play')?.addEventListener('click', () => this.togglePlay());
    q('#stem-btn-rewind')?.addEventListener('click', () => this.seekTo(0));
    q('#stem-scrubber')?.addEventListener('input', (e) => {
      if (!this.stems) return;
      const ratio = Number(e.target.value) / 1000;
      this.seekTo(ratio * this.stems.durationSec);
    });

    q('#stem-chord-timeline')?.addEventListener('click', (e) => {
      const pill = e.target.closest('.stem-chord-pill');
      if (!pill) return;
      this.seekTo(Number(pill.dataset.startSec) || 0);
    });

    this.root.querySelectorAll('[data-stem-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.exportFormat = btn.dataset.stemFmt === 'mp3' ? 'mp3' : 'wav';
        this.root.querySelectorAll('[data-stem-fmt]').forEach((b) =>
          b.classList.toggle('active', b === btn)
        );
      });
    });

    this.root.querySelectorAll('[data-stem-vol]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const key = e.target.dataset.stemVol;
        if (!this.stemMixer[key]) return;
        this.stemMixer[key].volume = Number(e.target.value);
        const lbl = q(`[data-stem-vol-lbl="${key}"]`);
        if (lbl) lbl.textContent = `${this.stemMixer[key].volume}%`;
        this.activePreset = this._detectActivePreset();
        this.root.querySelectorAll('[data-stem-preset]').forEach((b) =>
          b.classList.toggle('active', b.dataset.stemPreset === this.activePreset)
        );
        this._syncLiveStemGains();
      });
    });

    this.root.querySelectorAll('[data-stem-mute]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.stemMute;
        if (!this.stemMixer[key]) return;
        this.stemMixer[key].muted = !this.stemMixer[key].muted;
        btn.classList.toggle('active-mute', this.stemMixer[key].muted);
        this.activePreset = this._detectActivePreset();
        this.root.querySelectorAll('[data-stem-preset]').forEach((b) =>
          b.classList.toggle('active', b.dataset.stemPreset === this.activePreset)
        );
        this._syncLiveStemGains();
      });
    });

    this.root.querySelectorAll('[data-stem-solo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.stemSolo;
        if (!this.stemMixer[key]) return;
        this.stemMixer[key].solo = !this.stemMixer[key].solo;
        btn.classList.toggle('active-solo', this.stemMixer[key].solo);
        this.activePreset = this._detectActivePreset();
        this.root.querySelectorAll('[data-stem-preset]').forEach((b) =>
          b.classList.toggle('active', b.dataset.stemPreset === this.activePreset)
        );
        this._syncLiveStemGains();
      });
    });

    this.root.querySelectorAll('[data-stem-preset]').forEach((btn) => {
      btn.addEventListener('click', () => this.applyMixerPreset(btn.dataset.stemPreset));
    });

    q('#stem-btn-dl-mix')?.addEventListener('click', () => this._downloadMixedStems());

    this.root.querySelectorAll('[data-stem-dl]').forEach((btn) => {
      btn.addEventListener('click', () => this._downloadStem(btn.dataset.stemDl));
    });

    q('#stem-btn-send-arr')?.addEventListener('click', () => {
      if (!this.stems || !this.cb.onSendStemsToPlaylist) return;
      this.stopPlayback();
      const bpm = this.analysis ? this.analysis.bpmInfo.bpm : 100;
      const items = Object.entries(this.stemMixer).map(([key, st], idx) => ({
        stemKey: key,
        trackTitle: st.label,
        name: `${st.label} (${this.sourceName})`,
        sourceType: key === 'vocals' ? 'vocal' : 'stem',
        audioBuffer: this.stems[key],
        bpm,
        color: st.color,
        suggestedTrackIndex: idx,
      }));
      this.cb.onSendStemsToPlaylist(items);
    });

    q('#stem-btn-apply-chords')?.addEventListener('click', () => {
      if (!this.analysis || !this.cb.onApplyChordsToStudio) return;
      this.stopPlayback();
      this.cb.onApplyChordsToStudio({
        keyPc: this.analysis.keyInfo.keyPc,
        scaleType: this.analysis.keyInfo.scaleType,
        bpm: this.analysis.bpmInfo.bpm,
        chords: this.analysis.studioChords,
      });
    });

    q('#stem-btn-practice-chords')?.addEventListener('click', () => {
      if (!this.analysis || !this.cb.onPracticeChordsInTrainer) return;
      this.stopPlayback();
      this.cb.onPracticeChordsInTrainer({
        keyPc: this.analysis.keyInfo.keyPc,
        scaleType: this.analysis.keyInfo.scaleType,
        bpm: this.analysis.bpmInfo.bpm,
        chords: this.analysis.studioChords,
      });
    });
  }
}
