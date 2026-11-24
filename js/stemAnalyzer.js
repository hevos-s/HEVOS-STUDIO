// ============================================================================
// stemAnalyzer.js — Công cụ Phân tích Tông (Key), BPM & Dòng thời gian Hợp âm
// - Chạy 100% Browser-Native trên trình duyệt qua Web Audio API & Radix-2 FFT
// - Đồng bộ phát nhạc gốc với đèn Hợp âm, tua theo ô hợp âm & đẩy sang Beat / Đàn / Playlist
// ============================================================================

import { detectKeyFromAudioBuffer } from './autoTune.js?v=40';
import { SCALES, getScaleSet, pcToNoteName, shouldPreferFlats } from './theory.js?v=40';

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

// ============================================================================
// Giao diện Công Cụ Phân Tích Hợp Âm & Tông 100% Browser-Native
// ============================================================================
export class StemAnalyzerStudio {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    this.cb = callbacks; // { renderStudioBeat, onSendAudioToPlaylist, onApplyChordsToStudio, onPracticeChordsInTrainer, showToast }
    this.sourceBuffer = null;
    this.sourceName = '';
    this.analysis = null;

    this.isProcessing = false;
    this.progressPct = 0;
    this.statusText = '';
    this.errorMessage = '';

    this.playCtx = null;
    this.isPlaying = false;
    this.currentTimeSec = 0;
    this._playStartCtxTime = 0;
    this._playStartOffset = 0;
    this._playSeq = 0;
    this._activeSource = null;
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

  _getPlaybackDurationSec() {
    return this.sourceBuffer ? this.sourceBuffer.duration || 0 : 0;
  }

  _getCurrentChordAt(sec) {
    const tl = this.analysis && Array.isArray(this.analysis.timeline) ? this.analysis.timeline : [];
    if (tl.length === 0) return null;
    const t = Math.max(0, Number(sec) || 0);
    for (const item of tl) {
      if (t >= item.startSec && t < item.endSec) return item;
    }
    const last = tl[tl.length - 1];
    if (last && t >= last.startSec) return last;
    return tl[0];
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
      console.error('[HEVOS Analyzer Load File]', err);
      this._toast(`Không giải mã được file "${file.name}".`, true);
    }
  }

  async loadFromStudioBeat() {
    if (!this.cb.renderStudioBeat) return;
    try {
      this._toast('Đang lấy Beat từ Sáng tác Beat để phân tích Tông & Hợp âm...');
      const res = await this.cb.renderStudioBeat();
      if (!res || !res.audioBuffer) {
        this._toast('Chưa có dữ liệu Beat từ Sáng tác Beat.', true);
        return;
      }
      await this.processAudioBuffer(res.audioBuffer, res.name || 'Beat Sáng tác');
    } catch (err) {
      console.error('[HEVOS Analyzer Studio Load]', err);
      this._toast(err.message || 'Lỗi khi lấy Beat để phân tích.', true);
    }
  }

  async processAudioBuffer(audioBuffer, name = 'Audio Track') {
    if (!audioBuffer || this.isProcessing) return;
    this.stopPlayback();
    this.isProcessing = true;
    this.progressPct = 35;
    this.statusText = `Đang phân tích Tông, BPM & Hợp âm cục bộ cho "${name}"...`;
    this.errorMessage = '';
    this.sourceBuffer = audioBuffer;
    this.sourceName = name;
    this.analysis = null;
    this.currentTimeSec = 0;
    this._render();

    try {
      await new Promise((r) => setTimeout(r, 20));
      this.analysis = analyzeChordsFromAudioBuffer(audioBuffer);
      this.progressPct = 100;
      this._toast(`Đã phân tích xong Tông, BPM & Dòng thời gian Hợp âm cho "${name}"!`);
    } catch (err) {
      console.error('[HEVOS Analyzer Process]', err);
      this.errorMessage = err.message || 'Lỗi khi phân tích hợp âm cục bộ.';
      this._toast(this.errorMessage, true);
    } finally {
      this.isProcessing = false;
      this.statusText = '';
      this._render();
    }
  }

  async togglePlay() {
    const dur = this._getPlaybackDurationSec();
    if (dur <= 0 || !this.sourceBuffer) return;
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
    if (seq !== this._playSeq || !this.sourceBuffer) return;
    this._stopSources();

    if (this.currentTimeSec >= dur - 0.05) {
      this.currentTimeSec = 0;
    }
    const startOffset = Math.max(0, this.currentTimeSec);
    const now = ctx.currentTime + 0.02;
    this._playStartCtxTime = now;
    this._playStartOffset = startOffset;

    const src = ctx.createBufferSource();
    src.buffer = this.sourceBuffer;
    src.connect(ctx.destination);
    src.start(now, startOffset);
    this._activeSource = src;

    this.isPlaying = true;
    this._syncPlayUI();
    this._startTimelineWatch();
  }

  pausePlayback() {
    this._playSeq += 1;
    if (this.isPlaying && this.playCtx) {
      this.currentTimeSec = Math.min(
        this._getPlaybackDurationSec(),
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
    const dur = this._getPlaybackDurationSec();
    if (dur <= 0) return;
    this.currentTimeSec = clamp(Number(sec) || 0, 0, Math.max(0, dur));
    if (this.isPlaying) {
      this.pausePlayback();
      this.togglePlay();
    } else {
      this._syncPlayUI();
    }
  }

  _stopSources() {
    if (this._activeSource) {
      try { this._activeSource.stop(); } catch (_) {}
      try { this._activeSource.disconnect(); } catch (_) {}
      this._activeSource = null;
    }
  }

  _startTimelineWatch() {
    this._stopTimelineWatch();
    const step = () => {
      this._rafId = null;
      const dur = this._getPlaybackDurationSec();
      if (!this.isPlaying || !this.playCtx || dur <= 0) return;
      const t = this._playStartOffset + Math.max(0, this.playCtx.currentTime - this._playStartCtxTime);
      if (t >= dur) {
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
    const nowChordEl = this.root.querySelector('#stem-now-chord');
    const dur = this._getPlaybackDurationSec();

    if (playBtn) {
      playBtn.textContent = this.isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc gốc';
      playBtn.classList.toggle('playing', this.isPlaying);
    }
    if (scrub && dur > 0) {
      scrub.value = String(Math.round((this.currentTimeSec / dur) * 1000));
    }
    if (timeLbl) {
      timeLbl.textContent = `${formatClock(this.currentTimeSec)} / ${formatClock(dur)}`;
    }

    const activeChord = this._getCurrentChordAt(this.currentTimeSec);
    if (nowChordEl) {
      nowChordEl.innerHTML = activeChord
        ? `Hợp âm hiện tại: <strong class="mono-val">${escapeHtml(activeChord.symbol)}</strong>`
        : 'Chưa phát hiện hợp âm';
    }

    // Tô sáng hợp âm đang phát trên Timeline
    this.root.querySelectorAll('.stem-chord-pill').forEach((pill) => {
      const s = Number(pill.dataset.startSec);
      const e = Number(pill.dataset.endSec);
      pill.classList.toggle('active', this.currentTimeSec >= s && this.currentTimeSec < e);
    });
  }

  _render() {
    if (!this.root) return;

    const processingHtml = this.isProcessing
      ? `
        <div class="stem-progress-box">
          <span id="stem-progress-label" class="stem-progress-label">${escapeHtml(this.statusText || 'Đang phân tích...')} (${this.progressPct}%)</span>
          <div class="stem-progress-track">
            <div id="stem-progress-fill" class="stem-progress-fill" style="width: ${this.progressPct}%"></div>
          </div>
        </div>
      `
      : '';

    const errorBannerHtml =
      this.errorMessage && !this.isProcessing
        ? `<div class="stem-error-note">${escapeHtml(this.errorMessage)}</div>`
        : '';

    let resultHtml = '';
    if (this.analysis && !this.isProcessing) {
      const { keyInfo, bpmInfo, timeline } = this.analysis;
      const playDur = this._getPlaybackDurationSec();

      const chordsTimelineHtml = timeline.length
        ? timeline
            .map(
              (c) => `
            <button type="button" class="stem-chord-pill" data-start-sec="${c.startSec}" data-end-sec="${c.endSec}" title="Bấm để tua nghe đoạn ${formatClock(c.startSec)}">
              <strong class="mono-val">${escapeHtml(c.symbol)}</strong>
              <span class="mono-val">${formatClock(c.startSec)}</span>
            </button>
          `
            )
            .join('')
        : '<span class="stem-empty-msg">Chưa phát hiện đủ hợp âm rõ rệt trong đoạn nhạc này.</span>';

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
              <span class="stem-meta-sub">Thời lượng ${formatClock(playDur)} · Xử lý 100% tại máy</span>
            </div>
            <div class="stem-meta-actions">
              <button type="button" id="stem-btn-apply-chords" class="btn btn-indigo-solid btn-xs">
                Nạp hợp âm vào Sáng tác Beat →
              </button>
              <button type="button" id="stem-btn-practice-chords" class="btn btn-cyan-outline btn-xs">
                Tập đệm ngay bên Phòng Đàn →
              </button>
              <button type="button" id="stem-btn-send-arr" class="btn btn-amber-solid btn-xs">
                Gửi file Audio sang Playlist Dựng bài →
              </button>
            </div>
          </div>

          <div class="stem-player-bar">
            <button type="button" id="stem-btn-rewind" class="btn btn-ghost btn-xs" title="Về đầu đoạn">⏮</button>
            <button type="button" id="stem-btn-play" class="btn btn-cyan-solid btn-xs">
              ${this.isPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc gốc'}
            </button>
            <input type="range" id="stem-scrubber" class="studio-range stem-scrubber" min="0" max="1000" value="0" aria-label="Tua nghe bài nhạc" />
            <span id="stem-time-clock" class="mono-val stem-time-clock">0:00 / ${formatClock(playDur)}</span>
            <span id="stem-now-chord" class="stem-now-chord"></span>
          </div>

          <div class="stem-timeline-section">
            <div class="stem-section-head">
              <span>DÒNG THỜI GIAN HỢP ÂM TỰ ĐỘNG (${timeline.length} chuyển đoạn · Bấm để tua nghe)</span>
              <span class="stem-source-name mono-val">${escapeHtml(this.sourceName)}</span>
            </div>
            <div id="stem-chord-timeline" class="stem-chord-timeline">${chordsTimelineHtml}</div>
          </div>
        </div>
      `;
    } else if (!this.isProcessing) {
      resultHtml = `
        <div class="stem-empty-hero">
          <h3>Phân tích Tông, BPM &amp; Dòng thời gian Hợp âm 100% trên Trình duyệt</h3>
          <p>
            Nạp bài nhạc MP3 / WAV bất kỳ hoặc lấy trực tiếp vòng Beat từ <strong>Sáng tác Beat</strong>. Hệ thống lập tức dò <strong>Tông bài hát</strong>, <strong>BPM</strong>, vẽ <strong>Dòng thời gian Hợp âm</strong> tự động chạy đèn theo nhạc, và cho phép nạp thẳng vòng hợp âm sang <strong>Sáng tác Beat</strong>, <strong>Phòng Đàn 88 phím</strong> hoặc đưa file vào <strong>Playlist Dựng bài</strong>.
          </p>
          <span class="stem-dsp-note">100% Browser-Native Web Audio API &amp; Radix-2 FFT · Không tải file lên máy chủ ngoài</span>
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
          <span class="stem-dsp-badge is-ready">100% Browser-Native · Web Audio FFT</span>
        </div>

        ${processingHtml}
        ${errorBannerHtml}
        ${resultHtml}
      </div>
    `;

    this._bindEvents();
    if (this.analysis && !this.isProcessing) {
      this._syncPlayUI();
    }
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
      const dur = this._getPlaybackDurationSec();
      if (dur <= 0) return;
      const ratio = Number(e.target.value) / 1000;
      this.seekTo(ratio * dur);
    });

    q('#stem-chord-timeline')?.addEventListener('click', (e) => {
      const pill = e.target.closest('.stem-chord-pill');
      if (!pill) return;
      this.seekTo(Number(pill.dataset.startSec) || 0);
    });

    q('#stem-btn-send-arr')?.addEventListener('click', () => {
      if (!this.sourceBuffer || !this.cb.onSendAudioToPlaylist) return;
      this.stopPlayback();
      const bpm = this.analysis ? this.analysis.bpmInfo.bpm : 100;
      this.cb.onSendAudioToPlaylist({
        name: this.sourceName || 'File Audio Phân tích',
        sourceType: 'file',
        audioBuffer: this.sourceBuffer,
        bpm,
      });
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
