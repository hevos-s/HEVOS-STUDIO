// ============================================================================
// stepSequencer.js — Bộ gõ Step Sequencer 16 bước trực quan (6 làn trống + Accent)
// Đồng bộ 2 chiều với Tone.Part Live, Offline WAV/MP3 Export, MIDI Export & Vocal Studio
// ============================================================================

export const SEQ_LANES = [
  { id: 'kick',    label: 'Kick 808',   drumType: 'kick',  openHat: false, color: '#F97316' },
  { id: 'snare',   label: 'Snare',      drumType: 'snare', openHat: false, color: '#EC4899' },
  { id: 'clap',    label: 'Clap',       drumType: 'clap',  openHat: false, color: '#A78BFA' },
  { id: 'hat',     label: 'Hi-Hat',     drumType: 'hat',   openHat: false, color: '#22D3EE' },
  { id: 'openHat', label: 'Open Hat',   drumType: 'hat',   openHat: true,  color: '#38BDF8' },
  { id: 'perc',    label: 'Rim / Crash',drumType: 'rim',   openHat: false, color: '#34D399' },
];

export const SEQ_PRESETS = [
  {
    id: 'kpop_trap',
    name: 'K-Pop / YG Trap Stage',
    grid: {
      kick:    [2,0,0,1, 0,0,2,0, 0,0,2,0, 0,0,0,1],
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 2,0,1,0],
      clap:    [0,0,0,0, 2,0,0,0, 0,0,0,0, 2,0,0,1],
      hat:     [1,0,1,1, 1,0,2,1, 1,1,1,0, 1,0,2,1],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
      perc:    [2,0,0,0, 0,0,0,1, 0,0,0,0, 0,1,0,0],
    },
  },
  {
    id: 'stage_pop',
    name: 'US-UK Four-on-the-Floor',
    grid: {
      kick:    [2,0,0,0, 2,0,0,0, 2,0,0,0, 2,0,1,0],
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 2,0,0,1],
      clap:    [0,0,0,0, 2,0,0,0, 0,0,0,0, 2,0,0,0],
      hat:     [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      openHat: [0,0,2,0, 0,0,2,0, 0,0,2,0, 0,0,2,0],
      perc:    [2,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
    },
  },
  {
    id: 'alt_hiphop',
    name: 'G-Dragon / Alt Bounce',
    grid: {
      kick:    [2,0,0,0, 0,0,2,0, 2,0,1,0, 0,0,0,0],
      snare:   [0,0,0,0, 2,0,0,1, 0,0,0,0, 2,0,1,1],
      clap:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 2,0,0,1],
      hat:     [1,0,1,0, 1,0,0,0, 1,0,1,0, 1,0,0,0],
      openHat: [0,0,0,0, 0,0,2,0, 0,0,0,0, 0,0,1,0],
      perc:    [2,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,0],
    },
  },
  {
    id: 'pop',
    name: 'Pop Groove Năng Động',
    grid: {
      kick:    [2,0,0,0, 0,0,1,0, 2,0,0,0, 0,0,0,0],
      snare:   [0,0,0,0, 2,0,0,0, 0,0,0,0, 2,0,0,0],
      clap:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:     [2,0,1,0, 2,0,1,0, 2,0,1,0, 2,0,0,0],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,2,0],
      perc:    [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    },
  },
  {
    id: 'lofi',
    name: 'Lo-Fi / R&B Êm Mượt',
    grid: {
      kick:    [2,0,0,0, 0,0,0,1, 0,0,2,0, 0,0,0,0],
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      clap:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hat:     [2,0,1,0, 2,0,1,0, 2,0,1,0, 2,0,0,0],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      perc:    [0,0,0,0, 2,0,0,0, 0,0,0,0, 2,0,0,0],
    },
  },
  {
    id: 'ballad',
    name: 'Ballad Tinh Tế',
    grid: {
      kick:    [2,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      snare:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
      clap:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hat:     [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      perc:    [0,0,0,0, 2,0,0,0, 0,0,0,0, 2,0,0,0],
    },
  },
  {
    id: 'afrobeats_bounce',
    name: 'Afrobeats / Dancehall Bounce',
    suggestedBpm: 105,
    suggestedSwing: 12,
    grid: {
      kick:    [2,0,0,0, 1,0,0,0, 2,0,0,0, 1,0,0,0],
      snare:   [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
      clap:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
      hat:     [2,0,1,0, 1,0,1,0, 2,0,1,0, 1,0,1,0],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
      perc:    [0,0,0,2, 0,0,1,0, 0,0,0,2, 0,0,1,0],
    },
  },
  {
    id: 'vpop_afro_club',
    name: 'V-Pop Afro Club',
    suggestedBpm: 104,
    suggestedSwing: 15,
    grid: {
      kick:    [2,0,0,0, 1,0,0,0, 2,0,0,1, 2,0,0,0],
      snare:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      clap:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,2,0],
      hat:     [2,1,1,0, 1,1,1,0, 2,1,1,0, 1,1,1,1],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,1,0,0],
      perc:    [0,0,0,2, 0,0,1,0, 0,0,2,0, 0,0,1,0],
    },
  },
  {
    id: 'afro_rnb_chill',
    name: 'Afro R&B / Moombahton Chill',
    suggestedBpm: 102,
    suggestedSwing: 18,
    grid: {
      kick:    [2,0,0,0, 1,0,0,0, 2,0,0,0, 1,0,0,0],
      snare:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0],
      clap:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hat:     [1,0,1,1, 1,0,1,1, 1,0,1,0, 1,0,1,1],
      openHat: [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      perc:    [0,0,0,1, 0,0,1,0, 0,0,0,1, 0,0,1,0],
    },
  },
];

export function getSeqPresetById(id) {
  return SEQ_PRESETS.find((p) => p.id === id) || null;
}

export function cloneDrumGrid(grid) {
  const out = {};
  SEQ_LANES.forEach((lane) => {
    const src = grid && Array.isArray(grid[lane.id]) ? grid[lane.id] : [];
    const arr = new Array(16).fill(0);
    for (let i = 0; i < 16; i++) {
      const v = Number(src[i]);
      arr[i] = v === 2 ? 2 : v === 1 ? 1 : 0;
    }
    out[lane.id] = arr;
  });
  return out;
}

export function createDefaultDrumGrid(presetId = 'kpop_trap') {
  const found = SEQ_PRESETS.find((p) => p.id === presetId) || SEQ_PRESETS[0];
  return cloneDrumGrid(found.grid);
}

export function createEmptyDrumGrid() {
  const out = {};
  SEQ_LANES.forEach((lane) => {
    out[lane.id] = new Array(16).fill(0);
  });
  return out;
}

export function randomizeDrumGrid() {
  const g = createEmptyDrumGrid();
  g.kick[0] = 2;
  for (let i = 1; i < 16; i++) {
    if (i === 4 || i === 12) continue;
    if (Math.random() < (i % 2 === 0 ? 0.35 : 0.16)) {
      g.kick[i] = Math.random() < 0.45 ? 2 : 1;
    }
  }
  g.snare[4] = 2;
  g.snare[12] = 2;
  g.clap[4] = 2;
  g.clap[12] = 2;
  if (Math.random() < 0.5) g.snare[15] = 1;

  for (let i = 0; i < 16; i++) {
    if (i === 14 && Math.random() < 0.65) {
      g.openHat[i] = 2;
    } else if (i % 2 === 0 || Math.random() < 0.42) {
      g.hat[i] = i % 4 === 0 ? 2 : 1;
    }
  }
  if (Math.random() < 0.65) g.perc[0] = 2;
  if (Math.random() < 0.5) g.perc[7] = 1;
  return g;
}

export class StepSequencerUI {
  constructor(containerEl, callbacks = {}) {
    this.container = containerEl;
    this.cb = callbacks; // { getGrid, getDrumPattern, onGridChange, onAuditionDrum, onSelectCustomDrum }
    this.selectedPresetId = 'kpop_trap';
    this.accentPaint = false;
    this.activeStep = -1;
    this._padMap = new Map(); // `${laneId}:${step}` -> button element
    this._render();
  }

  _getGrid() {
    if (typeof this.cb.getGrid === 'function') {
      const g = this.cb.getGrid();
      if (g) return g;
    }
    return createDefaultDrumGrid(this.selectedPresetId);
  }

  _render() {
    if (!this.container) return;
    const isCustom = typeof this.cb.getDrumPattern === 'function' && this.cb.getDrumPattern() === 'custom_seq';
    const presetOpts = SEQ_PRESETS.map(
      (p) => `<option value="${p.id}"${p.id === this.selectedPresetId ? ' selected' : ''}>${p.name}</option>`
    ).join('');

    const grid = this._getGrid();
    const headerSteps = Array.from({ length: 16 }, (_, s) => {
      const beatNum = Math.floor(s / 4) + 1;
      const isBeatHead = s % 4 === 0;
      return `<div class="seq-step-num${isBeatHead ? ' is-beat-head' : ''}" data-seq-head="${s}">${isBeatHead ? beatNum : '·'}</div>`;
    }).join('');

    const lanesHtml = SEQ_LANES.map((lane) => {
      const steps = grid[lane.id] || new Array(16).fill(0);
      const pads = steps
        .map((val, step) => {
          const beatGroup = Math.floor(step / 4) % 2;
          const cls = val === 2 ? ' is-accent' : val === 1 ? ' is-on' : '';
          return `
            <button
              type="button"
              class="seq-pad beat-grp-${beatGroup}${cls}"
              data-seq-lane="${lane.id}"
              data-seq-step="${step}"
              style="--lane-color: ${lane.color};"
              aria-label="${lane.label} bước ${step + 1}"
              aria-pressed="${val > 0}"
            >
              <span class="seq-pad-dot"></span>
            </button>
          `;
        })
        .join('');

      return `
        <div class="seq-lane-row" data-lane-row="${lane.id}">
          <button type="button" class="seq-lane-label" data-audition-lane="${lane.id}" title="Nghe thử ${lane.label}">
            <span class="seq-lane-swatch" style="background: ${lane.color};"></span>
            <span>${lane.label}</span>
          </button>
          <div class="seq-lane-pads">${pads}</div>
        </div>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="seq-wrap">
        <div class="seq-toolbar">
          <div class="seq-tb-left">
            <span class="seq-status-pill${isCustom ? ' is-live' : ''}" id="seq-active-badge">
              ${isCustom ? '● Đang phát lưới tự soạn 16 bước' : 'Chưa kích hoạt (đang dùng Preset trống)'}
            </span>
            <button type="button" class="btn btn-cyan-outline btn-xs${isCustom ? ' hidden' : ''}" id="btn-seq-activate">Dùng lưới này làm Trống</button>
          </div>

          <div class="seq-tb-right">
            <label class="inline-field">
              <span class="inline-label">Mẫu nhịp</span>
              <select id="seq-preset-select" class="studio-select compact" aria-label="Mẫu Step Sequencer">${presetOpts}</select>
            </label>
            <button type="button" class="btn btn-ghost btn-xs" id="btn-seq-load-preset">Nạp mẫu</button>
            <button type="button" class="btn btn-indigo-outline btn-xs" id="btn-seq-random">Ngẫu nhiên</button>
            <button type="button" class="toggle-pill${this.accentPaint ? ' active' : ''}" id="btn-seq-accent-mode" aria-pressed="${this.accentPaint}" title="Bật để đánh dấu Accent mạnh hơn khi chạm">
              <span>Nhấn mạnh (Accent)</span>
            </button>
            <button type="button" class="btn btn-rose-outline btn-xs" id="btn-seq-clear">Xóa lưới</button>
          </div>
        </div>

        <div class="seq-grid-scroll">
          <div class="seq-grid-inner">
            <div class="seq-header-row">
              <div class="seq-corner-lbl">NHẠC CỤ (TAP NGHE THỬ)</div>
              <div class="seq-steps-head">${headerSteps}</div>
            </div>
            <div class="seq-lanes-body" id="seq-lanes-body">${lanesHtml}</div>
          </div>
        </div>
        <p class="seq-tip">Mẹo: Chạm vào ô để bật/tắt tiếng · Step 1 nhấn Accent trên <strong>Rim / Crash</strong> đánh Crash đầu đoạn, các bước lệch phách đánh Afro Rimshot sắc nét!</p>
      </div>
    `;

    this._cachePads();
    this._bindEvents();
  }

  _cachePads() {
    this._padMap.clear();
    if (!this.container) return;
    this.container.querySelectorAll('.seq-pad').forEach((btn) => {
      const k = `${btn.dataset.seqLane}:${btn.dataset.seqStep}`;
      this._padMap.set(k, btn);
    });
  }

  _bindEvents() {
    if (!this.container) return;
    const q = (sel) => this.container.querySelector(sel);

    q('#btn-seq-activate')?.addEventListener('click', () => {
      if (this.cb.onSelectCustomDrum) this.cb.onSelectCustomDrum();
      this.syncPatternBadge(true);
    });

    const presetSel = q('#seq-preset-select');
    presetSel?.addEventListener('change', (e) => {
      this.selectedPresetId = e.target.value;
    });

    q('#btn-seq-load-preset')?.addEventListener('click', () => {
      const presetObj = getSeqPresetById(this.selectedPresetId);
      const next = createDefaultDrumGrid(this.selectedPresetId);
      if (this.cb.onGridChange) this.cb.onGridChange(next, true, presetObj);
      this.renderGridValues(next);
      this.syncPatternBadge(true);
    });

    q('#btn-seq-random')?.addEventListener('click', () => {
      const next = randomizeDrumGrid();
      if (this.cb.onGridChange) this.cb.onGridChange(next, true);
      this.renderGridValues(next);
      this.syncPatternBadge(true);
    });

    q('#btn-seq-clear')?.addEventListener('click', () => {
      const empty = createEmptyDrumGrid();
      if (this.cb.onGridChange) this.cb.onGridChange(empty, true);
      this.renderGridValues(empty);
      this.syncPatternBadge(true);
    });

    q('#btn-seq-accent-mode')?.addEventListener('click', (e) => {
      this.accentPaint = !this.accentPaint;
      e.currentTarget.classList.toggle('active', this.accentPaint);
      e.currentTarget.setAttribute('aria-pressed', String(this.accentPaint));
    });

    const body = q('#seq-lanes-body');
    body?.addEventListener('click', (e) => {
      const auditionBtn = e.target.closest('[data-audition-lane]');
      if (auditionBtn) {
        const lane = SEQ_LANES.find((l) => l.id === auditionBtn.dataset.auditionLane);
        if (lane && this.cb.onAuditionDrum) {
          this.cb.onAuditionDrum(lane.drumType, lane.openHat, 0.85);
        }
        return;
      }

      const pad = e.target.closest('.seq-pad');
      if (!pad) return;
      const laneId = pad.dataset.seqLane;
      const step = Number(pad.dataset.seqStep);
      const lane = SEQ_LANES.find((l) => l.id === laneId);
      if (!lane || !Number.isFinite(step)) return;

      const grid = cloneDrumGrid(this._getGrid());
      const cur = grid[laneId][step] || 0;
      const targetVal = this.accentPaint ? (cur === 2 ? 0 : 2) : cur > 0 ? 0 : 1;
      grid[laneId][step] = targetVal;

      pad.classList.toggle('is-on', targetVal === 1);
      pad.classList.toggle('is-accent', targetVal === 2);
      pad.setAttribute('aria-pressed', String(targetVal > 0));

      if (targetVal > 0 && this.cb.onAuditionDrum) {
        const hitType = laneId === 'perc' && step === 0 && targetVal === 2 ? 'crash' : lane.drumType;
        this.cb.onAuditionDrum(hitType, lane.openHat, targetVal === 2 ? 0.94 : 0.72);
      }

      if (this.cb.onGridChange) this.cb.onGridChange(grid, true);
      this.syncPatternBadge(true);
    });
  }

  selectPresetVisual(presetId, gridOverride = null) {
    if (!presetId) return;
    const presetObj = getSeqPresetById(presetId);
    if (!presetObj && !gridOverride) return;
    this.selectedPresetId = presetObj ? presetObj.id : this.selectedPresetId;
    const sel = this.container?.querySelector('#seq-preset-select');
    if (sel && presetObj) sel.value = presetObj.id;
    const nextGrid = gridOverride ? cloneDrumGrid(gridOverride) : createDefaultDrumGrid(this.selectedPresetId);
    this.renderGridValues(nextGrid);
  }

  renderGridValues(grid) {
    SEQ_LANES.forEach((lane) => {
      const row = (grid && grid[lane.id]) || [];
      for (let s = 0; s < 16; s++) {
        const pad = this._padMap.get(`${lane.id}:${s}`);
        if (!pad) continue;
        const val = row[s] || 0;
        pad.classList.toggle('is-on', val === 1);
        pad.classList.toggle('is-accent', val === 2);
        pad.setAttribute('aria-pressed', String(val > 0));
      }
    });
  }

  syncPatternBadge(isCustom) {
    if (!this.container) return;
    const badge = this.container.querySelector('#seq-active-badge');
    const actBtn = this.container.querySelector('#btn-seq-activate');
    if (badge) {
      badge.classList.toggle('is-live', Boolean(isCustom));
      badge.textContent = isCustom
        ? '● Đang phát lưới tự soạn 16 bước'
        : 'Chưa kích hoạt (đang dùng Preset trống)';
    }
    if (actBtn) {
      actBtn.classList.toggle('hidden', Boolean(isCustom));
    }
  }

  setActiveStep(stepIdx) {
    const next = Number.isFinite(stepIdx) && stepIdx >= 0 && stepIdx < 16 ? Math.floor(stepIdx) : -1;
    if (next === this.activeStep || !this.container) return;

    if (this.activeStep >= 0) {
      const oldHead = this.container.querySelector(`[data-seq-head="${this.activeStep}"]`);
      if (oldHead) oldHead.classList.remove('is-playing-col');
      SEQ_LANES.forEach((l) => {
        const oldPad = this._padMap.get(`${l.id}:${this.activeStep}`);
        if (oldPad) oldPad.classList.remove('is-playing-col');
      });
    }

    this.activeStep = next;
    if (next >= 0) {
      const head = this.container.querySelector(`[data-seq-head="${next}"]`);
      if (head) head.classList.add('is-playing-col');
      SEQ_LANES.forEach((l) => {
        const pad = this._padMap.get(`${l.id}:${next}`);
        if (pad) pad.classList.add('is-playing-col');
      });
    }
  }
}
