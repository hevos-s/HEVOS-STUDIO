// ============================================================================
// vocalStudio.js — Phòng Thu Vocal Độc Lập Hoàn Toàn (Standalone Vocal Booth)
// - Tách biệt 100% khỏi Tone.Transport của mục Sáng tác Beat
// - Track 0: Nhập Beat MP3/WAV/M4A/OGG từ máy, Thu mộc tự do, hoặc Render Beat từ Sáng tác
// - Track 1 (Giọng chính) & Track 2 (Hát bè / Ad-lib): Mic Preamp di động + Auto-Normalize
// - Auto-Tune khóa theo Tông riêng của Phòng thu + 6 Preset 1 chạm + Kệ FX chuyên sâu
// - Xuất Bản Mix Hoàn Chỉnh (.wav) & Xuất Riêng Giọng Hát (.wav) siêu tốc bằng OfflineAudioContext
// ============================================================================

import {
  KEY_OPTIONS,
  SCALES,
  midiToFreq,
  pcToNoteName,
  shouldPreferFlats,
} from './theory.js?v=38';
import {
  VocalCapture,
  encodePcmToWavBlob,
  getDefaultMicGain,
} from './pitchToMidi.js?v=38';
import {
  applyAutoTunePcm,
  detectKeyFromAudioBuffer,
  detectKeyFromPcm,
} from './autoTune.js?v=38';
import {
  generateAccompanimentEvents,
  generateDrumEvents,
  generateMelodyEvents,
} from './audioEngine.js?v=38';
import {
  encodeAudioBufferByFormat,
  encodeAudioBufferToWavBlob,
} from './audioEncode.js?v=38';

export { encodeAudioBufferToWavBlob };

export const VOCAL_PRESETS = [
  {
    id: 'clean',
    name: 'Mộc phòng thu',
    sub: 'Sạch tự nhiên',
    fx: {
      gate: -60,
      hpf: 85,
      lpf: 18000,
      eqLow: -1,
      eqMid: 1,
      eqHigh: 2,
      comp: 32,
      dist: 0,
      pitch: 0,
      chorus: 0,
      reverbMix: 14,
      reverbDecay: 1.2,
      delayMix: 0,
      delayDiv: '8n',
    },
    autoTune: { enabled: false, strength: 35 },
  },
  {
    id: 'ballad',
    name: 'Ballad Vang sâu',
    sub: 'Ấm · Reverb sâu',
    fx: {
      gate: -54,
      hpf: 90,
      lpf: 16500,
      eqLow: 1,
      eqMid: -1,
      eqHigh: 3,
      comp: 42,
      dist: 0,
      pitch: 0,
      chorus: 0,
      reverbMix: 46,
      reverbDecay: 3.1,
      delayMix: 18,
      delayDiv: '8n.',
    },
    autoTune: { enabled: false, strength: 40 },
  },
  {
    id: 'rnb',
    name: 'R&B / Neo-Soul',
    sub: 'Dày ấm · AT nhẹ',
    fx: {
      gate: -55,
      hpf: 85,
      lpf: 14500,
      eqLow: 3.5,
      eqMid: -1.5,
      eqHigh: 2,
      comp: 52,
      dist: 0,
      pitch: 0,
      chorus: 24,
      reverbMix: 32,
      reverbDecay: 1.9,
      delayMix: 14,
      delayDiv: '8n.',
    },
    autoTune: { enabled: true, strength: 45 },
  },
  {
    id: 'pop',
    name: 'Pop Sáng rõ',
    sub: 'Thoát tiếng · Gọn',
    fx: {
      gate: -52,
      hpf: 105,
      lpf: 19000,
      eqLow: -2.5,
      eqMid: 2,
      eqHigh: 5,
      comp: 58,
      dist: 0,
      pitch: 0,
      chorus: 0,
      reverbMix: 26,
      reverbDecay: 1.6,
      delayMix: 12,
      delayDiv: '8n',
    },
    autoTune: { enabled: false, strength: 45 },
  },
  {
    id: 'melodic',
    name: 'Melodic Auto-Tune',
    sub: 'Ép tông · Delay 1/8',
    fx: {
      gate: -50,
      hpf: 110,
      lpf: 18500,
      eqLow: -2,
      eqMid: 2.5,
      eqHigh: 4.5,
      comp: 64,
      dist: 0,
      pitch: 0,
      chorus: 12,
      reverbMix: 48,
      reverbDecay: 2.8,
      delayMix: 34,
      delayDiv: '8n',
    },
    autoTune: { enabled: true, strength: 88 },
  },
  {
    id: 'lofi',
    name: 'Lo-Fi Radio',
    sub: 'Loa cổ · Ấm nhẹ',
    fx: {
      gate: -58,
      hpf: 380,
      lpf: 3100,
      eqLow: -4,
      eqMid: 5.5,
      eqHigh: -5,
      comp: 68,
      dist: 22,
      pitch: 0,
      chorus: 0,
      reverbMix: 22,
      reverbDecay: 1.4,
      delayMix: 16,
      delayDiv: '8n.',
    },
    autoTune: { enabled: false, strength: 40 },
  },
];

function cloneDefaultFx(presetId = 'clean') {
  const preset = VOCAL_PRESETS.find((p) => p.id === presetId) || VOCAL_PRESETS[0];
  return {
    presetId: preset.id,
    fx: { ...preset.fx, pan: 0 },
    autoTune: { ...preset.autoTune },
  };
}

function formatPanLabel(val) {
  const n = Math.round(Number(val) || 0);
  if (n === 0) return 'C';
  return n < 0 ? `L${Math.abs(n)}` : `R${n}`;
}

function formatSyncLabel(ms) {
  const n = Math.round(Number(ms) || 0);
  return n > 0 ? `+${n}ms` : `${n}ms`;
}

function formatGainDb(gainMult) {
  const db = 20 * Math.log10(Math.max(0.1, gainMult));
  return `${gainMult.toFixed(1)}x (+${db.toFixed(1)}dB)`;
}

export function formatTimeClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

/**
 * Xử lý Noise Gate mượt trên mảng PCM Float32 (attack 4ms, release 45ms)
 */
export function applyNoiseGatePcm(pcm, sampleRate, thresholdDb = -60) {
  if (!pcm || pcm.length === 0 || thresholdDb <= -59) return pcm;
  const threshLin = Math.pow(10, thresholdDb / 20);
  const out = new Float32Array(pcm.length);
  const envAttack = Math.exp(-1 / Math.max(1, sampleRate * 0.004));
  const envRelease = Math.exp(-1 / Math.max(1, sampleRate * 0.045));
  const gainAttack = Math.exp(-1 / Math.max(1, sampleRate * 0.005));
  const gainRelease = Math.exp(-1 / Math.max(1, sampleRate * 0.055));

  let env = 0;
  let gain = 0;
  for (let i = 0; i < pcm.length; i++) {
    const abs = Math.abs(pcm[i]);
    env = abs > env ? envAttack * env + (1 - envAttack) * abs : envRelease * env + (1 - envRelease) * abs;
    const targetGain = env >= threshLin ? 1.0 : Math.pow(env / Math.max(1e-6, threshLin), 2.5);
    gain =
      targetGain > gain
        ? gainAttack * gain + (1 - gainAttack) * targetGain
        : gainRelease * gain + (1 - gainRelease) * targetGain;
    out[i] = pcm[i] * gain;
  }
  return out;
}

/**
 * Dịch cao độ giữ nguyên 100% độ dài thời gian (Dual-Grain Cosine Overlap-Add Pitch Shifter)
 * Giúp đổi màu giọng (-12..+12 bán cung) mà không bao giờ bị trôi lệch nhịp so với Beat
 */
export function applyPitchShiftConstantDurationPcm(pcm, sampleRate, semitones = 0) {
  if (!pcm || pcm.length === 0 || Math.abs(semitones) < 0.05) return pcm;
  const ratio = Math.pow(2, semitones / 12);
  const grainSize = Math.max(256, Math.round(sampleRate * 0.042)); // ~42ms grain
  const rate = 1 - ratio;
  const out = new Float32Array(pcm.length);
  const len = pcm.length;

  let ph = 0;
  const step = Math.abs(rate) / grainSize;

  const readInterp = (pos) => {
    if (pos < 0 || pos >= len - 1) return 0;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    return pcm[idx] * (1 - frac) + pcm[idx + 1] * frac;
  };

  for (let i = 0; i < len; i++) {
    const ph1 = ph % 1;
    const ph2 = (ph + 0.5) % 1;

    const d1 = rate >= 0 ? ph1 * grainSize : (1 - ph1) * grainSize;
    const d2 = rate >= 0 ? ph2 * grainSize : (1 - ph2) * grainSize;

    const w1 = Math.sin(Math.PI * ph1);
    const w2 = Math.sin(Math.PI * ph2);
    const g1 = w1 * w1;
    const g2 = w2 * w2;

    out[i] = readInterp(i - d1) * g1 + readInterp(i - d2) * g2;
    ph += step;
  }
  return out;
}

function makeDistortionCurve(amountPct = 0) {
  const n = 1024;
  const curve = new Float32Array(n);
  if (amountPct <= 0.5) {
    for (let i = 0; i < n; i++) {
      curve[i] = (i * 2) / n - 1;
    }
    return curve;
  }
  const drive = 1 + (amountPct / 100) * 6.5;
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

function createStereoReverbIR(ctx, decaySec = 1.6) {
  const sr = ctx.sampleRate || 44100;
  const dur = Math.max(0.4, Math.min(6.0, Number(decaySec) || 1.6));
  const length = Math.floor(sr * dur);
  const ir = ctx.createBuffer(2, length, sr);
  const preDelaySamples = Math.min(length - 1, Math.floor(sr * 0.014));

  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    let seed = ch === 0 ? 104729 : 224737;
    for (let i = preDelaySamples; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      const white = (seed / 2147483647) * 2 - 1;
      const t = (i - preDelaySamples) / (length - preDelaySamples);
      const env = Math.pow(1 - t, 2.65) * Math.exp(-2.8 * t);
      // Lọc bớt dải cao ở đuôi vang để tiếng vang ấm chuẩn phòng thu
      lp = lp + 0.38 * (white - lp);
      data[i] = lp * env * 0.52;
    }
  }
  return ir;
}

export class VocalStudio {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    this.cb = callbacks;

    this.vocalCapture = new VocalCapture();
    this.playCtx = null;

    // Cài đặt độc lập của Phòng thu Vocal
    this.vocalKeyPc = 3; // Eb mặc định (sẽ tự cập nhật khi Tự dò tông phát hiện giọng hoặc Beat)
    this.vocalScaleType = 'major';
    this.autoKeyEnabled = true;
    this.lastDetectedKeyInfo = null;
    this.vocalBpm = 90;
    this.exportFormat = 'wav';
    this.countInEnabled = true;
    this.metronomeEnabled = false;
    this.monitorEnabled = false;
    this.rackExpanded = false;
    this.activeTrackId = 'lead';

    // Trạng thái Transport độc lập
    this.isSectionActive = false;
    this.isPlaying = false;
    this.isExporting = false;
    this.recordPhase = 'idle'; // 'idle' | 'countin' | 'recording'
    this.recordingTrackId = null;
    this.currentTimeSec = 0;
    this._playStartCtxTime = 0;
    this._playStartOffsetSec = 0;
    this._playTargetDurSec = 0;
    this._recStartOffsetSec = 0;
    this._rafId = null;
    this._lastTimelineDrawMs = 0;
    this._lastVuUpdateMs = 0;
    this._vuEls = null;
    this._countInTimers = [];
    this._countInCancelled = false;
    this._activeSources = [];
    this._liveTrackGraphs = {};
    this._liveBeatGain = null;
    this._atDebounceTimers = { lead: null, backing: null };

    // Dữ liệu vẽ sóng âm trực tiếp khi đang thu
    this._liveWavePeaks = [];
    this._liveWaveSampleAccum = 0;
    this._liveWaveMaxPeak = 0;

    // Track 0: Nguồn Beat Nền
    this.beatTrack = {
      id: 'beat',
      name: '',
      sourceType: 'free', // 'free' | 'file' | 'studio'
      audioBuffer: null,
      durationSec: 0,
      volume: 82,
      muted: false,
      solo: false,
      wavePeaks: null,
    };

    const leadInit = cloneDefaultFx('clean');
    const backInit = cloneDefaultFx('ballad');
    backInit.fx.pan = 18;

    this.tracks = {
      lead: {
        id: 'lead',
        title: 'Track 1 · Giọng chính (Lead Vocal)',
        shortTitle: 'Giọng chính',
        accentClass: 'vs-track-lead',
        waveColor: '#F4F4F5',
        rawPcm: null,
        tunedPcm: null,
        playablePcm: null,
        wavePeaks: null,
        sampleRate: 44100,
        startTimeSec: 0,
        durationSec: 0,
        volume: 88,
        muted: false,
        solo: false,
        syncOffsetMs: 0,
        presetId: leadInit.presetId,
        fx: leadInit.fx,
        autoTune: leadInit.autoTune,
        isProcessingAt: false,
        atReqId: 0,
      },
      backing: {
        id: 'backing',
        title: 'Track 2 · Hát bè / Ad-lib',
        shortTitle: 'Hát bè / Ad-lib',
        accentClass: 'vs-track-backing',
        waveColor: '#A1A1AA',
        rawPcm: null,
        tunedPcm: null,
        playablePcm: null,
        wavePeaks: null,
        sampleRate: 44100,
        startTimeSec: 0,
        durationSec: 0,
        volume: 78,
        muted: false,
        solo: false,
        syncOffsetMs: 0,
        presetId: backInit.presetId,
        fx: backInit.fx,
        autoTune: backInit.autoTune,
        isProcessingAt: false,
        atReqId: 0,
      },
    };

    if (this.root) {
      this._render();
      this._cacheVuElements();
      this._bindEvents();
      this._syncAllUI();
      this.resizeAndRedraw();
    }

    this._onVisibilityChange = () => {
      if (typeof document === 'undefined') return;
      if (document.hidden) {
        if (this._rafId) {
          cancelAnimationFrame(this._rafId);
          this._rafId = null;
        }
      } else if (this.isSectionActive && this.isPlaying) {
        this._startTimelineLoop();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  setSectionActive(active) {
    this.isSectionActive = Boolean(active);
    if (!this.isSectionActive) {
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    } else {
      this.resizeAndRedraw();
      if (this.isPlaying && (typeof document === 'undefined' || !document.hidden)) {
        this._startTimelineLoop();
      }
    }
  }

  _cacheVuElements() {
    if (!this.root) {
      this._vuEls = null;
      return;
    }
    this._vuEls = {
      fill: this.root.querySelector('#vs-vu-fill'),
      peak: this.root.querySelector('#vs-vu-peak'),
      note: this.root.querySelector('#vs-live-note'),
    };
  }

  _ensurePlayContext() {
    const NativeCtx = window.AudioContext || window.webkitAudioContext;
    if (!NativeCtx) {
      throw new Error('Trình duyệt không hỗ trợ Web AudioContext.');
    }
    if (!this.playCtx || this.playCtx.state === 'closed') {
      const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
      if (isDesktop) {
        try {
          this.playCtx = new NativeCtx({ latencyHint: 'playback' });
        } catch (_) {
          this.playCtx = new NativeCtx();
        }
      } else {
        this.playCtx = new NativeCtx();
      }
      this._visualBus = this.playCtx.createGain();
      this._visualAnalyser = this.playCtx.createAnalyser();
      this._visualAnalyser.fftSize = 128;
      this._visualAnalyser.smoothingTimeConstant = 0.72;
      this._visualData = new Uint8Array(this._visualAnalyser.frequencyBinCount);
      this._visualBus.connect(this._visualAnalyser);
      this._visualBus.connect(this.playCtx.destination);
    }
    if (this.playCtx.state !== 'running') {
      try {
        const res = this.playCtx.resume();
        if (res && typeof res.catch === 'function') res.catch(() => {});
        const silentBuf = this.playCtx.createBuffer(1, 1, this.playCtx.sampleRate || 44100);
        const src = this.playCtx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(this.playCtx.destination);
        src.start(0);
      } catch (_) {}
    }
    return this.playCtx;
  }

  getAudioLevel() {
    if (!this.isPlaying || !this._visualAnalyser || !this._visualData) return 0;
    try {
      this._visualAnalyser.getByteFrequencyData(this._visualData);
      let sum = 0;
      const n = this._visualData.length;
      for (let i = 0; i < n; i++) sum += this._visualData[i];
      return Math.min(1, (sum / (n * 255)) * 2.2);
    } catch (_) {
      return 0;
    }
  }

  _getKeyScaleText() {
    const preferFlats = shouldPreferFlats(this.vocalKeyPc, this.vocalScaleType);
    const keyName = pcToNoteName(this.vocalKeyPc, preferFlats);
    const scaleObj = SCALES[this.vocalScaleType] || SCALES.major;
    return `${keyName} ${scaleObj.shortLabel}`;
  }

  _getKeyBadgeText() {
    const base = this._getKeyScaleText();
    if (!this.autoKeyEnabled) {
      return `Khóa tông (Thủ công): ${base}`;
    }
    const info = this.lastDetectedKeyInfo;
    if (info && info.source === 'vocal') {
      const conf = info.confidence ? ` · ~${info.confidence}%` : '';
      return `Tự dò từ giọng: ${base}${conf}`;
    }
    if (info && info.source === 'beat') {
      const conf = info.confidence ? ` · ~${info.confidence}%` : '';
      return `Tự dò từ Beat: ${base}${conf}`;
    }
    if (info && info.source === 'studio') {
      return `Khớp Beat Sáng tác: ${base}`;
    }
    return `Tự dò tông (Sẵn sàng) · Tạm: ${base}`;
  }

  /**
   * Tổng thời lượng trục thời gian (theo Beat nền nếu có, hoặc bản thu giọng dài nhất)
   */
  getTotalTimelineDurationSec() {
    let maxDur = this.beatTrack.audioBuffer ? this.beatTrack.durationSec : 0;
    ['lead', 'backing'].forEach((tid) => {
      const tr = this.tracks[tid];
      if (tr.rawPcm && tr.rawPcm.length > 0) {
        const endSec = (tr.startTimeSec || 0) + tr.rawPcm.length / (tr.sampleRate || 44100);
        if (endSec > maxDur) maxDur = endSec;
      }
    });
    if (this.recordPhase === 'recording' && this.vocalCapture.sampleRate) {
      const liveSec =
        this._recStartOffsetSec +
        this.vocalCapture.totalSamples / (this.vocalCapture.sampleRate || 44100);
      if (liveSec > maxDur) maxDur = liveSec;
    }
    return maxDur;
  }

  _isTrackAudible(trackKey, maskRecordingTrackId = null) {
    if (maskRecordingTrackId && trackKey === maskRecordingTrackId) return false;
    const all = [this.beatTrack, this.tracks.lead, this.tracks.backing];
    const anySolo = all.some((t) => Boolean(t.solo));
    const target = trackKey === 'beat' ? this.beatTrack : this.tracks[trackKey];
    if (!target) return false;
    return !target.muted && (!anySolo || Boolean(target.solo));
  }

  _rebuildWavePeaks(trackId) {
    const tr = this.tracks[trackId];
    if (!tr) return;
    const pcm = tr.autoTune.enabled && tr.tunedPcm ? tr.tunedPcm : tr.rawPcm;
    if (!pcm || pcm.length === 0) {
      tr.wavePeaks = null;
      return;
    }
    const numBins = 360;
    const step = Math.max(1, Math.floor(pcm.length / numBins));
    const peaks = new Float32Array(numBins);
    let maxP = 0.08;
    for (let b = 0; b < numBins; b++) {
      const start = b * step;
      const end = Math.min(pcm.length, start + step);
      const stride = Math.max(1, Math.floor((end - start) / 16));
      let p = 0;
      for (let i = start; i < end; i += stride) {
        const a = Math.abs(pcm[i]);
        if (a > p) p = a;
      }
      peaks[b] = p;
      if (p > maxP) maxP = p;
    }
    for (let b = 0; b < numBins; b++) {
      peaks[b] = peaks[b] / maxP;
    }
    tr.wavePeaks = peaks;
  }

  _rebuildPlayablePcm(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) {
      if (tr) {
        tr.playablePcm = null;
        tr.wavePeaks = null;
      }
      return;
    }
    const hasValidTuned = tr.tunedPcm && typeof tr.tunedPcm.length === 'number' && tr.tunedPcm.length > 0;
    let pcm = tr.autoTune.enabled && hasValidTuned ? tr.tunedPcm : tr.rawPcm;
    if (tr.fx.gate > -59) {
      pcm = applyNoiseGatePcm(pcm, tr.sampleRate, tr.fx.gate);
    }
    if (Math.abs(tr.fx.pitch || 0) >= 0.05) {
      pcm = applyPitchShiftConstantDurationPcm(pcm, tr.sampleRate, tr.fx.pitch);
    }
    tr.playablePcm = pcm;
    tr.durationSec = pcm.length / (tr.sampleRate || 44100);
    this._rebuildWavePeaks(trackId);
  }

  _render() {
    const micGain = this.cb.getMicGain ? this.cb.getMicGain() : getDefaultMicGain();
    const echoCancel = this.cb.getEchoCancellation ? this.cb.getEchoCancellation() : false;

    const keyOptionsHtml = KEY_OPTIONS.map(
      (k) => `<option value="${k.pc}"${k.pc === this.vocalKeyPc ? ' selected' : ''}>${k.label}</option>`
    ).join('');

    const presetsHtml = VOCAL_PRESETS.map(
      (p) => `
      <button type="button" class="vs-preset-btn" data-vs-preset="${p.id}">
        <span class="vs-preset-name">${p.name}</span>
        <span class="vs-preset-sub">${p.sub}</span>
      </button>
    `
    ).join('');

    const tracksHtml = ['lead', 'backing']
      .map((tid) => {
        const tr = this.tracks[tid];
        return `
        <div class="vs-track-card ${tr.accentClass}${tid === this.activeTrackId ? ' selected' : ''}" data-vs-card="${tid}">
          <div class="vs-track-top">
            <button type="button" class="vs-track-select" data-vs-select="${tid}" title="Chọn kênh này để chỉnh Auto-Tune & Hiệu ứng">
              <span class="vs-track-led"></span>
              <span class="vs-track-name">${tr.title}</span>
              <span class="vs-track-badge" id="vs-badge-${tid}">Trống</span>
            </button>
            <div class="vs-track-actions">
              <div class="ms-btns">
                <button type="button" class="ms-btn" data-vs-mute="${tid}" title="Tắt tiếng (Mute)">M</button>
                <button type="button" class="ms-btn" data-vs-solo="${tid}" title="Nghe riêng (Solo)">S</button>
              </div>
              <button type="button" class="btn vs-rec-btn" data-vs-rec="${tid}">
                <span class="rec-dot" aria-hidden="true"></span>
                <span class="vs-rec-label" id="vs-rec-label-${tid}">Thu giọng</span>
              </button>
              <button type="button" class="btn btn-amber-outline btn-xs vs-send-arr-btn" id="vs-send-arr-${tid}" data-vs-send-arr="${tid}" disabled title="Kết xuất giọng hát đã qua Auto-Tune & FX gửi sang Kho Clip Dựng bài & Master">
                <span>→ Dựng bài</span>
              </button>
              <button type="button" class="icon-btn vs-sm-btn" id="vs-dl-${tid}" data-vs-download="${tid}" disabled title="Tải riêng file WAV của track này (đã kèm Auto-Tune & FX)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button type="button" class="icon-btn vs-sm-btn vs-del-btn" id="vs-del-${tid}" data-vs-clear="${tid}" disabled title="Xóa bản thu này">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>
          </div>

          <div class="vs-wave-wrap" data-vs-seek-wave="${tid}" title="Bấm vào sóng âm để tua vị trí phát/thu">
            <canvas class="vs-wave-canvas" id="vs-wave-${tid}" aria-label="Sóng âm ${tr.shortTitle}"></canvas>
            <span class="vs-wave-empty" id="vs-wave-empty-${tid}">Bấm "Thu giọng" để thu âm độc lập (tự động phát Beat nền nếu đã nạp ở Track 0)</span>
          </div>

          <div class="vs-track-sliders">
            <label class="vs-mini-slider">
              <span class="vs-ms-lbl">Âm lượng</span>
              <input type="range" class="studio-range" min="0" max="100" step="1" value="${tr.volume}" data-vs-vol="${tid}" />
              <span class="mono-val vs-ms-val" id="vs-vol-val-${tid}">${tr.volume}%</span>
            </label>
            <label class="vs-mini-slider">
              <span class="vs-ms-lbl">Pan</span>
              <input type="range" class="studio-range" min="-100" max="100" step="1" value="${tr.fx.pan}" data-vs-pan="${tid}" title="Nháy đúp để đưa về giữa (C)" />
              <span class="mono-val vs-ms-val" id="vs-pan-val-${tid}">${formatPanLabel(tr.fx.pan)}</span>
            </label>
            <label class="vs-mini-slider vs-sync-slider" title="Căn lệch nhịp (-500ms đến +500ms) để bù trễ micro điện thoại/tai nghe">
              <span class="vs-ms-lbl">Lệch nhịp</span>
              <input type="range" class="studio-range" min="-500" max="500" step="5" value="${tr.syncOffsetMs}" data-vs-sync="${tid}" />
              <span class="mono-val vs-ms-val" id="vs-sync-val-${tid}">${formatSyncLabel(tr.syncOffsetMs)}</span>
            </label>
          </div>
        </div>
      `;
      })
      .join('');

    this.root.innerHTML = `
      <!-- 1. Thanh Điều Khiển Phòng Thu Vocal Độc Lập (Vocal Transport Bar) -->
      <div class="vs-transport-bar">
        <div class="vs-tp-main">
          <div class="vs-tp-btns">
            <button type="button" class="btn vs-tp-rewind" id="vs-btn-rewind" title="Về đầu bài (00:00.0)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="19,20 9,12 19,4" />
                <rect x="5" y="4" width="2.5" height="16" />
              </svg>
            </button>

            <button type="button" class="btn btn-play vs-tp-play" id="vs-btn-play" title="Phát / Tạm dừng Phòng thu Vocal">
              <svg class="icon-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
              <svg class="icon-stop" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span id="vs-btn-play-label">Phát</span>
            </button>

            <button type="button" class="btn btn-record vs-tp-rec" id="vs-btn-main-rec" title="Thu âm vào Track giọng đang chọn">
              <svg class="icon-mic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="17" x2="12" y2="22" />
                <line x1="8" y1="22" x2="16" y2="22" />
              </svg>
              <span class="rec-dot" aria-hidden="true"></span>
              <span id="vs-btn-main-rec-label">Thu âm</span>
            </button>
          </div>

          <!-- Đồng hồ thời gian & Thanh kéo tua Timeline Scrubber -->
          <div class="vs-scrubber-box">
            <div class="vs-clock-readout mono-val">
              <span id="vs-clock-cur">00:00.0</span>
              <span class="vs-clock-sep">/</span>
              <span id="vs-clock-total">00:00.0</span>
            </div>
            <input type="range" class="studio-range vs-timeline-scrubber" id="vs-timeline-scrubber" min="0" max="1000" step="1" value="0" aria-label="Tua thời gian Phòng thu Vocal" />
          </div>
        </div>

        <div class="vs-tp-options">
          <!-- Đếm vào 3-2-1 -->
          <button type="button" class="toggle-pill active" id="vs-btn-countin" aria-pressed="true" title="Đếm vào 4 nhịp (3-2-1) trước khi bắt đầu thu">
            <span>Đếm vào 3-2-1</span>
          </button>

          <!-- Metronome độc lập + BPM riêng -->
          <div class="vs-metro-cluster">
            <button type="button" class="toggle-pill" id="vs-btn-metronome" aria-pressed="false" title="Bật tiếng gõ nhịp Metronome độc lập khi thu mộc">
              <span>Metronome</span>
            </button>
            <label class="vs-bpm-box" title="Tốc độ BPM riêng của Phòng thu Vocal (dùng cho Metronome & Sync Delay)">
              <span>BPM</span>
              <input type="number" class="studio-input vs-bpm-input mono-val" id="vs-bpm-input" min="40" max="220" step="1" value="${this.vocalBpm}" />
            </label>
          </div>

          <!-- Bộ chọn Tông & Âm giai (hỗ trợ Tự dò tông thông minh từ Giọng / Beat) -->
          <div class="vs-key-cluster">
            <button type="button" class="toggle-pill vs-auto-key-btn active" id="vs-btn-auto-key" aria-pressed="true" title="Tự động nhận diện Tông & Âm giai từ file Beat nền hoặc trực tiếp từ giọng hát mộc của bạn">
              <span class="auto-key-dot" aria-hidden="true"></span>
              <span>Tự dò tông</span>
            </button>
            <label class="inline-field">
              <span class="inline-label">Tông</span>
              <select id="vs-key-select" class="studio-select compact" aria-label="Tông khóa Auto-Tune">${keyOptionsHtml}</select>
            </label>
            <select id="vs-scale-select" class="studio-select compact" aria-label="Âm giai khóa Auto-Tune">
              <option value="major" selected>Trưởng</option>
              <option value="minor">Thứ</option>
            </select>
          </div>

          <!-- Bộ chọn định dạng (.WAV / .MP3) & Xuất Bản Thu Hoàn Chỉnh -->
          <div class="vs-export-btns">
            <div class="export-fmt-switch vs-fmt-switch" id="vs-fmt-switch" role="group" aria-label="Định dạng xuất Vocal">
              <button type="button" class="fmt-pill active" data-vs-fmt="wav">WAV</button>
              <button type="button" class="fmt-pill" data-vs-fmt="mp3">MP3</button>
            </div>
            <button type="button" class="btn btn-cyan-solid vs-export-btn" id="vs-btn-export-mix" title="Trộn Beat nền + Giọng chính + Hát bè (đã qua Auto-Tune & FX) theo định dạng đã chọn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span id="vs-export-mix-label">Xuất Bản Mix (.wav)</span>
            </button>
            <button type="button" class="btn btn-indigo-outline vs-export-btn" id="vs-btn-export-vocal-only" title="Chỉ xuất riêng phần giọng hát đã qua Auto-Tune & FX theo định dạng đã chọn">
              <span id="vs-export-vocal-label">Xuất Riêng Giọng (.wav)</span>
            </button>
            <button type="button" class="btn btn-amber-outline vs-export-btn vs-send-vocal-top-btn" id="vs-btn-send-vocal-arr" title="Kết xuất toàn bộ giọng hát đã qua Auto-Tune & FX rồi đưa sang Kho Clip & Timeline của Dựng bài & Master">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              <span id="vs-send-vocal-arr-label">Gửi Vocal sang Dựng bài →</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Thanh Preamp Micro & Kiểm tra tín hiệu -->
      <div class="vs-input-strip">
        <div class="vs-vu-block">
          <span class="vs-tag-label">MIC PREAMP</span>
          <div class="vs-vu-meter" title="Đồng hồ VU đầu vào Micro">
            <div class="vs-vu-fill" id="vs-vu-fill"></div>
            <div class="vs-vu-peak" id="vs-vu-peak"></div>
          </div>
          <span class="live-pitch-chip" id="vs-live-note">Nốt: <strong>—</strong></span>
        </div>

        <div class="vs-input-controls">
          <label class="vs-gain-ctrl" title="Tăng độ nhạy Preamp phần mềm (mặc định 2.6x trên điện thoại để hát nhẹ vẫn rõ)">
            <span class="vs-ctrl-lbl">Độ nhạy Mic</span>
            <input type="range" class="studio-range" id="vs-mic-gain" min="1.0" max="5.0" step="0.1" value="${micGain.toFixed(1)}" />
            <span class="mono-val vs-gain-val" id="vs-mic-gain-val">${formatGainDb(micGain)}</span>
          </label>

          <button type="button" class="toggle-pill vs-monitor-btn" id="vs-btn-monitor" aria-pressed="false" title="Nghe giọng trực tiếp khi thu">
            <span>Nghe trực tiếp</span>
          </button>

          <label class="mini-check" title="Khử vọng loa nếu không đeo tai nghe">
            <input type="checkbox" id="vs-chk-echo" ${echoCancel ? 'checked' : ''} />
            <span>Khử vọng</span>
          </label>
        </div>

        <div class="vs-monitor-hint">
          <span>💡 Phòng thu Vocal hoạt động <strong>độc lập hoàn toàn</strong> với mục Sáng tác Beat. <strong>Chỉ bật "Nghe trực tiếp" khi đeo tai nghe có dây</strong> để tránh hú loa.</span>
        </div>
      </div>

      <!-- 3. Track 0 — Nguồn Beat Nền Linh Hoạt (Nhập file MP3/WAV | Thu mộc | Lấy vòng beat từ Sáng tác) -->
      <div class="vs-beat-card" id="vs-beat-dropzone">
        <div class="vs-beat-header">
          <div class="vs-beat-title-group">
            <span class="vs-track-led vs-led-beat"></span>
            <span class="vs-track-name">Track 0 · Nguồn Beat Nền (Backing Track)</span>
            <span class="vs-track-badge" id="vs-beat-badge">Chế độ: Thu mộc tự do</span>
          </div>

          <div class="vs-beat-source-btns">
            <input type="file" id="vs-beat-file-input" class="hidden" accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac" />
            <button type="button" class="btn btn-indigo-solid btn-xs" id="vs-btn-upload-beat">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Nhập Beat từ máy (MP3/WAV)</span>
            </button>

            <button type="button" class="btn btn-ghost btn-xs" id="vs-btn-free-mode" title="Thu hát mộc tự do không dùng nhạc nền (không giới hạn thời gian)">
              <span>Thu mộc (Không dùng beat)</span>
            </button>

            <button type="button" class="btn btn-cyan-outline btn-xs" id="vs-btn-import-studio-beat" title="Kết xuất 4 vòng lặp từ mục Sáng tác Beat nạp vào làm Beat nền">
              <span>Dùng vòng beat bên Sáng tác</span>
            </button>
          </div>
        </div>

        <div class="vs-wave-wrap vs-beat-wave-wrap" data-vs-seek-wave="beat" title="Kéo thả file nhạc (.mp3, .wav, .m4a, .ogg) vào đây hoặc bấm để tua thời gian">
          <canvas class="vs-wave-canvas" id="vs-wave-beat" aria-label="Sóng âm Beat nền"></canvas>
          <span class="vs-wave-empty" id="vs-wave-empty-beat">Chưa nạp Beat — Bạn có thể bấm "Thu giọng" để hát mộc tự do ngay, hoặc bấm "Nhập Beat từ máy (MP3/WAV)" / kéo thả file nhạc vào đây</span>
        </div>

        <div class="vs-beat-controls">
          <label class="vs-mini-slider vs-beat-vol-slider">
            <span class="vs-ms-lbl">Âm lượng Beat</span>
            <input type="range" class="studio-range" id="vs-beat-vol" min="0" max="100" step="1" value="${this.beatTrack.volume}" />
            <span class="mono-val vs-ms-val" id="vs-beat-vol-val">${this.beatTrack.volume}%</span>
          </label>
          <div class="ms-btns">
            <button type="button" class="ms-btn" data-vs-mute="beat" title="Tắt tiếng Beat nền">M</button>
            <button type="button" class="ms-btn" data-vs-solo="beat" title="Nghe riêng Beat nền">S</button>
          </div>
          <button type="button" class="btn btn-amber-outline btn-xs" id="vs-btn-send-beat-arr" disabled title="Gửi Beat nền Track 0 sang Kho Clip Dựng bài & Master">
            <span>Gửi Beat sang Dựng bài →</span>
          </button>
          <button type="button" class="btn btn-rose-outline btn-xs" id="vs-btn-clear-beat" disabled title="Xóa Beat nền hiện tại để đổi bài khác hoặc về chế độ Thu mộc">
            <span>Xóa / Đổi Beat</span>
          </button>
        </div>
      </div>

      <!-- 4. Bàn thu 2 kênh Giọng hát độc lập (Track 1 · Giọng chính & Track 2 · Hát bè) -->
      <div class="vs-tracks-grid">
        ${tracksHtml}
      </div>

      <!-- 5. Bảng chỉnh Kênh đang chọn: Auto-Tune khóa tông + Preset 1 chạm + Kệ Hiệu ứng -->
      <div class="vs-fx-shell">
        <div class="vs-editing-banner">
          <span class="vs-edit-dot" id="vs-edit-dot"></span>
          <span class="vs-edit-title" id="vs-edit-title">Đang chỉnh hiệu ứng: Track 1 · Giọng chính (Lead Vocal)</span>
          <div class="vs-track-pills">
            <button type="button" class="seg-btn active" data-vs-select="lead">Track 1 · Chính</button>
            <button type="button" class="seg-btn" data-vs-select="backing">Track 2 · Bè</button>
          </div>
        </div>

        <!-- Auto-Tune khóa tông -->
        <div class="vs-autotune-bar">
          <div class="vs-at-left">
            <label class="switch-toggle">
              <input type="checkbox" id="vs-at-enabled" />
              <span class="switch-track"></span>
            </label>
            <div class="vs-at-titles">
              <span class="vs-at-name">Auto-Tune (Chỉnh phô giọng hát)</span>
              <span class="vs-at-key-badge" id="vs-at-key-badge">${this._getKeyBadgeText()}</span>
            </div>
          </div>

          <div class="vs-at-right">
            <span class="vs-at-status hidden" id="vs-at-status">Đang chỉnh Auto-Tune...</span>
            <label class="vs-at-strength">
              <span>Độ ép tông</span>
              <input type="range" class="studio-range" id="vs-at-strength" min="0" max="100" step="1" value="35" />
              <span class="mono-val" id="vs-at-strength-val">35%</span>
            </label>
          </div>
        </div>

        <!-- Cấp 1: 6 Preset Phòng thu 1 chạm -->
        <div class="vs-presets-section">
          <div class="vs-subhead">
            <span>PRESET CHẤT GIỌNG (1 CHẠM)</span>
            <span class="vs-subhead-note" id="vs-preset-status">Đang dùng: Mộc phòng thu</span>
          </div>
          <div class="vs-presets-grid" id="vs-presets-grid">
            ${presetsHtml}
          </div>
        </div>

        <!-- Cấp 2: Kệ Hiệu ứng Chuyên sâu (Đóng mở gọn) -->
        <div class="vs-rack-wrap">
          <button type="button" class="vs-rack-toggle" id="vs-rack-toggle" aria-expanded="false">
            <span>Kệ hiệu ứng chuyên sâu (Noise Gate · 3-Band EQ · Compressor · Pitch · Reverb · Sync Delay)</span>
            <span class="vs-rack-arrow" id="vs-rack-arrow">▼ Mở rộng</span>
          </button>

          <div class="vs-rack-body hidden" id="vs-rack-body">
            <div class="vs-rack-grid">
              <!-- Module 1: Noise Gate & Compressor -->
              <div class="vs-rack-mod">
                <div class="vs-mod-title">ĐỘ SẠCH &amp; NÉN GIỌNG</div>
                <label class="vs-fx-row">
                  <span>Noise Gate (Cắt ồn nền)</span>
                  <input type="range" class="studio-range" id="vs-fx-gate" min="-60" max="-15" step="1" value="-60" />
                  <span class="mono-val" id="vs-fx-gate-val">Tắt</span>
                </label>
                <label class="vs-fx-row">
                  <span>Compressor (Dày đều giọng)</span>
                  <input type="range" class="studio-range" id="vs-fx-comp" min="0" max="100" step="1" value="32" />
                  <span class="mono-val" id="vs-fx-comp-val">32%</span>
                </label>
              </div>

              <!-- Module 2: 3-Band EQ -->
              <div class="vs-rack-mod">
                <div class="vs-mod-title">CHỈNH ÂM SẮC (3-BAND EQ)</div>
                <label class="vs-fx-row">
                  <span>Bass (~180Hz · Ấm dày)</span>
                  <input type="range" class="studio-range" id="vs-fx-eqLow" min="-12" max="12" step="0.5" value="0" />
                  <span class="mono-val" id="vs-fx-eqLow-val">0 dB</span>
                </label>
                <label class="vs-fx-row">
                  <span>Mid (~1.2kHz · Rõ lời)</span>
                  <input type="range" class="studio-range" id="vs-fx-eqMid" min="-12" max="12" step="0.5" value="0" />
                  <span class="mono-val" id="vs-fx-eqMid-val">0 dB</span>
                </label>
                <label class="vs-fx-row">
                  <span>Air (~6kHz · Sáng thoáng)</span>
                  <input type="range" class="studio-range" id="vs-fx-eqHigh" min="-12" max="12" step="0.5" value="0" />
                  <span class="mono-val" id="vs-fx-eqHigh-val">0 dB</span>
                </label>
              </div>

              <!-- Module 3: Đổi tông giọng / Pitch -->
              <div class="vs-rack-mod">
                <div class="vs-mod-title">ĐỔI CHẤT GIỌNG (PITCH)</div>
                <label class="vs-fx-row">
                  <span>Bán cung</span>
                  <input type="range" class="studio-range" id="vs-fx-pitch" min="-12" max="12" step="1" value="0" />
                  <span class="mono-val" id="vs-fx-pitch-val">0 st</span>
                </label>
                <div class="vs-pitch-chips" id="vs-pitch-chips">
                  <button type="button" class="vs-chip" data-vs-pitch="0">Giọng gốc 0</button>
                  <button type="button" class="vs-chip" data-vs-pitch="-3">Trầm sâu -3</button>
                  <button type="button" class="vs-chip" data-vs-pitch="3">Thanh cao +3</button>
                  <button type="button" class="vs-chip" data-vs-pitch="7">Chipmunk +7</button>
                </div>
              </div>

              <!-- Module 4: Reverb & Sync Delay -->
              <div class="vs-rack-mod">
                <div class="vs-mod-title">KHÔNG GIAN (REVERB &amp; SYNC DELAY)</div>
                <label class="vs-fx-row">
                  <span>Độ vang Reverb</span>
                  <input type="range" class="studio-range" id="vs-fx-reverbMix" min="0" max="100" step="1" value="14" />
                  <span class="mono-val" id="vs-fx-reverbMix-val">14%</span>
                </label>
                <label class="vs-fx-row">
                  <span>Độ ngân Decay</span>
                  <input type="range" class="studio-range" id="vs-fx-reverbDecay" min="0.5" max="5.5" step="0.1" value="1.2" />
                  <span class="mono-val" id="vs-fx-reverbDecay-val">1.2s</span>
                </label>
                <label class="vs-fx-row">
                  <span>Tiếng vọng Delay</span>
                  <input type="range" class="studio-range" id="vs-fx-delayMix" min="0" max="100" step="1" value="0" />
                  <span class="mono-val" id="vs-fx-delayMix-val">0%</span>
                </label>
                <div class="vs-delay-divs">
                  <span>Nhịp Delay (khớp BPM):</span>
                  <div class="seg-group" id="vs-delay-div-group">
                    <button type="button" class="seg-btn active" data-vs-delay-div="8n">1/8</button>
                    <button type="button" class="seg-btn" data-vs-delay-div="8n.">1/8.</button>
                    <button type="button" class="seg-btn" data-vs-delay-div="4n">1/4</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    const q = (sel) => this.root.querySelector(sel);
    const qq = (sel) => Array.from(this.root.querySelectorAll(sel));

    // --- 1. Vocal Transport Bar ---
    const btnPlay = q('#vs-btn-play');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        if (this.recordPhase !== 'idle') {
          if (this.recordPhase === 'recording') {
            this.finishTrackRecording();
          } else {
            this.cancelRecording();
          }
          return;
        }
        if (this.isPlaying) {
          this.pausePlayback();
        } else {
          this.startPlayback();
        }
      });
    }

    const btnRewind = q('#vs-btn-rewind');
    if (btnRewind) {
      btnRewind.addEventListener('click', () => {
        this.seekTo(0);
      });
    }

    const btnMainRec = q('#vs-btn-main-rec');
    if (btnMainRec) {
      btnMainRec.addEventListener('click', () => {
        this.toggleRecordActiveTrack();
      });
    }

    const scrubber = q('#vs-timeline-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        const total = this.getTotalTimelineDurationSec();
        if (total <= 0) {
          e.target.value = '0';
          return;
        }
        const ratio = Number(e.target.value) / 1000;
        this.seekTo(ratio * total);
      });
    }

    // Tua trực tiếp khi bấm vào khung Waveform của Beat / Track 1 / Track 2
    qq('[data-vs-seek-wave]').forEach((wrap) => {
      wrap.addEventListener('pointerdown', (e) => {
        if (this.recordPhase !== 'idle') return;
        const total = this.getTotalTimelineDurationSec();
        if (total <= 0) return;
        const rect = wrap.getBoundingClientRect();
        if (rect.width <= 10) return;
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.seekTo(ratio * total);
      });
    });

    const btnCountIn = q('#vs-btn-countin');
    if (btnCountIn) {
      btnCountIn.addEventListener('click', () => {
        this.countInEnabled = !this.countInEnabled;
        btnCountIn.classList.toggle('active', this.countInEnabled);
        btnCountIn.setAttribute('aria-pressed', String(this.countInEnabled));
      });
    }

    const btnMetro = q('#vs-btn-metronome');
    if (btnMetro) {
      btnMetro.addEventListener('click', () => {
        this.metronomeEnabled = !this.metronomeEnabled;
        btnMetro.classList.toggle('active', this.metronomeEnabled);
        btnMetro.setAttribute('aria-pressed', String(this.metronomeEnabled));
        if (this.isPlaying) {
          this.seekTo(this.currentTimeSec);
        }
      });
    }

    const bpmInp = q('#vs-bpm-input');
    if (bpmInp) {
      bpmInp.addEventListener('change', (e) => {
        const val = Math.max(40, Math.min(220, Math.round(Number(e.target.value) || 90)));
        this.vocalBpm = val;
        e.target.value = String(val);
        this._updateLiveFxParams('lead');
        this._updateLiveFxParams('backing');
      });
    }

    const btnAutoKey = q('#vs-btn-auto-key');
    if (btnAutoKey) {
      btnAutoKey.addEventListener('click', () => {
        this.autoKeyEnabled = !this.autoKeyEnabled;
        if (this.autoKeyEnabled) {
          this._runSmartKeyDetection({ notify: true });
        } else {
          this.lastDetectedKeyInfo = null;
          this._syncAutoKeyUI();
          this._toast(`Đã chuyển sang Khóa tông thủ công (${this._getKeyScaleText()}).`);
        }
      });
    }

    const keySel = q('#vs-key-select');
    if (keySel) {
      keySel.addEventListener('change', (e) => {
        this.vocalKeyPc = Number(e.target.value) || 0;
        this.autoKeyEnabled = false;
        this.lastDetectedKeyInfo = null;
        this._syncAutoKeyUI();
        this._onVocalKeyOrScaleChanged();
      });
    }

    const scaleSel = q('#vs-scale-select');
    if (scaleSel) {
      scaleSel.addEventListener('change', (e) => {
        this.vocalScaleType = e.target.value === 'minor' ? 'minor' : 'major';
        this.autoKeyEnabled = false;
        this.lastDetectedKeyInfo = null;
        this._syncAutoKeyUI();
        this._onVocalKeyOrScaleChanged();
      });
    }

    // Chọn định dạng xuất (.WAV / .MP3) & 2 Nút Xuất Mix / Xuất Riêng Giọng
    qq('[data-vs-fmt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.exportFormat = btn.dataset.vsFmt === 'mp3' ? 'mp3' : 'wav';
        this._syncExportFormatUI();
      });
    });

    const btnExportMix = q('#vs-btn-export-mix');
    if (btnExportMix) {
      btnExportMix.addEventListener('click', () => this.exportWavMixdown({ vocalOnly: false }));
    }

    const btnExportVocal = q('#vs-btn-export-vocal-only');
    if (btnExportVocal) {
      btnExportVocal.addEventListener('click', () => this.exportWavMixdown({ vocalOnly: true }));
    }

    const btnSendVocalArr = q('#vs-btn-send-vocal-arr');
    if (btnSendVocalArr) {
      btnSendVocalArr.addEventListener('click', () => this._sendAllVocalsToArrangement());
    }

    // --- 2. Track 0: Nguồn Beat Nền ---
    const btnUploadBeat = q('#vs-btn-upload-beat');
    const fileInput = q('#vs-beat-file-input');
    if (btnUploadBeat && fileInput) {
      btnUploadBeat.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          this.loadExternalBeatFile(file);
        }
        fileInput.value = '';
      });
    }

    const dropzone = q('#vs-beat-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) {
          this.loadExternalBeatFile(file);
        }
      });
    }

    const btnFreeMode = q('#vs-btn-free-mode');
    if (btnFreeMode) {
      btnFreeMode.addEventListener('click', () => {
        this.clearBeatTrack(true);
      });
    }

    const btnImportStudio = q('#vs-btn-import-studio-beat');
    if (btnImportStudio) {
      btnImportStudio.addEventListener('click', () => {
        this.importBeatFromStudio();
      });
    }

    const btnClearBeat = q('#vs-btn-clear-beat');
    if (btnClearBeat) {
      btnClearBeat.addEventListener('click', () => {
        this.clearBeatTrack(true);
      });
    }

    const btnSendBeatArr = q('#vs-btn-send-beat-arr');
    if (btnSendBeatArr) {
      btnSendBeatArr.addEventListener('click', () => {
        this._sendBeatToArrangement();
      });
    }

    const beatVolInp = q('#vs-beat-vol');
    if (beatVolInp) {
      beatVolInp.addEventListener('input', (e) => {
        this.beatTrack.volume = Number(e.target.value);
        const lbl = q('#vs-beat-vol-val');
        if (lbl) lbl.textContent = `${this.beatTrack.volume}%`;
        this._applyLiveTrackVolumes();
      });
    }

    // Mute / Solo trên cả 3 track (beat, lead, backing)
    qq('[data-vs-mute]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tid = btn.dataset.vsMute;
        const target = tid === 'beat' ? this.beatTrack : this.tracks[tid];
        if (!target) return;
        target.muted = !target.muted;
        this._syncMuteSoloButtons();
        this._applyLiveTrackVolumes();
      });
    });

    qq('[data-vs-solo]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tid = btn.dataset.vsSolo;
        const target = tid === 'beat' ? this.beatTrack : this.tracks[tid];
        if (!target) return;
        target.solo = !target.solo;
        this._syncMuteSoloButtons();
        this._applyLiveTrackVolumes();
      });
    });

    // --- 3. Chọn Track 1 / Track 2, Thu âm, Tải WAV, Xóa ---
    qq('[data-vs-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.vsSelect;
        if (tid && this.tracks[tid]) {
          this.activeTrackId = tid;
          this._syncAllUI();
        }
      });
    });

    qq('[data-vs-rec]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tid = btn.dataset.vsRec;
        if (this.recordPhase !== 'idle') {
          if (this.recordingTrackId === tid && this.recordPhase === 'recording') {
            this.finishTrackRecording();
          } else {
            this.cancelRecording();
            this._toast('Đã hủy thu âm giọng hát.');
          }
          return;
        }
        this.startTrackRecording(tid);
      });
    });

    qq('[data-vs-download]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._downloadSingleTrackWav(btn.dataset.vsDownload);
      });
    });

    qq('[data-vs-send-arr]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._sendVocalTrackToArrangement(btn.dataset.vsSendArr);
      });
    });

    qq('[data-vs-clear]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._clearTrack(btn.dataset.vsClear);
      });
    });

    // --- 4. Mic Preamp Controls ---
    const micGainInp = q('#vs-mic-gain');
    if (micGainInp) {
      micGainInp.addEventListener('input', (e) => {
        const val = Number(e.target.value);
        this.vocalCapture.setMicGain(val);
        if (this.cb.setMicGain) this.cb.setMicGain(val);
        const lbl = q('#vs-mic-gain-val');
        if (lbl) lbl.textContent = formatGainDb(val);
      });
    }

    const monitorBtn = q('#vs-btn-monitor');
    if (monitorBtn) {
      monitorBtn.addEventListener('click', () => {
        this.monitorEnabled = !this.monitorEnabled;
        monitorBtn.classList.toggle('active', this.monitorEnabled);
        monitorBtn.setAttribute('aria-pressed', String(this.monitorEnabled));
        this.vocalCapture.setMonitor(this.monitorEnabled);
        if (this.monitorEnabled) {
          this._toast('Đã bật Nghe trực tiếp — hãy chắc chắn bạn đang đeo tai nghe có dây!');
        }
      });
    }

    const echoChk = q('#vs-chk-echo');
    if (echoChk) {
      echoChk.addEventListener('change', (e) => {
        if (this.cb.setEchoCancellation) this.cb.setEchoCancellation(e.target.checked);
      });
    }

    // --- 5. Thanh trượt trên từng Track Card: Âm lượng, Pan, Lệch nhịp (-500..+500ms) ---
    qq('[data-vs-vol]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const tid = e.target.dataset.vsVol;
        const val = Number(e.target.value);
        const tr = this.tracks[tid];
        if (!tr) return;
        tr.volume = val;
        const lbl = q(`#vs-vol-val-${tid}`);
        if (lbl) lbl.textContent = `${val}%`;
        this._applyLiveTrackVolumes();
      });
    });

    qq('[data-vs-pan]').forEach((inp) => {
      const updatePan = (val) => {
        const tid = inp.dataset.vsPan;
        const tr = this.tracks[tid];
        if (!tr) return;
        tr.fx.pan = val;
        const lbl = q(`#vs-pan-val-${tid}`);
        if (lbl) lbl.textContent = formatPanLabel(val);
        this._updateLiveFxParams(tid);
      };
      inp.addEventListener('input', (e) => updatePan(Number(e.target.value)));
      inp.addEventListener('dblclick', () => {
        inp.value = '0';
        updatePan(0);
      });
    });

    qq('[data-vs-sync]').forEach((inp) => {
      const updateSync = (val) => {
        const tid = inp.dataset.vsSync;
        const tr = this.tracks[tid];
        if (!tr) return;
        tr.syncOffsetMs = Math.max(-500, Math.min(500, val));
        const lbl = q(`#vs-sync-val-${tid}`);
        if (lbl) lbl.textContent = formatSyncLabel(tr.syncOffsetMs);
        if (this.isPlaying) {
          this.seekTo(this.currentTimeSec);
        }
      };
      inp.addEventListener('input', (e) => updateSync(Number(e.target.value)));
      inp.addEventListener('dblclick', () => {
        inp.value = '0';
        updateSync(0);
      });
    });

    // --- 6. Auto-Tune, 6 Presets & Kệ FX Chuyên Sâu ---
    const atToggle = q('#vs-at-enabled');
    if (atToggle) {
      atToggle.addEventListener('change', (e) => {
        const tr = this.tracks[this.activeTrackId];
        tr.autoTune.enabled = e.target.checked;
        this._scheduleAutoTuneReprocess(tr.id, 40);
      });
    }

    const atStrength = q('#vs-at-strength');
    if (atStrength) {
      atStrength.addEventListener('input', (e) => {
        const tr = this.tracks[this.activeTrackId];
        const val = Number(e.target.value);
        tr.autoTune.strength = val;
        const lbl = q('#vs-at-strength-val');
        if (lbl) lbl.textContent = `${val}%`;
        if (tr.autoTune.enabled) {
          this._scheduleAutoTuneReprocess(tr.id, 160);
        }
      });
    }

    qq('[data-vs-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._applyPresetToActiveTrack(btn.dataset.vsPreset);
      });
    });

    const rackToggle = q('#vs-rack-toggle');
    if (rackToggle) {
      rackToggle.addEventListener('click', () => {
        this.rackExpanded = !this.rackExpanded;
        rackToggle.setAttribute('aria-expanded', String(this.rackExpanded));
        const body = q('#vs-rack-body');
        const arrow = q('#vs-rack-arrow');
        if (body) body.classList.toggle('hidden', !this.rackExpanded);
        if (arrow) arrow.textContent = this.rackExpanded ? '▲ Thu gọn' : '▼ Mở rộng';
      });
    }

    const bindFxSlider = (id, fxKey, formatter, requiresBufferRebuild = false, extraHook = null) => {
      const inp = q(`#${id}`);
      if (!inp) return;
      inp.addEventListener('input', (e) => {
        const tr = this.tracks[this.activeTrackId];
        const val = Number(e.target.value);
        tr.fx[fxKey] = val;
        tr.presetId = 'custom';
        const lbl = q(`#${id}-val`);
        if (lbl) lbl.textContent = formatter(val);
        this._syncPresetHighlight();
        if (requiresBufferRebuild) {
          this._rebuildPlayablePcm(tr.id);
          if (this.isPlaying) this.seekTo(this.currentTimeSec);
        } else {
          this._updateLiveFxParams(tr.id);
        }
        if (extraHook) extraHook(val);
      });
    };

    bindFxSlider('vs-fx-gate', 'gate', (v) => (v <= -59 ? 'Tắt' : `${Math.round(v)} dB`), true);
    bindFxSlider('vs-fx-comp', 'comp', (v) => `${Math.round(v)}%`);
    bindFxSlider('vs-fx-eqLow', 'eqLow', (v) => `${v > 0 ? '+' : ''}${v} dB`);
    bindFxSlider('vs-fx-eqMid', 'eqMid', (v) => `${v > 0 ? '+' : ''}${v} dB`);
    bindFxSlider('vs-fx-eqHigh', 'eqHigh', (v) => `${v > 0 ? '+' : ''}${v} dB`);
    bindFxSlider(
      'vs-fx-pitch',
      'pitch',
      (v) => `${v > 0 ? '+' : ''}${v} st`,
      true,
      () => this._syncPitchChipHighlight()
    );
    bindFxSlider('vs-fx-reverbMix', 'reverbMix', (v) => `${Math.round(v)}%`);
    bindFxSlider('vs-fx-reverbDecay', 'reverbDecay', (v) => `${v.toFixed(1)}s`);
    bindFxSlider('vs-fx-delayMix', 'delayMix', (v) => `${Math.round(v)}%`);

    qq('[data-vs-pitch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = this.tracks[this.activeTrackId];
        const val = Number(btn.dataset.vsPitch);
        tr.fx.pitch = val;
        tr.presetId = 'custom';
        const inp = q('#vs-fx-pitch');
        const lbl = q('#vs-fx-pitch-val');
        if (inp) inp.value = String(val);
        if (lbl) lbl.textContent = `${val > 0 ? '+' : ''}${val} st`;
        this._syncPitchChipHighlight();
        this._syncPresetHighlight();
        this._rebuildPlayablePcm(tr.id);
        if (this.isPlaying) this.seekTo(this.currentTimeSec);
      });
    });

    qq('[data-vs-delay-div]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = this.tracks[this.activeTrackId];
        tr.fx.delayDiv = btn.dataset.vsDelayDiv;
        tr.presetId = 'custom';
        qq('[data-vs-delay-div]').forEach((b) =>
          b.classList.toggle('active', b.dataset.vsDelayDiv === tr.fx.delayDiv)
        );
        this._syncPresetHighlight();
        this._updateLiveFxParams(tr.id);
      });
    });
  }

  _toast(msg, isError = false) {
    if (this.cb.showToast) this.cb.showToast(msg, isError);
  }

  _syncAutoKeyUI() {
    if (!this.root) return;
    const btnAutoKey = this.root.querySelector('#vs-btn-auto-key');
    const keySel = this.root.querySelector('#vs-key-select');
    const scaleSel = this.root.querySelector('#vs-scale-select');
    const atKey = this.root.querySelector('#vs-at-key-badge');

    if (btnAutoKey) {
      btnAutoKey.classList.toggle('active', Boolean(this.autoKeyEnabled));
      btnAutoKey.setAttribute('aria-pressed', String(Boolean(this.autoKeyEnabled)));
    }
    if (keySel) keySel.value = String(this.vocalKeyPc);
    if (scaleSel) scaleSel.value = this.vocalScaleType;
    if (atKey) atKey.textContent = this._getKeyBadgeText();
  }

  _onVocalKeyOrScaleChanged() {
    this._syncAutoKeyUI();
    ['lead', 'backing'].forEach((tid) => {
      const tr = this.tracks[tid];
      if (tr.rawPcm && tr.autoTune.enabled) {
        this._scheduleAutoTuneReprocess(tid, 50);
      }
    });
  }

  async _runSmartKeyDetection({ notify = false } = {}) {
    // 1. Nếu đang có Beat ngoài (MP3/WAV) -> phân tích Chromagram Beat nền
    if (this.beatTrack.audioBuffer && this.beatTrack.sourceType === 'file') {
      const det = detectKeyFromAudioBuffer(this.beatTrack.audioBuffer);
      if (det) {
        this.vocalKeyPc = det.keyPc;
        this.vocalScaleType = det.scaleType;
        this.lastDetectedKeyInfo = {
          source: 'beat',
          confidence: det.confidence,
          label: det.label,
        };
        this._syncAutoKeyUI();
        ['lead', 'backing'].forEach((tid) => {
          if (this.tracks[tid].rawPcm && this.tracks[tid].autoTune.enabled) {
            this._scheduleAutoTuneReprocess(tid, 30);
          }
        });
        if (notify) {
          this._toast(`Tự dò từ Beat nền: ${det.label} (~${det.confidence}%).`);
        }
        return det;
      }
    }

    // 2. Nếu đang dùng Beat từ mục Sáng tác -> đồng bộ tông chính xác từ Sáng tác Beat
    if (this.beatTrack.audioBuffer && this.beatTrack.sourceType === 'studio' && this.cb.getStudioBeatContext) {
      const ctxInfo = this.cb.getStudioBeatContext();
      if (ctxInfo) {
        this.vocalKeyPc = ctxInfo.keyPc ?? this.vocalKeyPc;
        this.vocalScaleType = ctxInfo.scaleType === 'minor' ? 'minor' : 'major';
        this.lastDetectedKeyInfo = {
          source: 'studio',
          confidence: 100,
          label: this._getKeyScaleText(),
        };
        this._syncAutoKeyUI();
        if (notify) {
          this._toast(`Khớp tông Beat Sáng tác: ${this._getKeyScaleText()}.`);
        }
        return { keyPc: this.vocalKeyPc, scaleType: this.vocalScaleType, confidence: 100 };
      }
    }

    // 3. Nếu đang Thu mộc -> dò trực tiếp ngay lập tức từ bản thu giọng (ưu tiên Track 1 Chính, fallback Track 2 Bè)
    const primaryTid = this.tracks.lead.rawPcm ? 'lead' : this.tracks.backing.rawPcm ? 'backing' : null;
    if (primaryTid) {
      const tr = this.tracks[primaryTid];
      const det = detectKeyFromPcm(tr.rawPcm, tr.sampleRate);
      if (det) {
        this.vocalKeyPc = det.keyPc;
        this.vocalScaleType = det.scaleType;
        this.lastDetectedKeyInfo = {
          source: 'vocal',
          confidence: det.confidence,
          label: det.label,
        };
        this._syncAutoKeyUI();
        if (tr.autoTune.enabled) {
          await this._processTrackAutoTune(primaryTid, notify);
          if (primaryTid === 'lead' && this.tracks.backing.rawPcm && this.tracks.backing.autoTune.enabled) {
            this._processTrackAutoTune('backing', false);
          }
        } else if (notify) {
          this._toast(`Tự dò từ giọng hát: ${det.label} (~${det.confidence}%).`);
        }
        return this.lastDetectedKeyInfo;
      }
      if (tr.autoTune.enabled) {
        await this._processTrackAutoTune(primaryTid, notify);
      }
      return this.lastDetectedKeyInfo;
    }

    this.lastDetectedKeyInfo = null;
    this._syncAutoKeyUI();
    if (notify) {
      this._toast('Đã bật Tự dò tông — sẽ tự nhận diện ngay khi bạn thu giọng hoặc nạp Beat!');
    }
    return null;
  }

  // ============================================================================
  // Quản lý Track 0: Nhập file Beat MP3/WAV, Thu mộc, hoặc Lấy vòng Beat từ Sáng tác
  // ============================================================================
  async loadExternalBeatFile(file) {
    if (!file) return;
    this.stopAll();
    try {
      const ctx = this._ensurePlayContext();
      const arrBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrBuf);
      this._setBeatAudioBuffer(decoded, file.name, 'file');

      let detectMsg = '';
      if (this.autoKeyEnabled) {
        const det = detectKeyFromAudioBuffer(decoded);
        if (det) {
          this.vocalKeyPc = det.keyPc;
          this.vocalScaleType = det.scaleType;
          this.lastDetectedKeyInfo = {
            source: 'beat',
            confidence: det.confidence,
            label: det.label,
          };
          this._syncAutoKeyUI();
          ['lead', 'backing'].forEach((tid) => {
            if (this.tracks[tid].rawPcm && this.tracks[tid].autoTune.enabled) {
              this._scheduleAutoTuneReprocess(tid, 40);
            }
          });
          detectMsg = ` · Tự dò tông: ${det.label} (~${det.confidence}%)`;
        }
      }
      this._toast(`Đã nạp Beat nền "${file.name}" (${formatTimeClock(decoded.duration)})${detectMsg}!`);
    } catch (err) {
      console.error('[HEVOS VocalStudio Beat Decode]', err);
      this._toast('Không thể giải mã file âm thanh này. Hãy thử file .mp3, .wav, .m4a hoặc .ogg.', true);
    }
  }

  _setBeatAudioBuffer(audioBuffer, name, sourceType = 'file') {
    this.beatTrack.audioBuffer = audioBuffer;
    this.beatTrack.name = name || 'Beat nền';
    this.beatTrack.sourceType = sourceType;
    this.beatTrack.durationSec = audioBuffer ? audioBuffer.duration : 0;
    this.beatTrack.muted = false;
    this.currentTimeSec = 0;

    // Tính sẵn mảng đỉnh sóng để vẽ nhanh trên Canvas
    if (audioBuffer && audioBuffer.length > 0) {
      const ch0 = audioBuffer.getChannelData(0);
      const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
      const numBins = 420;
      const step = Math.max(1, Math.floor(ch0.length / numBins));
      const peaks = new Float32Array(numBins);
      let maxP = 0.05;
      for (let b = 0; b < numBins; b++) {
        const start = b * step;
        const end = Math.min(ch0.length, start + step);
        const stride = Math.max(1, Math.floor((end - start) / 24));
        let p = 0;
        for (let i = start; i < end; i += stride) {
          const a = Math.max(Math.abs(ch0[i]), Math.abs(ch1[i]));
          if (a > p) p = a;
        }
        peaks[b] = p;
        if (p > maxP) maxP = p;
      }
      for (let b = 0; b < numBins; b++) {
        peaks[b] = peaks[b] / maxP;
      }
      this.beatTrack.wavePeaks = peaks;
    } else {
      this.beatTrack.wavePeaks = null;
    }

    this._syncBeatTrackUI();
    this._updateTimelineClockUI();
    this.resizeAndRedraw();
  }

  clearBeatTrack(notify = false) {
    this.stopAll();
    this.beatTrack.audioBuffer = null;
    this.beatTrack.name = '';
    this.beatTrack.sourceType = 'free';
    this.beatTrack.durationSec = 0;
    this.beatTrack.wavePeaks = null;
    this.beatTrack.muted = false;
    this.beatTrack.solo = false;
    this.currentTimeSec = 0;
    if (this.autoKeyEnabled) {
      this.lastDetectedKeyInfo = null;
    }
    this._syncBeatTrackUI();
    this._syncAutoKeyUI();
    this._syncMuteSoloButtons();
    this._updateTimelineClockUI();
    this.resizeAndRedraw();
    if (this.autoKeyEnabled) {
      ['lead', 'backing'].forEach((tid) => {
        if (this.tracks[tid].rawPcm && this.tracks[tid].autoTune.enabled) {
          this._scheduleAutoTuneReprocess(tid, 60);
        }
      });
    }
    if (notify) {
      this._toast('Đã chuyển sang chế độ Thu mộc tự do (không giới hạn thời gian).');
    }
  }

  /**
   * Kết xuất nhanh 4 vòng lặp Beat từ phân khu Sáng tác bằng OfflineAudioContext
   * Chỉ chạy khi người dùng chủ động bấm nút "Dùng vòng beat bên Sáng tác"
   */
  async importBeatFromStudio() {
    this.stopAll();
    const studioCtx = this.cb.getContext ? this.cb.getContext() : null;
    if (!studioCtx || !studioCtx.voicedChords || studioCtx.voicedChords.length === 0) {
      this._toast('Chưa có dữ liệu hợp âm bên mục Sáng tác Beat.', true);
      return;
    }

    try {
      const bpm = Math.max(40, Math.min(220, Number(studioCtx.bpm) || 84));
      const totalBars = studioCtx.totalBars === 8 ? 8 : 4;
      const loops = totalBars === 8 ? 2 : 4; // Tổng cộng 16 ô nhịp (~45 giây)
      const beatSec = 60 / bpm;
      const singleLoopBeats = totalBars * 4;
      const singleLoopSec = singleLoopBeats * beatSec;
      const totalSec = singleLoopSec * loops;
      const sr = 44100;
      const OfflineAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineAC) {
        throw new Error('Trình duyệt không hỗ trợ OfflineAudioContext.');
      }
      const offline = new OfflineAC(2, Math.ceil(totalSec * sr), sr);

      const masterGain = offline.createGain();
      masterGain.gain.value = 0.78;
      masterGain.connect(offline.destination);

      const { allEvents: accEvents } = generateAccompanimentEvents({
        voicedChords: studioCtx.voicedChords,
        totalBars,
        bpm,
        chordStyle: studioCtx.chordStyle || 'rnb',
        drumPattern: studioCtx.drumPattern || 'lofi',
        humanize: studioCtx.humanize ?? 50,
      });

      const drumEvents = generateDrumEvents({
        totalBars,
        bpm,
        drumPattern: studioCtx.drumPattern || 'lofi',
        chordStyle: studioCtx.chordStyle || 'rnb',
        humanize: studioCtx.humanize ?? 50,
        customDrumGrid: studioCtx.customDrumGrid || null,
      });

      const melEvents = generateMelodyEvents({
        melodyNotes: studioCtx.melodyNotes || [],
        totalBars,
        bpm,
        humanize: studioCtx.humanize ?? 50,
      });

      // Tổng hợp tiếng đàn (Dark Synth Brass / Stage Pluck / Piano Pop Trầm Ấm / Rhodes) + Bass + Trống trên OfflineAudioContext
      const chordTimbre = studioCtx.chordTimbre || 'rhodes';
      const isWarmModernPiano = chordTimbre === 'modern_piano';
      const isStageSynth = chordTimbre === 'dark_brass' || chordTimbre === 'stage_pluck';
      const scheduleNote = (freq, startSec, durSec, vel, isBass = false) => {
        if (startSec >= totalSec) return;
        const osc = offline.createOscillator();
        const sub = offline.createOscillator();
        const env = offline.createGain();
        const filter = offline.createBiquadFilter();

        osc.type = isBass ? 'triangle' : isStageSynth ? 'sawtooth' : isWarmModernPiano ? 'triangle' : 'sine';
        sub.type = isBass || isWarmModernPiano ? 'sine' : chordTimbre === 'stage_pluck' ? 'square' : isStageSynth ? 'sawtooth' : 'triangle';
        if (!isBass && isStageSynth) {
          osc.detune.setValueAtTime(-8, startSec);
          sub.detune.setValueAtTime(8, startSec);
        }
        osc.frequency.setValueAtTime(freq, startSec);
        sub.frequency.setValueAtTime(
          isBass || isWarmModernPiano ? freq * 0.5 : isStageSynth ? freq : freq * 2,
          startSec
        );

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(
          isBass ? 540 : chordTimbre === 'dark_brass' ? 2350 : chordTimbre === 'stage_pluck' ? 3100 : isWarmModernPiano ? 1650 : 2200,
          startSec
        );
        if (!isBass && isStageSynth) {
          filter.frequency.exponentialRampToValueAtTime(1050, Math.min(totalSec, startSec + 0.18));
        }

        const peak = Math.max(0.02, vel * (isBass ? 0.25 : isWarmModernPiano ? 0.16 : isStageSynth ? 0.125 : 0.14));
        const end = Math.min(totalSec, startSec + Math.max(0.08, durSec));
        env.gain.setValueAtTime(0.0001, startSec);
        env.gain.linearRampToValueAtTime(peak, startSec + (chordTimbre === 'stage_pluck' ? 0.005 : 0.012));
        env.gain.exponentialRampToValueAtTime(peak * (chordTimbre === 'stage_pluck' ? 0.20 : 0.45), Math.min(end, startSec + 0.18));
        env.gain.exponentialRampToValueAtTime(0.0001, end + 0.08);

        const subGain = offline.createGain();
        subGain.gain.value = isBass ? 0.35 : chordTimbre === 'dark_brass' ? 0.60 : chordTimbre === 'stage_pluck' ? 0.30 : isWarmModernPiano ? 0.22 : 0.12;

        osc.connect(filter);
        sub.connect(subGain);
        subGain.connect(filter);
        filter.connect(env);
        env.connect(masterGain);

        osc.start(startSec);
        sub.start(startSec);
        osc.stop(end + 0.09);
        sub.stop(end + 0.09);
      };

      // Buffer nhiễu trắng dùng chung cho snare/hi-hat
      const noiseBuf = offline.createBuffer(1, Math.floor(sr * 0.25), sr);
      const nData = noiseBuf.getChannelData(0);
      let seed = 918273;
      for (let i = 0; i < nData.length; i++) {
        seed = (seed * 16807) % 2147483647;
        nData[i] = (seed / 2147483647) * 2 - 1;
      }

      const scheduleDrum = (type, startSec, vel, openHat = false) => {
        if (startSec >= totalSec) return;
        if (type === 'kick') {
          const osc = offline.createOscillator();
          const env = offline.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(150, startSec);
          osc.frequency.exponentialRampToValueAtTime(42, startSec + 0.09);
          env.gain.setValueAtTime(vel * 0.52, startSec);
          env.gain.exponentialRampToValueAtTime(0.001, startSec + 0.24);
          osc.connect(env);
          env.connect(masterGain);
          osc.start(startSec);
          osc.stop(startSec + 0.25);
        } else if (type === 'clap') {
          [0, 0.013].forEach((offset, layerIdx) => {
            const cStart = startSec + offset;
            if (cStart >= totalSec) return;
            const src = offline.createBufferSource();
            src.buffer = noiseBuf;
            const filter = offline.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(layerIdx === 0 ? 1400 : 1750, cStart);
            const env = offline.createGain();
            const decay = layerIdx === 0 ? 0.065 : 0.135;
            env.gain.setValueAtTime(vel * (layerIdx === 0 ? 0.28 : 0.22), cStart);
            env.gain.exponentialRampToValueAtTime(0.001, cStart + decay);
            src.connect(filter);
            filter.connect(env);
            env.connect(masterGain);
            src.start(cStart);
            src.stop(cStart + decay + 0.015);
          });
        } else if (type === 'crash') {
          const src = offline.createBufferSource();
          src.buffer = noiseBuf;
          src.loop = true;
          const filter = offline.createBiquadFilter();
          filter.type = 'highpass';
          filter.frequency.setValueAtTime(4800, startSec);
          const env = offline.createGain();
          env.gain.setValueAtTime(vel * 0.18, startSec);
          env.gain.exponentialRampToValueAtTime(0.001, startSec + 0.50);
          src.connect(filter);
          filter.connect(env);
          env.connect(masterGain);
          src.start(startSec);
          src.stop(startSec + 0.52);
        } else if (type === 'snare' || type === 'hat') {
          const src = offline.createBufferSource();
          src.buffer = noiseBuf;
          const filter = offline.createBiquadFilter();
          filter.type = type === 'hat' ? 'highpass' : 'bandpass';
          filter.frequency.setValueAtTime(type === 'hat' ? 6800 : 1850, startSec);
          const env = offline.createGain();
          const decay = type === 'hat' ? (openHat ? 0.16 : 0.045) : 0.13;
          env.gain.setValueAtTime(vel * (type === 'hat' ? 0.16 : 0.28), startSec);
          env.gain.exponentialRampToValueAtTime(0.001, startSec + decay);
          src.connect(filter);
          filter.connect(env);
          env.connect(masterGain);
          src.start(startSec);
          src.stop(startSec + decay + 0.02);
        } else if (type === 'rim' || type === 'click' || type === 'clickAccent') {
          const osc = offline.createOscillator();
          const env = offline.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(type === 'clickAccent' ? 1150 : 780, startSec);
          env.gain.setValueAtTime(vel * 0.22, startSec);
          env.gain.exponentialRampToValueAtTime(0.001, startSec + 0.045);
          osc.connect(env);
          env.connect(masterGain);
          osc.start(startSec);
          osc.stop(startSec + 0.05);
        }
      };

      for (let lp = 0; lp < loops; lp++) {
        const baseSec = lp * singleLoopSec;
        accEvents.forEach((ev) => {
          scheduleNote(
            midiToFreq(ev.midi),
            baseSec + ev.startBeat * beatSec,
            ev.durationBeat * beatSec,
            ev.velocity,
            ev.role === 'bass'
          );
        });
        melEvents.forEach((ev) => {
          scheduleNote(
            midiToFreq(ev.midi),
            baseSec + ev.startBeat * beatSec,
            ev.durationBeat * beatSec,
            ev.velocity * 0.85,
            false
          );
        });
        drumEvents.forEach((ev) => {
          scheduleDrum(ev.drumType, baseSec + ev.startBeat * beatSec, ev.velocity, ev.openHat);
        });
      }

      const rendered = await offline.startRendering();

      // Đồng bộ Tông, Âm giai & BPM của Phòng thu Vocal theo Beat vừa lấy sang
      this.vocalKeyPc = studioCtx.keyPc ?? 0;
      this.vocalScaleType = studioCtx.scaleType === 'minor' ? 'minor' : 'major';
      this.vocalBpm = bpm;

      const preferFlats = shouldPreferFlats(this.vocalKeyPc, this.vocalScaleType);
      const keyLabel = `${pcToNoteName(this.vocalKeyPc, preferFlats)} ${
        this.vocalScaleType === 'minor' ? 'Thứ' : 'Trưởng'
      }`;
      this.lastDetectedKeyInfo = {
        source: 'studio',
        confidence: 100,
        label: keyLabel,
      };
      const beatTitle = `Beat Sáng tác (${keyLabel} · ${bpm} BPM · ${totalBars * loops} ô)`;

      this._setBeatAudioBuffer(rendered, beatTitle, 'studio');
      this._syncAllUI();
      this._onVocalKeyOrScaleChanged();
      this._toast(`Đã nạp "${beatTitle}" vào Track 0!`);
    } catch (err) {
      console.error('[HEVOS VocalStudio Import Studio Beat]', err);
      this._toast('Không thể kết xuất Beat từ mục Sáng tác.', true);
    }
  }

  // ============================================================================
  // Bộ máy Web Audio Độc Lập: Phát / Tạm dừng / Tua Timeline & Đồ thị FX
  // ============================================================================
  _buildTrackFxGraph(ctx, trackId, destNode) {
    const tr = this.tracks[trackId];
    const fx = tr.fx;

    const input = ctx.createGain();
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = Math.max(20, Math.min(2000, Number(fx.hpf ?? 85)));

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = Math.max(800, Math.min(20000, Number(fx.lpf ?? 18000)));

    const eqLow = ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    eqLow.frequency.value = 180;
    eqLow.gain.value = Number(fx.eqLow ?? 0);

    const eqMid = ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.frequency.value = 1200;
    eqMid.Q.value = 0.95;
    eqMid.gain.value = Number(fx.eqMid ?? 0);

    const eqHigh = ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';
    eqHigh.frequency.value = 6000;
    eqHigh.gain.value = Number(fx.eqHigh ?? 0);

    const comp = ctx.createDynamicsCompressor();
    const compPct = Math.max(0, Math.min(100, Number(fx.comp ?? 32)));
    comp.threshold.value = -8 - (compPct / 100) * 24;
    comp.knee.value = 6;
    comp.ratio.value = 1.5 + (compPct / 100) * 5.5;
    comp.attack.value = 0.008;
    comp.release.value = 0.14;

    const dist = ctx.createWaveShaper();
    dist.curve = makeDistortionCurve(Number(fx.dist ?? 0));
    dist.oversample = '2x';

    // Chorus nhẹ
    const chorusDry = ctx.createGain();
    const chorusWet = ctx.createGain();
    const chorusDelay = ctx.createDelay(0.05);
    chorusDelay.delayTime.value = 0.004;
    const chorusLfo = ctx.createOscillator();
    const chorusDepth = ctx.createGain();
    chorusLfo.frequency.value = 1.35;
    chorusDepth.gain.value = 0.0018;
    chorusLfo.connect(chorusDepth);
    chorusDepth.connect(chorusDelay.delayTime);
    chorusLfo.start(0);
    const chorusPct = Math.max(0, Math.min(100, Number(fx.chorus ?? 0))) / 100;
    chorusDry.gain.value = 1 - chorusPct * 0.35;
    chorusWet.gain.value = chorusPct * 0.65;

    const panner =
      typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) {
      panner.pan.value = Math.max(-1, Math.min(1, Number(fx.pan ?? 0) / 100));
    }

    // Nhánh Reverb song song (ConvolverNode với Impulse Response phòng thu)
    const reverbSend = ctx.createGain();
    const revMix = Math.max(0, Math.min(100, Number(fx.reverbMix ?? 14)));
    reverbSend.gain.value = (revMix / 100) * 0.85;
    const convolver = ctx.createConvolver();
    const revDecay = Math.max(0.5, Math.min(5.5, Number(fx.reverbDecay ?? 1.2)));
    convolver.buffer = createStereoReverbIR(ctx, revDecay);

    // Nhánh Sync Delay song song khớp BPM Phòng thu Vocal
    const delaySend = ctx.createGain();
    const delMix = Math.max(0, Math.min(100, Number(fx.delayMix ?? 0)));
    delaySend.gain.value = (delMix / 100) * 0.72;
    const delayNode = ctx.createDelay(2.0);
    const beatSec = 60 / Math.max(40, Math.min(220, this.vocalBpm || 90));
    const div = fx.delayDiv || '8n';
    const delSec = div === '4n' ? beatSec : div === '8n.' ? beatSec * 0.75 : beatSec * 0.5;
    delayNode.delayTime.value = Math.max(0.05, Math.min(1.8, delSec));

    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = 0.32;
    const delayDamp = ctx.createBiquadFilter();
    delayDamp.type = 'lowpass';
    delayDamp.frequency.value = 3400;

    delayNode.connect(delayDamp);
    delayDamp.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    const trackOutGain = ctx.createGain();
    const audible = this._isTrackAudible(trackId, this.recordingTrackId);
    const normVol = Math.max(0, Math.min(100, tr.volume)) / 100;
    trackOutGain.gain.value = audible ? Math.pow(normVol, 1.5) * 1.15 : 0;

    // Đấu nối chuỗi tín hiệu
    input.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(comp);
    comp.connect(dist);

    dist.connect(chorusDry);
    dist.connect(chorusDelay);
    chorusDelay.connect(chorusWet);

    chorusDry.connect(panner);
    chorusWet.connect(panner);

    panner.connect(trackOutGain);

    panner.connect(reverbSend);
    reverbSend.connect(convolver);
    convolver.connect(trackOutGain);

    panner.connect(delaySend);
    delaySend.connect(delayNode);
    delayNode.connect(trackOutGain);

    trackOutGain.connect(destNode);

    return {
      input,
      hpf,
      lpf,
      eqLow,
      eqMid,
      eqHigh,
      comp,
      dist,
      chorusDry,
      chorusWet,
      chorusLfo,
      panner,
      reverbSend,
      convolver,
      lastDecay: revDecay,
      delaySend,
      delayNode,
      trackOutGain,
    };
  }

  _updateLiveFxParams(trackId) {
    const graph = this._liveTrackGraphs[trackId];
    const tr = this.tracks[trackId];
    if (!graph || !tr || !this.playCtx) return;

    const fx = tr.fx;
    const now = this.playCtx.currentTime;

    graph.hpf.frequency.setTargetAtTime(Math.max(20, Math.min(2000, Number(fx.hpf ?? 85))), now, 0.02);
    graph.lpf.frequency.setTargetAtTime(Math.max(800, Math.min(20000, Number(fx.lpf ?? 18000))), now, 0.02);
    graph.eqLow.gain.setTargetAtTime(Number(fx.eqLow ?? 0), now, 0.02);
    graph.eqMid.gain.setTargetAtTime(Number(fx.eqMid ?? 0), now, 0.02);
    graph.eqHigh.gain.setTargetAtTime(Number(fx.eqHigh ?? 0), now, 0.02);

    const compPct = Math.max(0, Math.min(100, Number(fx.comp ?? 32)));
    graph.comp.threshold.setTargetAtTime(-8 - (compPct / 100) * 24, now, 0.02);
    graph.comp.ratio.setTargetAtTime(1.5 + (compPct / 100) * 5.5, now, 0.02);

    graph.dist.curve = makeDistortionCurve(Number(fx.dist ?? 0));

    const chorusPct = Math.max(0, Math.min(100, Number(fx.chorus ?? 0))) / 100;
    graph.chorusDry.gain.setTargetAtTime(1 - chorusPct * 0.35, now, 0.02);
    graph.chorusWet.gain.setTargetAtTime(chorusPct * 0.65, now, 0.02);

    if (graph.panner && graph.panner.pan) {
      graph.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, Number(fx.pan ?? 0) / 100)), now, 0.02);
    }

    const revMix = Math.max(0, Math.min(100, Number(fx.reverbMix ?? 14)));
    graph.reverbSend.gain.setTargetAtTime((revMix / 100) * 0.85, now, 0.025);

    const revDecay = Math.max(0.5, Math.min(5.5, Number(fx.reverbDecay ?? 1.2)));
    if (Math.abs(revDecay - graph.lastDecay) > 0.08) {
      graph.lastDecay = revDecay;
      graph.convolver.buffer = createStereoReverbIR(this.playCtx, revDecay);
    }

    const delMix = Math.max(0, Math.min(100, Number(fx.delayMix ?? 0)));
    graph.delaySend.gain.setTargetAtTime((delMix / 100) * 0.72, now, 0.025);

    const beatSec = 60 / Math.max(40, Math.min(220, this.vocalBpm || 90));
    const div = fx.delayDiv || '8n';
    const delSec = div === '4n' ? beatSec : div === '8n.' ? beatSec * 0.75 : beatSec * 0.5;
    graph.delayNode.delayTime.setTargetAtTime(Math.max(0.05, Math.min(1.8, delSec)), now, 0.025);
  }

  _applyLiveTrackVolumes() {
    if (!this.playCtx) return;
    const now = this.playCtx.currentTime;
    if (this._liveBeatGain) {
      const beatAudible = this._isTrackAudible('beat', this.recordingTrackId);
      const bNorm = Math.max(0, Math.min(100, this.beatTrack.volume)) / 100;
      const bGain = beatAudible ? Math.pow(bNorm, 1.5) * 1.05 : 0;
      this._liveBeatGain.gain.setTargetAtTime(bGain, now, 0.02);
    }
    ['lead', 'backing'].forEach((tid) => {
      const graph = this._liveTrackGraphs[tid];
      const tr = this.tracks[tid];
      if (!graph || !tr) return;
      const audible = this._isTrackAudible(tid, this.recordingTrackId);
      const norm = Math.max(0, Math.min(100, tr.volume)) / 100;
      const gain = audible ? Math.pow(norm, 1.5) * 1.15 : 0;
      graph.trackOutGain.gain.setTargetAtTime(gain, now, 0.02);
    });
  }

  _stopActiveSources() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._activeSources.forEach((node) => {
      try {
        node.stop();
      } catch (_) {}
      try {
        node.disconnect();
      } catch (_) {}
    });
    this._activeSources = [];
    Object.values(this._liveTrackGraphs).forEach((g) => {
      try {
        if (g.chorusLfo) g.chorusLfo.stop();
      } catch (_) {}
      try {
        if (g.trackOutGain) g.trackOutGain.disconnect();
      } catch (_) {}
    });
    this._liveTrackGraphs = {};
    if (this._liveBeatGain) {
      try {
        this._liveBeatGain.disconnect();
      } catch (_) {}
      this._liveBeatGain = null;
    }
  }

  /**
   * Phát các track hiện có từ vị trí offsetSec (TUYỆT ĐỐI KHÔNG bật Tone.Transport của Sáng tác Beat)
   */
  async startPlayback(fromOffsetSec = null, { maskTrackId = null, allowEmpty = false } = {}) {
    const totalDur = this.getTotalTimelineDurationSec();
    if (!allowEmpty && totalDur <= 0.02 && !this.metronomeEnabled) {
      this._toast('Chưa có Beat nền hoặc bản thu giọng nào để phát. Hãy nhập Beat hoặc bấm Thu giọng!', true);
      return;
    }

    const gen = (this._playGen = (this._playGen || 0) + 1);
    const ctx = this._ensurePlayContext();
    if (ctx.state !== 'running') {
      await Promise.race([
        Promise.resolve()
          .then(() => ctx.resume())
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 700)),
      ]);
      if (gen !== this._playGen) return;
    }
    this._stopActiveSources();

    let startOffset = fromOffsetSec !== null ? fromOffsetSec : this.currentTimeSec;
    if (totalDur > 0 && startOffset >= totalDur - 0.05 && !allowEmpty) {
      startOffset = 0;
    }
    startOffset = Math.max(0, startOffset);

    const now = ctx.currentTime + 0.02;
    this._playStartCtxTime = now;
    this._playStartOffsetSec = startOffset;
    this._playTargetDurSec = totalDur > 0 ? totalDur : 600;

    // 1. Lập lịch Track 0 (Beat nền)
    const masterOut = this._visualBus || ctx.destination;
    if (this.beatTrack.audioBuffer && startOffset < this.beatTrack.durationSec) {
      const src = ctx.createBufferSource();
      src.buffer = this.beatTrack.audioBuffer;
      const bGain = ctx.createGain();
      const beatAudible = this._isTrackAudible('beat', maskTrackId);
      const bNorm = Math.max(0, Math.min(100, this.beatTrack.volume)) / 100;
      bGain.gain.value = beatAudible ? Math.pow(bNorm, 1.5) * 1.05 : 0;
      src.connect(bGain);
      bGain.connect(masterOut);
      src.start(now, startOffset);
      this._activeSources.push(src);
      this._liveBeatGain = bGain;
    }

    // 2. Lập lịch Track 1 (Lead) & Track 2 (Backing)
    ['lead', 'backing'].forEach((tid) => {
      if (tid === maskTrackId) return;
      const tr = this.tracks[tid];
      if (!tr.playablePcm) this._rebuildPlayablePcm(tid);
      if (!tr.playablePcm || tr.playablePcm.length === 0) return;

      const sr = tr.sampleRate || 44100;
      const buf = ctx.createBuffer(1, tr.playablePcm.length, sr);
      buf.getChannelData(0).set(tr.playablePcm);

      const graph = this._buildTrackFxGraph(ctx, tid, masterOut);
      this._liveTrackGraphs[tid] = graph;

      const clipStartSec = (tr.startTimeSec || 0) + (tr.syncOffsetMs || 0) / 1000;
      const clipDurSec = buf.duration;
      const clipEndSec = clipStartSec + clipDurSec;
      if (startOffset >= clipEndSec) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(graph.input);

      if (startOffset <= clipStartSec) {
        const delayBeforeStart = clipStartSec - startOffset;
        src.start(now + delayBeforeStart, 0);
      } else {
        const offsetInsideClip = startOffset - clipStartSec;
        src.start(now, offsetInsideClip);
      }
      this._activeSources.push(src);
    });

    // 3. Metronome độc lập (nếu bật)
    if (this.metronomeEnabled) {
      this._scheduleLiveMetronome(ctx, now, startOffset, Math.min(120, Math.max(30, this._playTargetDurSec - startOffset)));
    }

    this.isPlaying = true;
    this.currentTimeSec = startOffset;
    if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(true);
    this._updateTransportButtonsUI();
    this._startTimelineLoop();
  }

  _scheduleLiveMetronome(ctx, startCtxTime, startOffsetSec, maxHorizonSec = 60) {
    const beatSec = 60 / Math.max(40, Math.min(220, this.vocalBpm || 90));
    const firstBeatIdx = Math.ceil(startOffsetSec / beatSec);
    const maxBeats = Math.min(240, Math.ceil(maxHorizonSec / beatSec));

    for (let i = 0; i < maxBeats; i++) {
      const bIdx = firstBeatIdx + i;
      const beatTimelineSec = bIdx * beatSec;
      const when = startCtxTime + (beatTimelineSec - startOffsetSec);
      if (when < ctx.currentTime) continue;

      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const isAccent = bIdx % 4 === 0;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(isAccent ? 1180 : 780, when);
      env.gain.setValueAtTime(isAccent ? 0.22 : 0.12, when);
      env.gain.exponentialRampToValueAtTime(0.0008, when + 0.045);
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.05);
      this._activeSources.push(osc);
    }
  }

  pausePlayback() {
    this._playGen = (this._playGen || 0) + 1;
    if (this.isPlaying && this.playCtx) {
      const elapsed = Math.max(0, this.playCtx.currentTime - this._playStartCtxTime);
      this.currentTimeSec = this._playStartOffsetSec + elapsed;
    }
    this._stopActiveSources();
    this.isPlaying = false;
    if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(false);
    this._updateTransportButtonsUI();
    this._updateTimelineClockUI();
    this._redrawAllWaveforms();
  }

  seekTo(targetSec) {
    const total = this.getTotalTimelineDurationSec();
    const clamped = total > 0 ? Math.max(0, Math.min(total, Number(targetSec) || 0)) : 0;
    this.currentTimeSec = clamped;
    if (this.isPlaying && this.recordPhase === 'idle') {
      this.startPlayback(clamped);
    } else {
      this._updateTimelineClockUI();
      this._redrawAllWaveforms();
    }
  }

  stopAll() {
    this._playGen = (this._playGen || 0) + 1;
    if (this.recordPhase !== 'idle') {
      this.cancelRecording();
    }
    this._stopActiveSources();
    this.isPlaying = false;
    if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(false);
    this._updateTransportButtonsUI();
    this._updateTimelineClockUI();
    this._redrawAllWaveforms();
  }

  _startTimelineLoop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (!this.isPlaying || !this.isSectionActive || (typeof document !== 'undefined' && document.hidden)) {
      return;
    }

    const TIMELINE_INTERVAL_MS = 35; // ~28fps cho đồng hồ thời gian & vẽ playhead waveform
    this._lastTimelineDrawMs = 0;

    const tick = (now) => {
      this._rafId = null;
      if (!this.isPlaying || !this.playCtx || !this.isSectionActive || (typeof document !== 'undefined' && document.hidden)) {
        return;
      }

      const elapsed = Math.max(0, this.playCtx.currentTime - this._playStartCtxTime);
      this.currentTimeSec = this._playStartOffsetSec + elapsed;

      const totalDur = this.getTotalTimelineDurationSec();

      // Nếu đang thu có Beat nền ở Track 0 -> tự dừng khi hết Beat nền
      if (this.recordPhase === 'recording') {
        if (
          this.beatTrack.audioBuffer &&
          this.beatTrack.durationSec > 0 &&
          this.currentTimeSec >= this.beatTrack.durationSec + 0.05
        ) {
          this.finishTrackRecording();
          return;
        }
      } else if (totalDur > 0 && this.currentTimeSec >= totalDur) {
        // Kết thúc phát lại
        this.currentTimeSec = totalDur;
        this._stopActiveSources();
        this.isPlaying = false;
        if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(false);
        this._updateTransportButtonsUI();
        this._updateTimelineClockUI();
        this._redrawAllWaveforms();
        return;
      }

      if (now - this._lastTimelineDrawMs >= TIMELINE_INTERVAL_MS) {
        this._lastTimelineDrawMs = now;
        this._updateTimelineClockUI();
        this._redrawAllWaveforms();
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  // ============================================================================
  // Luồng Thu Âm Giọng Hát Độc Lập (Thu theo Beat nền hoặc Thu mộc tự do không giới hạn)
  // ============================================================================
  toggleRecordActiveTrack() {
    if (this.recordPhase !== 'idle') {
      if (this.recordPhase === 'recording') {
        this.finishTrackRecording();
      } else {
        this.cancelRecording();
        this._toast('Đã hủy đếm vào thu âm.');
      }
      return;
    }
    this.startTrackRecording(this.activeTrackId);
  }

  isRecording() {
    return this.recordPhase !== 'idle';
  }

  hasAnyTake() {
    return Boolean(this.tracks.lead.rawPcm || this.tracks.backing.rawPcm);
  }

  getTrackTakeFlags() {
    return {
      lead: Boolean(this.tracks.lead.rawPcm),
      backing: Boolean(this.tracks.backing.rawPcm),
    };
  }

  async startTrackRecording(trackId) {
    const tr = this.tracks[trackId];
    if (!tr) return;

    this.activeTrackId = trackId;
    if (this.isPlaying) {
      this.pausePlayback();
    }
    this._syncAllUI();

    const echoCancellation = this.cb.getEchoCancellation ? this.cb.getEchoCancellation() : false;
    const micGain = this.cb.getMicGain ? this.cb.getMicGain() : getDefaultMicGain();

    // QUAN TRỌNG: Gọi openMic() đồng bộ ngay trong sự kiện chạm của người dùng (giữ user gesture iOS Safari)
    const micPromise = this.vocalCapture.openMic({
      echoCancellation,
      micGain,
      monitor: this.monitorEnabled,
      onLiveStats: (stats) => this._updateLiveVu(stats),
      onPcmChunk: (chunk) => this._appendLiveWaveChunk(trackId, chunk),
    });

    let playCtx;
    try {
      playCtx = this._ensurePlayContext();
    } catch (err) {
      this.vocalCapture.close();
      this._toast(err.message || 'Không thể khởi tạo AudioContext.', true);
      return;
    }

    try {
      await micPromise;
    } catch (err) {
      this.vocalCapture.close();
      const errName = err && err.name ? err.name : 'Error';
      const errMsg = err && err.message ? err.message : String(err);
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        this._toast(
          `Chưa cấp quyền Micro (${errName}). Hãy cấp quyền Micro trong cài đặt trình duyệt rồi thử lại.`,
          true
        );
      } else {
        this._toast(`Lỗi mở Micro (${errName}: ${errMsg})`, true);
      }
      return;
    }

    // Nếu con trỏ đang ở cuối bài -> tự đưa về 00:00.0 trước khi thu
    const beatDur = this.beatTrack.audioBuffer ? this.beatTrack.durationSec : 0;
    if (beatDur > 0 && this.currentTimeSec >= beatDur - 0.15) {
      this.currentTimeSec = 0;
    }
    this._recStartOffsetSec = Math.max(0, this.currentTimeSec);

    // 1. Đếm vào 3-2-1 (nếu bật)
    this.recordingTrackId = trackId;
    if (this.countInEnabled) {
      this.recordPhase = 'countin';
      this._updateTransportButtonsUI();
      this._updateRecordButtonsUI();
      if (this.cb.onRecordingStateChange) {
        this.cb.onRecordingStateChange(this.recordPhase, trackId);
      }

      const overlay = document.getElementById('vocal-countin-overlay');
      const captionEl = document.getElementById('vocal-countin-caption');
      const numEl = document.getElementById('vocal-countin-number');
      if (overlay) overlay.classList.remove('hidden');
      if (captionEl) captionEl.textContent = `CHUẨN BỊ THU · ${tr.shortTitle.toUpperCase()}`;
      if (numEl) numEl.textContent = '3';

      const completed = await this._runStandaloneCountIn(playCtx, (label) => {
        if (numEl) numEl.textContent = label;
      });

      if (overlay) overlay.classList.add('hidden');
      if (!completed || this.recordPhase !== 'countin') {
        this.vocalCapture.close();
        this.recordPhase = 'idle';
        this.recordingTrackId = null;
        this._resetLiveVu();
        this._updateTransportButtonsUI();
        this._updateRecordButtonsUI();
        if (this.cb.onRecordingStateChange) {
          this.cb.onRecordingStateChange('idle', null);
        }
        return;
      }
    }

    // 2. Bắt đầu thu giọng + phát Beat nền (nếu có) và kênh giọng còn lại để hát bè
    this._liveWavePeaks = [];
    this._liveWaveSampleAccum = 0;
    this._liveWaveMaxPeak = 0;

    this.recordPhase = 'recording';
    this._updateTransportButtonsUI();
    this._updateRecordButtonsUI();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange('recording', trackId);
    }

    const card = this.root.querySelector(`[data-vs-card="${trackId}"]`);
    if (card) card.classList.add('recording');
    const emptyEl = this.root.querySelector(`#vs-wave-empty-${trackId}`);
    if (emptyEl) emptyEl.classList.add('hidden');

    this.vocalCapture.beginCapture();
    this.startPlayback(this._recStartOffsetSec, {
      maskTrackId: trackId,
      allowEmpty: true,
    });
  }

  _runStandaloneCountIn(ctx, onTick) {
    this._countInCancelled = false;
    this._countInTimers.forEach((id) => clearTimeout(id));
    this._countInTimers = [];

    const beatSec = 60 / Math.max(40, Math.min(220, this.vocalBpm || 90));
    const startAudioTime = ctx.currentTime + 0.04;
    const labels = ['3', '2', '1', 'HÁT!'];

    for (let i = 0; i < 4; i++) {
      const when = startAudioTime + i * beatSec;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(i === 3 ? 1240 : 820, when);
      env.gain.setValueAtTime(i === 3 ? 0.3 : 0.18, when);
      env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(when);
      osc.stop(when + 0.055);

      const timer = setTimeout(() => {
        if (!this._countInCancelled && onTick) onTick(labels[i]);
      }, Math.max(0, Math.round((0.04 + i * beatSec) * 1000)));
      this._countInTimers.push(timer);
    }

    return new Promise((resolve) => {
      const endTimer = setTimeout(() => {
        this._countInTimers = [];
        resolve(!this._countInCancelled);
      }, Math.round((0.04 + 4 * beatSec) * 1000));
      this._countInTimers.push(endTimer);
    });
  }

  cancelRecording() {
    this._countInCancelled = true;
    this._countInTimers.forEach((id) => clearTimeout(id));
    this._countInTimers = [];

    this._stopActiveSources();
    this.isPlaying = false;
    this.vocalCapture.close();

    const prevTid = this.recordingTrackId;
    this.recordPhase = 'idle';
    this.recordingTrackId = null;

    const overlay = document.getElementById('vocal-countin-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (prevTid) {
      const card = this.root.querySelector(`[data-vs-card="${prevTid}"]`);
      if (card) card.classList.remove('recording');
    }
    this._resetLiveVu();
    this._updateTransportButtonsUI();
    this._updateRecordButtonsUI();
    this._redrawAllWaveforms();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange('idle', null);
    }
  }

  async finishTrackRecording() {
    const trackId = this.recordingTrackId;
    const tr = this.tracks[trackId];

    this._stopActiveSources();
    this.isPlaying = false;

    const take = this.vocalCapture.finishCapture({ trimStartSec: 0.04, autoNormalize: true });

    this.recordPhase = 'idle';
    this.recordingTrackId = null;
    if (trackId) {
      const card = this.root.querySelector(`[data-vs-card="${trackId}"]`);
      if (card) card.classList.remove('recording');
    }
    this._resetLiveVu();
    this._updateTransportButtonsUI();
    this._updateRecordButtonsUI();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange('idle', null);
    }

    if (!tr || !take || !take.pcmData || take.pcmData.length < 1024) {
      this._toast('Bản thu quá ngắn hoặc chưa nhận được tín hiệu giọng hát.', true);
      this._redrawAllWaveforms();
      return;
    }

    tr.rawPcm = take.pcmData;
    tr.sampleRate = take.sampleRate;
    tr.startTimeSec = this._recStartOffsetSec || 0;
    tr.durationSec = take.pcmData.length / (take.sampleRate || 44100);
    tr.tunedPcm = null;
    this._rebuildPlayablePcm(trackId);

    this.currentTimeSec = tr.startTimeSec;
    if (tr.autoTune.enabled) {
      await this._processTrackAutoTune(trackId, false);
    } else {
      await this._processTrackAutoTune(trackId, false);
      if (this.autoKeyEnabled && !this.beatTrack.audioBuffer && (!this.lastDetectedKeyInfo || trackId === 'lead')) {
        const det = detectKeyFromPcm(tr.rawPcm, tr.sampleRate);
        if (det) {
          this.vocalKeyPc = det.keyPc;
          this.vocalScaleType = det.scaleType;
          this.lastDetectedKeyInfo = {
            source: 'vocal',
            confidence: det.confidence,
            label: det.label,
          };
          this._syncAutoKeyUI();
        }
      }
    }
    this._updateTimelineClockUI();
    this._redrawAllWaveforms();
    this._toast(
      `Đã thu xong ${tr.shortTitle} (${formatTimeClock(tr.durationSec)} · tự động cân bằng âm lượng chuẩn)!`
    );
  }

  _scheduleAutoTuneReprocess(trackId, delayMs = 150) {
    clearTimeout(this._atDebounceTimers[trackId]);
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;
    this._atDebounceTimers[trackId] = setTimeout(() => {
      this._processTrackAutoTune(trackId, true);
    }, delayMs);
  }

  async _processTrackAutoTune(trackId, notifyAtDone = false) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;

    tr.atReqId += 1;
    const reqId = tr.atReqId;

    if (!tr.autoTune.enabled || tr.autoTune.strength <= 1) {
      tr.isProcessingAt = false;
      tr.tunedPcm = null;
      this._rebuildPlayablePcm(trackId);
      this._syncAtStatusUI();
      this._syncTrackCardHeader(trackId);
      this._redrawAllWaveforms();
      if (this.cb.onTakesChanged) this.cb.onTakesChanged();
      if (this.isPlaying) this.seekTo(this.currentTimeSec);
      return;
    }

    tr.isProcessingAt = true;
    this._syncAtStatusUI();

    const hasBeatAudio = Boolean(this.beatTrack.audioBuffer);
    const shouldDetectFromVocal =
      this.autoKeyEnabled &&
      !hasBeatAudio &&
      (trackId === 'lead' ||
        !this.tracks.lead.rawPcm ||
        !this.lastDetectedKeyInfo ||
        this.lastDetectedKeyInfo.source !== 'vocal');

    try {
      const res = await applyAutoTunePcm(tr.rawPcm, tr.sampleRate, {
        keyPc: this.vocalKeyPc,
        scaleType: this.vocalScaleType,
        strength: tr.autoTune.strength / 100,
        autoDetectKey: shouldDetectFromVocal,
      });

      if (tr.atReqId !== reqId) return;

      let didDetectVocalKey = false;
      if (shouldDetectFromVocal && res.stats && res.stats.detectedKeyConfidence !== null) {
        this.vocalKeyPc = res.stats.detectedKeyPc;
        this.vocalScaleType = res.stats.detectedScaleType;
        this.lastDetectedKeyInfo = {
          source: 'vocal',
          confidence: res.stats.detectedKeyConfidence,
          label: res.stats.detectedKeyLabel,
        };
        didDetectVocalKey = true;
        this._syncAutoKeyUI();
      }

      tr.tunedPcm = res.pcmData;
      tr.isProcessingAt = false;
      this._rebuildPlayablePcm(trackId);
      this._syncAtStatusUI();
      this._syncTrackCardHeader(trackId);
      this._redrawAllWaveforms();
      if (this.cb.onTakesChanged) this.cb.onTakesChanged();
      if (this.isPlaying) this.seekTo(this.currentTimeSec);

      if (notifyAtDone) {
        const cents =
          res.stats && res.stats.avgCorrectionCents ? ` (~${res.stats.avgCorrectionCents} cents)` : '';
        const prefix = didDetectVocalKey ? 'Đã tự dò giọng & khóa tông Auto-Tune' : 'Đã khóa tông Auto-Tune';
        this._toast(`${prefix} ${this._getKeyScaleText()}${cents}.`);
      }
    } catch (err) {
      if (tr.atReqId !== reqId) return;
      tr.isProcessingAt = false;
      this._rebuildPlayablePcm(trackId);
      this._syncAtStatusUI();
      console.warn('[HEVOS VocalStudio Auto-Tune]', err);
    }
  }

  _clearTrack(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;
    clearTimeout(this._atDebounceTimers[trackId]);
    tr.atReqId += 1;
    tr.rawPcm = null;
    tr.tunedPcm = null;
    tr.playablePcm = null;
    tr.wavePeaks = null;
    tr.durationSec = 0;
    tr.startTimeSec = 0;
    tr.isProcessingAt = false;

    if (this.isPlaying) this.seekTo(this.currentTimeSec);
    this._syncTrackCardHeader(trackId);
    this._syncAtStatusUI();
    this._updateTimelineClockUI();
    this._redrawAllWaveforms();
    if (this.cb.onTakesChanged) this.cb.onTakesChanged();
    this._toast(`Đã xóa bản thu ${tr.shortTitle}.`);
  }

  // ============================================================================
  // Xuất Bản Thu Hoàn Chỉnh (.WAV) & Xuất Riêng Giọng (.WAV) bằng OfflineAudioContext
  // ============================================================================
  async _renderOfflineMixBuffer({
    includeBeat = true,
    onlyTrackId = null,
    respectVolume = false,
    applyStartTrim = false,
  } = {}) {
    const hasLead = Boolean(this.tracks.lead.rawPcm);
    const hasBack = Boolean(this.tracks.backing.rawPcm);
    const hasBeat = Boolean(this.beatTrack.audioBuffer);

    if (onlyTrackId) {
      const tr = this.tracks[onlyTrackId];
      if (!tr || !tr.rawPcm) return null;
    } else if (!includeBeat && !hasLead && !hasBack) {
      return null;
    } else if (includeBeat && !hasBeat && !hasLead && !hasBack) {
      return null;
    }

    let renderDur = 0;
    if (onlyTrackId) {
      const tr = this.tracks[onlyTrackId];
      renderDur = tr.rawPcm.length / (tr.sampleRate || 44100) + 1.2;
    } else {
      if (includeBeat && hasBeat && this._isTrackAudible('beat')) {
        renderDur = Math.max(renderDur, this.beatTrack.durationSec);
      }
      ['lead', 'backing'].forEach((tid) => {
        const tr = this.tracks[tid];
        if (tr.rawPcm && this._isTrackAudible(tid)) {
          const endSec = (tr.startTimeSec || 0) + tr.rawPcm.length / (tr.sampleRate || 44100) + 1.2;
          if (endSec > renderDur) renderDur = endSec;
        }
      });
    }

    if (renderDur <= 0.05) return null;

    const leadTr = this.tracks.lead;
    const backTr = this.tracks.backing;
    const sr = Math.max(
      8000,
      Math.round(
        (leadTr && leadTr.rawPcm && leadTr.sampleRate) ||
        (backTr && backTr.rawPcm && backTr.sampleRate) ||
        (this.beatTrack.audioBuffer && this.beatTrack.audioBuffer.sampleRate) ||
        (this.playCtx && this.playCtx.sampleRate) ||
        44100
      )
    );
    const totalFrames = Math.ceil(renderDur * sr);
    const OfflineAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineAC) {
      throw new Error('Trình duyệt không hỗ trợ OfflineAudioContext.');
    }
    const offline = new OfflineAC(2, totalFrames, sr);

    const masterLimiter = offline.createDynamicsCompressor();
    masterLimiter.threshold.value = -1.2;
    masterLimiter.knee.value = 3;
    masterLimiter.ratio.value = 16;
    masterLimiter.attack.value = 0.002;
    masterLimiter.release.value = 0.08;
    masterLimiter.connect(offline.destination);

    // 1. Nạp Beat nền (nếu xuất bản Mix đầy đủ)
    if (!onlyTrackId && includeBeat && hasBeat && this._isTrackAudible('beat')) {
      const src = offline.createBufferSource();
      src.buffer = this.beatTrack.audioBuffer;
      const bGain = offline.createGain();
      const bNorm = Math.max(0, Math.min(100, this.beatTrack.volume)) / 100;
      bGain.gain.value = Math.pow(bNorm, 1.5) * 1.05;
      src.connect(bGain);
      bGain.connect(masterLimiter);
      src.start(0, 0);
    }

    // 2. Nạp các kênh Giọng hát kèm đầy đủ Auto-Tune, Gate, Pitch, EQ, Comp, Reverb, Delay, Pan, Sync Offset
    const trackIds = onlyTrackId ? [onlyTrackId] : ['lead', 'backing'];
    trackIds.forEach((tid) => {
      const tr = this.tracks[tid];
      if (!tr || !tr.rawPcm) return;
      if (!onlyTrackId && !this._isTrackAudible(tid)) return;

      this._rebuildPlayablePcm(tid);
      if (!tr.playablePcm || tr.playablePcm.length === 0) return;

      const tSr = tr.sampleRate || 44100;
      const buf = offline.createBuffer(1, tr.playablePcm.length, tSr);
      buf.getChannelData(0).set(tr.playablePcm);

      const graph = this._buildTrackFxGraph(offline, tid, masterLimiter);
      if (onlyTrackId && !respectVolume) {
        graph.trackOutGain.gain.value = 1.0;
      }

      const src = offline.createBufferSource();
      src.buffer = buf;
      src.connect(graph.input);

      if (onlyTrackId) {
        if (applyStartTrim) {
          const clipStartSec = (tr.startTimeSec || 0) + (tr.syncOffsetMs || 0) / 1000;
          if (clipStartSec < 0) {
            const trimIn = Math.min(buf.duration - 0.02, Math.abs(clipStartSec));
            if (trimIn < buf.duration - 0.02) {
              src.start(0, trimIn);
            }
          } else {
            src.start(0, 0);
          }
        } else {
          src.start(0, 0);
        }
      } else {
        const clipStartSec = (tr.startTimeSec || 0) + (tr.syncOffsetMs || 0) / 1000;
        if (clipStartSec >= 0) {
          src.start(clipStartSec, 0);
        } else {
          const trimIn = Math.min(buf.duration - 0.02, Math.abs(clipStartSec));
          if (trimIn < buf.duration - 0.02) {
            src.start(0, trimIn);
          }
        }
      }
    });

    return offline.startRendering();
  }

  _syncExportFormatUI() {
    if (!this.root) return;
    const fmt = this.exportFormat === 'mp3' ? 'mp3' : 'wav';
    this.root.querySelectorAll('[data-vs-fmt]').forEach((btn) => {
      const active = btn.dataset.vsFmt === fmt;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    const lblMix = this.root.querySelector('#vs-export-mix-label');
    const lblVoc = this.root.querySelector('#vs-export-vocal-label');
    if (lblMix) lblMix.textContent = `Xuất Bản Mix (.${fmt})`;
    if (lblVoc) lblVoc.textContent = `Xuất Riêng Giọng (.${fmt})`;
  }

  async exportWavMixdown({ vocalOnly = false } = {}) {
    if (this.isExporting) return;
    if (this.recordPhase !== 'idle') {
      this._toast('Vui lòng dừng thu âm trước khi xuất file âm thanh.', true);
      return;
    }

    const hasLead = Boolean(this.tracks.lead.rawPcm);
    const hasBack = Boolean(this.tracks.backing.rawPcm);
    const hasBeat = Boolean(this.beatTrack.audioBuffer);

    if (vocalOnly && !hasLead && !hasBack) {
      this._toast('Chưa có bản thu giọng hát nào để xuất. Hãy thu giọng trên Track 1 hoặc Track 2 trước!', true);
      return;
    }
    if (!vocalOnly && !hasBeat && !hasLead && !hasBack) {
      this._toast('Phòng thu đang trống. Hãy nhập Beat hoặc thu giọng trước khi xuất file!', true);
      return;
    }

    const fmt = this.exportFormat === 'mp3' ? 'mp3' : 'wav';
    this.isExporting = true;
    const btnMix = this.root.querySelector('#vs-btn-export-mix');
    const btnVoc = this.root.querySelector('#vs-btn-export-vocal-only');
    const lblMix = this.root.querySelector('#vs-export-mix-label');
    const lblVoc = this.root.querySelector('#vs-export-vocal-label');
    if (btnMix) btnMix.disabled = true;
    if (btnVoc) btnVoc.disabled = true;
    if (vocalOnly && lblVoc) lblVoc.textContent = `Đang xuất ${fmt.toUpperCase()}...`;
    if (!vocalOnly && lblMix) lblMix.textContent = `Đang xuất ${fmt.toUpperCase()}...`;

    try {
      const renderedBuffer = await this._renderOfflineMixBuffer({
        includeBeat: !vocalOnly,
        onlyTrackId: null,
      });

      if (!renderedBuffer) {
        this._toast('Không có kênh âm thanh nào đang bật để xuất.', true);
        return;
      }

      const encoded = await encodeAudioBufferByFormat(renderedBuffer, fmt, {
        kbps: 192,
        onProgress: (pct) => {
          if (vocalOnly && lblVoc) lblVoc.textContent = `${fmt.toUpperCase()} ${pct}%...`;
          if (!vocalOnly && lblMix) lblMix.textContent = `${fmt.toUpperCase()} ${pct}%...`;
        },
      });
      const preferFlats = shouldPreferFlats(this.vocalKeyPc, this.vocalScaleType);
      const keySlug = pcToNoteName(this.vocalKeyPc, preferFlats).replace('#', 's').toLowerCase();
      const tag = vocalOnly ? 'vocal-only' : 'full-mix';
      const filename = `hevos-vocal-${tag}-${keySlug}-${this.vocalBpm}bpm.${encoded.ext}`;

      const url = URL.createObjectURL(encoded.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      this._toast(
        `Đã xuất file ${fmt.toUpperCase()} (${formatTimeClock(renderedBuffer.duration)}): ${filename}`
      );
    } catch (err) {
      console.error('[HEVOS VocalStudio Export]', err);
      this._toast(err.message || `Lỗi khi kết xuất file ${fmt.toUpperCase()}.`, true);
    } finally {
      this.isExporting = false;
      if (btnMix) btnMix.disabled = false;
      if (btnVoc) btnVoc.disabled = false;
      this._syncExportFormatUI();
    }
  }

  async _downloadSingleTrackWav(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;
    const fmt = this.exportFormat === 'mp3' ? 'mp3' : 'wav';
    try {
      const rendered = await this._renderOfflineMixBuffer({
        includeBeat: false,
        onlyTrackId: trackId,
      });
      let blob;
      let ext = fmt;
      if (rendered) {
        const res = await encodeAudioBufferByFormat(rendered, fmt, { kbps: 192 });
        blob = res.blob;
        ext = res.ext;
      } else if (fmt === 'mp3') {
        const sr = tr.sampleRate || 44100;
        const pcm = tr.playablePcm || tr.rawPcm;
        const tmpBuf = new AudioBuffer({ numberOfChannels: 1, length: pcm.length, sampleRate: sr });
        tmpBuf.getChannelData(0).set(pcm);
        const res = await encodeAudioBufferByFormat(tmpBuf, 'mp3', { kbps: 192 });
        blob = res.blob;
        ext = res.ext;
      } else {
        blob = encodePcmToWavBlob(tr.playablePcm || tr.rawPcm, tr.sampleRate);
        ext = 'wav';
      }
      const suffix = tr.autoTune.enabled ? 'autotune-fx' : 'fx';
      const filename = `hevos-${trackId}-${suffix}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this._toast(`Đã tải file giọng (${ext.toUpperCase()}): ${filename}`);
    } catch (err) {
      console.warn('[HEVOS Single Track Download]', err);
      this._toast(err.message || `Lỗi khi tải track ${fmt.toUpperCase()}.`, true);
    }
  }

  _sendBeatToArrangement() {
    if (!this.beatTrack.audioBuffer) {
      this._toast('Track 0 chưa có Beat để gửi sang Dựng bài & Master.', true);
      return;
    }
    if (!this.cb.onSendToArrangement) return;
    this.cb.onSendToArrangement({
      name: this.beatTrack.name || 'Beat Phòng thu Track 0',
      sourceType: 'vocal-beat',
      audioBuffer: this.beatTrack.audioBuffer,
      bpm: this.vocalBpm,
      color: '#6366F1',
      suggestedTrackIndex: 0,
      suggestedStartSec: 0,
    });
  }

  async _renderVocalClipPayload(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return null;
    const rendered = await this._renderOfflineMixBuffer({
      includeBeat: false,
      onlyTrackId: trackId,
      respectVolume: true,
      applyStartTrim: true,
    });
    if (!rendered) return null;
    const startSec = Math.max(0, (tr.startTimeSec || 0) + (tr.syncOffsetMs || 0) / 1000);
    const baseName = trackId === 'lead' ? 'Vocal Chính · Phòng thu' : 'Hát Bè · Phòng thu';
    const fxSuffix = tr.autoTune.enabled ? ' (Auto-Tune · FX)' : '';
    return {
      name: `${baseName}${fxSuffix}`,
      sourceType: 'vocal',
      audioBuffer: rendered,
      bpm: this.vocalBpm,
      color: trackId === 'lead' ? '#EC4899' : '#F472B6',
      suggestedTrackIndex: trackId === 'lead' ? 2 : 3,
      suggestedStartSec: startSec,
      autoPlaceIfEmpty: true,
    };
  }

  async _sendVocalTrackToArrangement(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) {
      this._toast('Track giọng này chưa có bản thu.', true);
      return;
    }
    if (!this.cb.onSendToArrangement) return;

    const btn = this.root ? this.root.querySelector(`#vs-send-arr-${trackId}`) : null;
    if (btn) btn.disabled = true;
    try {
      const payload = await this._renderVocalClipPayload(trackId);
      if (!payload) {
        this._toast('Không thể kết xuất kênh giọng hát.', true);
        return;
      }
      this.cb.onSendToArrangement(payload);
    } catch (err) {
      console.error('[HEVOS Vocal Send Arrangement]', err);
      this._toast('Lỗi khi gửi Vocal sang Dựng bài & Master.', true);
    } finally {
      if (btn) btn.disabled = !Boolean(tr.rawPcm);
    }
  }

  async _sendAllVocalsToArrangement() {
    if (this.recordPhase !== 'idle') {
      this._toast('Vui lòng dừng thu âm trước khi gửi Vocal sang Dựng bài.', true);
      return;
    }
    const populatedIds = ['lead', 'backing'].filter(
      (tid) => this.tracks[tid] && this.tracks[tid].rawPcm
    );
    if (populatedIds.length === 0) {
      this._toast('Chưa có dữ liệu Vocal ở Track 1 hoặc Track 2 để gửi sang Dựng bài.', true);
      return;
    }
    if (!this.cb.onSendToArrangement) return;

    const topBtn = this.root ? this.root.querySelector('#vs-btn-send-vocal-arr') : null;
    const topLabel = this.root ? this.root.querySelector('#vs-send-vocal-arr-label') : null;
    if (topBtn) topBtn.disabled = true;
    if (topLabel) topLabel.textContent = 'Đang kết xuất...';

    try {
      const payloads = [];
      for (const tid of populatedIds) {
        const payload = await this._renderVocalClipPayload(tid);
        if (payload) payloads.push(payload);
      }
      if (payloads.length === 0) {
        this._toast('Không thể kết xuất dữ liệu Vocal.', true);
        return;
      }
      this.cb.onSendToArrangement(payloads);
    } catch (err) {
      console.error('[HEVOS Vocal Batch Send Arrangement]', err);
      this._toast('Lỗi khi gửi Vocal sang Dựng bài & Master.', true);
    } finally {
      if (topBtn) topBtn.disabled = false;
      if (topLabel) topLabel.textContent = 'Gửi Vocal sang Dựng bài →';
    }
  }

  _applyPresetToActiveTrack(presetId) {
    const preset = VOCAL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const tr = this.tracks[this.activeTrackId];
    const keepPan = tr.fx.pan ?? 0;
    const prevAtEnabled = tr.autoTune.enabled;
    const prevAtStrength = tr.autoTune.strength;

    tr.presetId = preset.id;
    tr.fx = { ...preset.fx, pan: keepPan };
    tr.autoTune = { ...preset.autoTune };

    this._rebuildPlayablePcm(tr.id);
    this._updateLiveFxParams(tr.id);
    this._syncAllUI();

    if (
      tr.rawPcm &&
      (tr.autoTune.enabled !== prevAtEnabled ||
        (tr.autoTune.enabled && tr.autoTune.strength !== prevAtStrength))
    ) {
      this._scheduleAutoTuneReprocess(tr.id, 10);
    } else if (this.isPlaying) {
      this.seekTo(this.currentTimeSec);
    }

    this._toast(`Đã áp dụng preset "${preset.name}" cho ${tr.shortTitle}.`);
  }

  // ============================================================================
  // Đồng bộ Giao diện & Vẽ Sóng Âm 3 Track
  // ============================================================================
  _updateLiveVu({ level, noteName }) {
    if (!this.root) return;
    if (!this._vuEls) this._cacheVuElements();
    const { fill, peak: peakEl, note: noteEl } = this._vuEls || {};
    if (noteName !== undefined && noteEl) {
      noteEl.innerHTML = `Nốt: <strong>${noteName || '—'}</strong>`;
    }
    const now = performance.now();
    if (now - this._lastVuUpdateMs < 40) return; // Tối đa 25fps cho VU Meter
    this._lastVuUpdateMs = now;

    const norm = Math.max(0, Math.min(1, level || 0));
    const pct = Math.min(100, Math.round(norm * 100));
    if (fill) fill.style.transform = `scaleX(${norm.toFixed(3)})`;
    if (peakEl) peakEl.style.transform = `translateX(${pct}%)`;
  }

  _resetLiveVu() {
    if (!this.root) return;
    if (!this._vuEls) this._cacheVuElements();
    const { fill, peak: peakEl, note: noteEl } = this._vuEls || {};
    if (fill) fill.style.transform = 'scaleX(0)';
    if (peakEl) peakEl.style.transform = 'translateX(0%)';
    if (noteEl) noteEl.innerHTML = 'Nốt: <strong>—</strong>';
  }

  _appendLiveWaveChunk(trackId, chunk) {
    if (this.recordPhase !== 'recording' || this.recordingTrackId !== trackId) return;
    const sr = this.vocalCapture.sampleRate || 44100;
    const samplesPerPeak = Math.max(512, Math.floor(sr * 0.05)); // 20 cột mỗi giây
    for (let i = 0; i < chunk.length; i++) {
      const a = Math.abs(chunk[i]);
      if (a > this._liveWaveMaxPeak) this._liveWaveMaxPeak = a;
      this._liveWaveSampleAccum++;
      if (this._liveWaveSampleAccum >= samplesPerPeak) {
        this._liveWavePeaks.push(this._liveWaveMaxPeak);
        this._liveWaveSampleAccum = 0;
        this._liveWaveMaxPeak = 0;
      }
    }
  }

  _updateTransportButtonsUI() {
    if (!this.root) return;
    const btnPlay = this.root.querySelector('#vs-btn-play');
    const lblPlay = this.root.querySelector('#vs-btn-play-label');
    const btnMainRec = this.root.querySelector('#vs-btn-main-rec');
    const lblMainRec = this.root.querySelector('#vs-btn-main-rec-label');

    const isRec = this.recordPhase !== 'idle';
    if (btnPlay && lblPlay) {
      btnPlay.classList.toggle('playing', this.isPlaying && !isRec);
      lblPlay.textContent = this.isPlaying && !isRec ? 'Tạm dừng' : 'Phát';
    }
    if (btnMainRec && lblMainRec) {
      btnMainRec.classList.toggle('recording', isRec);
      if (this.recordPhase === 'countin') {
        lblMainRec.textContent = 'Đếm vào...';
      } else if (this.recordPhase === 'recording') {
        lblMainRec.textContent = 'Dừng thu';
      } else {
        lblMainRec.textContent = 'Thu âm';
      }
    }
  }

  _updateTimelineClockUI() {
    if (!this.root) return;
    const total = this.getTotalTimelineDurationSec();
    const cur = Math.min(this.currentTimeSec, total > 0 ? total : this.currentTimeSec);
    const curEl = this.root.querySelector('#vs-clock-cur');
    const totEl = this.root.querySelector('#vs-clock-total');
    const scrub = this.root.querySelector('#vs-timeline-scrubber');

    if (curEl) curEl.textContent = formatTimeClock(cur);
    if (totEl) totEl.textContent = formatTimeClock(total);
    if (scrub) {
      scrub.value = total > 0 ? String(Math.min(1000, Math.round((cur / total) * 1000))) : '0';
    }
  }

  _updateRecordButtonsUI() {
    if (!this.root) return;
    ['lead', 'backing'].forEach((tid) => {
      const btn = this.root.querySelector(`[data-vs-rec="${tid}"]`);
      const lbl = this.root.querySelector(`#vs-rec-label-${tid}`);
      if (!btn || !lbl) return;
      const isThis = this.recordingTrackId === tid && this.recordPhase !== 'idle';
      btn.classList.toggle('recording', isThis);
      if (isThis && this.recordPhase === 'countin') {
        lbl.textContent = 'Đếm vào...';
      } else if (isThis && this.recordPhase === 'recording') {
        lbl.textContent = 'Dừng thu';
      } else {
        lbl.textContent = this.tracks[tid].rawPcm ? 'Thu lại' : 'Thu giọng';
      }
    });
  }

  _syncBeatTrackUI() {
    if (!this.root) return;
    const badge = this.root.querySelector('#vs-beat-badge');
    const emptyEl = this.root.querySelector('#vs-wave-empty-beat');
    const clearBtn = this.root.querySelector('#vs-btn-clear-beat');
    const hasBeat = Boolean(this.beatTrack.audioBuffer);

    if (badge) {
      if (hasBeat) {
        badge.textContent = `${this.beatTrack.name} · ${formatTimeClock(this.beatTrack.durationSec)}`;
        badge.classList.add('has-take');
      } else {
        badge.textContent = 'Chế độ: Thu mộc tự do (Không giới hạn)';
        badge.classList.remove('has-take');
      }
    }
    if (emptyEl) emptyEl.classList.toggle('hidden', hasBeat);
    if (clearBtn) clearBtn.disabled = !hasBeat;
    const sendBeatArrBtn = this.root.querySelector('#vs-btn-send-beat-arr');
    if (sendBeatArrBtn) sendBeatArrBtn.disabled = !hasBeat;
  }

  _syncMuteSoloButtons() {
    if (!this.root) return;
    ['beat', 'lead', 'backing'].forEach((tid) => {
      const target = tid === 'beat' ? this.beatTrack : this.tracks[tid];
      const mBtn = this.root.querySelector(`[data-vs-mute="${tid}"]`);
      const sBtn = this.root.querySelector(`[data-vs-solo="${tid}"]`);
      if (mBtn && target) mBtn.classList.toggle('active-mute', Boolean(target.muted));
      if (sBtn && target) sBtn.classList.toggle('active-solo', Boolean(target.solo));
    });
  }

  _syncTrackCardHeader(trackId) {
    if (!this.root) return;
    const tr = this.tracks[trackId];
    const has = Boolean(tr.rawPcm);
    const badge = this.root.querySelector(`#vs-badge-${trackId}`);
    const dlBtn = this.root.querySelector(`#vs-dl-${trackId}`);
    const sendArrBtn = this.root.querySelector(`#vs-send-arr-${trackId}`);
    const delBtn = this.root.querySelector(`#vs-del-${trackId}`);
    const emptyEl = this.root.querySelector(`#vs-wave-empty-${trackId}`);
    if (badge) {
      if (!has) {
        badge.textContent = 'Trống';
      } else {
        const durTxt = formatTimeClock(tr.durationSec);
        badge.textContent = tr.autoTune.enabled ? `${durTxt} · AT` : durTxt;
      }
      badge.classList.toggle('has-take', has);
      badge.classList.toggle('has-at', has && tr.autoTune.enabled);
    }
    if (dlBtn) dlBtn.disabled = !has;
    if (sendArrBtn) {
      sendArrBtn.disabled = !has;
      sendArrBtn.classList.toggle('is-ready', has);
    }
    if (delBtn) delBtn.disabled = !has;
    const topSendArrBtn = this.root.querySelector('#vs-btn-send-vocal-arr');
    if (topSendArrBtn) {
      const anyHas = Boolean(
        (this.tracks.lead && this.tracks.lead.rawPcm) ||
        (this.tracks.backing && this.tracks.backing.rawPcm)
      );
      topSendArrBtn.classList.toggle('is-ready', anyHas);
    }
    if (emptyEl) {
      emptyEl.classList.toggle(
        'hidden',
        has || (this.recordPhase === 'recording' && this.recordingTrackId === trackId)
      );
    }
    this._updateRecordButtonsUI();
  }

  _syncAtStatusUI() {
    if (!this.root) return;
    const tr = this.tracks[this.activeTrackId];
    const statusEl = this.root.querySelector('#vs-at-status');
    if (statusEl) {
      statusEl.classList.toggle('hidden', !tr.isProcessingAt);
    }
  }

  _syncPresetHighlight() {
    if (!this.root) return;
    const tr = this.tracks[this.activeTrackId];
    const qq = (sel) => Array.from(this.root.querySelectorAll(sel));
    qq('[data-vs-preset]').forEach((b) =>
      b.classList.toggle('active', b.dataset.vsPreset === tr.presetId)
    );
    const presetStatus = this.root.querySelector('#vs-preset-status');
    if (presetStatus) {
      const found = VOCAL_PRESETS.find((p) => p.id === tr.presetId);
      presetStatus.textContent = found ? `Đang dùng: ${found.name}` : 'Đang tùy chỉnh tay';
    }
  }

  _syncPitchChipHighlight() {
    if (!this.root) return;
    const tr = this.tracks[this.activeTrackId];
    const qq = (sel) => Array.from(this.root.querySelectorAll(sel));
    qq('[data-vs-pitch]').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.vsPitch) === tr.fx.pitch)
    );
  }

  _syncAllUI() {
    if (!this.root) return;
    const q = (sel) => this.root.querySelector(sel);
    const qq = (sel) => Array.from(this.root.querySelectorAll(sel));

    const tr = this.tracks[this.activeTrackId];

    // Đồng bộ Key/Scale/BPM độc lập của Phòng thu
    const bpmInp = q('#vs-bpm-input');
    if (bpmInp) bpmInp.value = String(this.vocalBpm);
    this._syncAutoKeyUI();

    // Card selection & Track pills
    qq('[data-vs-card]').forEach((card) =>
      card.classList.toggle('selected', card.dataset.vsCard === this.activeTrackId)
    );
    qq('.vs-track-pills [data-vs-select]').forEach((btn) =>
      btn.classList.toggle('active', btn.dataset.vsSelect === this.activeTrackId)
    );

    const editTitle = q('#vs-edit-title');
    const editDot = q('#vs-edit-dot');
    if (editTitle) editTitle.textContent = `Đang chỉnh hiệu ứng: ${tr.title}`;
    if (editDot) editDot.style.background = tr.waveColor;

    this._syncBeatTrackUI();
    this._syncExportFormatUI();
    this._syncTrackCardHeader('lead');
    this._syncTrackCardHeader('backing');
    this._syncMuteSoloButtons();
    this._updateTransportButtonsUI();
    this._updateTimelineClockUI();

    // Auto-Tune controls
    const atEn = q('#vs-at-enabled');
    const atStr = q('#vs-at-strength');
    const atStrVal = q('#vs-at-strength-val');
    const atKey = q('#vs-at-key-badge');
    if (atEn) atEn.checked = tr.autoTune.enabled;
    if (atStr) atStr.value = String(tr.autoTune.strength);
    if (atStrVal) atStrVal.textContent = `${tr.autoTune.strength}%`;
    if (atKey) atKey.textContent = this._getKeyBadgeText();
    this._syncAtStatusUI();

    // Presets
    this._syncPresetHighlight();

    // Kệ hiệu ứng
    const setSlider = (id, val, txt) => {
      const inp = q(`#${id}`);
      const lbl = q(`#${id}-val`);
      if (inp) inp.value = String(val);
      if (lbl) lbl.textContent = txt;
    };
    setSlider('vs-fx-gate', tr.fx.gate, tr.fx.gate <= -59 ? 'Tắt' : `${Math.round(tr.fx.gate)} dB`);
    setSlider('vs-fx-comp', tr.fx.comp, `${Math.round(tr.fx.comp)}%`);
    setSlider('vs-fx-eqLow', tr.fx.eqLow, `${tr.fx.eqLow > 0 ? '+' : ''}${tr.fx.eqLow} dB`);
    setSlider('vs-fx-eqMid', tr.fx.eqMid, `${tr.fx.eqMid > 0 ? '+' : ''}${tr.fx.eqMid} dB`);
    setSlider('vs-fx-eqHigh', tr.fx.eqHigh, `${tr.fx.eqHigh > 0 ? '+' : ''}${tr.fx.eqHigh} dB`);
    setSlider('vs-fx-pitch', tr.fx.pitch, `${tr.fx.pitch > 0 ? '+' : ''}${tr.fx.pitch} st`);
    setSlider('vs-fx-reverbMix', tr.fx.reverbMix, `${Math.round(tr.fx.reverbMix)}%`);
    setSlider('vs-fx-reverbDecay', tr.fx.reverbDecay, `${Number(tr.fx.reverbDecay).toFixed(1)}s`);
    setSlider('vs-fx-delayMix', tr.fx.delayMix, `${Math.round(tr.fx.delayMix)}%`);

    qq('[data-vs-delay-div]').forEach((b) =>
      b.classList.toggle('active', b.dataset.vsDelayDiv === tr.fx.delayDiv)
    );
    this._syncPitchChipHighlight();
  }

  syncFromApp({ micGain, echoCancellation } = {}) {
    if (!this.root) return;
    if (typeof micGain === 'number') {
      const inp = this.root.querySelector('#vs-mic-gain');
      const lbl = this.root.querySelector('#vs-mic-gain-val');
      if (inp) inp.value = micGain.toFixed(1);
      if (lbl) lbl.textContent = formatGainDb(micGain);
      this.vocalCapture.setMicGain(micGain);
    }
    if (typeof echoCancellation === 'boolean') {
      const chk = this.root.querySelector('#vs-chk-echo');
      if (chk) chk.checked = echoCancellation;
    }
  }

  onContextChange() {
    this.resizeAndRedraw();
  }

  resizeAndRedraw() {
    requestAnimationFrame(() => {
      this._redrawAllWaveforms();
    });
  }

  _redrawAllWaveforms() {
    this._drawBeatWaveform();
    this._drawVocalTrackWaveform('lead');
    this._drawVocalTrackWaveform('backing');
  }

  _drawPlayheadLine(ctx, w, h, totalTimelineSec) {
    if (totalTimelineSec <= 0) return;
    const ratio = Math.max(0, Math.min(1, this.currentTimeSec / totalTimelineSec));
    const px = Math.max(0.5, Math.min(w - 0.5, ratio * w));
    ctx.strokeStyle = '#FAFAFA';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  _drawBeatWaveform() {
    if (!this.root) return;
    const canvas = this.root.querySelector('#vs-wave-beat');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 16) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0B0C0E';
    ctx.fillRect(0, 0, w, h);

    // Lưới chia thời gian nhẹ
    for (let i = 1; i < 8; i++) {
      const x = Math.round((i / 8) * w) + 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const totalTimeline = this.getTotalTimelineDurationSec();
    const peaks = this.beatTrack.wavePeaks;
    if (peaks && peaks.length > 0 && this.beatTrack.durationSec > 0 && totalTimeline > 0) {
      const beatWidthPx = Math.min(w, (this.beatTrack.durationSec / totalTimeline) * w);
      ctx.fillStyle = this.beatTrack.muted ? 'rgba(113, 113, 122, 0.35)' : '#D4D4D8';
      for (let x = 0; x < beatWidthPx; x += 2.5) {
        const idx = Math.min(peaks.length - 1, Math.floor((x / beatWidthPx) * peaks.length));
        const barH = Math.max(2, peaks[idx] * (h - 8));
        ctx.fillRect(x, (h - barH) / 2, 1.6, barH);
      }
    }

    this._drawPlayheadLine(ctx, w, h, totalTimeline);
    ctx.restore();
  }

  _drawVocalTrackWaveform(trackId) {
    if (!this.root) return;
    const canvas = this.root.querySelector(`#vs-wave-${trackId}`);
    const tr = this.tracks[trackId];
    if (!canvas || !tr) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 16) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0B0C0E';
    ctx.fillRect(0, 0, w, h);

    for (let i = 1; i < 8; i++) {
      const x = Math.round((i / 8) * w) + 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const totalTimeline = this.getTotalTimelineDurationSec();
    const isRecThis = this.recordPhase === 'recording' && this.recordingTrackId === trackId;

    if (isRecThis && this._liveWavePeaks.length > 0) {
      const cols = this._liveWavePeaks;
      ctx.fillStyle = tr.waveColor;
      const startX =
        totalTimeline > 0 ? Math.min(w - 10, (this._recStartOffsetSec / totalTimeline) * w) : 0;
      const availW = Math.max(20, w - startX);
      const maxCols = Math.max(80, cols.length);
      const colStep = availW / maxCols;
      for (let i = 0; i < cols.length; i++) {
        const amp = Math.min(1, cols[i] * 1.15);
        const barH = Math.max(2, amp * (h - 8));
        const x = startX + i * colStep;
        if (x >= w) break;
        ctx.fillRect(x, (h - barH) / 2, Math.max(1.5, colStep * 0.72), barH);
      }
    } else {
      const pcm = tr.autoTune.enabled && tr.tunedPcm ? tr.tunedPcm : tr.rawPcm;
      if (pcm && pcm.length > 0 && totalTimeline > 0) {
        if (!tr.wavePeaks) this._rebuildWavePeaks(trackId);
        const peaks = tr.wavePeaks;
        if (peaks && peaks.length > 0) {
          const sr = tr.sampleRate || 44100;
          const clipStartSec = Math.max(0, (tr.startTimeSec || 0) + (tr.syncOffsetMs || 0) / 1000);
          const clipDurSec = pcm.length / sr;
          const startX = Math.max(0, Math.min(w - 2, (clipStartSec / totalTimeline) * w));
          const fullClipW = Math.max(4, (clipDurSec / totalTimeline) * w);
          const clipW = Math.min(w - startX, fullClipW);

          ctx.fillStyle = tr.muted
            ? 'rgba(113, 113, 122, 0.35)'
            : tr.autoTune.enabled && trackId === 'lead'
              ? '#FFFFFF'
              : tr.waveColor;

          const numBins = peaks.length;
          for (let dx = 0; dx < clipW; dx += 2.5) {
            const b0 = Math.min(numBins - 1, Math.floor((dx / fullClipW) * numBins));
            const b1 = Math.min(numBins - 1, Math.floor(((dx + 2.5) / fullClipW) * numBins));
            let peak = 0;
            for (let b = b0; b <= b1; b++) {
              if (peaks[b] > peak) peak = peaks[b];
            }
            const barH = Math.max(2, peak * (h - 8));
            ctx.fillRect(startX + dx, (h - barH) / 2, 1.6, barH);
          }
        }
      }
    }

    this._drawPlayheadLine(ctx, w, h, totalTimeline);
    ctx.restore();
  }
}
