// ============================================================================
// stemAnalyzer.js — Tách 4 Stems (Vocal / Nhạc nền / Bass / Trống) bằng DSP Phổ
// + Phân tích Tự động Tông, BPM & Vòng Hợp Âm theo dòng thời gian ngay trên trình duyệt
// ============================================================================

import { detectKeyFromAudioBuffer, softLimitPcm } from './autoTune.js?v=29';
import { encodeAudioBufferByFormat } from './audioEncode.js?v=29';
import { SCALES, getScaleSet, pcToNoteName, shouldPreferFlats } from './theory.js?v=29';

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

/**
 * Tách 4 Stems Stereo (Giọng hát, Nhạc nền, Bass, Trống) trực tiếp bằng STFT Mid/Side & Transient Flux DSP
 */
export async function separateAudioStems(audioBuffer, { onProgress = null } = {}) {
  if (!audioBuffer || audioBuffer.length < 2048) {
    throw new Error('Dữ liệu audio quá ngắn để tách Stems.');
  }

  const sr = audioBuffer.sampleRate || 44100;
  const len = Math.min(audioBuffer.length, Math.floor(sr * 90)); // Giới hạn 90s để chạy mượt trên mọi thiết bị
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;

  // Kiểm tra file có trường Stereo thực tế hay Mono
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

  // Cửa sổ sqrt-Hann cho Analysis & Synthesis đảm bảo Weighted-Overlap-Add (WOLA) khớp biên độ 1.0
  const win = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    win[i] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1))));
  }

  // Tạo sẵn mặt nạ dải tần (Vocals 130Hz–7.8kHz, Bass < 235Hz)
  const vocBand = new Float32Array(halfBins + 1);
  const bassBand = new Float32Array(halfBins + 1);
  const drumAirBand = new Float32Array(halfBins + 1);

  for (let k = 0; k <= halfBins; k++) {
    const freq = (k * sr) / fftSize;

    // Dải giọng hát sạch: cắt ù trầm < 130Hz & lọc chói > 7800Hz
    if (freq < 130 || freq > 8200) {
      vocBand[k] = 0;
    } else if (freq < 240) {
      vocBand[k] = 0.5 * (1 - Math.cos((Math.PI * (freq - 130)) / 110));
    } else if (freq > 5200) {
      vocBand[k] = 0.5 * (1 + Math.cos((Math.PI * (freq - 5200)) / 3000));
    } else {
      vocBand[k] = 1;
    }

    // Dải Sub & Bass (< 235Hz)
    if (freq <= 145) {
      bassBand[k] = 1;
    } else if (freq < 235) {
      bassBand[k] = 0.5 * (1 + Math.cos((Math.PI * (freq - 145)) / 90));
    } else {
      bassBand[k] = 0;
    }

    // Độ thoáng Hi-Hat / Rim / Snap > 4800Hz
    drumAirBand[k] = freq > 4800 ? clamp((freq - 4800) / 2400, 0, 1) : 0;
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

  const mRe = new Float64Array(fftSize);
  const mIm = new Float64Array(fftSize);
  const sRe = new Float64Array(fftSize);
  const sIm = new Float64Array(fftSize);

  const wRe = new Float64Array(fftSize);
  const wIm = new Float64Array(fftSize);
  const emaTotal = new Float32Array(halfBins + 1);

  const mVocArr = new Float32Array(halfBins + 1);
  const mInstMidArr = new Float32Array(halfBins + 1);
  const mDrumArr = new Float32Array(halfBins + 1);

  const applyComplexGainSym = (srcRe, srcIm, dstRe, dstIm, gainFn) => {
    for (let k = 0; k <= halfBins; k++) {
      const g = gainFn(k);
      dstRe[k] = srcRe[k] * g;
      dstIm[k] = srcIm[k] * g;
      if (k > 0 && k < halfBins) {
        const conj = fftSize - k;
        dstRe[conj] = srcRe[conj] * g;
        dstIm[conj] = srcIm[conj] * g;
      }
    }
  };

  const numFrames = Math.max(1, Math.floor((len - fftSize) / hop) + 1);
  const totalOutFrames = numFrames;

  for (let frameIdx = 0; frameIdx < numFrames; frameIdx++) {
    const start = frameIdx * hop;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      const w = win[i];
      const l = idx < len ? ch0[idx] : 0;
      const r = idx < len ? ch1[idx] : 0;
      mRe[i] = 0.5 * (l + r) * w;
      mIm[i] = 0;
      sRe[i] = 0.5 * (l - r) * w;
      sIm[i] = 0;
    }

    fftRadix2(mRe, mIm, false);
    fftRadix2(sRe, sIm, false);

    for (let k = 0; k <= halfBins; k++) {
      const magM = Math.hypot(mRe[k], mIm[k]);
      const magS = Math.hypot(sRe[k], sIm[k]);
      const m2 = magM * magM + 1e-12;
      const s2 = magS * magS + 1e-12;

      const centerRatio = isStereo ? m2 / (m2 + 2.35 * s2) : 0.82;
      const vb = vocBand[k];

      const mv = clamp(centerRatio * vb * (isStereo ? 1.12 : 0.85), 0, 1);
      mVocArr[k] = mv;

      // Nhạc nền giữ dải Side + phần Mid ngoài vocal
      mInstMidArr[k] = clamp(1 - 0.90 * centerRatio * vb, 0.08, 1);

      // Transient Flux cho Trống / Bộ gõ
      const totMag = magM + 0.5 * magS;
      const flux = Math.max(0, totMag - 0.86 * emaTotal[k]);
      emaTotal[k] = 0.65 * emaTotal[k] + 0.35 * totMag;
      const fluxRatio = clamp(flux / (totMag + 1e-8), 0, 1);
      const kickPulse = bassBand[k] * fluxRatio * 1.45;
      const hitBody = (1 - bassBand[k]) * Math.pow(fluxRatio, 1.15) * 1.35 + drumAirBand[k] * 0.45;
      mDrumArr[k] = clamp(kickPulse + hitBody, 0, 1);
    }

    // 1. Giọng hát (Vocals: Center Mid + chút không gian Stereo dịu nhẹ)
    applyComplexGainSym(mRe, mIm, wRe, wIm, (k) => mVocArr[k]);
    fftRadix2(wRe, wIm, true);
    for (let i = 0; i < fftSize && start + i < outLen; i++) {
      const val = wRe[i] * win[i];
      vocL[start + i] += val;
      vocR[start + i] += val;
    }

    // 2. Nhạc nền (Instrumental: InstMid +- Side)
    applyComplexGainSym(mRe, mIm, wRe, wIm, (k) => mInstMidArr[k]);
    fftRadix2(wRe, wIm, true);
    fftRadix2(sRe, sIm, true); // Dùng trực tiếp sRe để tiết kiệm cấp phát mảng cho Side
    for (let i = 0; i < fftSize && start + i < outLen; i++) {
      const midPart = wRe[i] * win[i];
      const sidePart = sRe[i] * win[i];
      const vSideBleed = 0.22 * midPart; // giữ không gian ấm vừa phải
      instL[start + i] += midPart + sidePart;
      instR[start + i] += midPart - sidePart;
      if (isStereo) {
        vocL[start + i] += 0.14 * sidePart;
        vocR[start + i] -= 0.14 * sidePart;
        void vSideBleed;
      }
    }

    // Phục hồi lại sRe bằng FFT? Không cần vì Bass & Drums chỉ dùng Mid+Side đã tổng hợp!
    // Hoặc lấy bass từ Mid * bassBand (vì Sub Bass 99% nằm ở Center/Mono!):
    applyComplexGainSym(mRe, mIm, wRe, wIm, (k) => bassBand[k]);
    fftRadix2(wRe, wIm, true);
    for (let i = 0; i < fftSize && start + i < outLen; i++) {
      const bVal = wRe[i] * win[i];
      bassL[start + i] += bVal;
      bassR[start + i] += bVal;
    }

    // 4. Trống (Drums Transient Flux từ Mid)
    applyComplexGainSym(mRe, mIm, wRe, wIm, (k) => mDrumArr[k]);
    fftRadix2(wRe, wIm, true);
    for (let i = 0; i < fftSize && start + i < outLen; i++) {
      const dVal = wRe[i] * win[i];
      drumL[start + i] += dVal;
      drumR[start + i] += dVal;
    }

    if (frameIdx % 140 === 0) {
      if (onProgress) {
        onProgress(Math.min(98, Math.round((frameIdx / totalOutFrames) * 100)));
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const buildBuf = (lArr, rArr) => {
    softLimitPcm(lArr, 0.94);
    softLimitPcm(rArr, 0.94);
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
      vocals:       { label: 'Giọng hát (Vocal)',    color: '#EC4899', volume: 90, muted: false, solo: false },
      instrumental: { label: 'Nhạc nền (Karaoke)',   color: '#67E8F9', volume: 85, muted: false, solo: false },
      bass:         { label: 'Bass & Sub',           color: '#A78BFA', volume: 85, muted: false, solo: false },
      drums:        { label: 'Trống & Bộ gõ',        color: '#F97316', volume: 85, muted: false, solo: false },
    };

    this.playCtx = null;
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this._playStartCtxTime = 0;
    this._playStartOffset = 0;
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

  _syncLiveStemGains() {
    if (!this.playCtx) return;
    const now = this.playCtx.currentTime;
    Object.keys(this.stemMixer).forEach((key) => {
      const node = this._stemGainNodes[key];
      if (!node) return;
      const audible = this._isStemAudible(key);
      const val = audible ? Math.pow(this.stemMixer[key].volume / 100, 1.45) : 0;
      node.gain.setTargetAtTime(val, now, 0.015);
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

    const ctx = this._ensurePlayCtx();
    if (ctx.state !== 'running') {
      await Promise.race([
        Promise.resolve().then(() => ctx.resume()).catch(() => {}),
        new Promise((r) => setTimeout(r, 700)),
      ]);
    }
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
      const val = this._isStemAudible(key) ? Math.pow(this.stemMixer[key].volume / 100, 1.45) : 0;
      g.gain.value = val;
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
        ? 'Nguồn Stereo chuẩn · Mid/Side + Spectral DSP'
        : 'Nguồn Mono · Tách theo dải tần phổ & Transient';

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
        this._syncLiveStemGains();
      });
    });

    this.root.querySelectorAll('[data-stem-mute]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.stemMute;
        if (!this.stemMixer[key]) return;
        this.stemMixer[key].muted = !this.stemMixer[key].muted;
        btn.classList.toggle('active-mute', this.stemMixer[key].muted);
        this._syncLiveStemGains();
      });
    });

    this.root.querySelectorAll('[data-stem-solo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.stemSolo;
        if (!this.stemMixer[key]) return;
        this.stemMixer[key].solo = !this.stemMixer[key].solo;
        btn.classList.toggle('active-solo', this.stemMixer[key].solo);
        this._syncLiveStemGains();
      });
    });

    this.root.querySelectorAll('[data-stem-dl]').forEach((btn) => {
      btn.addEventListener('click', () => this._downloadStem(btn.dataset.stemDl));
    });

    q('#stem-btn-send-arr')?.addEventListener('click', () => {
      if (!this.stems || !this.cb.onSendStemsToPlaylist) return;
      this.stopPlayback();
      const bpm = this.analysis ? this.analysis.bpmInfo.bpm : 100;
      const items = Object.entries(this.stemMixer).map(([key, st], idx) => ({
        name: `${st.label} (${this.sourceName})`,
        sourceType: key === 'vocals' ? 'vocal' : 'studio',
        audioBuffer: this.stems[key],
        bpm,
        color: st.color,
        suggestedTrackIndex: idx % 4,
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
