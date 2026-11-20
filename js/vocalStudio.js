// ============================================================================
// vocalStudio.js — Phân khu Thu âm Chuyên sâu 2 Kênh (Lead Vocal & Hát bè),
// Mạch Preamp Micro, Preset 1 chạm, Kệ hiệu ứng Tone.js & Auto-Tune khóa tông
// ============================================================================

import { SCALES, pcToNoteName, shouldPreferFlats } from './theory.js?v=8';
import { VocalCapture, encodePcmToWavBlob, getDefaultMicGain } from './pitchToMidi.js?v=8';
import { applyAutoTunePcm } from './autoTune.js?v=8';

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

export class VocalStudio {
  constructor(rootEl, callbacks = {}) {
    this.root = rootEl;
    this.cb = callbacks;

    this.vocalCapture = new VocalCapture();
    this.activeTrackId = 'lead';
    this.rackExpanded = false;
    this.monitorEnabled = false;
    this.recordPhase = 'idle'; // 'idle' | 'countin' | 'recording'
    this.recordingTrackId = null;

    this._recStopTimer = null;
    this._atDebounceTimers = { lead: null, backing: null };
    this._liveWavePeaks = [];
    this._liveWaveSampleAccum = 0;
    this._liveWaveMaxPeak = 0;
    this._liveExpectedSamples = 44100 * 10;

    const leadInit = cloneDefaultFx('clean');
    const backInit = cloneDefaultFx('ballad');
    backInit.fx.pan = 18;

    this.tracks = {
      lead: {
        id: 'lead',
        mixerKey: 'vocal',
        title: 'Track 1 · Giọng chính',
        shortTitle: 'Giọng chính',
        accentClass: 'vs-track-lead',
        waveColor: '#F43F5E',
        rawPcm: null,
        processedPcm: null,
        sampleRate: 44100,
        rawWavBlob: null,
        processedWavBlob: null,
        syncOffsetMs: 0,
        presetId: leadInit.presetId,
        fx: leadInit.fx,
        autoTune: leadInit.autoTune,
        isProcessingAt: false,
        atReqId: 0,
        lastBeat: 0,
      },
      backing: {
        id: 'backing',
        mixerKey: 'vocal2',
        title: 'Track 2 · Hát bè / Ad-lib',
        shortTitle: 'Hát bè / Ad-lib',
        accentClass: 'vs-track-backing',
        waveColor: '#A855F7',
        rawPcm: null,
        processedPcm: null,
        sampleRate: 44100,
        rawWavBlob: null,
        processedWavBlob: null,
        syncOffsetMs: 0,
        presetId: backInit.presetId,
        fx: backInit.fx,
        autoTune: backInit.autoTune,
        isProcessingAt: false,
        atReqId: 0,
        lastBeat: 0,
      },
    };

    if (this.root) {
      this._render();
      this._bindEvents();
      this._applyTrackFxToEngine('lead');
      this._applyTrackFxToEngine('backing');
      this._syncAllUI();
      this._drawTrackWaveform('lead', 0);
      this._drawTrackWaveform('backing', 0);
    }
  }

  _getKeyScaleText() {
    const ctx = this.cb.getContext ? this.cb.getContext() : { keyPc: 0, scaleType: 'major' };
    const preferFlats = shouldPreferFlats(ctx.keyPc, ctx.scaleType);
    const keyName = pcToNoteName(ctx.keyPc, preferFlats);
    const scaleObj = SCALES[ctx.scaleType] || SCALES.major;
    return `${keyName} ${scaleObj.shortLabel}`;
  }

  _getMixerVol(mixerKey) {
    return this.cb.getMixerTrackVolume ? this.cb.getMixerTrackVolume(mixerKey) : 75;
  }

  _render() {
    const micGain = this.cb.getMicGain ? this.cb.getMicGain() : getDefaultMicGain();
    const echoCancel = this.cb.getEchoCancellation ? this.cb.getEchoCancellation() : false;

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
        const volVal = this._getMixerVol(tr.mixerKey);
        return `
        <div class="vs-track-card ${tr.accentClass}${tid === this.activeTrackId ? ' selected' : ''}" data-vs-card="${tid}">
          <div class="vs-track-top">
            <button type="button" class="vs-track-select" data-vs-select="${tid}" title="Chọn kênh này để chỉnh Auto-Tune & Hiệu ứng">
              <span class="vs-track-led"></span>
              <span class="vs-track-name">${tr.title}</span>
              <span class="vs-track-badge" id="vs-badge-${tid}">Trống</span>
            </button>
            <div class="vs-track-actions">
              <button type="button" class="btn vs-rec-btn" data-vs-rec="${tid}">
                <span class="rec-dot" aria-hidden="true"></span>
                <span class="vs-rec-label" id="vs-rec-label-${tid}">Thu giọng</span>
              </button>
              <button type="button" class="icon-btn vs-sm-btn" id="vs-dl-${tid}" data-vs-download="${tid}" disabled title="Tải file WAV giọng hát">
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

          <div class="vs-wave-wrap">
            <canvas class="vs-wave-canvas" id="vs-wave-${tid}" aria-label="Sóng âm ${tr.shortTitle}"></canvas>
            <span class="vs-wave-empty" id="vs-wave-empty-${tid}">Bấm "Thu giọng" để hát trên nền nhạc đang chạy (${this.cb.getContext ? this.cb.getContext().totalBars : 4} ô nhịp)</span>
          </div>

          <div class="vs-track-sliders">
            <label class="vs-mini-slider">
              <span class="vs-ms-lbl">Âm lượng</span>
              <input type="range" class="studio-range" min="0" max="100" step="1" value="${volVal}" data-vs-vol="${tid}" />
              <span class="mono-val vs-ms-val" id="vs-vol-val-${tid}">${volVal}%</span>
            </label>
            <label class="vs-mini-slider">
              <span class="vs-ms-lbl">Pan</span>
              <input type="range" class="studio-range" min="-100" max="100" step="1" value="${tr.fx.pan}" data-vs-pan="${tid}" title="Nháy đúp để đưa về giữa (C)" />
              <span class="mono-val vs-ms-val" id="vs-pan-val-${tid}">${formatPanLabel(tr.fx.pan)}</span>
            </label>
            <label class="vs-mini-slider vs-sync-slider" title="Kéo sang trái (-) nếu giọng bị trễ nhịp do mic điện thoại/Bluetooth">
              <span class="vs-ms-lbl">Lệch nhịp</span>
              <input type="range" class="studio-range" min="-250" max="250" step="5" value="${tr.syncOffsetMs}" data-vs-sync="${tid}" />
              <span class="mono-val vs-ms-val" id="vs-sync-val-${tid}">${formatSyncLabel(tr.syncOffsetMs)}</span>
            </label>
          </div>
        </div>
      `;
      })
      .join('');

    this.root.innerHTML = `
      <!-- 1. Thanh Preamp Micro & Kiểm tra tín hiệu -->
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
          <label class="vs-gain-ctrl" title="Tăng độ nhạy Preamp phần mềm (khuyên 2.4x–3.2x trên điện thoại để hát nhẹ vẫn rõ)">
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
          <span>💡 Mặc định tăng sáng giọng + lọc gió 85Hz + chống rè. <strong>Chỉ bật "Nghe trực tiếp" khi đeo tai nghe có dây</strong> để tránh hú loa.</span>
        </div>
      </div>

      <!-- 2. Bàn thu 2 kênh song song (Giọng chính & Hát bè) -->
      <div class="vs-tracks-grid">
        ${tracksHtml}
      </div>

      <!-- 3. Bảng chỉnh Kênh đang chọn: Auto-Tune khóa tông + Preset 1 chạm + Kệ Hiệu ứng -->
      <div class="vs-fx-shell">
        <div class="vs-editing-banner">
          <span class="vs-edit-dot" id="vs-edit-dot"></span>
          <span class="vs-edit-title" id="vs-edit-title">Đang chỉnh hiệu ứng: Track 1 · Giọng chính</span>
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
              <span class="vs-at-key-badge" id="vs-at-key-badge">Khóa tông: ${this._getKeyScaleText()}</span>
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

    // Chọn kênh đang chỉnh (Track 1 / Track 2)
    qq('[data-vs-select]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.vsSelect;
        if (tid && this.tracks[tid]) {
          this.activeTrackId = tid;
          this._syncAllUI();
        }
      });
    });

    // Nút Thu giọng từng kênh (gọi getUserMedia đồng bộ trong tap gesture!)
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

    // Nút tải WAV từng kênh
    qq('[data-vs-download]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._downloadTrackWav(btn.dataset.vsDownload);
      });
    });

    // Nút xóa từng kênh
    qq('[data-vs-clear]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._clearTrack(btn.dataset.vsClear);
      });
    });

    // Mic Gain slider (đồng bộ với toàn app & Preamp sống)
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

    // Monitor (Nghe trực tiếp) toggle
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

    // Khử vọng loa
    const echoChk = q('#vs-chk-echo');
    if (echoChk) {
      echoChk.addEventListener('change', (e) => {
        if (this.cb.setEchoCancellation) this.cb.setEchoCancellation(e.target.checked);
      });
    }

    // Thanh trượt trên từng Track Card: Âm lượng, Pan, Lệch nhịp Sync Offset
    qq('[data-vs-vol]').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const tid = e.target.dataset.vsVol;
        const val = Number(e.target.value);
        const tr = this.tracks[tid];
        if (!tr) return;
        const lbl = q(`#vs-vol-val-${tid}`);
        if (lbl) lbl.textContent = `${val}%`;
        if (this.cb.setMixerTrackVolume) this.cb.setMixerTrackVolume(tr.mixerKey, val);
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
        this._applyTrackFxToEngine(tid);
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
        tr.syncOffsetMs = val;
        const lbl = q(`#vs-sync-val-${tid}`);
        if (lbl) lbl.textContent = formatSyncLabel(val);
        if (this.cb.audioEngine) this.cb.audioEngine.setVocalTrackSyncOffset(tid, val);
      };
      inp.addEventListener('input', (e) => updateSync(Number(e.target.value)));
      inp.addEventListener('dblclick', () => {
        inp.value = '0';
        updateSync(0);
      });
    });

    // Auto-Tune Bật/Tắt & Độ ép tông
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

    // 6 Preset 1 chạm
    qq('[data-vs-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.vsPreset;
        this._applyPresetToActiveTrack(pid);
      });
    });

    // Đóng mở Kệ hiệu ứng chuyên sâu
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

    // Thanh trượt Kệ hiệu ứng chuyên sâu
    const bindFxSlider = (id, fxKey, formatter, extraHook = null) => {
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
        this._applyTrackFxToEngine(tr.id);
        if (extraHook) extraHook(val);
      });
    };

    bindFxSlider('vs-fx-gate', 'gate', (v) => (v <= -59 ? 'Tắt' : `${Math.round(v)} dB`));
    bindFxSlider('vs-fx-comp', 'comp', (v) => `${Math.round(v)}%`);
    bindFxSlider('vs-fx-eqLow', 'eqLow', (v) => `${v > 0 ? '+' : ''}${v} dB`);
    bindFxSlider('vs-fx-eqMid', 'eqMid', (v) => `${v > 0 ? '+' : ''}${v} dB`);
    bindFxSlider('vs-fx-eqHigh', 'eqHigh', (v) => `${v > 0 ? '+' : ''}${v} dB`);
    bindFxSlider(
      'vs-fx-pitch',
      'pitch',
      (v) => `${v > 0 ? '+' : ''}${v} st`,
      () => this._syncPitchChipHighlight()
    );
    bindFxSlider('vs-fx-reverbMix', 'reverbMix', (v) => `${Math.round(v)}%`);
    bindFxSlider('vs-fx-reverbDecay', 'reverbDecay', (v) => `${v.toFixed(1)}s`);
    bindFxSlider('vs-fx-delayMix', 'delayMix', (v) => `${Math.round(v)}%`);

    // 4 Nút chọn nhanh Pitch
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
        this._applyTrackFxToEngine(tr.id);
      });
    });

    // Nhịp Sync Delay (1/8 | 1/8. | 1/4)
    qq('[data-vs-delay-div]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = this.tracks[this.activeTrackId];
        tr.fx.delayDiv = btn.dataset.vsDelayDiv;
        tr.presetId = 'custom';
        qq('[data-vs-delay-div]').forEach((b) =>
          b.classList.toggle('active', b.dataset.vsDelayDiv === tr.fx.delayDiv)
        );
        this._syncPresetHighlight();
        this._applyTrackFxToEngine(tr.id);
      });
    });
  }

  _toast(msg, isError = false) {
    if (this.cb.showToast) this.cb.showToast(msg, isError);
  }

  _applyTrackFxToEngine(trackId) {
    const tr = this.tracks[trackId];
    if (tr && this.cb.audioEngine) {
      this.cb.audioEngine.updateVocalTrackFx(trackId, tr.fx);
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

    this._applyTrackFxToEngine(tr.id);
    this._syncAllUI();

    if (
      tr.rawPcm &&
      (tr.autoTune.enabled !== prevAtEnabled ||
        (tr.autoTune.enabled && tr.autoTune.strength !== prevAtStrength))
    ) {
      this._scheduleAutoTuneReprocess(tr.id, 10);
    }

    this._toast(`Đã áp dụng preset "${preset.name}" cho ${tr.shortTitle}.`);
  }

  // ============================================================================
  // Luồng Thu âm Vocal 2 Kênh (Đếm vào 1 ô -> Overdub beat -> Auto-Normalize -> Auto-Tune)
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
    this._syncAllUI();

    const engine = this.cb.audioEngine;
    if (engine.isPlaying && this.cb.onStopPlayback) {
      this.cb.onStopPlayback();
    } else if (engine.isPlaying) {
      engine.stop();
    }

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
    const audioReadyPromise = engine.ensureReady();

    try {
      await micPromise;
    } catch (err) {
      this.vocalCapture.close();
      audioReadyPromise.catch(() => {});
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

    try {
      await audioReadyPromise;
    } catch (err) {
      this.vocalCapture.close();
      this._toast(err.message || 'Không thể khởi động bộ máy âm thanh.', true);
      return;
    }

    // 1. Giai đoạn Count-in 1 ô nhịp
    this.recordingTrackId = trackId;
    this.recordPhase = 'countin';
    this._updateRecordButtonsUI();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange(this.recordPhase, trackId);
    }

    const overlay = document.getElementById('vocal-countin-overlay');
    const captionEl = document.getElementById('vocal-countin-caption');
    const numEl = document.getElementById('vocal-countin-number');
    if (overlay) overlay.classList.remove('hidden');
    if (captionEl) captionEl.textContent = `CHUẨN BỊ THU · ${tr.shortTitle.toUpperCase()}`;
    if (numEl) numEl.textContent = '1';

    const completedCountIn = await engine.runCountIn((beatNum) => {
      if (numEl) numEl.textContent = String(beatNum);
    });

    if (overlay) overlay.classList.add('hidden');
    if (!completedCountIn || this.recordPhase !== 'countin') {
      this.vocalCapture.close();
      this.recordPhase = 'idle';
      this.recordingTrackId = null;
      this._resetLiveVu();
      this._updateRecordButtonsUI();
      if (this.cb.onRecordingStateChange) {
        this.cb.onRecordingStateChange('idle', null);
      }
      return;
    }

    // 2. Bắt đầu thu giọng song song beat (chỉ tắt tiếng đúng kênh đang thu để hát bè nghe được giọng chính!)
    const ctx = this.cb.getContext ? this.cb.getContext() : { bpm: 84, totalBars: 4 };
    const loopSec = ctx.totalBars * 4 * (60 / ctx.bpm);
    this._liveExpectedSamples = Math.max(1024, Math.round(loopSec * (this.vocalCapture.sampleRate || 44100)));
    this._liveWavePeaks = [];
    this._liveWaveSampleAccum = 0;
    this._liveWaveMaxPeak = 0;

    this.recordPhase = 'recording';
    this._updateRecordButtonsUI();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange('recording', trackId);
    }

    const card = this.root.querySelector(`[data-vs-card="${trackId}"]`);
    if (card) card.classList.add('recording');
    const emptyEl = this.root.querySelector(`#vs-wave-empty-${trackId}`);
    if (emptyEl) emptyEl.classList.add('hidden');

    await engine.play(true, { recordingTrack: trackId });
    this.vocalCapture.beginCapture();
    if (this.cb.onStartPlayback) this.cb.onStartPlayback();

    const loopMs = Math.round(loopSec * 1000);
    const compMs = Math.round(engine.getRecordLatencyCompSec() * 1000);
    clearTimeout(this._recStopTimer);
    this._recStopTimer = setTimeout(() => {
      if (this.recordPhase === 'recording' && this.recordingTrackId === trackId) {
        this.finishTrackRecording();
      }
    }, loopMs + compMs + 80);
  }

  cancelRecording() {
    clearTimeout(this._recStopTimer);
    this._recStopTimer = null;
    if (this.cb.audioEngine) {
      this.cb.audioEngine.cancelCountIn();
      this.cb.audioEngine.stop();
    }
    this.vocalCapture.close();
    const prevTid = this.recordingTrackId;
    this.recordPhase = 'idle';
    this.recordingTrackId = null;

    const overlay = document.getElementById('vocal-countin-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (prevTid) {
      const card = this.root.querySelector(`[data-vs-card="${prevTid}"]`);
      if (card) card.classList.remove('recording');
      this._drawTrackWaveform(prevTid, 0);
    }
    this._resetLiveVu();
    this._updateRecordButtonsUI();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange('idle', null);
    }
  }

  async finishTrackRecording() {
    clearTimeout(this._recStopTimer);
    this._recStopTimer = null;
    const trackId = this.recordingTrackId;
    const tr = this.tracks[trackId];

    const engine = this.cb.audioEngine;
    const trimStartSec = engine.getRecordLatencyCompSec();
    if (this.cb.onStopPlayback) this.cb.onStopPlayback();
    else engine.stop();

    const take = this.vocalCapture.finishCapture({ trimStartSec, autoNormalize: true });

    this.recordPhase = 'idle';
    this.recordingTrackId = null;
    if (trackId) {
      const card = this.root.querySelector(`[data-vs-card="${trackId}"]`);
      if (card) card.classList.remove('recording');
    }
    this._resetLiveVu();
    this._updateRecordButtonsUI();
    if (this.cb.onRecordingStateChange) {
      this.cb.onRecordingStateChange('idle', null);
    }

    if (!tr || !take || !take.pcmData || take.pcmData.length < 1024) {
      this._toast('Bản thu quá ngắn hoặc chưa nhận được tín hiệu giọng hát.', true);
      if (tr) this._drawTrackWaveform(tr.id, 0);
      return;
    }

    tr.rawPcm = take.pcmData;
    tr.sampleRate = take.sampleRate;
    tr.rawWavBlob = take.wavBlob;
    tr.processedPcm = null;
    tr.processedWavBlob = null;

    await this._processAndLoadTrack(trackId, false);
    this._toast(`Đã thu xong ${tr.shortTitle} (đã tự động cân chỉnh âm lượng chuẩn)!`);
  }

  _scheduleAutoTuneReprocess(trackId, delayMs = 150) {
    clearTimeout(this._atDebounceTimers[trackId]);
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;
    this._atDebounceTimers[trackId] = setTimeout(() => {
      this._processAndLoadTrack(trackId, true);
    }, delayMs);
  }

  async _processAndLoadTrack(trackId, notifyAtDone = false) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;

    tr.atReqId += 1;
    const reqId = tr.atReqId;

    if (!tr.autoTune.enabled || tr.autoTune.strength <= 1) {
      tr.isProcessingAt = false;
      tr.processedPcm = null;
      tr.processedWavBlob = null;
      this._syncAtStatusUI();
      this._drawTrackWaveform(trackId, 0);
      this._syncTrackCardHeader(trackId);
      if (this.cb.onTakesChanged) this.cb.onTakesChanged();
      await this.cb.audioEngine.setVocalTrackAudio(trackId, tr.rawWavBlob, tr.syncOffsetMs);
      return;
    }

    tr.isProcessingAt = true;
    this._syncAtStatusUI();

    const ctx = this.cb.getContext ? this.cb.getContext() : { keyPc: 0, scaleType: 'major' };
    try {
      const res = await applyAutoTunePcm(tr.rawPcm, tr.sampleRate, {
        keyPc: ctx.keyPc,
        scaleType: ctx.scaleType,
        strength: tr.autoTune.strength / 100,
      });

      if (tr.atReqId !== reqId) return; // Có lần xử lý mới hơn đang chạy

      tr.processedPcm = res.pcmData;
      tr.processedWavBlob = res.wavBlob;
      tr.isProcessingAt = false;
      this._syncAtStatusUI();
      this._drawTrackWaveform(trackId, 0);
      this._syncTrackCardHeader(trackId);
      if (this.cb.onTakesChanged) this.cb.onTakesChanged();

      await this.cb.audioEngine.setVocalTrackAudio(trackId, res.wavBlob, tr.syncOffsetMs);
      if (notifyAtDone) {
        const cents = res.stats && res.stats.avgCorrectionCents ? ` (~${res.stats.avgCorrectionCents} cents)` : '';
        this._toast(`Đã áp dụng Auto-Tune ${this._getKeyScaleText()}${cents}.`);
      }
    } catch (err) {
      if (tr.atReqId !== reqId) return;
      tr.isProcessingAt = false;
      this._syncAtStatusUI();
      console.warn('[HEVOS STUDIO Auto-Tune]', err);
      await this.cb.audioEngine.setVocalTrackAudio(trackId, tr.rawWavBlob, tr.syncOffsetMs);
    }
  }

  _clearTrack(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;
    clearTimeout(this._atDebounceTimers[trackId]);
    tr.atReqId += 1;
    tr.rawPcm = null;
    tr.processedPcm = null;
    tr.rawWavBlob = null;
    tr.processedWavBlob = null;
    tr.isProcessingAt = false;

    if (this.cb.audioEngine) {
      this.cb.audioEngine.clearVocalTrack(trackId);
    }
    this._syncTrackCardHeader(trackId);
    this._syncAtStatusUI();
    this._drawTrackWaveform(trackId, 0);
    if (this.cb.onTakesChanged) this.cb.onTakesChanged();
    this._toast(`Đã xóa bản thu ${tr.shortTitle}.`);
  }

  _downloadTrackWav(trackId) {
    const tr = this.tracks[trackId];
    if (!tr || !tr.rawPcm) return;
    const blob =
      tr.autoTune.enabled && tr.processedWavBlob
        ? tr.processedWavBlob
        : tr.rawWavBlob || encodePcmToWavBlob(tr.rawPcm, tr.sampleRate);
    const suffix = tr.autoTune.enabled ? 'autotune' : 'raw';
    const filename = `hevos-vocal-${trackId}-${suffix}.wav`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this._toast(`Đã tải file giọng: ${filename}`);
  }

  // ============================================================================
  // Đồng bộ Giao diện & Sóng âm 60fps
  // ============================================================================
  _updateLiveVu({ level, noteName }) {
    if (!this.root) return;
    const fill = this.root.querySelector('#vs-vu-fill');
    const peakEl = this.root.querySelector('#vs-vu-peak');
    const noteEl = this.root.querySelector('#vs-live-note');
    const pct = Math.min(100, Math.round((level || 0) * 100));
    if (fill) fill.style.width = `${pct}%`;
    if (peakEl) peakEl.style.left = `${pct}%`;
    if (noteName !== undefined && noteEl) {
      noteEl.innerHTML = `Nốt: <strong>${noteName || '—'}</strong>`;
    }
  }

  _resetLiveVu() {
    if (!this.root) return;
    const fill = this.root.querySelector('#vs-vu-fill');
    const peakEl = this.root.querySelector('#vs-vu-peak');
    const noteEl = this.root.querySelector('#vs-live-note');
    if (fill) fill.style.width = '0%';
    if (peakEl) peakEl.style.left = '0%';
    if (noteEl) noteEl.innerHTML = 'Nốt: <strong>—</strong>';
  }

  _appendLiveWaveChunk(trackId, chunk) {
    if (this.recordPhase !== 'recording' || this.recordingTrackId !== trackId) return;
    const samplesPerCol = Math.max(256, Math.floor(this._liveExpectedSamples / 140));
    for (let i = 0; i < chunk.length; i++) {
      const a = Math.abs(chunk[i]);
      if (a > this._liveWaveMaxPeak) this._liveWaveMaxPeak = a;
      this._liveWaveSampleAccum++;
      if (this._liveWaveSampleAccum >= samplesPerCol) {
        this._liveWavePeaks.push(this._liveWaveMaxPeak);
        this._liveWaveSampleAccum = 0;
        this._liveWaveMaxPeak = 0;
      }
    }
    this._drawTrackWaveform(trackId, this.cb.audioEngine ? this.cb.audioEngine.getCurrentBeat() : 0);
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

  _syncTrackCardHeader(trackId) {
    if (!this.root) return;
    const tr = this.tracks[trackId];
    const has = Boolean(tr.rawPcm);
    const badge = this.root.querySelector(`#vs-badge-${trackId}`);
    const dlBtn = this.root.querySelector(`#vs-dl-${trackId}`);
    const delBtn = this.root.querySelector(`#vs-del-${trackId}`);
    const emptyEl = this.root.querySelector(`#vs-wave-empty-${trackId}`);
    if (badge) {
      badge.textContent = !has ? 'Trống' : tr.autoTune.enabled ? 'Đã thu · AT' : 'Đã thu';
      badge.classList.toggle('has-take', has);
      badge.classList.toggle('has-at', has && tr.autoTune.enabled);
    }
    if (dlBtn) dlBtn.disabled = !has;
    if (delBtn) delBtn.disabled = !has;
    if (emptyEl) {
      emptyEl.classList.toggle('hidden', has || (this.recordPhase === 'recording' && this.recordingTrackId === trackId));
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

    // Header của từng track card
    this._syncTrackCardHeader('lead');
    this._syncTrackCardHeader('backing');

    // Auto-Tune controls
    const atEn = q('#vs-at-enabled');
    const atStr = q('#vs-at-strength');
    const atStrVal = q('#vs-at-strength-val');
    const atKey = q('#vs-at-key-badge');
    if (atEn) atEn.checked = tr.autoTune.enabled;
    if (atStr) atStr.value = String(tr.autoTune.strength);
    if (atStrVal) atStrVal.textContent = `${tr.autoTune.strength}%`;
    if (atKey) atKey.textContent = `Khóa tông: ${this._getKeyScaleText()}`;
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

  syncFromApp({ micGain, echoCancellation, mixer } = {}) {
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
    if (mixer) {
      ['lead', 'backing'].forEach((tid) => {
        const tr = this.tracks[tid];
        if (!mixer[tr.mixerKey]) return;
        const v = mixer[tr.mixerKey].volume;
        const inp = this.root.querySelector(`[data-vs-vol="${tid}"]`);
        const lbl = this.root.querySelector(`#vs-vol-val-${tid}`);
        if (inp) inp.value = String(v);
        if (lbl) lbl.textContent = `${v}%`;
      });
    }
  }

  onContextChange({ keyChanged = false } = {}) {
    if (!this.root) return;
    const atKey = this.root.querySelector('#vs-at-key-badge');
    if (atKey) atKey.textContent = `Khóa tông: ${this._getKeyScaleText()}`;

    const ctx = this.cb.getContext ? this.cb.getContext() : { totalBars: 4 };
    ['lead', 'backing'].forEach((tid) => {
      const tr = this.tracks[tid];
      const emptyEl = this.root.querySelector(`#vs-wave-empty-${tid}`);
      if (emptyEl) {
        emptyEl.textContent = `Bấm "Thu giọng" để hát trên nền nhạc đang chạy (${ctx.totalBars} ô nhịp)`;
      }
      if (keyChanged && tr.rawPcm && tr.autoTune.enabled) {
        this._scheduleAutoTuneReprocess(tid, 60);
      } else {
        this._drawTrackWaveform(tid, 0);
      }
    });
  }

  resizeAndRedraw() {
    requestAnimationFrame(() => {
      const beat = this.cb.audioEngine && this.cb.audioEngine.isPlaying ? this.cb.audioEngine.getCurrentBeat() : 0;
      this._drawTrackWaveform('lead', beat);
      this._drawTrackWaveform('backing', beat);
    });
  }

  tickPlayhead(beat, isPlaying) {
    this._drawTrackWaveform('lead', isPlaying ? beat : 0, isPlaying);
    this._drawTrackWaveform('backing', isPlaying ? beat : 0, isPlaying);
  }

  _drawTrackWaveform(trackId, playheadBeat = 0, showPlayhead = false) {
    if (!this.root) return;
    const canvas = this.root.querySelector(`#vs-wave-${trackId}`);
    const tr = this.tracks[trackId];
    if (!canvas || !tr) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 16) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    // Nền OLED chìm
    ctx.fillStyle = '#0B0C0E';
    ctx.fillRect(0, 0, w, h);

    // Vạch chia ô nhịp 4 hoặc 8 ô
    const studioCtx = this.cb.getContext ? this.cb.getContext() : { totalBars: 4 };
    const totalBars = studioCtx.totalBars === 8 ? 8 : 4;
    const totalBeats = totalBars * 4;

    for (let bar = 1; bar < totalBars; bar++) {
      const x = Math.round((bar / totalBars) * w) + 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // Đường trục giữa
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const isRecThis = this.recordPhase === 'recording' && this.recordingTrackId === trackId;

    if (isRecThis && this._liveWavePeaks.length > 0) {
      // Vẽ sóng âm trực tiếp đang thu
      const cols = this._liveWavePeaks;
      ctx.fillStyle = tr.waveColor;
      const totalCols = 140;
      const colStep = w / totalCols;
      for (let i = 0; i < cols.length && i < totalCols; i++) {
        const amp = Math.min(1, cols[i] * 1.15);
        const barH = Math.max(2, amp * (h - 8));
        const x = i * colStep;
        ctx.fillRect(x, (h - barH) / 2, Math.max(1.5, colStep * 0.72), barH);
      }
    } else {
      const pcm = tr.autoTune.enabled && tr.processedPcm ? tr.processedPcm : tr.rawPcm;
      if (pcm && pcm.length > 0) {
        const step = Math.max(1, Math.floor(pcm.length / (w / 2.5)));
        let maxPeak = 0.08;
        for (let i = 0; i < pcm.length; i += Math.max(1, Math.floor(step / 3))) {
          const a = Math.abs(pcm[i]);
          if (a > maxPeak) maxPeak = a;
        }

        ctx.fillStyle = tr.autoTune.enabled && trackId === 'lead' ? '#FB7185' : tr.waveColor;
        for (let x = 0; x < w; x += 2.5) {
          const start = Math.floor((x / w) * pcm.length);
          let peak = 0;
          const scanEnd = Math.min(pcm.length, start + step);
          const scanStep = Math.max(1, Math.floor((scanEnd - start) / 14));
          for (let j = start; j < scanEnd; j += scanStep) {
            const a = Math.abs(pcm[j]);
            if (a > peak) peak = a;
          }
          const barH = Math.max(2, (peak / maxPeak) * (h - 8));
          ctx.fillRect(x, (h - barH) / 2, 1.6, barH);
        }
      }
    }

    // Playhead cam-đỏ đồng bộ Transport
    if (showPlayhead && totalBeats > 0) {
      const px = Math.max(0, Math.min(w - 1, (playheadBeat / totalBeats) * w));
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }

    ctx.restore();
  }
}
