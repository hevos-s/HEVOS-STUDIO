// ============================================================================
// arrangementStudio.js — Phân khu 5: Dựng bài Đa Kênh & Mastering Studio
// - Lưới Playlist đa Track (kéo, cắt Split, Trim 2 đầu, Fade-In/Out, Nhân bản)
// - Kho Clip trung tâm (từ Sáng tác Beat, Phòng thu Vocal, hoặc nhập Audio)
// - Chuỗi Mastering đồng nhất Live + OfflineAudioContext:
//   3-Band Master EQ -> Stereo Width (Mid/Side) -> Glue Compressor ->
//   Master Limiter / Maximizer (-0.3 dBFS Ceiling) -> Xuất Stereo .WAV 16/24-bit
// - Tích hợp StemAnalyzerStudio: Tách 4 Stems & Phân tích hợp âm/BPM tự động
// ============================================================================

import { StemAnalyzerStudio } from './stemAnalyzer.js?v=33';

export const MASTERING_PRESETS = [
  {
    id: 'clean',
    name: 'Tự nhiên',
    sub: 'Clean Balance',
    eqLow: 0,
    eqMid: 0,
    eqHigh: 0,
    width: 100,
    glue: 18,
    driveDb: 1.0,
  },
  {
    id: 'rnb_pop',
    name: 'R&B / Pop',
    sub: 'Streaming Ready',
    eqLow: 2.2,
    eqMid: 0.8,
    eqHigh: 2.6,
    width: 116,
    glue: 52,
    driveDb: 4.5,
  },
  {
    id: 'warm_tape',
    name: 'Ấm áp Analog',
    sub: 'Warm Tape',
    eqLow: 3.0,
    eqMid: 1.4,
    eqHigh: -1.2,
    width: 105,
    glue: 64,
    driveDb: 3.2,
  },
  {
    id: 'punchy',
    name: 'Mạnh mẽ & Sáng rõ',
    sub: 'Punchy Modern',
    eqLow: 3.6,
    eqMid: -0.6,
    eqHigh: 3.4,
    width: 124,
    glue: 70,
    driveDb: 6.2,
  },
];

const DEFAULT_TRACKS = [
  { id: 't1', name: 'Track 1 · Beat Nền', color: '#8B5CF6' },
  { id: 't2', name: 'Track 2 · Nhạc Cụ / Loop', color: '#38BDF8' },
  { id: 't3', name: 'Track 3 · Giọng Chính', color: '#EC4899' },
  { id: 't4', name: 'Track 4 · Hát Bè / Ad-lib', color: '#F472B6' },
  { id: 't5', name: 'Track 5 · Hiệu Ứng / FX', color: '#F97316' },
  { id: 't6', name: 'Track 6 · Trống / Bổ Trợ', color: '#22C55E' },
];

const EXTRA_TRACK_COLORS = ['#A78BFA', '#2DD4BF', '#FB7185', '#FBBF24', '#60A5FA'];

const SOURCE_META = {
  studio: { label: 'Beat từ Sáng tác', badgeClass: 'src-studio', defaultTrack: 0, color: '#8B5CF6' },
  vocal: { label: 'Vocal từ Phòng thu', badgeClass: 'src-vocal', defaultTrack: 2, color: '#EC4899' },
  'vocal-beat': { label: 'Beat Phòng thu', badgeClass: 'src-vbeat', defaultTrack: 0, color: '#6366F1' },
  file: { label: 'File nhập ngoài', badgeClass: 'src-file', defaultTrack: 1, color: '#38BDF8' },
};

const ROW_HEIGHT = 76;
const WAVE_BINS = 320;
const MASTER_CEILING_LINEAR = 0.96605; // -0.3 dBFS

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function gainToDb(g) {
  if (!g || g <= 0.00001) return -96;
  return 20 * Math.log10(g);
}

function formatClockTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

function formatClockBarBeat(sec, bpm) {
  const safeBpm = clamp(Number(bpm) || 84, 40, 240);
  const totalBeats = Math.max(0, sec) * (safeBpm / 60);
  const bar = Math.floor(totalBeats / 4) + 1;
  const beatInBar = Math.floor(totalBeats % 4) + 1;
  const step16 = Math.floor((totalBeats % 1) * 4) + 1;
  return `${bar}.${beatInBar}.${step16}`;
}

function formatPanText(panVal) {
  const p = Math.round(panVal || 0);
  if (Math.abs(p) <= 2) return 'C';
  return p < 0 ? `L${Math.abs(p)}` : `R${p}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hexToRgba(hex, alpha) {
  const clean = String(hex || '#8B5CF6').replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function computeAudioBufferPeaks(audioBuffer, numBins = WAVE_BINS) {
  const peaks = new Float32Array(numBins);
  if (!audioBuffer || audioBuffer.length === 0) return peaks;
  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0;
  const totalLen = audioBuffer.length;
  const step = Math.max(1, Math.floor(totalLen / numBins));
  let maxP = 0.06;

  for (let b = 0; b < numBins; b++) {
    const start = Math.floor((b / numBins) * totalLen);
    const end = Math.min(totalLen, start + step);
    const stride = Math.max(1, Math.floor((end - start) / 14));
    let p = 0;
    for (let i = start; i < end; i += stride) {
      const a = Math.max(Math.abs(ch0[i]), Math.abs(ch1[i]));
      if (a > p) p = a;
    }
    peaks[b] = p;
    if (p > maxP) maxP = p;
  }

  for (let b = 0; b < numBins; b++) {
    peaks[b] = clamp(peaks[b] / maxP, 0, 1);
  }
  return peaks;
}

function createCeilingCurve(ceiling = MASTER_CEILING_LINEAR) {
  const size = 2049;
  const curve = new Float32Array(size);
  const knee = ceiling * 0.86;
  const headroom = ceiling - knee;
  for (let i = 0; i < size; i++) {
    const x = (i * 2) / (size - 1) - 1;
    const ax = Math.abs(x);
    if (ax <= knee) {
      curve[i] = x;
    } else {
      const over = (ax - knee) / Math.max(0.0001, headroom);
      const shaped = knee + headroom * Math.tanh(over);
      curve[i] = Math.sign(x) * Math.min(ceiling, shaped);
    }
  }
  return curve;
}

/**
 * Chuỗi DSP Mastering dùng chung cho cả phát Live (AudioContext) và Xuất WAV (OfflineAudioContext):
 * 3-Band EQ -> Mid/Side Stereo Width (0..140%) -> Glue Compressor -> Limiter Maximizer (-0.3dBFS)
 */
export function buildMasteringChain(ctx, params, destination, { tapMeters = false } = {}) {
  const input = ctx.createGain();
  input.gain.value = 1.0;
  input.channelCount = 2;
  input.channelCountMode = 'explicit';

  const eqLow = ctx.createBiquadFilter();
  eqLow.type = 'lowshelf';
  eqLow.frequency.value = 100;

  const eqMid = ctx.createBiquadFilter();
  eqMid.type = 'peaking';
  eqMid.frequency.value = 1500;
  eqMid.Q.value = 1.0;

  const eqHigh = ctx.createBiquadFilter();
  eqHigh.type = 'highshelf';
  eqHigh.frequency.value = 8000;

  // Ma trận Stereo Width Mid/Side: L' = (1+w)/2 * L + (1-w)/2 * R; R' = (1-w)/2 * L + (1+w)/2 * R
  const widthSplitter = ctx.createChannelSplitter(2);
  const widthMerger = ctx.createChannelMerger(2);
  const gLL = ctx.createGain();
  const gRR = ctx.createGain();
  const gLR = ctx.createGain();
  const gRL = ctx.createGain();

  const glueComp = ctx.createDynamicsCompressor();
  glueComp.knee.value = 12;
  glueComp.attack.value = 0.015;
  glueComp.release.value = 0.18;

  const glueMakeup = ctx.createGain();

  const driveGain = ctx.createGain();
  const limiterComp = ctx.createDynamicsCompressor();
  limiterComp.threshold.value = -1.5;
  limiterComp.knee.value = 2;
  limiterComp.ratio.value = 20;
  limiterComp.attack.value = 0.001;
  limiterComp.release.value = 0.06;

  const ceilingShaper = ctx.createWaveShaper();
  ceilingShaper.curve = createCeilingCurve(MASTER_CEILING_LINEAR);
  ceilingShaper.oversample = '2x';

  input.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(widthSplitter);

  widthSplitter.connect(gLL, 0);
  widthSplitter.connect(gLR, 0);
  widthSplitter.connect(gRR, 1);
  widthSplitter.connect(gRL, 1);

  gLL.connect(widthMerger, 0, 0);
  gRL.connect(widthMerger, 0, 0);
  gRR.connect(widthMerger, 0, 1);
  gLR.connect(widthMerger, 0, 1);

  widthMerger.connect(glueComp);
  glueComp.connect(glueMakeup);
  glueMakeup.connect(driveGain);
  driveGain.connect(limiterComp);
  limiterComp.connect(ceilingShaper);
  ceilingShaper.connect(destination);

  let analyserL = null;
  let analyserR = null;
  if (tapMeters) {
    const mSplit = ctx.createChannelSplitter(2);
    analyserL = ctx.createAnalyser();
    analyserR = ctx.createAnalyser();
    analyserL.fftSize = 512;
    analyserR.fftSize = 512;
    ceilingShaper.connect(mSplit);
    mSplit.connect(analyserL, 0);
    mSplit.connect(analyserR, 1);
  }

  const update = (nextParams) => {
    const p = nextParams || {};
    eqLow.gain.value = clamp(Number(p.eqLow) || 0, -12, 12);
    eqMid.gain.value = clamp(Number(p.eqMid) || 0, -12, 12);
    eqHigh.gain.value = clamp(Number(p.eqHigh) || 0, -12, 12);

    const w = clamp(Number(p.width ?? 100), 0, 140) / 100;
    const sameG = (1 + w) * 0.5;
    const crossG = (1 - w) * 0.5;
    gLL.gain.value = sameG;
    gRR.gain.value = sameG;
    gLR.gain.value = crossG;
    gRL.gain.value = crossG;

    const glueNorm = clamp(Number(p.glue ?? 30), 0, 100) / 100;
    glueComp.threshold.value = -4 - glueNorm * 20;
    glueComp.ratio.value = 1.2 + glueNorm * 3.3;
    glueMakeup.gain.value = dbToGain(glueNorm * 3.2);

    const driveDb = clamp(Number(p.driveDb ?? 2), 0, 9);
    driveGain.gain.value = dbToGain(driveDb);
  };

  update(params);

  return {
    input,
    analyserL,
    analyserR,
    update,
  };
}

/**
 * Mã hóa AudioBuffer Stereo sang Blob .WAV PCM 16-bit hoặc 24-bit
 */
export function encodeStereoAudioBufferToWavBlob(audioBuffer, bitDepth = 24) {
  const depth = bitDepth === 16 ? 16 : 24;
  const numChannels = 2;
  const sampleRate = audioBuffer.sampleRate || 44100;
  const numFrames = audioBuffer.length;
  const bytesPerSample = depth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(off + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, depth, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

  let offset = 44;
  if (depth === 16) {
    for (let i = 0; i < numFrames; i++) {
      const l = clamp(left[i], -1, 1);
      const r = clamp(right[i], -1, 1);
      view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
      view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      offset += 4;
    }
  } else {
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < numFrames; i++) {
      const l = clamp(left[i], -1, 1);
      const r = clamp(right[i], -1, 1);
      const il = Math.round(l < 0 ? l * 8388608 : l * 8388607);
      const ir = Math.round(r < 0 ? r * 8388608 : r * 8388607);
      bytes[offset] = il & 0xff;
      bytes[offset + 1] = (il >> 8) & 0xff;
      bytes[offset + 2] = (il >> 16) & 0xff;
      bytes[offset + 3] = ir & 0xff;
      bytes[offset + 4] = (ir >> 8) & 0xff;
      bytes[offset + 5] = (ir >> 16) & 0xff;
      offset += 6;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export class ArrangementStudio {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    this.cb = callbacks; // { getStudioBpm, onPlaybackStateChange, onClipsChanged, showToast }

    this.isSectionActive = false;
    this.activeSubView = 'playlist'; // 'playlist' | 'stems'
    this.stemStudio = null;
    this.bpm = clamp(Number(callbacks.getStudioBpm ? callbacks.getStudioBpm() : 84) || 84, 40, 220);
    this.snapMode = 'quarter'; // 'bar' | 'quarter' | 'off'
    this.toolMode = 'move';    // 'move' | 'split' | 'duplicate'
    this.zoom = 1.0;           // 0.35 .. 3.0
    this.bitDepth = 24;

    this.loopEnabled = false;
    this.loopStartBar = 0;
    this.loopEndBar = 4;

    this.tracks = DEFAULT_TRACKS.map((t) => ({
      ...t,
      volume: 85,
      pan: 0,
      muted: false,
      solo: false,
    }));

    this.clipsLibrary = [];
    this.placements = [];
    this.selectedPlacementId = null;
    this._idCounter = 1;

    this.masterPresetId = 'clean';
    this.masterParams = {
      eqLow: 0,
      eqMid: 0,
      eqHigh: 0,
      width: 100,
      glue: 18,
      driveDb: 1.0,
    };

    // Audio playback state
    this.playCtx = null;
    this.masterChain = null;
    this.trackNodes = [];
    this.activeSources = [];
    this.isPlaying = false;
    this.isExporting = false;
    this.currentSec = 0;
    this._playAnchorCtxTime = 0;
    this._playAnchorPosSec = 0;
    this._scheduleSeq = 0;

    // UI / Meter / Canvas state
    this._rafId = null;
    this._lastUiMs = 0;
    this._meterBufL = new Float32Array(512);
    this._meterBufR = new Float32Array(512);
    this._liveAudioLevel = 0;
    this._peakHoldL = 0;
    this._peakHoldR = 0;

    this._drag = null;
    this._hoverX = -1;
    this._hoverY = -1;
    this._hoveredAction = null;
    this._ro = null;

    this._render();
    this._bindEvents();
    this._setupResize();

    this._onVisibilityChange = () => {
      if (document.hidden) {
        this._stopRafLoop();
      } else if (this.isSectionActive) {
        this.resizeAndRedraw();
        if (this.isPlaying) {
          this._startRafLoop();
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _nextId(prefix) {
    this._idCounter += 1;
    return `${prefix}_${this._idCounter}_${Math.floor(Math.random() * 1000)}`;
  }

  _toast(msg, isError = false) {
    if (this.cb.showToast) this.cb.showToast(msg, isError);
  }

  getPxPerSec() {
    // Tai zoom = 1.0 va 84 BPM (~2.857s / o nhip 4 phach): ~32px/giay -> ~91px/o nhip
    return 34 * this.zoom * (this.bpm / 84);
  }

  getBarDurSec() {
    return 4 * (60 / this.bpm);
  }

  getBeatDurSec() {
    return 60 / this.bpm;
  }

  getSongEndSec() {
    let maxEnd = 0;
    for (const pl of this.placements) {
      const end = pl.startSec + pl.durationSec;
      if (end > maxEnd) maxEnd = end;
    }
    return maxEnd;
  }

  getTimelineTotalBars() {
    const endSec = Math.max(
      this.getSongEndSec(),
      this.loopEndBar * this.getBarDurSec(),
      this.currentSec + 2
    );
    const minBars = 16;
    const neededBars = Math.ceil(endSec / this.getBarDurSec()) + 4;
    return Math.max(minBars, neededBars);
  }

  getTimelineWidthPx() {
    const barDur = this.getBarDurSec();
    const totalSec = this.getTimelineTotalBars() * barDur;
    const pxPerSec = this.getPxPerSec();
    const scrollEl = this.root ? this.root.querySelector('#arr-lanes-scroll-x') : null;
    const minW = scrollEl ? scrollEl.clientWidth : 640;
    return Math.max(minW, Math.ceil(totalSec * pxPerSec));
  }

  getClipCount() {
    return this.clipsLibrary.length;
  }

  getAudioLevel() {
    return this.isPlaying ? this._liveAudioLevel : 0;
  }

  setSectionActive(active) {
    this.isSectionActive = Boolean(active);
    if (!this.isSectionActive) {
      this._stopRafLoop();
      if (this.stemStudio) this.stemStudio.pausePlayback();
    } else {
      requestAnimationFrame(() => {
        if (this.activeSubView === 'playlist') {
          this.resizeAndRedraw();
          requestAnimationFrame(() => this.resizeAndRedraw());
        }
      });
      if (this.isPlaying && !document.hidden) {
        this._startRafLoop();
      }
    }
  }

  setSubView(viewName) {
    const next = viewName === 'stems' ? 'stems' : 'playlist';
    if (this.activeSubView === next) {
      if (next === 'playlist') {
        requestAnimationFrame(() => this.resizeAndRedraw());
      }
      return;
    }
    if (next === 'stems' && this.isPlaying) {
      this.pause();
    } else if (next === 'playlist' && this.stemStudio) {
      this.stemStudio.pausePlayback();
    }
    this.activeSubView = next;
    if (this.root) {
      this.root.querySelectorAll('[data-arr-view]').forEach((btn) => {
        const active = btn.dataset.arrView === next;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
      });
      this.root.querySelector('#arr-playlist-view')?.classList.toggle('hidden', next !== 'playlist');
      this.root.querySelector('#arr-stems-panel')?.classList.toggle('hidden', next !== 'stems');
    }
    if (next === 'playlist') {
      requestAnimationFrame(() => this.resizeAndRedraw());
    }
  }

  openStemsAnalyzer() {
    this.setSubView('stems');
  }

  _snapSec(sec) {
    const s = Math.max(0, sec);
    if (this.snapMode === 'off') return s;
    const step = this.snapMode === 'bar'
      ? this.getBarDurSec()
      : this.getBeatDurSec() * 0.25; // 1/4 phach (1/16)
    return Math.max(0, Math.round(s / step) * step);
  }

  _isTrackAudible(trackIndex) {
    const t = this.tracks[trackIndex];
    if (!t) return false;
    const anySolo = this.tracks.some((tr) => tr.solo);
    return !t.muted && (!anySolo || t.solo);
  }

  // ============================================================================
  // Dựng Giao Diện Phân Khu Dựng Bài & Master
  // ============================================================================
  _render() {
    if (!this.root) return;

    const presetsHtml = MASTERING_PRESETS.map((p) => `
      <button type="button" class="arr-preset-card${p.id === this.masterPresetId ? ' active' : ''}" data-arr-preset="${p.id}">
        <span class="arr-preset-name">${escapeHtml(p.name)}</span>
        <span class="arr-preset-sub">${escapeHtml(p.sub)}</span>
      </button>
    `).join('');

    this.root.innerHTML = `
      <div class="arr-shell">
        <div class="arr-top-mode-bar" role="tablist" aria-label="Chế độ Dựng bài và Tách Stems">
          <button type="button" class="arr-mode-tab${this.activeSubView === 'playlist' ? ' active' : ''}" data-arr-view="playlist" role="tab" aria-selected="${this.activeSubView === 'playlist'}">
            <span>🎚️ Playlist &amp; Mastering</span>
          </button>
          <button type="button" class="arr-mode-tab${this.activeSubView === 'stems' ? ' active' : ''}" data-arr-view="stems" role="tab" aria-selected="${this.activeSubView === 'stems'}">
            <span>🎛️ Tách Stems &amp; Phân Tích Hợp Âm</span>
            <span class="badge-new">NEW</span>
          </button>
        </div>

        <div id="arr-playlist-view" class="arr-playlist-view${this.activeSubView !== 'playlist' ? ' hidden' : ''}">
          <!-- 1. Thanh Transport & Công cụ Playlist -->
          <div class="arr-transport">
          <div class="arr-tp-left">
            <button type="button" class="btn arr-tp-rewind" id="arr-btn-rewind" title="Về đầu bài (00:00.0)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="19,20 9,12 19,4" />
                <rect x="5" y="4" width="2.5" height="16" />
              </svg>
            </button>

            <button type="button" class="btn btn-play arr-tp-play" id="arr-btn-play" title="Phát / Tạm dừng (Space)">
              <svg class="icon-play" width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
              <svg class="icon-stop" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span id="arr-btn-play-label">Phát</span>
            </button>

            <div class="arr-loop-group" title="Bật/tắt Vòng lặp vùng chọn theo Ô nhịp">
              <button type="button" class="toggle-pill arr-loop-btn" id="arr-btn-loop" aria-pressed="false">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
                <span>Loop</span>
              </button>
              <input type="number" class="arr-num-mini mono-val" id="arr-loop-start" min="1" max="64" value="1" title="Ô nhịp bắt đầu Loop" aria-label="Ô bắt đầu Loop" />
              <span class="arr-sep">→</span>
              <input type="number" class="arr-num-mini mono-val" id="arr-loop-end" min="2" max="128" value="5" title="Ô nhịp kết thúc Loop" aria-label="Ô kết thúc Loop" />
            </div>

            <div class="arr-clock-lcd" aria-label="Đồng hồ vị trí">
              <span class="mono-val arr-clock-bars" id="arr-clock-bars">1.1.1</span>
              <span class="arr-clock-div">|</span>
              <span class="mono-val arr-clock-time" id="arr-clock-time">00:00.0</span>
            </div>

            <label class="arr-bpm-pill" title="Nhịp độ dự án (BPM)">
              <span>BPM</span>
              <input type="number" class="arr-bpm-input mono-val" id="arr-bpm-input" min="40" max="220" step="1" value="${this.bpm}" aria-label="BPM Dựng bài" />
            </label>
          </div>

          <div class="arr-tp-tools">
            <div class="seg-group arr-tool-group" id="arr-tool-group" role="group" aria-label="Công cụ thao tác Clip">
              <button type="button" class="seg-btn active" data-arr-tool="move" title="Con trỏ: Di chuyển, cắt đầu/đuôi & tạo Fade">
                <span>Di chuyển</span>
              </button>
              <button type="button" class="seg-btn" data-arr-tool="split" title="Dao cắt: Bấm lên Clip để chia làm 2 phần độc lập">
                <span>Dao cắt</span>
              </button>
              <button type="button" class="seg-btn" data-arr-tool="duplicate" title="Nhân bản nhanh: Bấm vào Clip để nhân đôi nối tiếp">
                <span>Nhân bản</span>
              </button>
            </div>

            <div class="arr-sel-actions">
              <button type="button" class="btn btn-ghost btn-xs" id="arr-btn-dup-sel" disabled title="Nhân đôi Clip đang chọn">
                <span>+ Nhân đôi</span>
              </button>
              <button type="button" class="btn btn-rose-outline btn-xs" id="arr-btn-del-sel" disabled title="Xóa Clip đang chọn (Delete)">
                <span>Xóa Clip</span>
              </button>
            </div>

            <label class="arr-snap-field" title="Chế độ khóa lưới thời gian">
              <span class="arr-field-lbl">Snap</span>
              <select id="arr-snap-select" class="studio-select compact" aria-label="Khóa lưới Timeline">
                <option value="bar">Ô nhịp (1 Bar)</option>
                <option value="quarter" selected>1/4 Phách</option>
                <option value="off">Tự do (Off · ms)</option>
              </select>
            </label>

            <label class="arr-zoom-field" title="Thu phóng ngang trục thời gian">
              <span class="arr-field-lbl">Zoom</span>
              <input type="range" class="studio-range arr-zoom-range" id="arr-zoom-range" min="0.35" max="2.8" step="0.05" value="${this.zoom}" aria-label="Thu phóng Timeline" />
            </label>

            <button type="button" class="btn btn-amber-solid arr-export-btn" id="arr-btn-export-wav" title="Kết xuất toàn bộ Track qua chuỗi Mastering ra file .WAV">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span id="arr-export-label">Xuất Sản Phẩm (.WAV)</span>
            </button>
          </div>
        </div>

        <!-- 2. Bố cục 3 Cột: Kho Clip (Trái) | Timeline Đa Kênh (Giữa) | Kệ Mastering (Phải) -->
        <div class="arr-body">
          <!-- Cột Trái: Kho Clip & Nguồn Âm Thanh -->
          <aside class="arr-browser" id="arr-clip-browser" aria-label="Kho Clip Âm Thanh">
            <div class="arr-panel-head">
              <div class="arr-panel-title">
                <span class="arr-dot-accent"></span>
                <span>KHO CLIP</span>
                <span class="arr-count-badge mono-val" id="arr-clip-count">0</span>
              </div>
              <button type="button" class="btn btn-indigo-solid btn-xs" id="arr-btn-import-file">
                <span>+ Nhập Audio</span>
              </button>
            </div>
            <input type="file" id="arr-file-input" class="hidden" multiple accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac" />

            <div class="arr-dropzone" id="arr-dropzone">
              <span>Kéo thả .mp3 / .wav / .m4a vào đây, hoặc gửi từ Sáng tác Beat &amp; Phòng thu Vocal</span>
            </div>

            <div class="arr-clip-list" id="arr-clip-list"></div>
          </aside>

          <!-- Khu Vực Trung Tâm: Lưới Timeline Đa Kênh -->
          <section class="arr-playlist" aria-label="Lưới Dựng bài Playlist">
            <div class="arr-playlist-scroll-y" id="arr-playlist-scroll-y">
              <!-- Thước thời gian cố định trên cùng -->
              <div class="arr-ruler-row">
                <div class="arr-corner">
                  <span>KÊNH TRACK</span>
                  <button type="button" class="arr-add-track-mini" id="arr-btn-add-track" title="Thêm hàng Track mới">+ Track</button>
                </div>
                <div class="arr-ruler-viewport" id="arr-ruler-viewport">
                  <canvas id="arr-ruler-canvas" aria-label="Thước đo ô nhịp và Playhead"></canvas>
                </div>
              </div>

              <!-- Danh sách Header Track (Trái) + Lưới Waveforms (Phải) khóa khớp chiều cao -->
              <div class="arr-tracks-row">
                <div class="arr-track-headers" id="arr-track-headers"></div>
                <div class="arr-lanes-scroll-x" id="arr-lanes-scroll-x">
                  <div class="arr-timeline-stage" id="arr-timeline-stage">
                    <canvas id="arr-timeline-canvas" aria-label="Vùng sắp xếp Clip đa kênh"></canvas>
                  </div>
                </div>
              </div>
            </div>

            <div class="arr-playlist-hint" id="arr-playlist-hint">
              <span>💡 Mẹo: Kéo khối Clip để đổi thời gian/kênh · Kéo 2 cạnh để Trim · Kéo 2 góc trên để tạo Fade-In/Out · Đổi "Dao cắt" rồi bấm vào Clip để cắt đôi.</span>
            </div>
          </section>

          <!-- Cột Phải / Phía dưới Mobile: Kệ Mix & Master Tổng -->
          <aside class="arr-master-rack" id="arr-master-rack" aria-label="Kệ Mix và Mastering Tổng">
            <div class="arr-panel-head">
              <div class="arr-panel-title">
                <span class="arr-dot-master"></span>
                <span>MIX &amp; MASTER TỔNG</span>
              </div>
              <span class="arr-ceiling-badge mono-val" id="arr-clip-led">SAFE · -0.3dB</span>
            </div>

            <!-- Đồng hồ đo Stereo L / R Peak & Loudness -->
            <div class="arr-meters-box">
              <div class="arr-meter-row">
                <span class="arr-meter-ch mono-val">L</span>
                <div class="arr-meter-track">
                  <div class="arr-meter-fill" id="arr-meter-l"></div>
                </div>
                <span class="arr-meter-db mono-val" id="arr-peak-l">-∞</span>
              </div>
              <div class="arr-meter-row">
                <span class="arr-meter-ch mono-val">R</span>
                <div class="arr-meter-track">
                  <div class="arr-meter-fill" id="arr-meter-r"></div>
                </div>
                <span class="arr-meter-db mono-val" id="arr-peak-r">-∞</span>
              </div>
            </div>

            <!-- 4 Preset Mastering 1 chạm -->
            <div class="arr-rack-block">
              <div class="arr-subhead">PRESET MASTERING (1 CHẠM)</div>
              <div class="arr-presets-grid" id="arr-presets-grid">
                ${presetsHtml}
              </div>
            </div>

            <!-- Master EQ 3 Dải + Stereo Width + Glue + Maximizer -->
            <div class="arr-rack-block">
              <div class="arr-subhead">MASTER EQ 3 DẢI &amp; KHÔNG GIAN</div>

              <label class="arr-fx-row">
                <span>Low (Trầm 100Hz)</span>
                <input type="range" class="studio-range" id="arr-eq-low" min="-12" max="12" step="0.5" value="${this.masterParams.eqLow}" />
                <span class="mono-val arr-fx-val" id="arr-eq-low-val">+0.0 dB</span>
              </label>

              <label class="arr-fx-row">
                <span>Mid (Trung 1.5kHz)</span>
                <input type="range" class="studio-range" id="arr-eq-mid" min="-12" max="12" step="0.5" value="${this.masterParams.eqMid}" />
                <span class="mono-val arr-fx-val" id="arr-eq-mid-val">+0.0 dB</span>
              </label>

              <label class="arr-fx-row">
                <span>High (Sáng Air 8kHz)</span>
                <input type="range" class="studio-range" id="arr-eq-high" min="-12" max="12" step="0.5" value="${this.masterParams.eqHigh}" />
                <span class="mono-val arr-fx-val" id="arr-eq-high-val">+0.0 dB</span>
              </label>

              <label class="arr-fx-row" title="0% = Mono kiểm tra pha · 100% = Gốc · 140% = Rộng mở Stereo">
                <span>Stereo Width</span>
                <input type="range" class="studio-range" id="arr-width" min="0" max="140" step="1" value="${this.masterParams.width}" />
                <span class="mono-val arr-fx-val" id="arr-width-val">${this.masterParams.width}%</span>
              </label>
            </div>

            <div class="arr-rack-block">
              <div class="arr-subhead">GLUE COMPRESSOR &amp; LIMITER</div>

              <label class="arr-fx-row" title="Gắn kết Beat và Vocal hòa quyện thành một khối mượt mà">
                <span>Glue Compressor</span>
                <input type="range" class="studio-range" id="arr-glue" min="0" max="100" step="1" value="${this.masterParams.glue}" />
                <span class="mono-val arr-fx-val" id="arr-glue-val">${this.masterParams.glue}%</span>
              </label>

              <label class="arr-fx-row" title="Đẩy độ lớn tổng thể, khóa trần an toàn ở -0.3 dBFS chống rè vỡ">
                <span>Limiter Drive</span>
                <input type="range" class="studio-range" id="arr-drive" min="0" max="9" step="0.2" value="${this.masterParams.driveDb}" />
                <span class="mono-val arr-fx-val" id="arr-drive-val">+${this.masterParams.driveDb.toFixed(1)} dB</span>
              </label>
            </div>

            <div class="arr-export-footer">
              <div class="arr-bitdepth-row">
                <span>Chất lượng WAV</span>
                <div class="seg-group" id="arr-bitdepth-group">
                  <button type="button" class="seg-btn" data-arr-bit="16">16-bit</button>
                  <button type="button" class="seg-btn active" data-arr-bit="24">24-bit</button>
                </div>
              </div>
              <button type="button" class="btn btn-amber-solid arr-export-side-btn" id="arr-btn-export-wav-side">
                <span>Xuất Sản Phẩm (.WAV)</span>
              </button>
            </div>
          </aside>
        </div>
        </div>

        <!-- Phân khu Tách Stems & Phân Tích Hợp Âm Tự Động -->
        <div id="arr-stems-panel" class="arr-stems-panel${this.activeSubView !== 'stems' ? ' hidden' : ''}"></div>
      </div>
    `;

    this._renderTrackHeaders();
    this._renderClipsLibrary();
    this._syncMasterSlidersUI();

    const stemsPanel = this.root.querySelector('#arr-stems-panel');
    if (stemsPanel) {
      this.stemStudio = new StemAnalyzerStudio(stemsPanel, {
        renderStudioBeat: this.cb.renderStudioBeat,
        onSendStemsToPlaylist: (items) => {
          if (!Array.isArray(items) || items.length === 0) return;
          const imported = [];
          items.forEach((item, idx) => {
            const clip = this.importClip({
              name: item.name,
              sourceType: item.sourceType || 'studio',
              audioBuffer: item.audioBuffer,
              bpm: item.bpm || this.bpm,
              color: item.color,
              suggestedTrackIndex: item.suggestedTrackIndex ?? (idx % this.tracks.length),
              autoPlace: false,
            });
            if (clip) {
              this.placeClipOnTimeline(clip.id, {
                trackIndex: Math.min(this.tracks.length - 1, item.suggestedTrackIndex ?? idx),
                startSec: 0,
              });
              imported.push(clip);
            }
          });
          if (imported.length > 0) {
            this.setSubView('playlist');
            this._toast(`Đã đưa ${imported.length} Stems tách rời lên lưới Playlist & Master!`);
          }
        },
        onApplyChordsToStudio: this.cb.onApplyChordsToStudio,
        onPracticeChordsInTrainer: this.cb.onPracticeChordsInTrainer,
        showToast: this.cb.showToast,
      });
    }
  }

  _renderTrackHeaders() {
    const container = this.root ? this.root.querySelector('#arr-track-headers') : null;
    if (!container) return;

    container.innerHTML = this.tracks.map((tr, idx) => `
      <div class="arr-tr-header${!this._isTrackAudible(idx) ? ' is-muted' : ''}" data-arr-tr-idx="${idx}">
        <div class="arr-tr-top">
          <span class="arr-tr-dot" style="background:${tr.color}"></span>
          <button type="button" class="arr-tr-name" data-arr-rename="${idx}" title="Bấm để đổi tên Track">${escapeHtml(tr.name)}</button>
          <div class="ms-btns arr-tr-ms">
            <button type="button" class="ms-btn${tr.muted ? ' active-mute' : ''}" data-arr-mute="${idx}" title="Tắt tiếng (Mute)">M</button>
            <button type="button" class="ms-btn${tr.solo ? ' active-solo' : ''}" data-arr-solo="${idx}" title="Nghe riêng (Solo)">S</button>
          </div>
        </div>
        <div class="arr-tr-sliders">
          <label class="arr-tr-slider-row" title="Âm lượng Track">
            <span>Vol</span>
            <input type="range" class="studio-range" min="0" max="100" step="1" value="${tr.volume}" data-arr-vol="${idx}" />
            <span class="mono-val" data-arr-vol-val="${idx}">${tr.volume}%</span>
          </label>
          <label class="arr-tr-slider-row" title="Pan Trái/Phải (nháy đúp để về giữa)">
            <span>Pan</span>
            <input type="range" class="studio-range" min="-100" max="100" step="1" value="${tr.pan}" data-arr-pan="${idx}" />
            <span class="mono-val" data-arr-pan-val="${idx}">${formatPanText(tr.pan)}</span>
          </label>
        </div>
      </div>
    `).join('');
  }

  _renderClipsLibrary() {
    const list = this.root ? this.root.querySelector('#arr-clip-list') : null;
    const countEl = this.root ? this.root.querySelector('#arr-clip-count') : null;
    if (countEl) countEl.textContent = String(this.clipsLibrary.length);
    if (this.cb.onClipsChanged) this.cb.onClipsChanged(this.clipsLibrary.length);
    if (!list) return;

    if (this.clipsLibrary.length === 0) {
      list.innerHTML = `
        <div class="arr-clip-empty">
          <strong>Kho Clip đang trống</strong>
          <span>Bấm <b>Gửi Beat sang Dựng bài →</b> bên Sáng tác Beat, gửi Vocal bên Phòng thu, hoặc nhập file Audio tại đây.</span>
        </div>
      `;
      return;
    }

    list.innerHTML = this.clipsLibrary.map((clip) => {
      const meta = SOURCE_META[clip.sourceType] || SOURCE_META.file;
      return `
        <div class="arr-clip-item" draggable="true" data-arr-clip-id="${clip.id}">
          <div class="arr-clip-top">
            <span class="arr-clip-src-badge ${meta.badgeClass}">${escapeHtml(meta.label)}</span>
            <span class="mono-val arr-clip-dur">${formatClockTime(clip.durationSec)}</span>
          </div>
          <div class="arr-clip-name" title="${escapeHtml(clip.name)}">
            <span class="arr-clip-dot" style="background:${clip.color}"></span>
            <span>${escapeHtml(clip.name)}</span>
          </div>
          <div class="arr-clip-actions">
            <button type="button" class="btn btn-cyan-outline btn-xs arr-place-btn" data-arr-place-clip="${clip.id}" title="Đặt Clip vào hàng Track phù hợp trên Timeline">
              <span>+ Đặt vào Timeline</span>
            </button>
            <button type="button" class="icon-btn arr-clip-del-btn" data-arr-del-clip="${clip.id}" title="Xóa Clip khỏi kho">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  _bindEvents() {
    if (!this.root) return;
    const q = (sel) => this.root.querySelector(sel);
    const qq = (sel) => Array.from(this.root.querySelectorAll(sel));

    qq('[data-arr-view]').forEach((btn) => {
      btn.addEventListener('click', () => this.setSubView(btn.dataset.arrView));
    });

    // Transport buttons
    q('#arr-btn-rewind')?.addEventListener('click', () => {
      this.seekTo(this.loopEnabled ? this.loopStartBar * this.getBarDurSec() : 0);
    });

    q('#arr-btn-play')?.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    q('#arr-btn-loop')?.addEventListener('click', () => {
      this.loopEnabled = !this.loopEnabled;
      const btn = q('#arr-btn-loop');
      if (btn) {
        btn.classList.toggle('active', this.loopEnabled);
        btn.setAttribute('aria-pressed', String(this.loopEnabled));
      }
      this._drawRuler();
      this._drawTimeline();
      if (this.isPlaying) this._reschedulePlayback();
    });

    q('#arr-loop-start')?.addEventListener('change', (e) => {
      const bar = Math.max(1, Math.round(Number(e.target.value) || 1)) - 1;
      this.loopStartBar = bar;
      if (this.loopEndBar <= this.loopStartBar) {
        this.loopEndBar = this.loopStartBar + 1;
        const endInp = q('#arr-loop-end');
        if (endInp) endInp.value = String(this.loopEndBar + 1);
      }
      e.target.value = String(this.loopStartBar + 1);
      this._updateStageSize();
      this.resizeAndRedraw();
      if (this.isPlaying && this.loopEnabled) this._reschedulePlayback();
    });

    q('#arr-loop-end')?.addEventListener('change', (e) => {
      const barEnd = Math.max(this.loopStartBar + 1, Math.round(Number(e.target.value) || 4) - 1);
      this.loopEndBar = barEnd;
      e.target.value = String(this.loopEndBar + 1);
      this._updateStageSize();
      this.resizeAndRedraw();
      if (this.isPlaying && this.loopEnabled) this._reschedulePlayback();
    });

    q('#arr-bpm-input')?.addEventListener('change', (e) => {
      const nextBpm = clamp(Math.round(Number(e.target.value) || 84), 40, 220);
      this.bpm = nextBpm;
      e.target.value = String(nextBpm);
      this._updateStageSize();
      this._updateClockUI();
      this.resizeAndRedraw();
    });

    // Tools: Move / Split / Duplicate
    q('#arr-tool-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-arr-tool]');
      if (!btn) return;
      this.toolMode = btn.dataset.arrTool;
      qq('[data-arr-tool]').forEach((b) => b.classList.toggle('active', b === btn));
      const canvas = q('#arr-timeline-canvas');
      if (canvas) {
        canvas.style.cursor =
          this.toolMode === 'split'
            ? 'col-resize'
            : this.toolMode === 'duplicate'
              ? 'copy'
              : 'default';
      }
      this._drawTimeline();
    });

    q('#arr-btn-dup-sel')?.addEventListener('click', () => {
      if (this.selectedPlacementId) {
        this.duplicatePlacement(this.selectedPlacementId);
      }
    });

    q('#arr-btn-del-sel')?.addEventListener('click', () => {
      if (this.selectedPlacementId) {
        this.removePlacement(this.selectedPlacementId);
      }
    });

    q('#arr-snap-select')?.addEventListener('change', (e) => {
      this.snapMode = e.target.value;
    });

    q('#arr-zoom-range')?.addEventListener('input', (e) => {
      this.zoom = clamp(Number(e.target.value) || 1, 0.35, 2.8);
      this._updateStageSize();
      this.resizeAndRedraw();
    });

    // Export WAV
    q('#arr-btn-export-wav')?.addEventListener('click', () => this.exportMasterWav());
    q('#arr-btn-export-wav-side')?.addEventListener('click', () => this.exportMasterWav());

    // Clip Import
    const fileInput = q('#arr-file-input');
    q('#arr-btn-import-file')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      for (const file of files) {
        await this.importAudioFile(file);
      }
      fileInput.value = '';
    });

    const dropzone = q('#arr-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
      dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
        for (const file of files) {
          await this.importAudioFile(file);
        }
      });
    }

    // Clip Library events (delegated)
    const clipList = q('#arr-clip-list');
    if (clipList) {
      clipList.addEventListener('click', (e) => {
        const placeBtn = e.target.closest('[data-arr-place-clip]');
        if (placeBtn) {
          this.placeClipOnTimeline(placeBtn.dataset.arrPlaceClip);
          return;
        }
        const delBtn = e.target.closest('[data-arr-del-clip]');
        if (delBtn) {
          this._deleteClipFromLibrary(delBtn.dataset.arrDelClip);
        }
      });

      clipList.addEventListener('dragstart', (e) => {
        const card = e.target.closest('[data-arr-clip-id]');
        if (!card || !e.dataTransfer) return;
        e.dataTransfer.setData('text/hevos-clip-id', card.dataset.arrClipId);
        e.dataTransfer.effectAllowed = 'copy';
      });
    }

    // Track Headers delegated controls
    q('#arr-btn-add-track')?.addEventListener('click', () => this.addTrack());
    const trackHeaders = q('#arr-track-headers');
    if (trackHeaders) {
      trackHeaders.addEventListener('click', (e) => {
        const muteBtn = e.target.closest('[data-arr-mute]');
        if (muteBtn) {
          const idx = Number(muteBtn.dataset.arrMute);
          if (this.tracks[idx]) {
            this.tracks[idx].muted = !this.tracks[idx].muted;
            this._renderTrackHeaders();
            this._updateLiveTrackGains();
            this._drawTimeline();
          }
          return;
        }
        const soloBtn = e.target.closest('[data-arr-solo]');
        if (soloBtn) {
          const idx = Number(soloBtn.dataset.arrSolo);
          if (this.tracks[idx]) {
            this.tracks[idx].solo = !this.tracks[idx].solo;
            this._renderTrackHeaders();
            this._updateLiveTrackGains();
            this._drawTimeline();
          }
          return;
        }
        const renameBtn = e.target.closest('[data-arr-rename]');
        if (renameBtn) {
          const idx = Number(renameBtn.dataset.arrRename);
          const tr = this.tracks[idx];
          if (!tr) return;
          const nextName = window.prompt('Đổi tên hàng Track:', tr.name);
          if (nextName && nextName.trim()) {
            tr.name = nextName.trim().slice(0, 34);
            this._renderTrackHeaders();
          }
        }
      });

      trackHeaders.addEventListener('input', (e) => {
        const volInp = e.target.closest('[data-arr-vol]');
        if (volInp) {
          const idx = Number(volInp.dataset.arrVol);
          if (this.tracks[idx]) {
            this.tracks[idx].volume = Number(volInp.value);
            const lbl = trackHeaders.querySelector(`[data-arr-vol-val="${idx}"]`);
            if (lbl) lbl.textContent = `${this.tracks[idx].volume}%`;
            this._updateLiveTrackGains();
          }
          return;
        }
        const panInp = e.target.closest('[data-arr-pan]');
        if (panInp) {
          const idx = Number(panInp.dataset.arrPan);
          if (this.tracks[idx]) {
            this.tracks[idx].pan = Number(panInp.value);
            const lbl = trackHeaders.querySelector(`[data-arr-pan-val="${idx}"]`);
            if (lbl) lbl.textContent = formatPanText(this.tracks[idx].pan);
            this._updateLiveTrackGains();
          }
        }
      });

      trackHeaders.addEventListener('dblclick', (e) => {
        const panInp = e.target.closest('[data-arr-pan]');
        if (!panInp) return;
        const idx = Number(panInp.dataset.arrPan);
        if (this.tracks[idx]) {
          this.tracks[idx].pan = 0;
          panInp.value = '0';
          const lbl = trackHeaders.querySelector(`[data-arr-pan-val="${idx}"]`);
          if (lbl) lbl.textContent = 'C';
          this._updateLiveTrackGains();
        }
      });
    }

    // Horizontal Scroll Sync for Ruler + Timeline
    const scrollX = q('#arr-lanes-scroll-x');
    if (scrollX) {
      scrollX.addEventListener('scroll', () => {
        this._drawRuler();
        this._drawTimeline();
      }, { passive: true });
    }

    // Ruler Seek
    const rulerCanvas = q('#arr-ruler-canvas');
    if (rulerCanvas) {
      let seekingRuler = false;
      const seekFromEvent = (ev) => {
        const rect = rulerCanvas.getBoundingClientRect();
        const sx = scrollX ? scrollX.scrollLeft : 0;
        const x = clamp(ev.clientX - rect.left, 0, rect.width) + sx;
        const sec = Math.max(0, x / this.getPxPerSec());
        this.seekTo(sec);
      };
      rulerCanvas.addEventListener('pointerdown', (e) => {
        seekingRuler = true;
        rulerCanvas.setPointerCapture?.(e.pointerId);
        seekFromEvent(e);
      });
      rulerCanvas.addEventListener('pointermove', (e) => {
        if (seekingRuler) seekFromEvent(e);
      });
      rulerCanvas.addEventListener('pointerup', () => {
        seekingRuler = false;
      });
      rulerCanvas.addEventListener('pointercancel', () => {
        seekingRuler = false;
      });
    }

    // Timeline Canvas Pointer & Drop
    const tlCanvas = q('#arr-timeline-canvas');
    if (tlCanvas) {
      tlCanvas.addEventListener('pointerdown', (e) => this._onCanvasPointerDown(e));
      tlCanvas.addEventListener('pointermove', (e) => this._onCanvasPointerMove(e));
      tlCanvas.addEventListener('pointerup', (e) => this._onCanvasPointerUp(e));
      tlCanvas.addEventListener('pointercancel', (e) => this._onCanvasPointerUp(e));
      tlCanvas.addEventListener('pointerleave', () => {
        if (!this._drag) {
          this._hoverX = -1;
          this._hoverY = -1;
          if (this.toolMode === 'split') this._drawTimeline();
        }
      });

      tlCanvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });

      tlCanvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const clipId = e.dataTransfer && e.dataTransfer.getData('text/hevos-clip-id');
        if (!clipId) return;
        const world = this._eventToWorld(e);
        const trackIdx = clamp(Math.floor(world.worldY / ROW_HEIGHT), 0, this.tracks.length - 1);
        const startSec = this._snapSec(world.worldX / this.getPxPerSec());
        this.placeClipOnTimeline(clipId, { trackIndex: trackIdx, startSec });
      });
    }

    // Master Rack Presets & Sliders
    q('#arr-presets-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-arr-preset]');
      if (!btn) return;
      this.applyMasteringPreset(btn.dataset.arrPreset);
    });

    const bindMasterSlider = (id, key, fmt) => {
      const inp = q(id);
      if (!inp) return;
      inp.addEventListener('input', () => {
        this.masterParams[key] = Number(inp.value);
        this.masterPresetId = null;
        this._syncPresetHighlight();
        const valEl = q(`${id}-val`);
        if (valEl) valEl.textContent = fmt(this.masterParams[key]);
        if (this.masterChain) {
          this.masterChain.update(this.masterParams);
        }
      });
    };

    bindMasterSlider('#arr-eq-low', 'eqLow', (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`);
    bindMasterSlider('#arr-eq-mid', 'eqMid', (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`);
    bindMasterSlider('#arr-eq-high', 'eqHigh', (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`);
    bindMasterSlider('#arr-width', 'width', (v) => `${Math.round(v)}%`);
    bindMasterSlider('#arr-glue', 'glue', (v) => `${Math.round(v)}%`);
    bindMasterSlider('#arr-drive', 'driveDb', (v) => `+${v.toFixed(1)} dB`);

    q('#arr-bitdepth-group')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-arr-bit]');
      if (!btn) return;
      this.bitDepth = Number(btn.dataset.arrBit) === 16 ? 16 : 24;
      qq('[data-arr-bit]').forEach((b) => b.classList.toggle('active', b === btn));
    });
  }

  _setupResize() {
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => {
        if (this.isSectionActive) this.resizeAndRedraw();
      });
      if (this.root) this._ro.observe(this.root);
    }
  }

  _updateStageSize() {
    const stage = this.root ? this.root.querySelector('#arr-timeline-stage') : null;
    if (!stage) return;
    const totalW = this.getTimelineWidthPx();
    const totalH = this.tracks.length * ROW_HEIGHT;
    stage.style.width = `${totalW}px`;
    stage.style.height = `${totalH}px`;
  }

  resizeAndRedraw() {
    if (!this.root) return;
    this._updateStageSize();
    this._syncRulerSize();
    this._syncTimelineSize();
    this._drawRuler();
    this._drawTimeline();
  }

  _syncRulerSize() {
    const vp = this.root.querySelector('#arr-ruler-viewport');
    const canvas = this.root.querySelector('#arr-ruler-canvas');
    if (!vp || !canvas) return;
    const w = Math.max(100, Math.floor(vp.clientWidth));
    const h = 34;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }

  _syncTimelineSize() {
    const vp = this.root.querySelector('#arr-lanes-scroll-x');
    const canvas = this.root.querySelector('#arr-timeline-canvas');
    if (!vp || !canvas) return;
    const w = Math.max(100, Math.floor(vp.clientWidth));
    const h = Math.max(ROW_HEIGHT, this.tracks.length * ROW_HEIGHT);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
  }

  // ============================================================================
  // Quản lý Kho Clip & Cầu nối Nhận Audio từ Sáng tác Beat / Phòng thu Vocal / File
  // ============================================================================
  _ensureAudioContext() {
    if (!this.playCtx || this.playCtx.state === 'closed') {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        throw new Error('Trình duyệt không hỗ trợ Web AudioContext.');
      }
      this.playCtx = new AC();
      this.masterChain = buildMasteringChain(
        this.playCtx,
        this.masterParams,
        this.playCtx.destination,
        { tapMeters: true }
      );
      this._syncTrackNodes();
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

  _syncTrackNodes() {
    if (!this.playCtx || !this.masterChain) return;
    while (this.trackNodes.length < this.tracks.length) {
      const g = this.playCtx.createGain();
      const pan = this.playCtx.createStereoPanner();
      g.connect(pan);
      pan.connect(this.masterChain.input);
      this.trackNodes.push({ gain: g, pan });
    }
    this._updateLiveTrackGains();
  }

  _updateLiveTrackGains() {
    if (!this.playCtx) return;
    const now = this.playCtx.currentTime;
    this.tracks.forEach((tr, idx) => {
      const nodes = this.trackNodes[idx];
      if (!nodes) return;
      const audible = this._isTrackAudible(idx);
      const norm = clamp(Number(tr.volume) || 0, 0, 100) / 100;
      const val = audible && norm > 0 ? Math.pow(norm, 1.55) * 1.15 : 0;
      try {
        nodes.gain.gain.cancelScheduledValues(now);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, now);
        nodes.gain.gain.linearRampToValueAtTime(val, now + 0.015);
      } catch (_) {
        nodes.gain.gain.value = val;
      }
      nodes.pan.pan.setTargetAtTime(clamp(tr.pan, -100, 100) / 100, now, 0.015);
    });
  }

  async importAudioFile(file) {
    if (!file) return null;
    try {
      const ctx = this._ensureAudioContext();
      const arrBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrBuf);
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      const clip = this.importClip({
        name: cleanName || 'File Audio',
        sourceType: 'file',
        audioBuffer: decoded,
        bpm: this.bpm,
        autoPlace: false,
      });
      this._toast(`Đã nạp "${cleanName}" vào Kho Clip (${formatClockTime(decoded.duration)}).`);
      return clip;
    } catch (err) {
      console.error('[HEVOS Arrangement Import Audio]', err);
      this._toast(`Không giải mã được file "${file.name}".`, true);
      return null;
    }
  }

  importClip({
    name = 'Clip mới',
    sourceType = 'file',
    audioBuffer,
    bpm = null,
    color = null,
    suggestedTrackIndex = null,
    suggestedStartSec = null,
    autoPlace = false,
    autoPlaceIfEmpty = false,
  }) {
    if (!audioBuffer || audioBuffer.length === 0) return null;
    const meta = SOURCE_META[sourceType] || SOURCE_META.file;
    const clip = {
      id: this._nextId('clip'),
      name,
      sourceType,
      audioBuffer,
      durationSec: audioBuffer.duration,
      bpm: bpm || this.bpm,
      color: color || meta.color,
      peaks: computeAudioBufferPeaks(audioBuffer, WAVE_BINS),
      suggestedTrackIndex:
        suggestedTrackIndex !== null && suggestedTrackIndex !== undefined
          ? suggestedTrackIndex
          : meta.defaultTrack,
      suggestedStartSec:
        suggestedStartSec !== null && suggestedStartSec !== undefined
          ? Math.max(0, Number(suggestedStartSec) || 0)
          : null,
    };

    this.clipsLibrary.unshift(clip);
    this._renderClipsLibrary();

    if (autoPlace) {
      this.placeClipOnTimeline(clip.id);
    } else if (autoPlaceIfEmpty) {
      const targetTrackIndex = clamp(
        clip.suggestedTrackIndex ?? 0,
        0,
        this.tracks.length - 1
      );
      const hasPlacementOnTrack = this.placements.some(
        (p) => p.trackIndex === targetTrackIndex
      );
      if (!hasPlacementOnTrack) {
        this.placeClipOnTimeline(clip.id, { trackIndex: targetTrackIndex });
      }
    }
    return clip;
  }

  _deleteClipFromLibrary(clipId) {
    this.clipsLibrary = this.clipsLibrary.filter((c) => c.id !== clipId);
    const hadPlacements = this.placements.some((p) => p.clipId === clipId);
    if (hadPlacements) {
      this.placements = this.placements.filter((p) => p.clipId !== clipId);
      if (!this.placements.some((p) => p.id === this.selectedPlacementId)) {
        this.selectedPlacementId = null;
      }
      this._syncSelectionButtons();
      this._updateStageSize();
      this.resizeAndRedraw();
      if (this.isPlaying) this._reschedulePlayback();
    }
    this._renderClipsLibrary();
  }

  placeClipOnTimeline(clipId, opts = {}) {
    const clip = this.clipsLibrary.find((c) => c.id === clipId);
    if (!clip) return null;

    const trackIndex = clamp(
      opts.trackIndex !== undefined ? opts.trackIndex : clip.suggestedTrackIndex ?? 0,
      0,
      this.tracks.length - 1
    );

    let startSec = opts.startSec;
    if (startSec === undefined || startSec === null) {
      let trackEnd = 0;
      let hasAny = false;
      for (const p of this.placements) {
        if (p.trackIndex === trackIndex) {
          hasAny = true;
          trackEnd = Math.max(trackEnd, p.startSec + p.durationSec);
        }
      }
      if (!hasAny && clip.suggestedStartSec !== null && clip.suggestedStartSec !== undefined) {
        startSec = clip.suggestedStartSec;
      } else {
        startSec = this._snapSec(trackEnd);
      }
    }

    const placement = {
      id: this._nextId('pl'),
      clipId: clip.id,
      trackIndex,
      startSec: Math.max(0, startSec),
      trimStartSec: 0,
      durationSec: clip.durationSec,
      fadeInSec: 0.01,
      fadeOutSec: 0.015,
      label: clip.name,
      color: clip.color,
    };

    this.placements.push(placement);
    this.selectedPlacementId = placement.id;
    this._syncSelectionButtons();
    this._updateStageSize();
    this.resizeAndRedraw();
    if (this.isPlaying) this._reschedulePlayback();
    return placement;
  }

  addTrack() {
    const idx = this.tracks.length + 1;
    const color = EXTRA_TRACK_COLORS[(idx - 1) % EXTRA_TRACK_COLORS.length];
    this.tracks.push({
      id: this._nextId('tr'),
      name: `Track ${idx} · Mới`,
      color,
      volume: 85,
      pan: 0,
      muted: false,
      solo: false,
    });
    this._syncTrackNodes();
    this._renderTrackHeaders();
    this.resizeAndRedraw();
  }

  duplicatePlacement(plId) {
    const src = this.placements.find((p) => p.id === plId);
    if (!src) return null;
    const clone = {
      ...src,
      id: this._nextId('pl'),
      startSec: src.startSec + src.durationSec,
    };
    this.placements.push(clone);
    this.selectedPlacementId = clone.id;
    this._syncSelectionButtons();
    this._updateStageSize();
    this.resizeAndRedraw();
    if (this.isPlaying) this._reschedulePlayback();
    return clone;
  }

  removePlacement(plId) {
    const before = this.placements.length;
    this.placements = this.placements.filter((p) => p.id !== plId);
    if (this.placements.length === before) return;
    if (this.selectedPlacementId === plId) {
      this.selectedPlacementId = null;
    }
    this._syncSelectionButtons();
    this._updateStageSize();
    this.resizeAndRedraw();
    if (this.isPlaying) this._reschedulePlayback();
  }

  _splitPlacementAt(plId, cutWorldSec) {
    const idx = this.placements.findIndex((p) => p.id === plId);
    if (idx === -1) return false;
    const pl = this.placements[idx];
    const snapped = this.snapMode !== 'off' ? this._snapSec(cutWorldSec) : cutWorldSec;
    const targetSec =
      snapped > pl.startSec + 0.06 && snapped < pl.startSec + pl.durationSec - 0.06
        ? snapped
        : cutWorldSec;

    if (targetSec <= pl.startSec + 0.06 || targetSec >= pl.startSec + pl.durationSec - 0.06) {
      return false;
    }

    const leftDur = targetSec - pl.startSec;
    const rightDur = pl.durationSec - leftDur;
    const origFadeOut = pl.fadeOutSec;

    pl.durationSec = leftDur;
    pl.fadeOutSec = Math.max(0.008, Math.min(origFadeOut, leftDur * 0.45));
    pl.fadeInSec = Math.min(pl.fadeInSec, leftDur * 0.45);

    const rightPl = {
      id: this._nextId('pl'),
      clipId: pl.clipId,
      trackIndex: pl.trackIndex,
      startSec: targetSec,
      trimStartSec: pl.trimStartSec + leftDur,
      durationSec: rightDur,
      fadeInSec: 0.008,
      fadeOutSec: Math.min(origFadeOut, rightDur * 0.45),
      label: pl.label,
      color: pl.color,
    };

    this.placements.splice(idx + 1, 0, rightPl);
    this.selectedPlacementId = rightPl.id;
    this._syncSelectionButtons();
    this.resizeAndRedraw();
    if (this.isPlaying) this._reschedulePlayback();
    return true;
  }

  _syncSelectionButtons() {
    if (!this.root) return;
    const hasSel = Boolean(this.selectedPlacementId);
    const dupBtn = this.root.querySelector('#arr-btn-dup-sel');
    const delBtn = this.root.querySelector('#arr-btn-del-sel');
    if (dupBtn) dupBtn.disabled = !hasSel;
    if (delBtn) delBtn.disabled = !hasSel;
  }

  // ============================================================================
  // Tương tác Pointer Trực Tiếp Trên Timeline Canvas (Move / Trim / Fade / Split)
  // ============================================================================
  _eventToWorld(e) {
    const stage = this.root.querySelector('#arr-timeline-stage');
    const scrollX = this.root.querySelector('#arr-lanes-scroll-x');
    const canvas = this.root.querySelector('#arr-timeline-canvas');
    const rect = stage
      ? stage.getBoundingClientRect()
      : canvas.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      worldX: e.clientX - rect.left,
      worldY: e.clientY - rect.top,
      localX: e.clientX - canvasRect.left,
      scrollLeft: scrollX ? scrollX.scrollLeft : 0,
    };
  }

  _hitTestPlacement(worldX, worldY) {
    const pxPerSec = this.getPxPerSec();
    const rowIdx = Math.floor(worldY / ROW_HEIGHT);
    if (rowIdx < 0 || rowIdx >= this.tracks.length) return null;

    const rowTop = rowIdx * ROW_HEIGHT + 5;
    const rowBot = (rowIdx + 1) * ROW_HEIGHT - 5;
    if (worldY < rowTop || worldY > rowBot) return null;

    for (let i = this.placements.length - 1; i >= 0; i--) {
      const pl = this.placements[i];
      if (pl.trackIndex !== rowIdx) continue;
      const x0 = pl.startSec * pxPerSec;
      const x1 = (pl.startSec + pl.durationSec) * pxPerSec;
      const w = x1 - x0;
      if (worldX < x0 - 4 || worldX > x1 + 4) continue;

      const fadeBandY = rowTop + 17;
      const fadeTolX = Math.min(16, w * 0.25);
      const edgeTolX = Math.min(11, w * 0.22);

      if (worldY <= fadeBandY && worldX <= x0 + fadeTolX) {
        return { placement: pl, action: 'fade-in' };
      }
      if (worldY <= fadeBandY && worldX >= x1 - fadeTolX) {
        return { placement: pl, action: 'fade-out' };
      }
      if (worldX <= x0 + edgeTolX) {
        return { placement: pl, action: 'trim-left' };
      }
      if (worldX >= x1 - edgeTolX) {
        return { placement: pl, action: 'trim-right' };
      }
      return { placement: pl, action: 'move' };
    }
    return null;
  }

  _onCanvasPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const canvas = this.root.querySelector('#arr-timeline-canvas');
    const world = this._eventToWorld(e);
    const hit = this._hitTestPlacement(world.worldX, world.worldY);

    if (!hit) {
      this.selectedPlacementId = null;
      this._syncSelectionButtons();
      // Cham nhe vao khoang trong cung cap nhat con tro phat tai diem bam
      this._drawTimeline();
      return;
    }

    const pl = hit.placement;
    if (e.cancelable) e.preventDefault();
    this.selectedPlacementId = pl.id;
    this._syncSelectionButtons();

    if (this.toolMode === 'split') {
      const cutSec = world.worldX / this.getPxPerSec();
      this._splitPlacementAt(pl.id, cutSec);
      return;
    }

    if (this.toolMode === 'duplicate') {
      this.duplicatePlacement(pl.id);
      return;
    }

    canvas?.setPointerCapture?.(e.pointerId);
    this._drag = {
      pointerId: e.pointerId,
      placement: pl,
      action: hit.action,
      startWorldX: world.worldX,
      startWorldY: world.worldY,
      origStartSec: pl.startSec,
      origTrimStartSec: pl.trimStartSec,
      origDurationSec: pl.durationSec,
      origTrackIndex: pl.trackIndex,
      origFadeInSec: pl.fadeInSec,
      origFadeOutSec: pl.fadeOutSec,
    };
    this._drawTimeline();
  }

  _onCanvasPointerMove(e) {
    const canvas = this.root.querySelector('#arr-timeline-canvas');
    const world = this._eventToWorld(e);
    this._hoverX = world.localX;
    this._hoverY = world.worldY;

    if (!this._drag) {
      if (this.toolMode === 'split') {
        if (canvas) canvas.style.cursor = 'col-resize';
        this._drawTimeline();
        return;
      }
      if (this.toolMode === 'duplicate') {
        if (canvas) canvas.style.cursor = 'copy';
        return;
      }
      const hit = this._hitTestPlacement(world.worldX, world.worldY);
      if (canvas) {
        if (!hit) canvas.style.cursor = 'default';
        else if (hit.action === 'trim-left' || hit.action === 'trim-right') canvas.style.cursor = 'ew-resize';
        else if (hit.action === 'fade-in' || hit.action === 'fade-out') canvas.style.cursor = 'nesw-resize';
        else canvas.style.cursor = 'grab';
      }
      return;
    }

    const d = this._drag;
    const pl = d.placement;
    const clip = this.clipsLibrary.find((c) => c.id === pl.clipId);
    if (!clip) return;

    const pxPerSec = this.getPxPerSec();
    const deltaSec = (world.worldX - d.startWorldX) / pxPerSec;

    if (d.action === 'move') {
      const targetStart = this._snapSec(d.origStartSec + deltaSec);
      const targetTrack = clamp(Math.floor(world.worldY / ROW_HEIGHT), 0, this.tracks.length - 1);
      pl.startSec = Math.max(0, targetStart);
      pl.trackIndex = targetTrack;
    } else if (d.action === 'trim-left') {
      const minDelta = -Math.min(d.origStartSec, d.origTrimStartSec);
      const maxDelta = d.origDurationSec - 0.12;
      const wantedStart = this._snapSec(d.origStartSec + deltaSec);
      const actualDelta = clamp(wantedStart - d.origStartSec, minDelta, maxDelta);
      pl.startSec = d.origStartSec + actualDelta;
      pl.trimStartSec = d.origTrimStartSec + actualDelta;
      pl.durationSec = d.origDurationSec - actualDelta;
      pl.fadeInSec = Math.min(pl.fadeInSec, pl.durationSec * 0.45);
      pl.fadeOutSec = Math.min(pl.fadeOutSec, pl.durationSec * 0.45);
    } else if (d.action === 'trim-right') {
      const maxDur = Math.max(0.12, clip.durationSec - d.origTrimStartSec);
      const origEnd = d.origStartSec + d.origDurationSec;
      const wantedEnd = this._snapSec(origEnd + deltaSec);
      const newDur = clamp(wantedEnd - d.origStartSec, 0.12, maxDur);
      pl.durationSec = newDur;
      pl.fadeInSec = Math.min(pl.fadeInSec, pl.durationSec * 0.45);
      pl.fadeOutSec = Math.min(pl.fadeOutSec, pl.durationSec * 0.45);
    } else if (d.action === 'fade-in') {
      const maxFade = Math.max(0, Math.min(pl.durationSec * 0.48, pl.durationSec - pl.fadeOutSec - 0.02));
      pl.fadeInSec = clamp(d.origFadeInSec + deltaSec, 0, maxFade);
    } else if (d.action === 'fade-out') {
      const maxFade = Math.max(0, Math.min(pl.durationSec * 0.48, pl.durationSec - pl.fadeInSec - 0.02));
      pl.fadeOutSec = clamp(d.origFadeOutSec - deltaSec, 0, maxFade);
    }

    this._updateStageSize();
    this._drawRuler();
    this._drawTimeline();
  }

  _onCanvasPointerUp(e) {
    if (!this._drag) return;
    const canvas = this.root.querySelector('#arr-timeline-canvas');
    canvas?.releasePointerCapture?.(e.pointerId);
    this._drag = null;
    if (this.isPlaying) {
      this._reschedulePlayback();
    }
    this.resizeAndRedraw();
  }

  handleKeyDown(e) {
    if (!this.isSectionActive) return;
    if (this.activeSubView === 'stems') {
      if (e.code === 'Space') {
        e.preventDefault();
        if (this.stemStudio) this.stemStudio.togglePlay();
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.isPlaying) this.pause();
      else this.play();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedPlacementId) {
      e.preventDefault();
      this.removePlacement(this.selectedPlacementId);
    }
  }

  // ============================================================================
  // Vẽ Thước Thời Gian (Ruler) & Lưới Playlist Đa Kênh + Waveforms (Retina dpr<=2)
  // ============================================================================
  _drawRuler() {
    if (!this.root) return;
    const canvas = this.root.querySelector('#arr-ruler-canvas');
    const scrollX = this.root.querySelector('#arr-lanes-scroll-x');
    if (!canvas) return;

    const vp = this.root.querySelector('#arr-ruler-viewport');
    const w = vp ? vp.clientWidth : 600;
    const h = 34;
    if (w < 10) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sx = scrollX ? scrollX.scrollLeft : 0;
    const pxPerSec = this.getPxPerSec();
    const beatDur = this.getBeatDurSec();
    const barDur = this.getBarDurSec();
    const pxPerBeat = beatDur * pxPerSec;
    const pxPerBar = barDur * pxPerSec;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0D0E16';
    ctx.fillRect(0, 0, w, h);

    // Vùng Loop Region highlight
    if (this.loopEnabled) {
      const lx0 = this.loopStartBar * pxPerBar - sx;
      const lx1 = this.loopEndBar * pxPerBar - sx;
      if (lx1 > 0 && lx0 < w) {
        const clampedX = Math.max(0, lx0);
        const clampedW = Math.min(w, lx1) - clampedX;
        if (clampedW > 0) {
          ctx.fillStyle = 'rgba(249, 115, 22, 0.20)';
          ctx.fillRect(clampedX, 0, clampedW, h);
          ctx.fillStyle = '#F97316';
          ctx.fillRect(clampedX, 0, clampedW, 3);
        }
      }
    }

    const firstBar = Math.max(0, Math.floor(sx / pxPerBar) - 1);
    const lastBar = Math.ceil((sx + w) / pxPerBar) + 1;

    ctx.font = '700 10.5px "JetBrains Mono", Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    for (let bar = firstBar; bar <= lastBar; bar++) {
      const bx = Math.round(bar * pxPerBar - sx) + 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, 6);
      ctx.lineTo(bx, h);
      ctx.stroke();

      ctx.fillStyle = '#E4E4F0';
      ctx.fillText(String(bar + 1), bx + 4, 6);

      if (pxPerBeat >= 14) {
        for (let b = 1; b < 4; b++) {
          const tickX = Math.round(bx + b * pxPerBeat) + 0.5;
          if (tickX < 0 || tickX > w) continue;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
          ctx.beginPath();
          ctx.moveTo(tickX, h - 10);
          ctx.lineTo(tickX, h);
          ctx.stroke();
        }
      }
    }

    // Playhead mũi tên tua
    const phX = this.currentSec * pxPerSec - sx;
    if (phX >= -10 && phX <= w + 10) {
      ctx.fillStyle = '#F97316';
      ctx.beginPath();
      ctx.moveTo(phX - 6, h - 13);
      ctx.lineTo(phX + 6, h - 13);
      ctx.lineTo(phX + 6, h - 7);
      ctx.lineTo(phX, h);
      ctx.lineTo(phX - 6, h - 7);
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    ctx.restore();
  }

  _drawTimeline() {
    if (!this.root) return;
    const canvas = this.root.querySelector('#arr-timeline-canvas');
    const scrollX = this.root.querySelector('#arr-lanes-scroll-x');
    if (!canvas) return;

    const w = scrollX ? scrollX.clientWidth : 600;
    const h = this.tracks.length * ROW_HEIGHT;
    if (w < 10 || h < 10) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const sx = scrollX ? scrollX.scrollLeft : 0;
    const pxPerSec = this.getPxPerSec();
    const beatDur = this.getBeatDurSec();
    const barDur = this.getBarDurSec();
    const pxPerBeat = beatDur * pxPerSec;
    const pxPerBar = barDur * pxPerSec;

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Nền lưới DAW tối chia theo ô nhịp xen kẽ nhẹ
    ctx.fillStyle = '#090A10';
    ctx.fillRect(0, 0, w, h);

    const firstBar = Math.max(0, Math.floor(sx / pxPerBar) - 1);
    const lastBar = Math.ceil((sx + w) / pxPerBar) + 1;

    for (let bar = firstBar; bar <= lastBar; bar++) {
      const bx = bar * pxPerBar - sx;
      if (bar % 2 === 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.018)';
        ctx.fillRect(bx, 0, pxPerBar, h);
      }

      if (pxPerBeat >= 14) {
        for (let b = 1; b < 4; b++) {
          const tickX = Math.round(bx + b * pxPerBeat) + 0.5;
          if (tickX < 0 || tickX > w) continue;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tickX, 0);
          ctx.lineTo(tickX, h);
          ctx.stroke();
        }
      }

      const barLineX = Math.round(bx) + 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.11)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(barLineX, 0);
      ctx.lineTo(barLineX, h);
      ctx.stroke();
    }

    // 2. Đường phân cách các hàng Track
    for (let t = 0; t < this.tracks.length; t++) {
      const y = t * ROW_HEIGHT;
      if (!this._isTrackAudible(t)) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(0, y, w, ROW_HEIGHT);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.075)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + ROW_HEIGHT - 0.5);
      ctx.lineTo(w, y + ROW_HEIGHT - 0.5);
      ctx.stroke();
    }

    // Vùng Loop shade
    if (this.loopEnabled) {
      const lx0 = this.loopStartBar * pxPerBar - sx;
      const lx1 = this.loopEndBar * pxPerBar - sx;
      if (lx1 > 0 && lx0 < w) {
        const cx = Math.max(0, lx0);
        const cw = Math.min(w, lx1) - cx;
        ctx.fillStyle = 'rgba(249, 115, 22, 0.04)';
        ctx.fillRect(cx, 0, cw, h);
      }
    }

    // 3. Gợi ý trống nếu chưa đặt Clip nào
    if (this.placements.length === 0) {
      ctx.fillStyle = 'rgba(176, 180, 200, 0.45)';
      ctx.font = '600 12.5px "Be Vietnam Pro", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        'Hãy kéo Clip từ Kho Clip bên trái hoặc bấm "+ Đặt vào Timeline" để dựng bài',
        w / 2,
        Math.min(h / 2, ROW_HEIGHT * 2.5)
      );
    }

    // 4. Vẽ các khối Clip (kiểu FL Studio Playlist + Waveform + Trim & Fade Handles)
    for (const pl of this.placements) {
      this._drawClipBlock(ctx, pl, sx, w, pxPerSec);
    }

    // 5. Đường định vị dao cắt Split
    if (this.toolMode === 'split' && this._hoverX >= 0 && this._hoverX <= w) {
      ctx.save();
      ctx.strokeStyle = 'rgba(244, 114, 182, 0.85)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this._hoverX, 0);
      ctx.lineTo(this._hoverX, h);
      ctx.stroke();
      ctx.restore();
    }

    // 6. Kim chạy Playhead dọc toàn lưới
    const phX = this.currentSec * pxPerSec - sx;
    if (phX >= -2 && phX <= w + 2) {
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(phX, 0);
      ctx.lineTo(phX, h);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawClipBlock(ctx, pl, sx, viewW, pxPerSec) {
    const x = pl.startSec * pxPerSec - sx;
    const w = Math.max(14, pl.durationSec * pxPerSec);
    if (x + w < -4 || x > viewW + 4) return;

    const y = pl.trackIndex * ROW_HEIGHT + 5;
    const h = ROW_HEIGHT - 10;
    const isSelected = pl.id === this.selectedPlacementId;
    const muted = !this._isTrackAudible(pl.trackIndex);
    const clip = this.clipsLibrary.find((c) => c.id === pl.clipId);
    const baseColor = muted ? '#52525B' : pl.color || '#8B5CF6';

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.clip();

    // Nền khối Clip & thanh tiêu đề
    ctx.fillStyle = hexToRgba(baseColor, isSelected ? 0.28 : 0.18);
    ctx.fillRect(x, y, w, h);

    ctx.fillStyle = hexToRgba(baseColor, isSelected ? 0.56 : 0.36);
    ctx.fillRect(x, y, w, 18);

    // Sóng âm (Waveform) trích đúng vùng [trimStartSec .. trimStartSec + durationSec]
    if (clip && clip.peaks && clip.durationSec > 0) {
      const peaks = clip.peaks;
      const numBins = peaks.length;
      const waveTop = y + 20;
      const waveH = h - 24;
      const midY = waveTop + waveH / 2;

      const visStartX = Math.max(0, -x);
      const visEndX = Math.min(w, viewW - x);
      const stepPx = 2.4;

      ctx.fillStyle = muted ? 'rgba(212, 212, 216, 0.32)' : 'rgba(250, 250, 255, 0.88)';
      for (let lx = visStartX; lx < visEndX; lx += stepPx) {
        const localFrac = lx / w;
        const srcTime = pl.trimStartSec + localFrac * pl.durationSec;
        const bIdx = clamp(Math.floor((srcTime / clip.durationSec) * numBins), 0, numBins - 1);
        const amp = peaks[bIdx];
        const barH = Math.max(2, amp * waveH * 0.9);
        ctx.fillRect(x + lx, midY - barH / 2, 1.5, barH);
      }
    }

    // Tam giác Fade-In & Fade-Out trực quan
    const fadeInPx = Math.min(w * 0.45, pl.fadeInSec * pxPerSec);
    if (fadeInPx >= 4) {
      ctx.fillStyle = 'rgba(8, 9, 15, 0.52)';
      ctx.beginPath();
      ctx.moveTo(x, y + 18);
      ctx.lineTo(x + fadeInPx, y + 18);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + fadeInPx, y + 18);
      ctx.stroke();
    }

    const fadeOutPx = Math.min(w * 0.45, pl.fadeOutSec * pxPerSec);
    if (fadeOutPx >= 4) {
      ctx.fillStyle = 'rgba(8, 9, 15, 0.52)';
      ctx.beginPath();
      ctx.moveTo(x + w, y + 18);
      ctx.lineTo(x + w - fadeOutPx, y + 18);
      ctx.lineTo(x + w, y + h);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + w - fadeOutPx, y + 18);
      ctx.lineTo(x + w, y + h);
      ctx.stroke();
    }

    // Tiêu đề clip góc trên
    ctx.fillStyle = '#FAFAFC';
    ctx.font = '700 10px "Be Vietnam Pro", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (w > 28) {
      ctx.fillText(pl.label, x + 7, y + 9, w - 26);
    }

    ctx.restore();

    // Viền ngoài + Tay nắm Fade ở 2 góc trên
    ctx.strokeStyle = isSelected ? '#FFFFFF' : hexToRgba(baseColor, 0.85);
    ctx.lineWidth = isSelected ? 1.8 : 1.1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.stroke();

    if (w > 40) {
      ctx.fillStyle = '#FAFAFC';
      ctx.beginPath();
      ctx.arc(x + Math.max(6, fadeInPx), y + 14, 3, 0, Math.PI * 2);
      ctx.arc(x + w - Math.max(6, fadeOutPx), y + 14, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ============================================================================
  // Phát Nhạc Đa Kênh Thời Gian Thực & Đồng hồ Stereo L/R Peak Meter
  // ============================================================================
  async play() {
    if (this.placements.length === 0) {
      this._toast('Chưa có Clip nào trên Timeline. Hãy đặt ít nhất 1 Clip để phát.', true);
      return;
    }

    const ctx = this._ensureAudioContext();
    if (ctx.state !== 'running') {
      await Promise.race([
        Promise.resolve()
          .then(() => ctx.resume())
          .catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 700)),
      ]);
    }

    const songEnd = this.getSongEndSec();
    if (!this.loopEnabled && this.currentSec >= songEnd - 0.03) {
      this.currentSec = 0;
    }
    if (this.loopEnabled) {
      const loopStart = this.loopStartBar * this.getBarDurSec();
      const loopEnd = this.loopEndBar * this.getBarDurSec();
      if (this.currentSec < loopStart || this.currentSec >= loopEnd) {
        this.currentSec = loopStart;
      }
    }

    this.isPlaying = true;
    this._syncPlayButtonUI();
    this._scheduleFrom(this.currentSec);
    this._startRafLoop();
    if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(true);
  }

  pause() {
    if (this.isPlaying) {
      this.currentSec = this._getPlayheadSecLive();
    }
    this.isPlaying = false;
    this._stopActiveSources();
    this._stopRafLoop();
    this._resetMeters();
    this._syncPlayButtonUI();
    this._updateClockUI();
    this._drawRuler();
    this._drawTimeline();
    if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(false);
  }

  stopAll() {
    this.isPlaying = false;
    this._stopActiveSources();
    this._stopRafLoop();
    this._resetMeters();
    this.currentSec = 0;
    this._syncPlayButtonUI();
    this._updateClockUI();
    this._drawRuler();
    this._drawTimeline();
    if (this.stemStudio) this.stemStudio.stopPlayback();
    if (this.cb.onPlaybackStateChange) this.cb.onPlaybackStateChange(false);
  }

  seekTo(sec) {
    this.currentSec = Math.max(0, sec);
    if (this.isPlaying) {
      this._scheduleFrom(this.currentSec);
    }
    this._updateClockUI();
    this._drawRuler();
    this._drawTimeline();
  }

  _reschedulePlayback() {
    if (!this.isPlaying) return;
    const pos = this._getPlayheadSecLive();
    this._scheduleFrom(pos);
  }

  _stopActiveSources() {
    this._scheduleSeq += 1;
    for (const item of this.activeSources) {
      try { item.src.stop(); } catch (_) {}
      try { item.src.disconnect(); } catch (_) {}
      try { item.gain.disconnect(); } catch (_) {}
    }
    this.activeSources = [];
  }

  _scheduleFrom(posSec) {
    if (!this.playCtx || !this.masterChain) return;
    this._stopActiveSources();
    this._syncTrackNodes();

    const ctx = this.playCtx;
    const startAtCtx = ctx.currentTime + 0.025;
    this._playAnchorCtxTime = startAtCtx;
    this._playAnchorPosSec = Math.max(0, posSec);

    const loopActive = this.loopEnabled && this.loopEndBar > this.loopStartBar;
    const loopEndSec = this.loopEndBar * this.getBarDurSec();

    for (const pl of this.placements) {
      const clip = this.clipsLibrary.find((c) => c.id === pl.clipId);
      const trackNode = this.trackNodes[pl.trackIndex];
      if (!clip || !clip.audioBuffer || !trackNode) continue;

      const plEnd = pl.startSec + pl.durationSec;
      if (plEnd <= posSec + 0.005) continue;
      if (loopActive && pl.startSec >= loopEndSec) continue;

      const src = ctx.createBufferSource();
      src.buffer = clip.audioBuffer;
      const clipGain = ctx.createGain();

      let whenCtx = startAtCtx;
      let offsetInClip = pl.trimStartSec;
      let playDur = pl.durationSec;

      if (pl.startSec >= posSec) {
        whenCtx = startAtCtx + (pl.startSec - posSec);
      } else {
        const skip = posSec - pl.startSec;
        offsetInClip = pl.trimStartSec + skip;
        playDur = pl.durationSec - skip;
      }

      if (loopActive) {
        const maxClipEnd = Math.min(plEnd, loopEndSec);
        playDur = Math.min(playDur, maxClipEnd - Math.max(posSec, pl.startSec));
      }

      if (playDur <= 0.015 || offsetInClip >= clip.audioBuffer.duration - 0.01) continue;

      // Envelope Fade-In & Fade-Out mượt mà chống bụp tiếng
      const endCtx = whenCtx + playDur;
      const relFadeInEnd = (pl.startSec + pl.fadeInSec) - Math.max(posSec, pl.startSec);
      if (pl.fadeInSec > 0.005 && relFadeInEnd > 0) {
        const startAmp = posSec > pl.startSec
          ? clamp((posSec - pl.startSec) / pl.fadeInSec, 0, 1)
          : 0.0001;
        clipGain.gain.setValueAtTime(startAmp, whenCtx);
        clipGain.gain.linearRampToValueAtTime(1.0, Math.min(endCtx - 0.005, whenCtx + relFadeInEnd));
      } else {
        clipGain.gain.setValueAtTime(1.0, whenCtx);
      }

      if (pl.fadeOutSec > 0.005 && plEnd > Math.max(posSec, pl.startSec)) {
        const fadeOutStartTimeline = plEnd - pl.fadeOutSec;
        const fadeOutStartCtx = startAtCtx + Math.max(0, fadeOutStartTimeline - posSec);
        if (fadeOutStartTimeline > posSec && fadeOutStartCtx < endCtx) {
          clipGain.gain.setValueAtTime(1.0, Math.max(whenCtx, fadeOutStartCtx));
          clipGain.gain.linearRampToValueAtTime(0.0001, startAtCtx + (plEnd - posSec));
        }
      }

      src.connect(clipGain);
      clipGain.connect(trackNode.gain);
      src.start(whenCtx, offsetInClip, playDur);
      this.activeSources.push({ src, gain: clipGain });
    }
  }

  _getPlayheadSecLive() {
    if (!this.isPlaying || !this.playCtx) return this.currentSec;
    return this._playAnchorPosSec + Math.max(0, this.playCtx.currentTime - this._playAnchorCtxTime);
  }

  _startRafLoop() {
    if (this._rafId !== null || document.hidden || !this.isSectionActive) return;
    const step = (now) => {
      this._rafId = null;
      if (!this.isPlaying || document.hidden || !this.isSectionActive) return;

      const cur = this._getPlayheadSecLive();
      const loopActive = this.loopEnabled && this.loopEndBar > this.loopStartBar;
      const loopStartSec = this.loopStartBar * this.getBarDurSec();
      const loopEndSec = this.loopEndBar * this.getBarDurSec();

      if (loopActive && cur >= loopEndSec) {
        this.currentSec = loopStartSec;
        this._scheduleFrom(loopStartSec);
      } else if (!loopActive && cur >= this.getSongEndSec() + 0.12) {
        this.stopAll();
        return;
      } else {
        this.currentSec = cur;
      }

      if (now - this._lastUiMs >= 32) {
        this._lastUiMs = now;
        this._updateClockUI();
        this._updateStereoMeters();
        this._drawRuler();
        this._drawTimeline();
      }

      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  _stopRafLoop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _updateStereoMeters() {
    if (!this.root || !this.masterChain || !this.masterChain.analyserL) return;
    const aL = this.masterChain.analyserL;
    const aR = this.masterChain.analyserR;
    aL.getFloatTimeDomainData(this._meterBufL);
    aR.getFloatTimeDomainData(this._meterBufR);

    let peakL = 0;
    let peakR = 0;
    let rmsSum = 0;
    const n = this._meterBufL.length;
    for (let i = 0; i < n; i += 2) {
      const l = Math.abs(this._meterBufL[i]);
      const r = Math.abs(this._meterBufR[i]);
      if (l > peakL) peakL = l;
      if (r > peakR) peakR = r;
      rmsSum += l * l + r * r;
    }

    this._liveAudioLevel = clamp(Math.sqrt(rmsSum / n) * 2.2, 0, 1);
    this._peakHoldL = Math.max(peakL, this._peakHoldL * 0.86);
    this._peakHoldR = Math.max(peakR, this._peakHoldR * 0.86);

    const dbL = gainToDb(this._peakHoldL);
    const dbR = gainToDb(this._peakHoldR);
    const normL = clamp((dbL + 48) / 48, 0, 1);
    const normR = clamp((dbR + 48) / 48, 0, 1);

    const barL = this.root.querySelector('#arr-meter-l');
    const barR = this.root.querySelector('#arr-meter-r');
    const lblL = this.root.querySelector('#arr-peak-l');
    const lblR = this.root.querySelector('#arr-peak-r');
    const clipLed = this.root.querySelector('#arr-clip-led');

    if (barL) barL.style.transform = `scaleX(${normL.toFixed(3)})`;
    if (barR) barR.style.transform = `scaleX(${normR.toFixed(3)})`;
    if (lblL) lblL.textContent = dbL <= -60 ? '-∞' : `${dbL.toFixed(1)}`;
    if (lblR) lblR.textContent = dbR <= -60 ? '-∞' : `${dbR.toFixed(1)}`;

    const maxDb = Math.max(dbL, dbR);
    if (clipLed) {
      const isHot = maxDb >= -0.45;
      clipLed.classList.toggle('is-clip', isHot);
      clipLed.textContent = isHot ? `LIMIT · ${maxDb.toFixed(1)}dB` : 'SAFE · -0.3dB';
    }
  }

  _resetMeters() {
    this._liveAudioLevel = 0;
    this._peakHoldL = 0;
    this._peakHoldR = 0;
    if (!this.root) return;
    const barL = this.root.querySelector('#arr-meter-l');
    const barR = this.root.querySelector('#arr-meter-r');
    const lblL = this.root.querySelector('#arr-peak-l');
    const lblR = this.root.querySelector('#arr-peak-r');
    const clipLed = this.root.querySelector('#arr-clip-led');
    if (barL) barL.style.transform = 'scaleX(0)';
    if (barR) barR.style.transform = 'scaleX(0)';
    if (lblL) lblL.textContent = '-∞';
    if (lblR) lblR.textContent = '-∞';
    if (clipLed) {
      clipLed.classList.remove('is-clip');
      clipLed.textContent = 'SAFE · -0.3dB';
    }
  }

  _syncPlayButtonUI() {
    if (!this.root) return;
    const btn = this.root.querySelector('#arr-btn-play');
    const lbl = this.root.querySelector('#arr-btn-play-label');
    if (btn) btn.classList.toggle('playing', this.isPlaying);
    if (lbl) lbl.textContent = this.isPlaying ? 'Tạm dừng' : 'Phát';
  }

  _updateClockUI() {
    if (!this.root) return;
    const barEl = this.root.querySelector('#arr-clock-bars');
    const timeEl = this.root.querySelector('#arr-clock-time');
    if (barEl) barEl.textContent = formatClockBarBeat(this.currentSec, this.bpm);
    if (timeEl) timeEl.textContent = formatClockTime(this.currentSec);
  }

  // ============================================================================
  // Master Presets & Offline Mixdown / Master Export (.WAV)
  // ============================================================================
  applyMasteringPreset(presetId) {
    const preset = MASTERING_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.masterPresetId = preset.id;
    this.masterParams = {
      eqLow: preset.eqLow,
      eqMid: preset.eqMid,
      eqHigh: preset.eqHigh,
      width: preset.width,
      glue: preset.glue,
      driveDb: preset.driveDb,
    };
    this._syncPresetHighlight();
    this._syncMasterSlidersUI();
    if (this.masterChain) {
      this.masterChain.update(this.masterParams);
    }
    this._toast(`Đã áp dụng Master Preset: ${preset.name}`);
  }

  _syncPresetHighlight() {
    if (!this.root) return;
    this.root.querySelectorAll('[data-arr-preset]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.arrPreset === this.masterPresetId);
    });
  }

  _syncMasterSlidersUI() {
    if (!this.root) return;
    const set = (id, val, txt) => {
      const el = this.root.querySelector(id);
      const lbl = this.root.querySelector(`${id}-val`);
      if (el) el.value = String(val);
      if (lbl) lbl.textContent = txt;
    };
    const p = this.masterParams;
    set('#arr-eq-low', p.eqLow, `${p.eqLow >= 0 ? '+' : ''}${p.eqLow.toFixed(1)} dB`);
    set('#arr-eq-mid', p.eqMid, `${p.eqMid >= 0 ? '+' : ''}${p.eqMid.toFixed(1)} dB`);
    set('#arr-eq-high', p.eqHigh, `${p.eqHigh >= 0 ? '+' : ''}${p.eqHigh.toFixed(1)} dB`);
    set('#arr-width', p.width, `${Math.round(p.width)}%`);
    set('#arr-glue', p.glue, `${Math.round(p.glue)}%`);
    set('#arr-drive', p.driveDb, `+${p.driveDb.toFixed(1)} dB`);
  }

  async renderMasterBuffer() {
    if (this.placements.length === 0) return null;
    const songEndSec = this.getSongEndSec();
    if (songEndSec <= 0.05) return null;

    const totalSec = songEndSec + 0.25;
    const sr = 44100;
    const totalFrames = Math.ceil(totalSec * sr);
    const OfflineAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineAC) {
      throw new Error('Trình duyệt không hỗ trợ OfflineAudioContext.');
    }
    const offline = new OfflineAC(2, totalFrames, sr);

    const chain = buildMasteringChain(offline, this.masterParams, offline.destination, {
      tapMeters: false,
    });

    const offTrackGains = this.tracks.map((tr, idx) => {
      const g = offline.createGain();
      const pan = offline.createStereoPanner();
      const audible = this._isTrackAudible(idx);
      const norm = clamp(tr.volume, 0, 100) / 100;
      g.gain.value = audible ? Math.pow(norm, 1.55) * 1.15 : 0;
      pan.pan.value = clamp(tr.pan, -100, 100) / 100;
      g.connect(pan);
      pan.connect(chain.input);
      return { g, audible };
    });

    for (const pl of this.placements) {
      const trNode = offTrackGains[pl.trackIndex];
      const clip = this.clipsLibrary.find((c) => c.id === pl.clipId);
      if (!trNode || !trNode.audible || !clip || !clip.audioBuffer) continue;

      const src = offline.createBufferSource();
      src.buffer = clip.audioBuffer;
      const clipGain = offline.createGain();

      const when = Math.max(0, pl.startSec);
      const dur = Math.min(pl.durationSec, clip.audioBuffer.duration - pl.trimStartSec);
      if (dur <= 0.01) continue;

      if (pl.fadeInSec > 0.005) {
        clipGain.gain.setValueAtTime(0.0001, when);
        clipGain.gain.linearRampToValueAtTime(1.0, when + Math.min(pl.fadeInSec, dur * 0.5));
      } else {
        clipGain.gain.setValueAtTime(1.0, when);
      }

      if (pl.fadeOutSec > 0.005) {
        const fStart = Math.max(when, when + dur - Math.min(pl.fadeOutSec, dur * 0.5));
        clipGain.gain.setValueAtTime(1.0, fStart);
        clipGain.gain.linearRampToValueAtTime(0.0001, when + dur);
      }

      src.connect(clipGain);
      clipGain.connect(trNode.g);
      src.start(when, pl.trimStartSec, dur);
    }

    return offline.startRendering();
  }

  async exportMasterWav() {
    if (this.isExporting) return;
    if (this.placements.length === 0) {
      this._toast('Timeline đang trống. Hãy đặt ít nhất 1 Clip trước khi xuất sản phẩm.', true);
      return;
    }

    this.isExporting = true;
    const btnMain = this.root?.querySelector('#arr-btn-export-wav');
    const lblMain = this.root?.querySelector('#arr-export-label');
    const btnSide = this.root?.querySelector('#arr-btn-export-wav-side');
    if (btnMain) btnMain.disabled = true;
    if (btnSide) btnSide.disabled = true;
    if (lblMain) lblMain.textContent = 'Đang Master WAV...';

    try {
      const rendered = await this.renderMasterBuffer();
      if (!rendered) {
        this._toast('Không có tín hiệu âm thanh khả dụng (kiểm tra nút Mute/Solo).', true);
        return;
      }

      const blob = encodeStereoAudioBufferToWavBlob(rendered, this.bitDepth);
      const filename = `hevos-master-mix-${this.bitDepth}bit.wav`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      this._toast(
        `Đã xuất Sản Phẩm Master ${this.bitDepth}-bit (${formatClockTime(rendered.duration)}): ${filename}`
      );
    } catch (err) {
      console.error('[HEVOS Arrangement Export WAV]', err);
      this._toast('Lỗi khi kết xuất bản Master WAV.', true);
    } finally {
      this.isExporting = false;
      if (btnMain) btnMain.disabled = false;
      if (btnSide) btnSide.disabled = false;
      if (lblMain) lblMain.textContent = 'Xuất Sản Phẩm (.WAV)';
    }
  }
}
