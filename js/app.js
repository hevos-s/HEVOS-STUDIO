// ============================================================================
// app.js — Điều phối trung tâm HEVOS STUDIO
// Quản lý trạng thái, đồng bộ Desktop & Mobile, Thu Mic -> MIDI, Lưu & Xuất
// ============================================================================

import {
  BASIC_MAJOR_CHORDS,
  BASIC_MINOR_CHORDS,
  CHORD_EXTENSIONS,
  KEY_OPTIONS,
  PROGRESSION_PRESETS,
  SCALES,
  generateVoicedProgression,
  getDiatonicChords,
  pcToNoteName,
  shouldPreferFlats,
  snapMidiToScale,
} from './theory.js?v=36';
import {
  CHORD_STYLES,
  CHORD_TIMBRES,
  DRUM_PATTERNS,
  MELODY_TIMBRES,
  audioEngine,
} from './audioEngine.js?v=36';
import {
  VocalCapture,
  drawVocalWaveform,
  getDefaultMicGain,
  transcribeAudioBufferToMidi,
} from './pitchToMidi.js?v=36';
import { PianoRoll } from './pianoRoll.js?v=36';
import { downloadMidiFile } from './midiExport.js?v=36';
import { encodeAudioBufferByFormat } from './audioEncode.js?v=36';
import { MusicTrainer } from './musicTrainer.js?v=36';
import { VocalStudio } from './vocalStudio.js?v=36';
import { ArrangementStudio } from './arrangementStudio.js?v=36';
import { createAmbientScene } from './ambientScene.js?v=36';
import { midiController } from './midiController.js?v=36';
import {
  StepSequencerUI,
  createDefaultDrumGrid,
  cloneDrumGrid,
} from './stepSequencer.js?v=36';

const STORAGE_KEY = 'melosketch_projects_v1';

// ============================================================================
// Trạng thái ứng dụng trung tâm
// ============================================================================
const defaultPreset = PROGRESSION_PRESETS[0];

const state = {
  activePresetId: defaultPreset.id,
  keyPc: defaultPreset.keyPc,
  scaleType: defaultPreset.scaleType,
  bpm: defaultPreset.bpm,
  totalBars: defaultPreset.bars,
  humanize: defaultPreset.humanize,
  chordStyle: defaultPreset.style,
  chordTimbre: defaultPreset.timbre,
  drumPattern: defaultPreset.drums,
  customDrumGrid: createDefaultDrumGrid('kpop_trap'),
  melodyTimbre: 'bell',
  beatExportFormat: 'wav',

  chords: defaultPreset.chords.map((c) => ({ ...c })),
  voicedChords: [],
  melodyNotes: [],
  selectedNoteId: null,

  // Piano Roll & Thu âm
  prMode: 'edit',
  scaleLock: true,
  prGridStep: 0.25,
  scaleSnap: true,
  vocalQuantize: '1/16',
  overdubVocal: false,
  echoCancellation: false,
  micGain: getDefaultMicGain(),
  midiRecordArmed: false,
  midiStepCursor: 0,

  // Mixer 4 kênh của phân khu Sáng tác Beat
  mixer: {
    chords: { volume: 78, muted: false, solo: false },
    melody: { volume: 82, muted: false, solo: false },
    drums:  { volume: 68, muted: false, solo: false },
    vocal:  { volume: 75, muted: false, solo: false },
  },

  // Lịch sử hoàn tác giai điệu
  undoStack: [],
  redoStack: [],

  // Trạng thái thu âm & điều hướng 4 phân khu
  recordPhase: 'idle', // 'idle' | 'countin' | 'recording'
  rawVocalBuffer: null,
  editingBarIndex: null,
  activeMobileTab: 'chords', // 'chords' | 'melody' | 'mixer'
  studioCenterView: 'melody', // 'melody' | 'sequencer'
  activeSection: 'hub',      // 'hub' | 'studio' | 'vocal' | 'arrangement' | 'trainer' | 'vision'
};

const vocalCapture = new VocalCapture();
let pianoRoll = null;
let stepSequencer = null;
let musicTrainer = null;
let vocalStudio = null;
let arrangementStudio = null;
let ambientScene = null;
let recStopTimer = null;
let uiRafId = null;
let lastPlayheadDrawMs = 0;
let channelMeters = null;
let lastHighlightedBar = -1;
const PLAYHEAD_WATCH_INTERVAL = 1000 / 28;

// ============================================================================
// DOM References
// ============================================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = {
  app: $('#app'),
  bg3dCanvas: $('#bg-3d-canvas'),
  globalBar: $('.global-app-bar'),
  btnLogoHome: $('#btn-logo-home'),
  mobileSectionBadge: $('#mobile-section-badge'),
  sectionSwitcher: $('#section-switcher'),
  hubRoot: $('#hub-root'),
  vocalRoot: $('#vocal-root'),
  arrangementRoot: $('#arrangement-root'),
  arrangementPresenceDot: $('#arrangement-presence-dot'),
  trainerRoot: $('#trainer-root'),
  visionRoot: $('#vision-root'),
  btnPlay: $('#btn-play'),
  btnPlayLabel: $('#btn-play-label'),
  btnRecord: $('#btn-record'),
  btnRecordLabel: $('#btn-record-label'),
  mobileQuickStatus: $('#mobile-quick-status'),
  mobileKeyBadge: $('#mobile-key-badge'),
  mobileBpmBadge: $('#mobile-bpm-badge'),
  lcdPos: $('#lcd-pos'),
  lcdKey: $('#lcd-key'),

  presetSelect: $('#preset-select'),
  vibeChips: $('#vibe-chips'),
  chordStyleSelect: $('#chord-style-select'),
  pianoStyleChips: $('#piano-style-chips'),
  chordStyleDesc: $('#chord-style-desc'),
  chordTimbreSelect: $('#chord-timbre-select'),
  drumPatternSelect: $('#drum-pattern-select'),
  melodyTimbreSelect: $('#melody-timbre-select'),
  chordStrip: $('#chord-strip'),

  prCanvas: $('#piano-roll-canvas'),
  prModeGroup: $('#pr-mode-group'),
  btnScaleLock: $('#btn-scale-lock'),
  btnMidiRecordArm: $('#btn-midi-record-arm'),
  prGridSelect: $('#pr-grid-select'),
  btnUndo: $('#btn-undo'),
  btnRedo: $('#btn-redo'),
  btnZoomOut: $('#btn-zoom-out'),
  btnZoomIn: $('#btn-zoom-in'),
  btnPrFullscreen: $('#btn-pr-fullscreen'),
  btnPrFullscreenLabel: $('#btn-pr-fullscreen-label'),
  btnPrFsPlay: $('#btn-pr-fs-play'),
  btnPrFsPlayLabel: $('#btn-pr-fs-play-label'),
  btnPrFsRecord: $('#btn-pr-fs-record'),
  btnPrFsRecordLabel: $('#btn-pr-fs-record-label'),
  btnClearMelody: $('#btn-clear-melody'),
  btnClearMelodyLabel: $('#btn-clear-melody-label'),

  headphoneBanner: $('#headphone-banner'),
  btnDismissHeadphone: $('#btn-dismiss-headphone'),
  vocalStatusBadge: $('#vocal-status-badge'),
  micMeterFill: $('#mic-meter-fill'),
  livePitchReadout: $('#live-pitch-readout'),
  vocalWaveform: $('#vocal-waveform'),
  chkScaleSnap: $('#chk-scale-snap'),
  vocalQuantizeSelect: $('#vocal-quantize-select'),
  chkOverdub: $('#chk-overdub'),
  btnRequantize: $('#btn-requantize'),
  vocalTakeTag: $('#vocal-take-tag'),
  vocal2TakeTag: $('#vocal2-take-tag'),

  workspaceSubtabs: $('#workspace-subtabs'),
  studioCenterTabs: $('#studio-center-tabs'),
  melodyWorkspaceView: $('#melody-workspace-view'),
  sequencerWorkspaceView: $('#sequencer-workspace-view'),
  btnOpenSequencer: $('#btn-open-sequencer'),
  vocalStudioView: $('#vocal-studio-view'),
  vocalStudioPanel: $('#vocal-studio-panel'),
  vocalPresenceDot: $('#vocal-presence-dot'),
  mobileVocalDot: $('#mobile-vocal-dot'),

  countinOverlay: $('#countin-overlay'),
  countinCaption: $('#countin-caption'),
  countinNumber: $('#countin-number'),

  chordModal: $('#chord-modal'),
  chordModalTitle: $('#chord-modal-title'),
  chordModalPreview: $('#chord-modal-preview'),
  diatonicGrid: $('#diatonic-grid'),
  basicMajorGrid: $('#basic-major-grid'),
  basicMinorGrid: $('#basic-minor-grid'),
  extensionPills: $('#extension-pills'),
  btnAuditionModalChord: $('#btn-audition-modal-chord'),
  btnCloseChordModal: $('#btn-close-chord-modal'),

  btnOpenProjects: $('#btn-open-projects'),
  projectsModal: $('#projects-modal'),
  btnCloseProjectsModal: $('#btn-close-projects-modal'),

  toastContainer: $('#toast-container'),
};

// ============================================================================
// Tiện ích UI (Toast, Sync Audio, Voicings)
// ============================================================================
function showToast(message, isError = false, options = null) {
  const div = document.createElement('div');
  const hasAction = Boolean(options && options.actionLabel && typeof options.onAction === 'function');
  div.className = `toast${isError ? ' toast-error' : ''}${hasAction ? ' has-action' : ''}`;

  if (hasAction) {
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action-btn';
    actionBtn.textContent = options.actionLabel;
    actionBtn.addEventListener('click', () => {
      options.onAction();
      div.remove();
    });
    div.appendChild(msgSpan);
    div.appendChild(actionBtn);
  } else {
    div.textContent = message;
  }

  el.toastContainer.appendChild(div);
  const durationMs = hasAction ? 4800 : 3000;
  setTimeout(() => {
    if (!div.isConnected) return;
    div.style.opacity = '0';
    div.style.transition = 'opacity 0.25s ease';
    setTimeout(() => div.remove(), 260);
  }, durationMs);
}

function recomputeVoicings() {
  state.voicedChords = generateVoicedProgression(
    state.chords.slice(0, state.totalBars),
    state.keyPc,
    state.scaleType
  );
}

function syncAudioEngine() {
  audioEngine.updateConfig({
    bpm: state.bpm,
    totalBars: state.totalBars,
    humanize: state.humanize,
    chordStyle: state.chordStyle,
    chordTimbre: state.chordTimbre,
    drumPattern: state.drumPattern,
    customDrumGrid: state.customDrumGrid,
    melodyTimbre: state.melodyTimbre,
    voicedChords: state.voicedChords,
    melodyNotes: state.melodyNotes,
    mixer: state.mixer,
  });
}

function updateClearMelodyButton() {
  const count = state.melodyNotes.length;
  el.btnClearMelody.disabled = count === 0;
  if (el.btnClearMelodyLabel) {
    el.btnClearMelodyLabel.textContent = count > 0 ? `Xóa hết MIDI (${count})` : 'Xóa hết MIDI';
  }
}

function syncPianoRoll() {
  updateClearMelodyButton();
  if (!pianoRoll) return;
  pianoRoll.setData({
    notes: state.melodyNotes,
    totalBars: state.totalBars,
    keyPc: state.keyPc,
    scaleType: state.scaleType,
    voicedChords: state.voicedChords,
    selectedNoteId: state.selectedNoteId,
  });
}

function pushUndoSnapshot() {
  const copy = state.melodyNotes.map((n) => ({ ...n }));
  state.undoStack.push(copy);
  if (state.undoStack.length > 40) state.undoStack.shift();
  state.redoStack = [];
  updateUndoButtons();
}

function updateUndoButtons() {
  el.btnUndo.disabled = state.undoStack.length === 0;
  el.btnRedo.disabled = state.redoStack.length === 0;
}

function performUndo() {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(state.melodyNotes.map((n) => ({ ...n })));
  state.melodyNotes = state.undoStack.pop();
  state.selectedNoteId = null;
  updateUndoButtons();
  syncPianoRoll();
  syncAudioEngine();
}

function performRedo() {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(state.melodyNotes.map((n) => ({ ...n })));
  state.melodyNotes = state.redoStack.pop();
  state.selectedNoteId = null;
  updateUndoButtons();
  syncPianoRoll();
  syncAudioEngine();
}

// ============================================================================
// Khởi tạo danh sách chọn (Dropdowns & Mobile Vibe Chips)
// ============================================================================
function populateSelects() {
  // 1. Key selector (Desktop & Mobile)
  $$('[data-bind="keyPc"]').forEach((sel) => {
    sel.innerHTML = KEY_OPTIONS.map(
      (k) => `<option value="${k.pc}">${k.label}</option>`
    ).join('');
  });

  // 2. Preset selector theo nhóm màu nhạc (optgroup)
  const vibes = [...new Set(PROGRESSION_PRESETS.map((p) => p.vibe))];
  el.presetSelect.innerHTML = vibes
    .map((vibe) => {
      const items = PROGRESSION_PRESETS.filter((p) => p.vibe === vibe)
        .map((p) => `<option value="${p.id}">${p.name} (${p.desc})</option>`)
        .join('');
      return `<optgroup label="${vibe}">${items}</optgroup>`;
    })
    .join('');

  // 3. Mobile quick Vibe chips
  el.vibeChips.innerHTML = vibes
    .map((vibe) => {
      const firstPreset = PROGRESSION_PRESETS.find((p) => p.vibe === vibe);
      return `<button type="button" class="vibe-chip" data-vibe="${vibe}" data-preset-id="${firstPreset.id}">${vibe}</button>`;
    })
    .join('');

  // 4. Kiểu đệm (nhóm Đệm Piano Cơ bản & Beat Hiện Đại), Chất tiếng đàn, Trống, Tiếng giai điệu
  const styleGroups = Array.from(new Set(CHORD_STYLES.map((s) => s.group || 'Khác')));
  el.chordStyleSelect.innerHTML = styleGroups
    .map((grp) => {
      const items = CHORD_STYLES.filter((s) => (s.group || 'Khác') === grp);
      const opts = items.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
      return `<optgroup label="${grp}">${opts}</optgroup>`;
    })
    .join('');

  if (el.pianoStyleChips) {
    const pianoBaseIds = ['block', 'broken_1357', 'pattern_158', 'bass_chord'];
    el.pianoStyleChips.innerHTML = pianoBaseIds
      .map((id) => {
        const s = CHORD_STYLES.find((item) => item.id === id);
        if (!s) return '';
        return `<button type="button" class="piano-style-chip" data-style-id="${s.id}" title="${s.desc}">${s.shortLabel}</button>`;
      })
      .join('');
  }

  el.chordTimbreSelect.innerHTML = CHORD_TIMBRES.map(
    (t) => `<option value="${t.id}">${t.label}</option>`
  ).join('');

  el.drumPatternSelect.innerHTML = DRUM_PATTERNS.map(
    (d) => `<option value="${d.id}">${d.label}</option>`
  ).join('');

  el.melodyTimbreSelect.innerHTML = MELODY_TIMBRES.map(
    (m) => `<option value="${m.id}">${m.label}</option>`
  ).join('');
}

// ============================================================================
// Render UI đồng bộ Desktop & Mobile
// ============================================================================
function syncGlobalControlsUI() {
  $$('[data-bind="keyPc"]').forEach((s) => (s.value = String(state.keyPc)));
  $$('[data-bind="scaleType"]').forEach((s) => (s.value = state.scaleType));
  $$('[data-bind="bpm"]').forEach((i) => (i.value = String(state.bpm)));
  $$('[data-bind="humanize"]').forEach((i) => (i.value = String(state.humanize)));
  $$('[data-bind="echoCancellation"]').forEach(
    (chk) => (chk.checked = state.echoCancellation)
  );
  $$('[data-bind="micGain"]').forEach((inp) => (inp.value = state.micGain.toFixed(1)));
  $$('[data-display="micGain"]').forEach((d) => (d.textContent = `${state.micGain.toFixed(1)}x`));

  $$('[data-display="bpm"]').forEach((d) => (d.textContent = String(state.bpm)));
  $$('[data-display="humanize"]').forEach((d) => (d.textContent = `${state.humanize}%`));

  $$('[data-seg="totalBars"] .seg-btn').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.value) === state.totalBars);
  });

  el.chordStyleSelect.value = state.chordStyle;
  if (el.pianoStyleChips) {
    $$('.piano-style-chip', el.pianoStyleChips).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.styleId === state.chordStyle);
    });
  }
  if (el.chordStyleDesc) {
    const activeStyle = CHORD_STYLES.find((s) => s.id === state.chordStyle);
    el.chordStyleDesc.textContent = activeStyle ? activeStyle.desc : '';
  }
  el.chordTimbreSelect.value = state.chordTimbre;
  el.drumPatternSelect.value = state.drumPattern;
  if (stepSequencer) stepSequencer.syncPatternBadge(state.drumPattern === 'custom_seq');
  el.melodyTimbreSelect.value = state.melodyTimbre;
  syncBeatExportFormatUI();
  if (state.activePresetId) {
    el.presetSelect.value = state.activePresetId;
  }

  // Mobile quick status pill & Desktop LCD Key readout
  const preferFlats = shouldPreferFlats(state.keyPc, state.scaleType);
  const keyName = pcToNoteName(state.keyPc, preferFlats);
  const scaleShort = SCALES[state.scaleType]?.shortLabel || 'Trưởng';
  el.mobileKeyBadge.textContent = `${keyName} ${scaleShort}`;
  el.mobileBpmBadge.textContent = `${state.bpm} BPM`;
  if (el.lcdKey) {
    el.lcdKey.textContent = `${keyName} ${scaleShort.toUpperCase()}`;
  }

  // Highlight vibe chip đang khớp
  const activePreset = PROGRESSION_PRESETS.find((p) => p.id === state.activePresetId);
  $$('.vibe-chip', el.vibeChips).forEach((chip) => {
    chip.classList.toggle('active', Boolean(activePreset && chip.dataset.vibe === activePreset.vibe));
  });
}

function renderChordStrip() {
  el.chordStrip.className = `chord-strip bars-${state.totalBars}`;
  el.chordStrip.innerHTML = state.voicedChords
    .map(
      (vc, idx) => `
      <button type="button" class="chord-card" data-bar-index="${idx}" role="listitem" title="Bấm để đổi hợp âm ô nhịp ${idx + 1}">
        <div class="chord-card-top">
          <span class="chord-bar-num">Ô ${idx + 1}</span>
          <span class="chord-roman">${vc.roman}</span>
        </div>
        <div class="chord-symbol">${vc.symbol}</div>
        <div class="chord-voicing">${vc.voicingLabels.join(' · ')}</div>
      </button>
    `
    )
    .join('');

  lastHighlightedBar = -1;
}

function syncMixerUI() {
  for (const [ch, data] of Object.entries(state.mixer)) {
    const slider = $(`[data-vol="${ch}"]`);
    const label = $(`[data-vol-label="${ch}"]`);
    const muteBtn = $(`[data-mute="${ch}"]`);
    const soloBtn = $(`[data-solo="${ch}"]`);
    if (slider) slider.value = String(data.volume);
    if (label) label.textContent = `${data.volume}%`;
    if (muteBtn) muteBtn.classList.toggle('active-mute', data.muted);
    if (soloBtn) soloBtn.classList.toggle('active-solo', data.solo);
  }

  const hasDraftVocal = Boolean(state.rawVocalBuffer);
  if (el.vocalTakeTag) {
    el.vocalTakeTag.textContent = hasDraftVocal ? 'Đã thu' : 'Trống';
    el.vocalTakeTag.classList.toggle('has-take', hasDraftVocal);
  }
  const hasVocalBoothTake = Boolean(vocalStudio && vocalStudio.hasAnyTake());
  if (el.vocalPresenceDot) {
    el.vocalPresenceDot.classList.toggle('hidden', !hasVocalBoothTake);
  }

  el.btnRequantize.disabled = !state.rawVocalBuffer;

  if (vocalStudio) {
    vocalStudio.syncFromApp({
      micGain: state.micGain,
      echoCancellation: state.echoCancellation,
    });
  }
}

function updatePlayButtonUI() {
  const playing = audioEngine.isPlaying;
  el.btnPlay.classList.toggle('playing', playing);
  el.btnPlayLabel.textContent = playing ? 'Dừng' : 'Phát';
  if (el.btnPrFsPlay) {
    el.btnPrFsPlay.classList.toggle('playing', playing);
  }
  if (el.btnPrFsPlayLabel) {
    el.btnPrFsPlayLabel.textContent = playing ? 'Dừng' : 'Phát';
  }
}

function updateRecordButtonUI() {
  const isRec = state.recordPhase !== 'idle';
  el.btnRecord.classList.toggle('recording', isRec);
  let label = 'Ngân nga MIDI';
  if (state.recordPhase === 'countin') {
    label = 'Đếm vào...';
  } else if (state.recordPhase === 'recording') {
    label = 'Dừng thu';
  }
  el.btnRecordLabel.textContent = label;
  if (el.btnPrFsRecord) {
    el.btnPrFsRecord.classList.toggle('recording', isRec);
  }
  if (el.btnPrFsRecordLabel) {
    el.btnPrFsRecordLabel.textContent = label;
  }
}

// ============================================================================
// Vòng lặp đồng bộ thanh chạy & tô sáng ô nhịp hợp âm đang phát (60fps)
// ============================================================================
function resetChannelMeters() {
  if (channelMeters) {
    for (const m of Object.values(channelMeters)) {
      m.style.transform = 'scaleX(0)';
    }
  } else {
    $$('[data-meter]').forEach((m) => {
      m.style.transform = 'scaleX(0)';
    });
  }
}

function stopPlayheadWatch() {
  if (uiRafId !== null) {
    cancelAnimationFrame(uiRafId);
    uiRafId = null;
  }
  if (lastHighlightedBar !== -1) {
    $$('.chord-card.active-bar', el.chordStrip).forEach((c) =>
      c.classList.remove('active-bar')
    );
    lastHighlightedBar = -1;
  }
  if (el.lcdPos) el.lcdPos.textContent = '1.1.1';
  if (stepSequencer) stepSequencer.setActiveStep(-1);
  resetChannelMeters();
}

function startPlayheadWatch() {
  if (uiRafId !== null) return;
  if (!audioEngine.isPlaying || state.activeSection !== 'studio' || document.hidden) return;
  lastPlayheadDrawMs = 0;

  const step = (now) => {
    if (!audioEngine.isPlaying || state.activeSection !== 'studio' || document.hidden) {
      uiRafId = null;
      if (!audioEngine.isPlaying) {
        stopPlayheadWatch();
      }
      return;
    }

    if (now - lastPlayheadDrawMs >= PLAYHEAD_WATCH_INTERVAL) {
      lastPlayheadDrawMs = now;
      const beat = audioEngine.getCurrentBeat();
      const curBar = Math.floor(beat / 4) % state.totalBars;
      if (curBar !== lastHighlightedBar) {
        lastHighlightedBar = curBar;
        $$('.chord-card', el.chordStrip).forEach((card, idx) => {
          card.classList.toggle('active-bar', idx === curBar);
        });
        if (state.recordPhase === 'recording' && el.vocalStatusBadge) {
          el.vocalStatusBadge.textContent = `Đang thu · Ô ${curBar + 1}/${state.totalBars}`;
        }
      }

      if (el.lcdPos) {
        const beatInBar = Math.floor(beat % 4) + 1;
        const step16 = Math.floor((beat % 1) * 4) + 1;
        el.lcdPos.textContent = `${curBar + 1}.${beatInBar}.${step16}`;
      }
      if (stepSequencer) {
        stepSequencer.setActiveStep(Math.floor((beat % 4) * 4));
      }

      const levels = audioEngine.getChannelLevels();
      for (const [ch, lvl] of Object.entries(levels)) {
        const barEl = channelMeters ? channelMeters[ch] : $(`[data-meter="${ch}"]`);
        if (barEl) {
          const s = Math.max(0, Math.min(1, lvl));
          barEl.style.transform = `scaleX(${s.toFixed(3)})`;
        }
      }
    }

    uiRafId = requestAnimationFrame(step);
  };
  uiRafId = requestAnimationFrame(step);
}

// ============================================================================
// Áp dụng Preset & Chỉnh Hợp âm từng ô nhịp
// ============================================================================
function applyPreset(presetId, notify = false) {
  const preset = PROGRESSION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;

  state.activePresetId = preset.id;
  state.keyPc = preset.keyPc;
  state.scaleType = preset.scaleType;
  state.bpm = preset.bpm;
  state.totalBars = preset.bars;
  state.humanize = preset.humanize;
  state.chordStyle = preset.style;
  state.chordTimbre = preset.timbre;
  state.drumPattern = preset.drums;
  state.chords = preset.chords.map((c) => ({ ...c }));

  recomputeVoicings();
  syncGlobalControlsUI();
  renderChordStrip();
  syncPianoRoll();
  syncAudioEngine();
  if (vocalStudio) vocalStudio.onContextChange({ keyChanged: true });

  if (notify) {
    showToast(`Đã nạp vòng mẫu: ${preset.name}`);
  }
}

function setTotalBars(bars) {
  const target = bars === 8 ? 8 : 4;
  if (target === state.totalBars) return;

  if (target === 8 && state.chords.length < 8) {
    // Nhân đôi vòng 4 ô lên 8 ô mượt mà để người dùng sửa thêm biến tấu
    const base = state.chords.slice(0, 4);
    state.chords = [...base.map((c) => ({ ...c })), ...base.map((c) => ({ ...c }))];
  } else if (target === 4) {
    state.chords = state.chords.slice(0, 4);
  }

  state.totalBars = target;
  recomputeVoicings();
  syncGlobalControlsUI();
  renderChordStrip();
  syncPianoRoll();
  syncAudioEngine();
  if (vocalStudio) vocalStudio.onContextChange({ keyChanged: false });
}

function setKeyPc(newPc) {
  const prevPc = state.keyPc;
  if (newPc === prevPc) return;

  // Dịch giọng giai điệu hiện có theo khoảng ngắn nhất (-6..+5) để khớp tông mới
  let delta = ((newPc - prevPc) + 12) % 12;
  if (delta > 6) delta -= 12;

  if (state.melodyNotes.length > 0 && delta !== 0) {
    pushUndoSnapshot();
    state.melodyNotes = state.melodyNotes.map((n) => {
      let m = n.midi + delta;
      while (m < 48) m += 12;
      while (m > 84) m -= 12;
      return { ...n, midi: m };
    });
  }

  state.keyPc = newPc;
  recomputeVoicings();
  syncGlobalControlsUI();
  renderChordStrip();
  syncPianoRoll();
  syncAudioEngine();
  if (vocalStudio) vocalStudio.onContextChange({ keyChanged: true });
}

// ============================================================================
// Bảng Chọn Hợp Âm (Modal Desktop / Bottom Sheet Mobile)
// ============================================================================
function openChordPicker(barIndex) {
  state.editingBarIndex = barIndex;
  renderChordPickerContent();
  el.chordModal.classList.remove('hidden');
}

function closeChordPicker() {
  el.chordModal.classList.add('hidden');
  state.editingBarIndex = null;
}

function renderChordPickerContent() {
  const idx = state.editingBarIndex;
  if (idx === null || !state.chords[idx]) return;

  const currentSpec = state.chords[idx];
  const currentVoiced = state.voicedChords[idx];
  const diatonics = getDiatonicChords(state.keyPc, state.scaleType);

  el.chordModalTitle.textContent = `Chọn hợp âm · Ô nhịp ${idx + 1}`;
  const notesPreview =
    currentVoiced && Array.isArray(currentVoiced.rootOrderedLabels)
      ? ` · [${currentVoiced.rootOrderedLabels.join(' – ')}]`
      : '';
  el.chordModalPreview.innerHTML = `Đang chọn: <strong>${currentVoiced.symbol}</strong> (${currentVoiced.roman})${notesPreview}`;

  el.diatonicGrid.innerHTML = diatonics
    .map(
      (d) => `
      <button type="button" class="diatonic-btn${!currentSpec.custom && d.degree === currentSpec.degree ? ' selected' : ''}" data-pick-degree="${d.degree}">
        <span class="dia-roman">${d.roman}</span>
        <span class="dia-name">${d.symbol}</span>
      </button>
    `
    )
    .join('');

  if (el.basicMajorGrid) {
    el.basicMajorGrid.innerHTML = BASIC_MAJOR_CHORDS.map((ch) => {
      const isSel = currentVoiced && currentVoiced.rootPc === ch.rootPc && currentVoiced.baseQuality === 'maj';
      return `
        <button type="button" class="basic-chord-btn${isSel ? ' selected' : ''}" data-pick-basic-root="${ch.rootPc}" data-pick-basic-quality="maj" title="${ch.viName}">
          <span class="bc-name">${ch.name}</span>
          <span class="bc-sub">${ch.viName}</span>
        </button>
      `;
    }).join('');
  }

  if (el.basicMinorGrid) {
    el.basicMinorGrid.innerHTML = BASIC_MINOR_CHORDS.map((ch) => {
      const isSel = currentVoiced && currentVoiced.rootPc === ch.rootPc && currentVoiced.baseQuality === 'min';
      return `
        <button type="button" class="basic-chord-btn${isSel ? ' selected' : ''}" data-pick-basic-root="${ch.rootPc}" data-pick-basic-quality="min" title="${ch.viName}">
          <span class="bc-name">${ch.name}</span>
          <span class="bc-sub">${ch.viName}</span>
        </button>
      `;
    }).join('');
  }

  el.extensionPills.innerHTML = CHORD_EXTENSIONS.map(
    (ext) => `
      <button type="button" class="ext-pill${ext.id === currentSpec.extension ? ' selected' : ''}" data-pick-ext="${ext.id}">
        ${ext.label}
      </button>
    `
  ).join('');
}

async function updateEditingBarChord(partial) {
  const idx = state.editingBarIndex;
  if (idx === null || !state.chords[idx]) return;

  state.chords[idx] = { ...state.chords[idx], ...partial };
  recomputeVoicings();
  renderChordStrip();
  renderChordPickerContent();
  syncPianoRoll();
  syncAudioEngine();

  // Nghe thử hợp âm vừa chọn ngay lập tức
  if (state.voicedChords[idx]) {
    try {
      if (ambientScene && state.activeSection === 'hub') ambientScene.wake(1800);
      await audioEngine.auditionChord(state.voicedChords[idx]);
    } catch (_) {}
  }
}

// ============================================================================
// Luồng Thu Micro Ngân Nga -> Tự động trích xuất MIDI
// ============================================================================
async function toggleVocalRecording() {
  if (state.recordPhase === 'countin') {
    cancelRecordingCleanly();
    showToast('Đã hủy đếm vào thu âm.');
    return;
  }
  if (state.recordPhase === 'recording') {
    await finishVocalRecording();
    return;
  }

  // Trên mobile tự chuyển sang Tab Giai điệu để thấy đếm vào, sóng âm và nốt MIDI
  if (window.innerWidth < 768) {
    setMobileTab('melody');
  }

  if (audioEngine.isPlaying) {
    audioEngine.stop();
    updatePlayButtonUI();
  }

  // Gọi đồng thời openMic() VÀ audioEngine.ensureReady() ngay trong sự kiện chạm của người dùng
  // để không mất user-gesture activation trước getUserMedia trên iOS Safari
  const micPromise = vocalCapture.openMic({
    echoCancellation: state.echoCancellation,
    micGain: state.micGain,
    onLiveStats: ({ level, noteName }) => {
      el.micMeterFill.style.transform = `scaleX(${Math.max(0, Math.min(1, level)).toFixed(3)})`;
      if (noteName !== undefined) {
        el.livePitchReadout.innerHTML = `Nốt: <strong>${noteName || '—'}</strong>`;
      }
    },
  });
  const audioReadyPromise = audioEngine.ensureReady();

  try {
    await micPromise;
  } catch (err) {
    vocalCapture.close();
    audioReadyPromise.catch(() => {});
    const errName = err && err.name ? err.name : 'Error';
    const errMsg = err && err.message ? err.message : String(err);
    console.error('[HEVOS STUDIO Mic Error]', err);
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      showToast(
        `Chưa cấp quyền Micro (${errName}: ${errMsg}). Hãy mở Cài đặt Safari → Micro cho trang này rồi tải lại.`,
        true
      );
    } else {
      showToast(`Lỗi thu âm Micro (${errName}: ${errMsg})`, true);
    }
    return;
  }

  try {
    await audioReadyPromise;
  } catch (err) {
    vocalCapture.close();
    showToast(err.message || 'Không thể khởi động bộ máy âm thanh.', true);
    return;
  }

  // 1. Giai đoạn Đếm vào 1 ô nhịp (Count-in)
  state.recordPhase = 'countin';
  updateRecordButtonUI();
  el.vocalStatusBadge.textContent = 'Đếm vào 1 ô nhịp...';
  el.vocalStatusBadge.classList.add('active');
  el.countinOverlay.classList.remove('hidden');
  el.countinCaption.textContent = 'CHUẨN BỊ NGÂN NGA';
  el.countinNumber.textContent = '1';

  const completedCountIn = await audioEngine.runCountIn((beatNum) => {
    el.countinNumber.textContent = String(beatNum);
    el.vocalStatusBadge.textContent = `Đếm vào: ${beatNum}/4`;
  });

  el.countinOverlay.classList.add('hidden');
  if (!completedCountIn || state.recordPhase !== 'countin') {
    vocalCapture.close();
    state.recordPhase = 'idle';
    updateRecordButtonUI();
    resetLiveMeter();
    return;
  }

  // 2. Bắt đầu phát nhạc đệm (ẩn bản thu giọng cũ nếu có) rồi mở đệm ghi âm để khớp beat 0
  state.recordPhase = 'recording';
  updateRecordButtonUI();
  el.vocalStatusBadge.textContent = `Đang thu · Ô 1/${state.totalBars}`;

  await audioEngine.play(true, { muteVocal: true });
  if (ambientScene && state.activeSection === 'hub') ambientScene.wake(8000);
  vocalCapture.beginCapture();
  updatePlayButtonUI();
  pianoRoll.startAnimationLoop();
  startPlayheadWatch();

  // Tự động dừng sạch sẽ khi hoàn tất trọn 1 vòng lặp + phần bù trễ đầu để không bị cụt đuôi
  const loopMs = Math.round(state.totalBars * 4 * (60 / state.bpm) * 1000);
  const compMs = Math.round(audioEngine.getRecordLatencyCompSec() * 1000);
  clearTimeout(recStopTimer);
  recStopTimer = setTimeout(() => {
    if (state.recordPhase === 'recording') {
      finishVocalRecording();
    }
  }, loopMs + compMs + 80);
}

function cancelRecordingCleanly() {
  clearTimeout(recStopTimer);
  recStopTimer = null;
  audioEngine.cancelCountIn();
  audioEngine.stop();
  vocalCapture.close();
  state.recordPhase = 'idle';
  el.countinOverlay.classList.add('hidden');
  updatePlayButtonUI();
  updateRecordButtonUI();
  resetLiveMeter();
}

async function finishVocalRecording() {
  clearTimeout(recStopTimer);
  recStopTimer = null;

  const trimStartSec = audioEngine.getRecordLatencyCompSec();
  audioEngine.stop();
  const take = vocalCapture.finishCapture({ trimStartSec });
  state.recordPhase = 'idle';
  updatePlayButtonUI();
  updateRecordButtonUI();
  resetLiveMeter();

  if (!take || !take.pcmData || take.pcmData.length < 1024) {
    showToast('Bản thu quá ngắn, chưa nhận được tín hiệu giọng hát.', true);
    return;
  }

  state.rawVocalBuffer = take;
  drawVocalWaveform(el.vocalWaveform, take);
  syncMixerUI();

  el.vocalStatusBadge.classList.remove('active');
  el.vocalStatusBadge.classList.add('ready-take');
  el.vocalStatusBadge.textContent = `Đã thu ${state.totalBars} ô`;

  try {
    await audioEngine.setRawVocalBuffer(take.wavBlob);
  } catch (err) {
    console.warn('[HEVOS STUDIO Vocal Playback Load]', err);
  }

  runVocalTranscription(false);
}

function resetLiveMeter() {
  el.micMeterFill.style.transform = 'scaleX(0)';
  el.livePitchReadout.innerHTML = 'Nốt: <strong>—</strong>';
  if (!state.rawVocalBuffer) {
    el.vocalStatusBadge.classList.remove('active', 'ready-take');
    el.vocalStatusBadge.textContent = 'Ngân nga → MIDI';
  }
}

/**
 * Phân tích AudioBuffer giọng hát thành MIDI (dùng ngay sau thu & khi bấm "Quét lại MIDI")
 */
function runVocalTranscription(isManualRescan = false) {
  if (!state.rawVocalBuffer) return;

  const detected = transcribeAudioBufferToMidi(state.rawVocalBuffer, {
    bpm: state.bpm,
    totalBars: state.totalBars,
    keyPc: state.keyPc,
    scaleType: state.scaleType,
    voicedChords: state.voicedChords,
    scaleSnap: state.scaleSnap,
    quantizeGrid: state.vocalQuantize,
  });

  if (detected.length === 0) {
    showToast(
      'Chưa bắt được nốt rõ ràng. Hãy thử ngân to và rõ hơn gần micro!',
      true
    );
    return;
  }

  pushUndoSnapshot();
  if (state.overdubVocal && !isManualRescan) {
    state.melodyNotes = [...state.melodyNotes, ...detected];
  } else {
    state.melodyNotes = detected;
  }
  state.selectedNoteId = null;

  syncPianoRoll();
  syncAudioEngine();

  const snapLabel = state.scaleSnap ? 'đã ép đúng tông' : 'cao độ mộc';
  showToast(
    `${isManualRescan ? 'Đã quét lại' : 'Đã chuyển thành'} ${detected.length} nốt MIDI (${snapLabel})!`
  );
}

// ============================================================================
// Xuất file MIDI (.mid) & Xuất file nhạc nháp (Audio)
// ============================================================================
function handleExportMidi() {
  const preferFlats = shouldPreferFlats(state.keyPc, state.scaleType);
  const keyName = pcToNoteName(state.keyPc, preferFlats).replace('#', 's').toLowerCase();
  const scaleTag = state.scaleType === 'minor' ? 'minor' : 'major';
  const filename = `hevos-studio-${keyName}-${scaleTag}-${state.bpm}bpm.mid`;

  const result = downloadMidiFile(
    {
      bpm: state.bpm,
      totalBars: state.totalBars,
      humanize: state.humanize,
      voicedChords: state.voicedChords,
      chordStyle: state.chordStyle,
      chordTimbre: state.chordTimbre,
      drumPattern: state.drumPattern,
      customDrumGrid: state.customDrumGrid,
      melodyNotes: state.melodyNotes,
      melodyTimbre: state.melodyTimbre,
      mixer: state.mixer,
    },
    filename
  );

  if (!result.ok) {
    showToast(
      result.error || 'Vui lòng bật ít nhất 1 kênh nhạc cụ trên Mixer để xuất MIDI.',
      true
    );
    return;
  }

  const trackSummary = result.tracks.map((t) => t.shortVi).join(', ');
  showToast(
    `Đã xuất MIDI ${result.tracks.length} track (${trackSummary}): ${result.filename}`
  );
}

function syncBeatExportFormatUI() {
  const fmt = state.beatExportFormat === 'mp3' ? 'mp3' : 'wav';
  $$('[data-beat-fmt]').forEach((btn) => {
    const active = btn.dataset.beatFmt === fmt;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  $$('.export-audio-label').forEach((l) => {
    l.textContent = l.closest('.mobile-export-grid')
      ? `Xuất Beat (.${fmt})`
      : `Xuất ${fmt.toUpperCase()}`;
  });
}

async function handleExportAudio() {
  if (audioEngine.isExporting) return;
  if (state.recordPhase !== 'idle' || (vocalStudio && vocalStudio.isRecording())) {
    showToast('Vui lòng dừng thu âm trước khi xuất Audio.', true);
    return;
  }

  const fmt = state.beatExportFormat === 'mp3' ? 'mp3' : 'wav';
  const btns = $$('[data-action="export-audio"]');
  const labels = $$('.export-audio-label');
  btns.forEach((b) => (b.disabled = true));
  labels.forEach((l) => (l.textContent = `Đang xuất ${fmt.toUpperCase()}...`));

  try {
    showToast(`Đang kết xuất vòng Beat sang ${fmt.toUpperCase()}...`);
    const renderedBuffer = await audioEngine.renderBeatOffline({
      bpm: state.bpm,
      totalBars: state.totalBars,
      humanize: state.humanize,
      chordStyle: state.chordStyle,
      chordTimbre: state.chordTimbre,
      drumPattern: state.drumPattern,
      customDrumGrid: state.customDrumGrid,
      melodyTimbre: state.melodyTimbre,
      voicedChords: state.voicedChords,
      melodyNotes: state.melodyNotes,
      mixer: state.mixer,
    });
    if (!renderedBuffer) {
      showToast('Không có dữ liệu beat để xuất.', true);
      return;
    }

    const encoded = await encodeAudioBufferByFormat(renderedBuffer, fmt, {
      kbps: 192,
      onProgress: (pct) => {
        labels.forEach((l) => (l.textContent = `${fmt.toUpperCase()} ${pct}%...`));
      },
    });

    if (encoded && encoded.blob) {
      const preferFlats = shouldPreferFlats(state.keyPc, state.scaleType);
      const keyName = pcToNoteName(state.keyPc, preferFlats).replace('#', 's').toLowerCase();
      const filename = `hevos-beat-${keyName}-${state.bpm}bpm.${encoded.ext}`;
      const url = URL.createObjectURL(encoded.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      showToast(`Đã xuất Beat định dạng ${fmt.toUpperCase()}: ${filename}`);
    }
  } catch (err) {
    console.error('[HEVOS Beat Export]', err);
    showToast(err.message || `Không thể xuất file ${fmt.toUpperCase()} trên trình duyệt này.`, true);
  } finally {
    btns.forEach((b) => (b.disabled = false));
    syncBeatExportFormatUI();
    updatePlayButtonUI();
  }
}

async function handleSendBeatToArrangement() {
  if (!arrangementStudio) return;
  const btns = $$('[data-action="send-beat-arrangement"]');
  const labels = $$('.send-arr-label');
  btns.forEach((b) => (b.disabled = true));
  labels.forEach((l) => (l.textContent = 'Đang kết xuất...'));

  try {
    const audioBuffer = await audioEngine.renderBeatOffline({
      bpm: state.bpm,
      totalBars: state.totalBars,
      humanize: state.humanize,
      chordStyle: state.chordStyle,
      chordTimbre: state.chordTimbre,
      drumPattern: state.drumPattern,
      customDrumGrid: state.customDrumGrid,
      melodyTimbre: state.melodyTimbre,
      voicedChords: state.voicedChords,
      melodyNotes: state.melodyNotes,
      mixer: state.mixer,
    });
    if (!audioBuffer) {
      showToast('Không có dữ liệu beat để kết xuất.', true);
      return;
    }

    const preferFlats = shouldPreferFlats(state.keyPc, state.scaleType);
    const keyName = pcToNoteName(state.keyPc, preferFlats);
    const scaleLbl = state.scaleType === 'minor' ? 'Thứ' : 'Trưởng';
    const clipName = `Beat ${keyName} ${scaleLbl} · ${state.bpm} BPM (${state.totalBars} ô)`;

    arrangementStudio.importClip({
      name: clipName,
      sourceType: 'studio',
      audioBuffer,
      bpm: state.bpm,
      color: '#8B5CF6',
      suggestedTrackIndex: 0,
      autoPlace: false,
    });
    showToast(`Đã gửi "${clipName}" vào Kho Clip của Dựng bài & Master!`);
  } catch (err) {
    console.error('[HEVOS Send Beat Arrangement]', err);
    showToast(err.message || 'Lỗi khi kết xuất Beat sang Dựng bài.', true);
  } finally {
    btns.forEach((b) => (b.disabled = false));
    labels.forEach((l) => (l.textContent = 'Gửi Beat sang Dựng bài →'));
    updatePlayButtonUI();
  }
}

// ============================================================================
// Lưu & Mở nhiều dự án nháp qua LocalStorage
// ============================================================================
function loadSavedProjectsList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function saveProjectsList(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (_) {
    showToast('Bộ nhớ trình duyệt đã đầy, không thể lưu thêm.', true);
  }
}

function renderSavedProjectsLists() {
  const list = loadSavedProjectsList();
  const html =
    list.length === 0
      ? `<div class="empty-saved">Chưa có bản nháp nào. Hãy đặt tên và bấm Lưu để giữ lại ý tưởng của bạn!</div>`
      : list
          .map((item) => {
            const preferFlats = shouldPreferFlats(item.keyPc, item.scaleType);
            const kName = pcToNoteName(item.keyPc, preferFlats);
            const sc = item.scaleType === 'minor' ? 'Thứ' : 'Trưởng';
            const dateStr = new Date(item.savedAt).toLocaleString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            });
            return `
              <div class="saved-item">
                <div class="saved-info">
                  <span class="saved-name">${escapeHtml(item.name)}</span>
                  <span class="saved-meta">${kName} ${sc} · ${item.bpm} BPM · ${item.totalBars} ô · ${item.melodyNotes?.length || 0} nốt · ${dateStr}</span>
                </div>
                <div class="saved-actions">
                  <button type="button" class="btn btn-cyan-outline btn-xs" data-load-project="${item.id}">Mở</button>
                  <button type="button" class="btn btn-rose-outline btn-xs" data-delete-project="${item.id}">Xóa</button>
                </div>
              </div>
            `;
          })
          .join('');

  $$('[data-projects-list]').forEach((container) => {
    container.innerHTML = html;
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function saveCurrentProject(customName) {
  const preferFlats = shouldPreferFlats(state.keyPc, state.scaleType);
  const autoName = `Ý tưởng ${pcToNoteName(state.keyPc, preferFlats)} ${
    state.scaleType === 'minor' ? 'Thứ' : 'Trưởng'
  } (${state.bpm} BPM)`;
  const name = (customName || '').trim() || autoName;

  const entry = {
    id: `proj_${Date.now().toString(36)}`,
    name,
    savedAt: Date.now(),
    activePresetId: state.activePresetId,
    keyPc: state.keyPc,
    scaleType: state.scaleType,
    bpm: state.bpm,
    totalBars: state.totalBars,
    humanize: state.humanize,
    chordStyle: state.chordStyle,
    chordTimbre: state.chordTimbre,
    drumPattern: state.drumPattern,
    customDrumGrid: cloneDrumGrid(state.customDrumGrid),
    melodyTimbre: state.melodyTimbre,
    chords: state.chords.map((c) => ({ ...c })),
    melodyNotes: state.melodyNotes.map((n) => ({ ...n })),
    mixer: JSON.parse(JSON.stringify(state.mixer)),
  };

  const list = loadSavedProjectsList();
  list.unshift(entry);
  saveProjectsList(list.slice(0, 25));

  $$('[data-project-name-input]').forEach((inp) => (inp.value = ''));
  renderSavedProjectsLists();
  showToast(`Đã lưu bản nháp "${name}"!`);
}

function loadProjectById(id) {
  const list = loadSavedProjectsList();
  const item = list.find((p) => p.id === id);
  if (!item) return;

  audioEngine.stop();
  updatePlayButtonUI();

  state.activePresetId = item.activePresetId || defaultPreset.id;
  state.keyPc = item.keyPc ?? 0;
  state.scaleType = item.scaleType || 'major';
  state.bpm = item.bpm || 84;
  state.totalBars = item.totalBars === 8 ? 8 : 4;
  state.humanize = item.humanize ?? 50;
  state.chordStyle = item.chordStyle || 'rnb';
  state.chordTimbre = item.chordTimbre || 'rhodes';
  state.drumPattern = item.drumPattern || 'lofi';
  state.customDrumGrid = item.customDrumGrid ? cloneDrumGrid(item.customDrumGrid) : createDefaultDrumGrid('kpop_trap');
  state.melodyTimbre = item.melodyTimbre || 'bell';
  state.chords = Array.isArray(item.chords) ? item.chords.map((c) => ({ ...c })) : defaultPreset.chords.map((c) => ({ ...c }));
  state.melodyNotes = Array.isArray(item.melodyNotes) ? item.melodyNotes.map((n) => ({ ...n })) : [];
  if (item.mixer) {
    state.mixer = JSON.parse(JSON.stringify(item.mixer));
    if (!state.mixer.vocal2) {
      state.mixer.vocal2 = { volume: 72, muted: false, solo: false };
    }
  }
  state.undoStack = [];
  state.redoStack = [];
  state.selectedNoteId = null;

  recomputeVoicings();
  syncGlobalControlsUI();
  renderChordStrip();
  syncMixerUI();
  updateUndoButtons();
  syncPianoRoll();
  if (stepSequencer) {
    stepSequencer.renderGridValues(state.customDrumGrid);
    stepSequencer.syncPatternBadge(state.drumPattern === 'custom_seq');
  }
  syncAudioEngine();
  audioEngine.applyMixer(state.mixer);
  if (vocalStudio) vocalStudio.onContextChange({ keyChanged: true });

  el.projectsModal.classList.add('hidden');
  showToast(`Đã mở bản nháp "${item.name}"!`);
}

function deleteProjectById(id) {
  const list = loadSavedProjectsList().filter((p) => p.id !== id);
  saveProjectsList(list);
  renderSavedProjectsLists();
  showToast('Đã xóa bản nháp.');
}

// ============================================================================
// Điều hướng 5 Phân khu (Tổng quan | Sáng tác Beat | Phòng thu Vocal | Dựng bài & Master | Học nhạc lý)
// ============================================================================
let isPianoRollFullscreen = false;

function setPianoRollFullscreen(open) {
  const next = Boolean(open);
  if (isPianoRollFullscreen === next && !el.melodyWorkspaceView) return;
  isPianoRollFullscreen = next;

  if (el.melodyWorkspaceView) {
    el.melodyWorkspaceView.classList.toggle('piano-roll-fullscreen', next);
  }
  document.body.classList.toggle('piano-roll-open', next);

  if (el.btnPrFullscreen) {
    el.btnPrFullscreen.classList.toggle('active', next);
    el.btnPrFullscreen.setAttribute('aria-pressed', String(next));
    el.btnPrFullscreen.title = next
      ? 'Thu nhỏ về giao diện chuẩn (Esc)'
      : 'Phóng to Piano Roll toàn màn hình';
  }
  if (el.btnPrFullscreenLabel) {
    el.btnPrFullscreenLabel.textContent = next ? 'Thu nhỏ' : 'Toàn màn hình';
  }

  if (pianoRoll) {
    pianoRoll.resize(true);
    requestAnimationFrame(() => {
      if (pianoRoll) pianoRoll.resize(true);
    });
    setTimeout(() => {
      if (pianoRoll) pianoRoll.resize(false);
    }, 60);
  }
}

function setAppSection(section) {
  const valid = ['hub', 'studio', 'vocal', 'arrangement', 'trainer', 'vision'];
  const target = valid.includes(section) ? section : 'hub';
  if (state.activeSection === target) return;

  // Dừng sạch sẽ mọi âm thanh/vòng lặp/ghi âm ở phân khu cũ để không bao giờ bị lẫn tiếng
  if (state.recordPhase !== 'idle') {
    cancelRecordingCleanly();
  }
  audioEngine.stop();
  updatePlayButtonUI();
  if (vocalStudio) {
    vocalStudio.stopAll();
  }
  if (arrangementStudio) {
    arrangementStudio.stopAll();
  }
  if (musicTrainer) {
    musicTrainer.stopActiveSession();
  }
  audioEngine.stopTrainerAudio();

  if (target !== 'studio' && isPianoRollFullscreen) {
    setPianoRollFullscreen(false);
  }

  stopPlayheadWatch();
  midiController.releaseAll();

  state.activeSection = target;
  el.app.dataset.section = target;

  if (el.mobileSectionBadge) {
    const sectionNames = {
      hub: 'Tổng quan',
      studio: 'Sáng tác Beat',
      vocal: 'Phòng thu Vocal',
      arrangement: 'Dựng bài & Master',
      trainer: 'Học nhạc lý',
      vision: 'Tính năng & Ý tưởng',
    };
    el.mobileSectionBadge.textContent = sectionNames[target] || 'Tổng quan';
  }

  if (el.sectionSwitcher) {
    $$('[data-section-target]', el.sectionSwitcher).forEach((btn) => {
      const isAct = btn.dataset.sectionTarget === target;
      btn.classList.toggle('active', isAct);
      btn.setAttribute('aria-selected', String(isAct));
      if (isAct && window.innerWidth <= 768 && typeof btn.scrollIntoView === 'function') {
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    });
  }

  if (el.hubRoot) {
    el.hubRoot.classList.toggle('hidden', target !== 'hub');
  }
  if (el.vocalRoot) {
    el.vocalRoot.classList.toggle('hidden', target !== 'vocal');
  }
  if (el.arrangementRoot) {
    el.arrangementRoot.classList.toggle('hidden', target !== 'arrangement');
  }
  if (el.trainerRoot) {
    el.trainerRoot.classList.toggle('hidden', target !== 'trainer');
  }
  if (el.visionRoot) {
    el.visionRoot.classList.toggle('hidden', target !== 'vision');
    if (target === 'vision') {
      el.visionRoot.scrollTop = 0;
    }
  }
  if (pianoRoll) {
    pianoRoll.setActive(target === 'studio');
  }
  if (vocalStudio) {
    vocalStudio.setSectionActive(target === 'vocal');
  }
  if (arrangementStudio) {
    arrangementStudio.setSectionActive(target === 'arrangement');
  }
  if (musicTrainer) {
    musicTrainer.setSectionActive(target === 'trainer');
  }

  if (target === 'studio') {
    if (pianoRoll) pianoRoll.resize();
    requestAnimationFrame(() => {
      if (pianoRoll) pianoRoll.resize();
      if (state.rawVocalBuffer) {
        drawVocalWaveform(el.vocalWaveform, state.rawVocalBuffer);
      }
      requestAnimationFrame(() => {
        if (pianoRoll) pianoRoll.resize();
      });
    });
  }

  if (ambientScene) {
    ambientScene.setSection(target);
  }
  if (el.globalBar) {
    const isHubScrolled = target === 'hub' && el.hubRoot && el.hubRoot.scrollTop > 24;
    el.globalBar.classList.toggle('is-scrolled', Boolean(isHubScrolled));
  }
}

function setStudioCenterView(viewName) {
  const next = viewName === 'sequencer' ? 'sequencer' : 'melody';
  state.studioCenterView = next;

  if (next !== 'melody' && isPianoRollFullscreen) {
    setPianoRollFullscreen(false);
  }

  if (el.studioCenterTabs) {
    $$('[data-center-view]', el.studioCenterTabs).forEach((btn) => {
      const act = btn.dataset.centerView === next;
      btn.classList.toggle('active', act);
      btn.setAttribute('aria-selected', String(act));
    });
  }
  if (el.btnOpenSequencer) {
    el.btnOpenSequencer.classList.toggle('active', next === 'sequencer');
  }
  if (el.melodyWorkspaceView) {
    el.melodyWorkspaceView.classList.toggle('hidden', next !== 'melody');
  }
  if (el.sequencerWorkspaceView) {
    el.sequencerWorkspaceView.classList.toggle('hidden', next !== 'sequencer');
  }
  if (next === 'melody' && pianoRoll) {
    requestAnimationFrame(() => pianoRoll.resize());
  }
}

function setMobileTab(tabName) {
  const target = ['chords', 'melody', 'mixer'].includes(tabName) ? tabName : 'chords';
  state.activeMobileTab = target;
  el.app.dataset.activeTab = target;

  $$('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tabTarget === target);
  });

  if (target !== 'melody' && isPianoRollFullscreen) {
    setPianoRollFullscreen(false);
  }

  if (target === 'melody' && state.studioCenterView === 'melody') {
    if (pianoRoll) {
      pianoRoll.setActive(state.activeSection === 'studio');
      pianoRoll.resize();
    }
    requestAnimationFrame(() => {
      if (pianoRoll) pianoRoll.resize();
      if (state.rawVocalBuffer) {
        drawVocalWaveform(el.vocalWaveform, state.rawVocalBuffer);
      }
      requestAnimationFrame(() => {
        if (pianoRoll) pianoRoll.resize();
      });
    });
  }
}

// ============================================================================
// Gắn toàn bộ sự kiện DOM & Phím tắt
// ============================================================================
function bindEvents() {
  // Mở khóa Web Audio trên mọi chạm thực tế (touchend / click / keydown) cho đến khi running;
  // tự gắn lại nếu iOS Safari chuyển AudioContext sang interrupted khi về nền
  let audioUnlockAttached = false;
  const detachAudioUnlock = () => {
    if (!audioUnlockAttached) return;
    audioUnlockAttached = false;
    window.removeEventListener('touchend', onUnlockGesture, true);
    window.removeEventListener('click', onUnlockGesture, true);
    window.removeEventListener('keydown', onUnlockGesture, true);
  };
  const onUnlockGesture = () => {
    audioEngine.unlockSync();
    audioEngine.ensureReady()
      .then(() => {
        if (ambientScene) {
          ambientScene.connectTone(audioEngine.getMasterOutputNode());
        }
        if (audioEngine.isAudioRunning()) {
          detachAudioUnlock();
        }
      })
      .catch(() => {});
  };
  const attachAudioUnlock = () => {
    if (audioUnlockAttached) return;
    audioUnlockAttached = true;
    window.addEventListener('touchend', onUnlockGesture, { capture: true, passive: true });
    window.addEventListener('click', onUnlockGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onUnlockGesture, { capture: true, passive: true });
  };
  attachAudioUnlock();

  // Bấm vào Logo -> Về màn hình Tổng quan (Studio Hub)
  if (el.btnLogoHome) {
    el.btnLogoHome.addEventListener('click', () => {
      setAppSection('hub');
    });
  }

  // Bấm vào các nút trong màn hình Tổng quan (chuyển phân khu hoặc cuộn tới chương)
  if (el.hubRoot) {
    el.hubRoot.addEventListener('click', (e) => {
      const scrollBtn = e.target.closest('[data-scroll-to]');
      if (scrollBtn) {
        const sel = scrollBtn.dataset.scrollTo;
        const anchor = sel ? $(sel, el.hubRoot) : null;
        if (anchor) {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
      const featBtn = e.target.closest('[data-goto-feature]');
      if (featBtn) {
        const feat = featBtn.dataset.gotoFeature;
        if (feat === 'ear-training') {
          setAppSection('trainer');
          if (musicTrainer) musicTrainer.openEarTraining();
        } else if (feat === 'step-sequencer') {
          setAppSection('studio');
          setStudioCenterView('sequencer');
          if (window.innerWidth <= 768) setMobileTab('melody');
        } else if (feat === 'stems') {
          setAppSection('arrangement');
          if (arrangementStudio) arrangementStudio.openStemsAnalyzer();
        }
        return;
      }
      const targetEl = e.target.closest('[data-goto-section]');
      if (!targetEl) return;
      setAppSection(targetEl.dataset.gotoSection);
    });

    el.hubRoot.addEventListener('scroll', () => {
      if (!el.globalBar) return;
      el.globalBar.classList.toggle('is-scrolled', el.hubRoot.scrollTop > 24);
    }, { passive: true });
  }

  // Điều hướng nhanh trong phân khu Tính năng & Ý tưởng (chuyển tab hoặc cuộn tới khối nội dung)
  if (el.visionRoot) {
    el.visionRoot.addEventListener('click', (e) => {
      const scrollBtn = e.target.closest('[data-scroll-to]');
      if (scrollBtn) {
        const sel = scrollBtn.dataset.scrollTo;
        const anchor = sel ? $(sel, el.visionRoot) : null;
        if (anchor) {
          anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }
      const targetEl = e.target.closest('[data-goto-section]');
      if (!targetEl) return;
      setAppSection(targetEl.dataset.gotoSection);
    });
  }

  // Phát / Dừng bên Sáng tác Beat (có khóa chống bấm đúp khi Tone.start() đang chạy)
  let isPlayToggleBusy = false;
  el.btnPlay.addEventListener('click', async () => {
    audioEngine.unlockSync();
    if (state.recordPhase !== 'idle') {
      cancelRecordingCleanly();
      return;
    }
    if (isPlayToggleBusy) return;
    isPlayToggleBusy = true;
    try {
      if (audioEngine.isPlaying) {
        audioEngine.stop();
        updatePlayButtonUI();
        stopPlayheadWatch();
        if (pianoRoll) pianoRoll.stopAnimationLoop();
      } else {
        await audioEngine.play(false);
        if (ambientScene) {
          ambientScene.connectTone();
          if (state.activeSection === 'hub') ambientScene.wake(8000);
        }
        updatePlayButtonUI();
        pianoRoll.startAnimationLoop();
        startPlayheadWatch();
      }
    } catch (err) {
      showToast(err.message || 'Lỗi khi phát âm thanh.', true);
    } finally {
      isPlayToggleBusy = false;
    }
  });

  // Thu Micro ngân nga ra nốt MIDI (chỉ bên Sáng tác Beat)
  el.btnRecord.addEventListener('click', () => {
    toggleVocalRecording();
  });

  // Bấm vào pill Tông/BPM trên Mobile -> nhảy nhanh sang Tab Mixer/Cài đặt
  el.mobileQuickStatus.addEventListener('click', () => {
    setMobileTab(state.activeMobileTab === 'mixer' ? 'chords' : 'mixer');
  });

  // Đồng bộ toàn bộ input data-bind (Desktop + Mobile)
  $$('[data-bind="keyPc"]').forEach((sel) => {
    sel.addEventListener('change', (e) => setKeyPc(Number(e.target.value)));
  });

  $$('[data-bind="scaleType"]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      state.scaleType = e.target.value;
      recomputeVoicings();
      syncGlobalControlsUI();
      renderChordStrip();
      syncPianoRoll();
      syncAudioEngine();
      if (vocalStudio) vocalStudio.onContextChange({ keyChanged: true });
    });
  });

  $$('[data-bind="bpm"]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      state.bpm = Number(e.target.value);
      syncGlobalControlsUI();
      syncAudioEngine();
      if (vocalStudio) vocalStudio.onContextChange({ keyChanged: false });
    });
  });

  $$('[data-bind="humanize"]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      state.humanize = Number(e.target.value);
      syncGlobalControlsUI();
      syncAudioEngine();
    });
  });

  $$('[data-bind="echoCancellation"]').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      state.echoCancellation = e.target.checked;
      syncGlobalControlsUI();
      if (vocalStudio) vocalStudio.syncFromApp({ echoCancellation: state.echoCancellation });
    });
  });

  $$('[data-bind="micGain"]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      state.micGain = Number(e.target.value);
      vocalCapture.setMicGain(state.micGain);
      $$('[data-bind="micGain"]').forEach((o) => {
        if (o !== e.target) o.value = state.micGain.toFixed(1);
      });
      $$('[data-display="micGain"]').forEach((d) => {
        d.textContent = `${state.micGain.toFixed(1)}x`;
      });
      if (vocalStudio) vocalStudio.syncFromApp({ micGain: state.micGain });
    });
  });

  // Loop 4 ô / 8 ô
  $$('[data-seg="totalBars"]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      setTotalBars(Number(btn.dataset.value));
    });
  });

  // Preset & Vibe Chips
  el.presetSelect.addEventListener('change', (e) => {
    applyPreset(e.target.value, true);
  });

  el.vibeChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.vibe-chip');
    if (!chip) return;
    applyPreset(chip.dataset.presetId, true);
  });

  // Kiểu đệm, Tiếng đàn, Trống, Tiếng Giai điệu
  el.chordStyleSelect.addEventListener('change', (e) => {
    state.chordStyle = e.target.value;
    syncGlobalControlsUI();
    syncAudioEngine();
  });

  if (el.pianoStyleChips) {
    el.pianoStyleChips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-style-id]');
      if (!btn) return;
      state.chordStyle = btn.dataset.styleId;
      syncGlobalControlsUI();
      syncAudioEngine();
    });
  }

  el.chordTimbreSelect.addEventListener('change', (e) => {
    state.chordTimbre = e.target.value;
    syncAudioEngine();
  });

  el.drumPatternSelect.addEventListener('change', (e) => {
    state.drumPattern = e.target.value;
    if (stepSequencer) stepSequencer.syncPatternBadge(state.drumPattern === 'custom_seq');
    syncAudioEngine();
  });

  if (el.studioCenterTabs) {
    el.studioCenterTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-center-view]');
      if (!btn) return;
      setStudioCenterView(btn.dataset.centerView);
    });
  }

  if (el.btnOpenSequencer) {
    el.btnOpenSequencer.addEventListener('click', () => {
      setStudioCenterView('sequencer');
      if (window.innerWidth <= 768) setMobileTab('melody');
    });
  }

  el.melodyTimbreSelect.addEventListener('change', (e) => {
    state.melodyTimbre = e.target.value;
    syncAudioEngine();
  });

  // Bấm vào ô nhịp hợp âm -> mở Bảng Chọn Hợp Âm
  el.chordStrip.addEventListener('click', (e) => {
    const card = e.target.closest('.chord-card');
    if (!card) return;
    openChordPicker(Number(card.dataset.barIndex));
  });

  // Sự kiện bên trong Modal Chọn Hợp Âm
  el.diatonicGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-degree]');
    if (!btn) return;
    updateEditingBarChord({
      degree: Number(btn.dataset.pickDegree),
      custom: false,
      rootPc: undefined,
      quality: undefined,
    });
  });

  const handleBasicChordClick = (e) => {
    const btn = e.target.closest('[data-pick-basic-root]');
    if (!btn) return;
    const rootPc = Number(btn.dataset.pickBasicRoot);
    const quality = btn.dataset.pickBasicQuality === 'min' ? 'min' : 'maj';
    const idx = state.editingBarIndex;
    const curExt = idx !== null && state.chords[idx] ? state.chords[idx].extension : 'triad';
    let nextExt = curExt || 'triad';
    if (quality === 'maj' && nextExt === 'm7') nextExt = 'triad';
    if (quality === 'min' && (nextExt === 'maj7' || nextExt === '7')) nextExt = 'm7';
    updateEditingBarChord({
      custom: true,
      rootPc,
      quality,
      extension: nextExt,
    });
  };
  if (el.basicMajorGrid) el.basicMajorGrid.addEventListener('click', handleBasicChordClick);
  if (el.basicMinorGrid) el.basicMinorGrid.addEventListener('click', handleBasicChordClick);

  el.extensionPills.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick-ext]');
    if (!btn) return;
    updateEditingBarChord({ extension: btn.dataset.pickExt });
  });

  el.btnAuditionModalChord.addEventListener('click', async () => {
    const idx = state.editingBarIndex;
    if (idx !== null && state.voicedChords[idx]) {
      try {
        if (ambientScene && state.activeSection === 'hub') ambientScene.wake(1800);
        await audioEngine.auditionChord(state.voicedChords[idx]);
      } catch (_) {}
    }
  });

  el.btnCloseChordModal.addEventListener('click', closeChordPicker);
  el.chordModal.addEventListener('click', (e) => {
    if (e.target === el.chordModal) closeChordPicker();
  });

  // Thanh công cụ Piano Roll
  el.prModeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.prMode = btn.dataset.mode;
    $$('.seg-btn', el.prModeGroup).forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    pianoRoll.setMode(state.prMode);
  });

  el.btnScaleLock.addEventListener('click', () => {
    state.scaleLock = !state.scaleLock;
    el.btnScaleLock.classList.toggle('active', state.scaleLock);
    el.btnScaleLock.setAttribute('aria-pressed', String(state.scaleLock));
    pianoRoll.setScaleLock(state.scaleLock);
  });

  if (el.btnMidiRecordArm) {
    el.btnMidiRecordArm.addEventListener('click', () => {
      state.midiRecordArmed = !state.midiRecordArmed;
      state.midiStepCursor = 0;
      el.btnMidiRecordArm.classList.toggle('active', state.midiRecordArmed);
      el.btnMidiRecordArm.setAttribute('aria-pressed', String(state.midiRecordArmed));
      if (state.midiRecordArmed) {
        showToast('Đã bật Ghi MIDI trực tiếp vào Piano Roll — bấm phím đàn MIDI để ghi nốt!');
      }
    });
  }

  el.prGridSelect.addEventListener('change', (e) => {
    state.prGridStep = Number(e.target.value);
    pianoRoll.setGridStep(state.prGridStep);
  });

  el.btnUndo.addEventListener('click', performUndo);
  el.btnRedo.addEventListener('click', performRedo);
  el.btnZoomOut.addEventListener('click', () => pianoRoll.setZoom(pianoRoll.zoom - 0.22));
  el.btnZoomIn.addEventListener('click', () => pianoRoll.setZoom(pianoRoll.zoom + 0.22));
  if (el.btnPrFullscreen) {
    el.btnPrFullscreen.addEventListener('click', () => {
      setPianoRollFullscreen(!isPianoRollFullscreen);
    });
  }
  if (el.btnPrFsPlay) {
    el.btnPrFsPlay.addEventListener('click', () => el.btnPlay.click());
  }
  if (el.btnPrFsRecord) {
    el.btnPrFsRecord.addEventListener('click', () => el.btnRecord.click());
  }

  el.btnClearMelody.addEventListener('click', () => {
    const count = state.melodyNotes.length;
    if (count === 0) return;
    pushUndoSnapshot();
    state.melodyNotes = [];
    state.selectedNoteId = null;
    syncPianoRoll();
    syncAudioEngine();
    showToast(`Đã xóa toàn bộ ${count} nốt MIDI (bấm Hoàn tác để khôi phục).`);
  });

  // Vocal HUD controls
  el.btnDismissHeadphone.addEventListener('click', () => {
    el.headphoneBanner.classList.add('hidden');
    if (pianoRoll) requestAnimationFrame(() => pianoRoll.resize());
  });

  el.chkScaleSnap.addEventListener('change', (e) => {
    state.scaleSnap = e.target.checked;
    if (state.rawVocalBuffer) {
      runVocalTranscription(true);
    }
  });

  el.vocalQuantizeSelect.addEventListener('change', (e) => {
    state.vocalQuantize = e.target.value;
    if (state.rawVocalBuffer) {
      runVocalTranscription(true);
    }
  });

  el.chkOverdub.addEventListener('change', (e) => {
    state.overdubVocal = e.target.checked;
  });

  el.btnRequantize.addEventListener('click', () => {
    runVocalTranscription(true);
  });

  // Mixer 4 kênh (Volume, Mute, Solo)
  $('#mixer-channels').addEventListener('input', (e) => {
    const volCh = e.target.dataset.vol;
    if (!volCh || !state.mixer[volCh]) return;
    state.mixer[volCh].volume = Number(e.target.value);
    const lbl = $(`[data-vol-label="${volCh}"]`);
    if (lbl) lbl.textContent = `${state.mixer[volCh].volume}%`;
    audioEngine.applyMixer(state.mixer);
  });

  $('#mixer-channels').addEventListener('click', (e) => {
    const muteBtn = e.target.closest('[data-mute]');
    if (muteBtn) {
      const ch = muteBtn.dataset.mute;
      state.mixer[ch].muted = !state.mixer[ch].muted;
      syncMixerUI();
      audioEngine.applyMixer(state.mixer);
      return;
    }
    const soloBtn = e.target.closest('[data-solo]');
    if (soloBtn) {
      const ch = soloBtn.dataset.solo;
      state.mixer[ch].solo = !state.mixer[ch].solo;
      syncMixerUI();
      audioEngine.applyMixer(state.mixer);
    }
  });

  // Xuất MIDI & Xuất Audio (cả nút Desktop và Mobile)
  $$('[data-beat-fmt]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.beatExportFormat = btn.dataset.beatFmt === 'mp3' ? 'mp3' : 'wav';
      syncBeatExportFormatUI();
    })
  );
  $$('[data-action="export-midi"]').forEach((btn) =>
    btn.addEventListener('click', handleExportMidi)
  );
  $$('[data-action="export-audio"]').forEach((btn) =>
    btn.addEventListener('click', handleExportAudio)
  );
  $$('[data-action="send-beat-arrangement"]').forEach((btn) =>
    btn.addEventListener('click', handleSendBeatToArrangement)
  );

  // Lưu & Mở bản nháp (Desktop Modal + Mobile Tab 3)
  el.btnOpenProjects.addEventListener('click', () => {
    renderSavedProjectsLists();
    el.projectsModal.classList.remove('hidden');
  });
  el.btnCloseProjectsModal.addEventListener('click', () =>
    el.projectsModal.classList.add('hidden')
  );
  el.projectsModal.addEventListener('click', (e) => {
    if (e.target === el.projectsModal) el.projectsModal.classList.add('hidden');
  });

  $$('[data-action="save-project"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.save-form-row');
      const inp = row ? $('[data-project-name-input]', row) : null;
      saveCurrentProject(inp ? inp.value : '');
    });
  });

  document.addEventListener('click', (e) => {
    const loadBtn = e.target.closest('[data-load-project]');
    if (loadBtn) {
      loadProjectById(loadBtn.dataset.loadProject);
      return;
    }
    const delBtn = e.target.closest('[data-delete-project]');
    if (delBtn) {
      deleteProjectById(delBtn.dataset.deleteProject);
    }
  });

  // Chuyển phân khu Studio | Học nhạc
  if (el.sectionSwitcher) {
    el.sectionSwitcher.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-section-target]');
      if (!btn) return;
      setAppSection(btn.dataset.sectionTarget);
    });
  }

  // Thanh Tab dưới đáy trên Mobile
  $$('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMobileTab(tab.dataset.tabTarget));
  });

  window.addEventListener('resize', () => {
    if (state.activeSection === 'vocal' && vocalStudio) {
      vocalStudio.resizeAndRedraw();
    } else if (state.activeSection === 'arrangement' && arrangementStudio) {
      arrangementStudio.resizeAndRedraw();
    } else if (state.activeSection === 'trainer' && musicTrainer && musicTrainer.view === 'piano-room' && musicTrainer.pianoSubMode === 'falling') {
      musicTrainer._drawFallingNotesFrame();
    } else if (state.activeSection === 'trainer' && musicTrainer && musicTrainer.view === 'academy' && musicTrainer.exerciseRunner) {
      musicTrainer.exerciseRunner.onResize();
    } else if (state.activeSection === 'studio' && pianoRoll) {
      pianoRoll.resize();
    }
  });

  // Phím tắt Desktop (Sáng tác Beat & Dựng bài & Master)
  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (state.activeSection === 'arrangement' && arrangementStudio) {
      arrangementStudio.handleKeyDown(e);
      return;
    }

    if (state.activeSection !== 'studio') return;

    if (e.key === 'Escape') {
      if (isPianoRollFullscreen) {
        e.preventDefault();
        setPianoRollFullscreen(false);
        return;
      }
      closeChordPicker();
      el.projectsModal.classList.add('hidden');
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      el.btnPlay.click();
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleVocalRecording();
      }
      return;
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedNoteId) {
        e.preventDefault();
        pushUndoSnapshot();
        state.melodyNotes = state.melodyNotes.filter(
          (n) => n.id !== state.selectedNoteId
        );
        state.selectedNoteId = null;
        syncPianoRoll();
        syncAudioEngine();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) performRedo();
      else performUndo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      performRedo();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (uiRafId !== null) {
        cancelAnimationFrame(uiRafId);
        uiRafId = null;
      }
    } else {
      if (!audioEngine.isAudioRunning()) {
        attachAudioUnlock();
      }
      if (audioEngine.isPlaying && state.activeSection === 'studio') {
        startPlayheadWatch();
      }
    }
  });
}

function setupHubScrollReveal() {
  if (!el.hubRoot) return;
  const items = $$('.reveal-item', el.hubRoot);
  if (!items.length) return;

  if (typeof IntersectionObserver !== 'function') {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  el.hubRoot.classList.add('has-reveal');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    {
      root: el.hubRoot,
      threshold: 0.02,
      rootMargin: '0px',
    }
  );

  items.forEach((item) => observer.observe(item));

  setTimeout(() => {
    if (!el.hubRoot) return;
    const hubRect = el.hubRoot.getBoundingClientRect();
    const collapsedHub = el.hubRoot.clientHeight === 0 || hubRect.height === 0;
    items.forEach((item) => {
      if (item.classList.contains('is-visible')) return;
      if (collapsedHub) {
        item.classList.add('is-visible');
        observer.unobserve(item);
        return;
      }
      const r = item.getBoundingClientRect();
      if (r.top < window.innerHeight + 60 && r.bottom > -60) {
        item.classList.add('is-visible');
        observer.unobserve(item);
      }
    });
  }, 600);
}

// ============================================================================
// Khởi chạy ứng dụng
// ============================================================================
function init() {
  // Mở Web MIDI độc lập ngay khi trang tải xong, tách rời hoàn toàn khỏi tiến trình vẽ DOM lười
  midiController.setAudioUnlockHandler(() => {
    audioEngine.unlockSync();
    audioEngine.ensureReady().catch(() => {});
  });
  midiController.initWebMidi();

  populateSelects();
  recomputeVoicings();

  if (el.bg3dCanvas) {
    ambientScene = createAmbientScene(el.bg3dCanvas, {
      hubScrollEl: el.hubRoot,
    });
    ambientScene.setSection(state.activeSection);
    ambientScene.setExternalEnergyProvider(() =>
      Math.max(
        vocalStudio ? vocalStudio.getAudioLevel() : 0,
        arrangementStudio ? arrangementStudio.getAudioLevel() : 0
      )
    );
  }
  setupHubScrollReveal();

  pianoRoll = new PianoRoll(el.prCanvas, {
    getPlayheadBeat: () => audioEngine.getCurrentBeat(),
    getIsPlaying: () => audioEngine.isPlaying,
    onHistoryPush: () => pushUndoSnapshot(),
    onChange: (nextNotes) => {
      state.melodyNotes = nextNotes;
      updateClearMelodyButton();
      syncAudioEngine();
    },
    onSelect: (noteId) => {
      state.selectedNoteId = noteId;
    },
    onAudition: (midi) => {
      if (ambientScene && state.activeSection === 'hub') ambientScene.wake(1800);
      audioEngine.auditionMelodyNote(midi).catch(() => {});
    },
  });

  if (el.sequencerWorkspaceView) {
    stepSequencer = new StepSequencerUI(el.sequencerWorkspaceView, {
      getGrid: () => state.customDrumGrid,
      getDrumPattern: () => state.drumPattern,
      onGridChange: (grid, activateCustom) => {
        state.customDrumGrid = cloneDrumGrid(grid);
        if (activateCustom && state.drumPattern !== 'custom_seq') {
          state.drumPattern = 'custom_seq';
          syncGlobalControlsUI();
        }
        syncAudioEngine();
      },
      onAuditionDrum: (drumType, openHat, velocity) => {
        audioEngine.auditionDrumHit(drumType, openHat, velocity).catch(() => {});
      },
      onSelectCustomDrum: () => {
        state.drumPattern = 'custom_seq';
        syncGlobalControlsUI();
        syncAudioEngine();
        showToast('Đã kích hoạt Bộ gõ 16 bước (Step Sequencer)!');
      },
    });
  }

  // Khởi tạo phân khu Học viện Nhạc lý 6 Chặng & Phòng Tập Đàn Hybrid (Web MIDI + On-Screen)
  midiController.setQwertyActiveCheck(
    () => Boolean(musicTrainer) && musicTrainer.isHybridKeyboardActive()
  );

  if (el.trainerRoot) {
    musicTrainer = new MusicTrainer(el.trainerRoot, {
      audioEngine,
      midiController,
      getStudioContext: () => ({
        keyPc: state.keyPc,
        scaleType: state.scaleType,
        bpm: state.bpm,
        totalBars: state.totalBars,
        voicedChords: state.voicedChords,
        melodyNotes: state.melodyNotes,
      }),
      onExportToStudio: ({ keyPc, scaleType, bpm, chords, melodyNotes, label }) => {
        audioEngine.stop();
        updatePlayButtonUI();
        if (state.melodyNotes.length > 0) {
          pushUndoSnapshot();
        }
        state.keyPc = ((Number(keyPc) || 0) + 12) % 12;
        state.scaleType = scaleType === 'minor' ? 'minor' : 'major';
        state.bpm = Math.max(50, Math.min(200, Math.round(Number(bpm) || 82)));
        const srcChords = Array.isArray(chords) && chords.length > 0 ? chords : state.chords.slice(0, 4);
        state.totalBars = srcChords.length >= 8 ? 8 : 4;
        state.chords = srcChords.slice(0, state.totalBars).map((c) => ({ ...c }));
        if (Array.isArray(melodyNotes)) {
          state.melodyNotes = melodyNotes.map((n) => ({ ...n }));
          state.selectedNoteId = null;
        }
        recomputeVoicings();
        syncGlobalControlsUI();
        renderChordStrip();
        syncPianoRoll();
        syncAudioEngine();
        if (vocalStudio) vocalStudio.onContextChange({ keyChanged: true });
        setStudioCenterView('melody');
        setAppSection('studio');
        if (window.innerWidth <= 768) {
          setMobileTab(Array.isArray(melodyNotes) && melodyNotes.length > 0 ? 'melody' : 'chords');
        }
        showToast(
          Array.isArray(melodyNotes) && melodyNotes.length > 0
            ? `Đã chuyển dự án "${label || 'Hỏi - Đáp'}" (${melodyNotes.length} nốt MIDI) sang Sáng tác Beat!`
            : `Đã đẩy vòng hợp âm "${label || 'Học viện'}" sang Sáng tác Beat!`
        );
      },
      showToast,
    });
  }

  // Kết nối đàn MIDI USB vào Sáng tác Beat (nghe tiếng & ghi trực tiếp vào Piano Roll)
  const studioMidiRecActive = new Map();
  let lastMidiUndoAt = 0;
  midiController.subscribe({
    onDeviceChange: ({ primaryDevice, newlyConnected }) => {
      if (el.btnMidiRecordArm) {
        el.btnMidiRecordArm.classList.toggle('has-device', Boolean(primaryDevice));
        el.btnMidiRecordArm.title = primaryDevice
          ? `Thiết bị MIDI: ${primaryDevice} · Bật để ghi trực tiếp vào Piano Roll`
          : 'Bật để ghi từng nốt bấm từ đàn Piano MIDI USB vào Piano Roll';
      }
      if (newlyConnected && primaryDevice) {
        showToast(`Đã kết nối MIDI: ${primaryDevice} (Sẵn sàng chơi & ghi nốt!)`);
      }
    },
    onNoteOn: ({ midi, velocity, source }) => {
      if (state.activeSection !== 'studio' || source !== 'midi') return;
      audioEngine.unlockSync();
      audioEngine.studioMidiNoteOn(midi, velocity).catch(() => {});
      if (!audioEngine.isPlaying && !state.midiRecordArmed) return;

      let targetMidi = Math.round(midi);
      while (targetMidi < 48) targetMidi += 12;
      while (targetMidi > 84) targetMidi -= 12;
      if (state.scaleLock) {
        targetMidi = snapMidiToScale(targetMidi, state.keyPc, state.scaleType);
      }

      const step = state.prGridStep > 0 ? state.prGridStep : 0.25;
      const totalBeats = state.totalBars * 4;
      let startBeat = 0;
      if (audioEngine.isPlaying) {
        const raw = audioEngine.getCurrentBeat();
        startBeat = Math.min(totalBeats - step, Math.round(raw / step) * step);
      } else {
        startBeat = state.midiStepCursor < totalBeats - 0.01 ? state.midiStepCursor : 0;
        state.midiStepCursor = startBeat + step >= totalBeats ? 0 : startBeat + step;
      }

      const nowMs = performance.now();
      if (nowMs - lastMidiUndoAt > 1200) {
        pushUndoSnapshot();
      }
      lastMidiUndoAt = nowMs;

      const noteObj = {
        id: `n_midi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        midi: targetMidi,
        startBeat: Number(startBeat.toFixed(4)),
        durationBeats: step,
        velocity: Math.max(0.2, Math.min(0.96, velocity || 0.82)),
      };
      state.melodyNotes = [...state.melodyNotes, noteObj];
      state.selectedNoteId = noteObj.id;
      studioMidiRecActive.set(midi, { note: noteObj, wallMs: nowMs, livePlay: audioEngine.isPlaying });

      syncPianoRoll();
      syncAudioEngine();
    },
    onNoteOff: ({ midi, source }) => {
      if (state.activeSection !== 'studio' || source !== 'midi') return;
      audioEngine.studioMidiNoteOff(midi);
      const active = studioMidiRecActive.get(midi);
      if (active) {
        studioMidiRecActive.delete(midi);
        if (active.livePlay) {
          const step = state.prGridStep > 0 ? state.prGridStep : 0.25;
          const elapsedBeats = ((performance.now() - active.wallMs) / 1000) * (state.bpm / 60);
          const qDur = Math.max(step, Math.round(elapsedBeats / step) * step);
          const maxDur = Math.max(0.25, state.totalBars * 4 - active.note.startBeat);
          active.note.durationBeats = Number(Math.min(maxDur, qDur).toFixed(4));
          syncPianoRoll();
          syncAudioEngine();
        }
      }
    },
  });

  // Đồng bộ trạng thái nút Ghi MIDI nếu thiết bị (vd: SE61) đã kết nối trước khi subscribe
  const initMidiStatus = midiController.getDeviceStatus();
  if (el.btnMidiRecordArm) {
    el.btnMidiRecordArm.classList.toggle('has-device', Boolean(initMidiStatus.primaryDevice));
    el.btnMidiRecordArm.title = initMidiStatus.primaryDevice
      ? `Thiết bị MIDI: ${initMidiStatus.primaryDevice} · Bật để ghi trực tiếp vào Piano Roll`
      : 'Bật để ghi từng nốt bấm từ đàn Piano MIDI USB vào Piano Roll';
  }

  // Khởi tạo Phân khu Dựng bài & Master (Multi-Track Playlist, Mastering & Tách Stems)
  if (el.arrangementRoot) {
    arrangementStudio = new ArrangementStudio(el.arrangementRoot, {
      getStudioBpm: () => state.bpm,
      renderStudioBeat: async () => {
        const buffer = await audioEngine.renderBeatOffline({
          bpm: state.bpm,
          totalBars: state.totalBars,
          humanize: state.humanize,
          chordStyle: state.chordStyle,
          chordTimbre: state.chordTimbre,
          drumPattern: state.drumPattern,
          melodyTimbre: state.melodyTimbre,
          voicedChords: state.voicedChords,
          melodyNotes: state.melodyNotes,
          mixer: state.mixer,
          customDrumGrid: state.customDrumGrid,
        });
        const preferFlats = shouldPreferFlats(state.keyPc, state.scaleType);
        const keyName = pcToNoteName(state.keyPc, preferFlats);
        return {
          audioBuffer: buffer,
          name: `Beat ${keyName} ${state.scaleType === 'minor' ? 'Thứ' : 'Trưởng'} · ${state.bpm} BPM`,
        };
      },
      onApplyChordsToStudio: ({ keyPc, scaleType, bpm, chords }) => {
        audioEngine.stop();
        updatePlayButtonUI();
        state.keyPc = ((Number(keyPc) || 0) + 12) % 12;
        state.scaleType = scaleType === 'minor' ? 'minor' : 'major';
        state.bpm = Math.max(50, Math.min(200, Math.round(Number(bpm) || 100)));
        const src = Array.isArray(chords) && chords.length > 0 ? chords : state.chords;
        state.totalBars = src.length >= 8 ? 8 : 4;
        const nextChords = [];
        for (let i = 0; i < state.totalBars; i++) {
          nextChords.push({ ...src[i % src.length] });
        }
        state.chords = nextChords;
        recomputeVoicings();
        syncGlobalControlsUI();
        renderChordStrip();
        syncPianoRoll();
        syncAudioEngine();
        if (vocalStudio) vocalStudio.onContextChange({ keyChanged: true });
        setAppSection('studio');
        showToast(`Đã nạp ${state.totalBars} ô hợp âm phân tích vào Sáng tác Beat!`);
      },
      onPracticeChordsInTrainer: ({ keyPc, scaleType, bpm, chords }) => {
        setAppSection('trainer');
        if (musicTrainer) {
          musicTrainer.openChordPracticeCustom({ keyPc, scaleType, bpm, chords });
        }
      },
      onPlaybackStateChange: (playing) => {
        if (playing && ambientScene && state.activeSection === 'hub') {
          ambientScene.wake();
        }
      },
      onClipsChanged: (count) => {
        if (el.arrangementPresenceDot) {
          el.arrangementPresenceDot.classList.toggle('hidden', count === 0);
        }
      },
      showToast,
    });
  }

  // Khởi tạo Phòng thu Vocal độc lập (Nhập Beat MP3/WAV, 2 Track Giọng, Auto-Tune, Offline Mix .WAV)
  if (el.vocalStudioPanel) {
    vocalStudio = new VocalStudio(el.vocalStudioPanel, {
      getContext: () => ({
        keyPc: state.keyPc,
        scaleType: state.scaleType,
        bpm: state.bpm,
        totalBars: state.totalBars,
        humanize: state.humanize,
        chordStyle: state.chordStyle,
        chordTimbre: state.chordTimbre,
        drumPattern: state.drumPattern,
        customDrumGrid: state.customDrumGrid,
        voicedChords: state.voicedChords,
        melodyNotes: state.melodyNotes,
      }),
      getMicGain: () => state.micGain,
      setMicGain: (val) => {
        state.micGain = Math.max(1.0, Math.min(5.0, Number(val) || getDefaultMicGain()));
        vocalCapture.setMicGain(state.micGain);
        syncGlobalControlsUI();
      },
      getEchoCancellation: () => state.echoCancellation,
      setEchoCancellation: (enabled) => {
        state.echoCancellation = Boolean(enabled);
        syncGlobalControlsUI();
      },
      onTakesChanged: () => {
        syncMixerUI();
      },
      onPlaybackStateChange: (playing) => {
        if (playing && ambientScene && state.activeSection === 'hub') {
          ambientScene.wake(8000);
        }
      },
      onSendToArrangement: (clipPayload) => {
        if (!arrangementStudio || !clipPayload) return;
        const payloads = Array.isArray(clipPayload) ? clipPayload : [clipPayload];
        const importedClips = [];
        for (const item of payloads) {
          const clip = arrangementStudio.importClip(item);
          if (clip) importedClips.push(clip);
        }
        if (importedClips.length > 0) {
          showToast('Đã gửi Vocal sang Dựng bài & Master!', false, {
            actionLabel: 'Mở Dựng bài →',
            onAction: () => setAppSection('arrangement'),
          });
        }
      },
      showToast,
    });
  }

  channelMeters = {};
  $$('[data-meter]').forEach((m) => {
    if (m.dataset.meter) channelMeters[m.dataset.meter] = m;
  });

  if (pianoRoll) pianoRoll.setActive(state.activeSection === 'studio');
  if (vocalStudio) vocalStudio.setSectionActive(state.activeSection === 'vocal');
  if (arrangementStudio) arrangementStudio.setSectionActive(state.activeSection === 'arrangement');
  if (musicTrainer) musicTrainer.setSectionActive(state.activeSection === 'trainer');

  syncGlobalControlsUI();
  renderChordStrip();
  syncMixerUI();
  updateUndoButtons();
  renderSavedProjectsLists();
  syncPianoRoll();
  syncAudioEngine();
  bindEvents();

  // Vẽ đường giữa ban đầu cho waveform trống
  drawVocalWaveform(el.vocalWaveform, null);
}

init();
