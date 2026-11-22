// ============================================================================
// musicTrainer.js — Phân khu Học nhạc (Luyện Đọc Nốt & Phản Xạ Nhạc Lý)
// 4 Chế độ: Luyện từng nốt · Luyện nốt chạy · Ôn tập nốt sai · Tra cứu nốt
// ============================================================================

import { KEY_OPTIONS, SCALES, generateVoicedProgression, midiToFreq, midiToNoteName } from './theory.js?v=29';
import { getQwertyLabelForMidi } from './midiController.js?v=29';
import {
  FALLING_NOTES_SONGS,
  PIANO_CHORD_PROGRESSIONS,
  buildFallingSongFromStudio,
  buildPracticeChordsFromStudio,
  detectChordFromMidis,
  doesActiveMatchChord,
  getScaleGuideInfo,
} from './musicTheory.js?v=29';
import {
  generateEarQuestion,
  loadEarStats,
  saveEarOutcome,
} from './earTraining.js?v=29';
import {
  CLEF_META,
  KEYBOARD_MAP,
  KEY_SIGNATURES,
  PIANO_KEYS_12,
  SCROLL_LESSON_GROUPS,
  SINGLE_NOTE_GROUPS,
  buildLessonNotePool,
  computeSessionRank,
  findScrollLesson,
  findSingleLesson,
  getWeakNotesList,
  loadTrainerStats,
  pickRandomNote,
  recordTrainerOutcome,
  saveTrainerSessionSummary,
} from './trainerData.js?v=29';
import {
  ScrollingStaffView,
  renderReferenceStaff,
  renderSingleNoteStaff,
} from './staffRenderer.js?v=29';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function formatTimer(secLeft) {
  const s = Math.max(0, Math.ceil(secLeft));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export class MusicTrainer {
  constructor(rootEl, { audioEngine, midiController = null, getStudioContext = null, showToast }) {
    this.root = rootEl;
    this.audio = audioEngine;
    this.midi = midiController;
    this.getStudioContext = typeof getStudioContext === 'function' ? getStudioContext : null;
    this.showToast = showToast || (() => {});

    this.isSectionActive = false;
    this.view = 'piano-room'; // 'piano-room' | 'home' | 'setup-single' | 'setup-scroll' | 'drill-single' | 'drill-scroll' | 'reference' | 'report'
    this.pianoSubMode = 'free'; // 'free' | 'chord-wait' | 'falling'

    this.pianoConfig = {
      timbre: 'grand',
      scaleKeyPc: 3, // Eb Trưởng mặc định
      scaleType: 'major',
      showScaleGuide: true,
    };

    this.chordPractice = {
      progression: PIANO_CHORD_PROGRESSIONS[0],
      customProgression: null,
      barIndex: 0,
      rhythmMode: 'wait', // 'wait' | 'metronome'
      bpm: PIANO_CHORD_PROGRESSIONS[0].bpm,
      completedCount: 0,
      totalAttemptBars: 0,
      hitInCurrentBar: false,
      metronomeTimer: null,
      advanceTimer: null,
      beatStep: 0,
    };

    this.falling = {
      song: FALLING_NOTES_SONGS[0],
      customSong: null,
      playing: false,
      finished: false,
      waitMode: true,
      speedPct: 85,
      notes: [],
      currentBeat: -1.5,
      waitingForNote: null,
      correctHits: 0,
      wrongHits: 0,
      lastFrameMs: 0,
      rafId: null,
    };

    this._keyGeometry = new Map();
    this._keyElByMidi = new Map();
    this._signalLedTimer = null;

    this.earState = {
      mode: 'chord', // 'chord' | 'interval' | 'degree'
      difficulty: 'medium',
      question: null,
      answered: false,
      selectedId: null,
      stats: loadEarStats(),
    };
    this._earTimers = [];

    // Cấu hình người dùng (Đọc Khuông Nhạc)
    this.config = {
      singleLessonId: SINGLE_NOTE_GROUPS[0].lessons[1].id, // Khóa Sol - Trong khuông
      scrollLessonId: SCROLL_LESSON_GROUPS[0].lessons[0].id, // Đô ngũ cung - Dân ca
      timeLimitPreset: '2', // '1' | '2' | '3' | '5' | 'custom'
      customMinutes: 2,
      playSample: true,
      showKeyLabels: true,
      scrollBpm: 40,
      metronomeOn: true,
      refClef: 'treble',
      refAccidental: 0,
    };

    // Trạng thái phiên luyện tập đang chạy
    this.session = null;
    this.lastReport = null;
    this.lastMistakeNotes = [];

    this._rafId = null;
    this._timerInterval = null;
    this._nextNoteTimer = null;
    this._refNotes = [];
    this._activeRefNoteKey = null;

    this._onVisibilityChange = () => {
      if (document.hidden) {
        if (this._rafId !== null) {
          cancelAnimationFrame(this._rafId);
          this._rafId = null;
        }
        if (this._timerInterval !== null) {
          clearInterval(this._timerInterval);
          this._timerInterval = null;
        }
        this._pauseFallingNotes();
        if (this.midi) this.midi.releaseAll();
      } else if (this.isSectionActive && this.session && this.session.active) {
        this._startCountdownTimer();
        if (this.view === 'drill-scroll') {
          this._resumeScrollLoop();
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    if (this.midi) {
      this._unsubMidi = this.midi.subscribe({
        onDeviceChange: () => this._updateDeviceBarStatus(),
        onSignal: () => this._flashMidiSignalLed(),
        onOctaveChange: () => {
          if (this.view === 'piano-room') this._rebuildHybridKeyboard();
          this._updateDeviceBarStatus();
        },
        onSustainChange: () => {
          if (this.view === 'piano-room') this._updateLiveChordHud();
        },
        onNoteOn: (evt) => this._onUnifiedNoteOn(evt),
        onNoteOff: (evt) => this._onUnifiedNoteOff(evt),
        onActiveChange: (snap) => this._onUnifiedActiveChange(snap),
      });
    }

    this._bindKeyboardShortcuts();
    this.render();
  }

  setSectionActive(active) {
    this.isSectionActive = Boolean(active);
    if (!active) {
      this.stopActiveSession();
    } else if (this.view === 'home' || this.view === 'piano-room' || this.view === 'ear-training') {
      this.render();
    }
  }

  openEarTraining() {
    this.stopActiveSession();
    this.view = 'ear-training';
    if (!this.earState.question) {
      this.earState.question = generateEarQuestion({
        mode: this.earState.mode,
        difficulty: this.earState.difficulty,
      });
    }
    this.render();
  }

  openChordPracticeCustom({ keyPc = 0, scaleType = 'major', bpm = 80, chords = [] } = {}) {
    this.stopActiveSession();
    this.view = 'piano-room';
    this.pianoSubMode = 'chord-wait';
    if (Array.isArray(chords) && chords.length > 0) {
      const voiced = generateVoicedProgression(chords, keyPc, scaleType);
      const custom = buildPracticeChordsFromStudio(voiced, keyPc, scaleType);
      if (custom) {
        custom.bpm = bpm || 80;
        custom.name = `Hợp âm phân tích (${custom.desc})`;
        this.chordPractice.customProgression = custom;
        this.chordPractice.progression = custom;
        this.chordPractice.barIndex = 0;
        this.chordPractice.bpm = custom.bpm;
      }
    }
    this.render();
  }

  stopActiveSession() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    if (this._nextNoteTimer) {
      clearTimeout(this._nextNoteTimer);
      this._nextNoteTimer = null;
    }
    this._clearEarTimers();
    this._stopChordWaitTimers();
    this._stopFallingLoop();
    this.falling.playing = false;
    if (this.session) {
      this.session.active = false;
    }
    if (this.midi) {
      this.midi.releaseAll();
    }
    this.audio.stopTrainerAudio();
  }

  // ==========================================================================
  // Xử lý bàn phím máy tính (Desktop QWERTY) cho chế độ Đọc Khuông Nhạc
  // ==========================================================================
  _bindKeyboardShortcuts() {
    this._onKeyDown = (e) => {
      if (!this.isSectionActive || this.view === 'piano-room' || this.view === 'ear-training') return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const pc = KEYBOARD_MAP[e.key.toLowerCase()];
      if (pc !== undefined) {
        e.preventDefault();
        this._handlePianoKeyInput(pc);
        return;
      }

      if (e.code === 'Space' && this.view === 'drill-single' && this.session?.currentNote) {
        e.preventDefault();
        this.audio.playTrainerPiano(this.session.currentNote.midi, 0.7).catch(() => {});
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  // ==========================================================================
  // Render tổng thể theo View hiện tại
  // ==========================================================================
  render() {
    if (this.view !== 'piano-room') {
      this._stopChordWaitTimers();
      this._stopFallingLoop();
    }
    if (this.view !== 'ear-training') {
      this._clearEarTimers();
    }

    if (this.view === 'piano-room') {
      this._renderPianoRoom();
    } else if (this.view === 'ear-training') {
      this._renderEarTraining();
    } else if (this.view === 'home') {
      this._renderHome();
    } else if (this.view === 'setup-single') {
      this._renderSetupSingle();
    } else if (this.view === 'setup-scroll') {
      this._renderSetupScroll();
    } else if (this.view === 'drill-single') {
      this._renderDrillSingle();
    } else if (this.view === 'drill-scroll') {
      this._renderDrillScroll();
    } else if (this.view === 'reference') {
      this._renderReference();
    } else if (this.view === 'report') {
      this._renderReport();
    }
  }

  // ==========================================================================
  // 1. TRANG CHỦ MỤC HỌC NHẠC
  // ==========================================================================
  _renderHome() {
    const stats = loadTrainerStats();
    const weakList = getWeakNotesList(20);
    const overallAcc =
      stats.totalPracticed > 0
        ? Math.round((stats.totalCorrect / stats.totalPracticed) * 100)
        : 0;

    this.root.innerHTML = `
      <div class="trainer-shell">
        ${this._renderDeviceBarHtml()}
        ${this._renderTopSectionTabsHtml()}
        <div class="trainer-home">
          <div class="trainer-hero">
            <div>
              <h1 class="trainer-title">Luyện Đọc Nốt &amp; Phản Xạ Nhạc Lý</h1>
              <p class="trainer-sub">Mở khóa 100% bài tập · Đọc khuông nhạc Khóa Sol, Fa, Đô và cảm âm chuẩn DAW</p>
            </div>
            <div class="trainer-stats-bar">
              <div class="t-stat-cell">
                <span class="t-stat-label">ĐÃ LUYỆN</span>
                <strong class="t-stat-val mono-val">${stats.totalPracticed} nốt</strong>
              </div>
              <div class="t-stat-cell">
                <span class="t-stat-label">ĐIỂM CAO NHẤT</span>
                <strong class="t-stat-val mono-val accent-green">${stats.bestAccuracy}%</strong>
              </div>
              <div class="t-stat-cell">
                <span class="t-stat-label">CHÍNH XÁC TB</span>
                <strong class="t-stat-val mono-val">${overallAcc}%</strong>
              </div>
              <div class="t-stat-cell">
                <span class="t-stat-label">NỐT CẦN ÔN</span>
                <strong class="t-stat-val mono-val accent-amber">${weakList.length}</strong>
              </div>
            </div>
          </div>

          <div class="trainer-modes-grid">
            <button type="button" class="mode-card mode-emerald" data-open-mode="setup-single">
              <div class="mode-card-head">
                <span class="mode-badge">CHẾ ĐỘ 1</span>
                <span class="mode-tag mono-val">12 BÀI · MỞ KHÓA</span>
              </div>
              <h2 class="mode-name">Luyện từng nốt</h2>
              <p class="mode-desc">Chọn bài theo Khóa Sol, Fa, Đô hoặc tổng hợp. Nốt hiện ngẫu nhiên kèm tiếng đàn mẫu để rèn phản xạ đọc nốt và cảm âm.</p>
              <span class="mode-cta">Chọn bài tập →</span>
            </button>

            <button type="button" class="mode-card mode-blue" data-open-mode="setup-scroll">
              <div class="mode-card-head">
                <span class="mode-badge">CHẾ ĐỘ 2</span>
                <span class="mode-tag mono-val">14 BÀI · 60FPS</span>
              </div>
              <h2 class="mode-name">Luyện nốt chạy</h2>
              <p class="mode-desc">Nốt trôi liên tục theo nhịp BPM qua vạch chuẩn kèm hóa biểu thật. Sai không dừng hình — rèn đọc nhạc thực chiến không khựng nhịp.</p>
              <span class="mode-cta">Chọn bài chạy nhịp →</span>
            </button>

            <button type="button" class="mode-card mode-amber" data-open-mode="weak-notes">
              <div class="mode-card-head">
                <span class="mode-badge">CHẾ ĐỘ 3</span>
                <span class="mode-tag mono-val">${weakList.length} NỐT YẾU</span>
              </div>
              <h2 class="mode-name">Ôn tập nốt sai</h2>
              <p class="mode-desc">Tự động lọc những nốt bạn hay bấm nhầm nhất từ các phiên trước để tập trung khắc phục điểm yếu nhanh nhất.</p>
              <span class="mode-cta">${weakList.length > 0 ? 'Vào ôn ngay →' : 'Chưa có nốt sai'}</span>
            </button>

            <button type="button" class="mode-card mode-indigo" data-open-mode="reference">
              <div class="mode-card-head">
                <span class="mode-badge">CHẾ ĐỘ 4</span>
                <span class="mode-tag mono-val">SOL · FA · ĐÔ</span>
              </div>
              <h2 class="mode-name">Tra cứu nốt</h2>
              <p class="mode-desc">Bảng tương tác vị trí nốt trên khuông theo Khóa Sol, Fa, Đô. Bấm vào khuông hoặc phím đàn để xem vị trí dòng/khe và nghe tiếng.</p>
              <span class="mode-cta">Mở bảng tra cứu →</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this._bindDeviceBarEvents();
    this._bindTopSectionTabsEvents();
    this.root.querySelectorAll('[data-open-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.openMode;
        if (target === 'weak-notes') {
          this._startWeakNotesSession();
        } else {
          this.view = target;
          this.render();
        }
      });
    });
  }

  // ==========================================================================
  // 2. MÀN HÌNH CÀI ĐẶT CHẾ ĐỘ 1 (LUYỆN TỪNG NỐT)
  // ==========================================================================
  _renderSetupSingle() {
    const groupsHtml = SINGLE_NOTE_GROUPS.map(
      (grp) => `
      <div class="lesson-group">
        <h3 class="lesson-group-title">${escapeHtml(grp.group)}</h3>
        <div class="lesson-grid">
          ${grp.lessons
            .map(
              (l) => `
            <button type="button" class="lesson-card${
              l.id === this.config.singleLessonId ? ' selected' : ''
            }" data-pick-single="${l.id}">
              <div class="lesson-card-top">
                <span class="lesson-name">${escapeHtml(l.title)}</span>
                <span class="lesson-pill mono-val">${CLEF_META[l.clef]?.shortLabel || 'Mix'}</span>
              </div>
              <span class="lesson-desc">${escapeHtml(l.desc)}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `
    ).join('');

    this.root.innerHTML = `
      <div class="trainer-shell">
        <div class="trainer-setup">
          <div class="setup-topbar">
            <button type="button" class="btn btn-ghost" data-nav="home">← Quay lại</button>
            <div class="setup-heading">
              <h2>Chế độ 1 · Luyện từng nốt</h2>
              <span>Mở khóa 100% toàn bộ giáo trình · Kết hợp đọc nốt và cảm âm</span>
            </div>
            <button type="button" class="btn btn-cyan-solid setup-start-btn" id="btn-start-single">
              Bắt đầu luyện tập ▶
            </button>
          </div>

          <div class="setup-options-panel">
            <div class="setup-opt-block">
              <span class="opt-label">Thời gian phiên tập</span>
              ${this._renderTimeLimitControls()}
            </div>
            <div class="setup-opt-toggles">
              <label class="mini-check accent-check">
                <input type="checkbox" id="opt-play-sample" ${this.config.playSample ? 'checked' : ''} />
                <span>Phát tiếng nốt mẫu</span>
              </label>
              <label class="mini-check">
                <input type="checkbox" id="opt-show-labels" ${this.config.showKeyLabels ? 'checked' : ''} />
                <span>Hiện tên phím đàn (C D E...)</span>
              </label>
            </div>
          </div>

          <div class="lessons-scroll-area">${groupsHtml}</div>
        </div>
      </div>
    `;

    this._bindCommonSetupEvents();
    this.root.querySelectorAll('[data-pick-single]').forEach((card) => {
      card.addEventListener('click', () => {
        this.config.singleLessonId = card.dataset.pickSingle;
        this.root.querySelectorAll('[data-pick-single]').forEach((c) =>
          c.classList.toggle('selected', c === card)
        );
      });
    });

    this.root.querySelector('#opt-play-sample').addEventListener('change', (e) => {
      this.config.playSample = e.target.checked;
    });
    this.root.querySelector('#opt-show-labels').addEventListener('change', (e) => {
      this.config.showKeyLabels = e.target.checked;
    });
    this.root.querySelector('#btn-start-single').addEventListener('click', () => {
      const lesson = findSingleLesson(this.config.singleLessonId);
      const pool = buildLessonNotePool(lesson);
      this._launchSingleSession({
        mode: 'single',
        title: `${CLEF_META[lesson.clef]?.label || 'Tổng hợp'} · ${lesson.title}`,
        difficulty: lesson.accMode === 'chromatic' ? 'hard' : 'medium',
        pool,
      });
    });
  }

  // ==========================================================================
  // 3. MÀN HÌNH CÀI ĐẶT CHẾ ĐỘ 2 (LUYỆN NỐT CHẠY)
  // ==========================================================================
  _renderSetupScroll() {
    const selectedLesson = findScrollLesson(this.config.scrollLessonId);

    const groupsHtml = SCROLL_LESSON_GROUPS.map(
      (grp) => `
      <div class="lesson-group">
        <h3 class="lesson-group-title diff-${grp.difficulty}">${escapeHtml(grp.group)}</h3>
        <div class="lesson-grid">
          ${grp.lessons
            .map(
              (l) => `
            <button type="button" class="lesson-card${
              l.id === this.config.scrollLessonId ? ' selected' : ''
            }" data-pick-scroll="${l.id}">
              <div class="lesson-card-top">
                <span class="lesson-name">${escapeHtml(l.title)}</span>
                <span class="lesson-pill mono-val">${l.defaultBpm} BPM</span>
              </div>
              <span class="lesson-desc">${escapeHtml(l.desc)}</span>
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `
    ).join('');

    this.root.innerHTML = `
      <div class="trainer-shell">
        <div class="trainer-setup">
          <div class="setup-topbar">
            <button type="button" class="btn btn-ghost" data-nav="home">← Quay lại</button>
            <div class="setup-heading">
              <h2>Chế độ 2 · Luyện nốt chạy</h2>
              <span>Nốt trôi đều qua vạch xanh lá · Sai không dừng hình để giữ chắc nhịp</span>
            </div>
            <button type="button" class="btn btn-cyan-solid setup-start-btn" id="btn-start-scroll">
              Bắt đầu chạy nhịp ▶
            </button>
          </div>

          <div class="setup-options-panel">
            <div class="setup-opt-block">
              <span class="opt-label">Thời gian</span>
              ${this._renderTimeLimitControls()}
            </div>

            <div class="setup-opt-block bpm-opt-block">
              <span class="opt-label">Tốc độ BPM <strong class="mono-val" id="setup-scroll-bpm-val">${this.config.scrollBpm}</strong></span>
              <input type="range" class="studio-range" id="opt-scroll-bpm" min="20" max="140" step="1" value="${this.config.scrollBpm}" />
            </div>

            <div class="setup-opt-toggles">
              <label class="mini-check accent-check">
                <input type="checkbox" id="opt-metronome" ${this.config.metronomeOn ? 'checked' : ''} />
                <span>Đếm nhịp (Metronome)</span>
              </label>
              <label class="mini-check">
                <input type="checkbox" id="opt-show-labels" ${this.config.showKeyLabels ? 'checked' : ''} />
                <span>Hiện tên phím đàn</span>
              </label>
            </div>
          </div>

          <div class="lessons-scroll-area">${groupsHtml}</div>
        </div>
      </div>
    `;

    this._bindCommonSetupEvents();
    const bpmSlider = this.root.querySelector('#opt-scroll-bpm');
    const bpmVal = this.root.querySelector('#setup-scroll-bpm-val');

    bpmSlider.addEventListener('input', (e) => {
      this.config.scrollBpm = Number(e.target.value);
      bpmVal.textContent = String(this.config.scrollBpm);
    });

    this.root.querySelectorAll('[data-pick-scroll]').forEach((card) => {
      card.addEventListener('click', () => {
        this.config.scrollLessonId = card.dataset.pickScroll;
        const lesson = findScrollLesson(this.config.scrollLessonId);
        this.config.scrollBpm = lesson.defaultBpm;
        bpmSlider.value = String(lesson.defaultBpm);
        bpmVal.textContent = String(lesson.defaultBpm);
        this.root.querySelectorAll('[data-pick-scroll]').forEach((c) =>
          c.classList.toggle('selected', c === card)
        );
      });
    });

    this.root.querySelector('#opt-metronome').addEventListener('change', (e) => {
      this.config.metronomeOn = e.target.checked;
    });
    this.root.querySelector('#opt-show-labels').addEventListener('change', (e) => {
      this.config.showKeyLabels = e.target.checked;
    });
    this.root.querySelector('#btn-start-scroll').addEventListener('click', () => {
      this._launchScrollSession(findScrollLesson(this.config.scrollLessonId));
    });
  }

  _renderTimeLimitControls() {
    const p = this.config.timeLimitPreset;
    return `
      <div class="time-limit-row">
        <div class="seg-group" id="time-preset-group">
          <button type="button" class="seg-btn${p === '1' ? ' active' : ''}" data-tpreset="1">1 phút</button>
          <button type="button" class="seg-btn${p === '2' ? ' active' : ''}" data-tpreset="2">2 phút</button>
          <button type="button" class="seg-btn${p === '3' ? ' active' : ''}" data-tpreset="3">3 phút</button>
          <button type="button" class="seg-btn${p === '5' ? ' active' : ''}" data-tpreset="5">5 phút</button>
          <button type="button" class="seg-btn${p === 'custom' ? ' active' : ''}" data-tpreset="custom">Tự do</button>
        </div>
        <label class="custom-min-wrap${p === 'custom' ? '' : ' hidden'}" id="custom-min-wrap">
          <input type="number" id="opt-custom-min" class="studio-input custom-min-input mono-val" min="1" max="15" value="${this.config.customMinutes}" />
          <span>phút</span>
        </label>
      </div>
    `;
  }

  _bindCommonSetupEvents() {
    this.root.querySelectorAll('[data-nav="home"]').forEach((b) =>
      b.addEventListener('click', () => {
        this.stopActiveSession();
        this.view = 'home';
        this.render();
      })
    );

    const group = this.root.querySelector('#time-preset-group');
    const customWrap = this.root.querySelector('#custom-min-wrap');
    const customInp = this.root.querySelector('#opt-custom-min');
    if (group) {
      group.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tpreset]');
        if (!btn) return;
        this.config.timeLimitPreset = btn.dataset.tpreset;
        group.querySelectorAll('.seg-btn').forEach((b) =>
          b.classList.toggle('active', b === btn)
        );
        if (customWrap) {
          customWrap.classList.toggle('hidden', this.config.timeLimitPreset !== 'custom');
        }
      });
    }
    if (customInp) {
      customInp.addEventListener('change', (e) => {
        const v = Math.max(1, Math.min(15, Number(e.target.value) || 2));
        this.config.customMinutes = v;
        e.target.value = String(v);
      });
    }
  }

  _getDurationSeconds() {
    if (this.config.timeLimitPreset === 'custom') {
      return Math.max(1, Math.min(15, Number(this.config.customMinutes) || 2)) * 60;
    }
    return (Number(this.config.timeLimitPreset) || 2) * 60;
  }

  // ==========================================================================
  // 4. LOGIC CHẾ ĐỘ 1 & CHẾ ĐỘ 3 (LUYỆN TỪNG NỐT / ÔN NỐT SAI)
  // ==========================================================================
  _startWeakNotesSession() {
    const weak = getWeakNotesList(20);
    if (weak.length === 0) {
      this.showToast('Chưa có nốt sai nào được ghi nhận. Hãy vào Luyện từng nốt hoặc Luyện nốt chạy trước nhé!');
      return;
    }
    this._launchSingleSession({
      mode: 'weak',
      title: `Ôn tập nốt hay sai (${weak.length} nốt)`,
      difficulty: 'medium',
      pool: weak,
    });
  }

  async _launchSingleSession({ mode, title, difficulty, pool, backView = null }) {
    this.stopActiveSession();
    try {
      await this.audio.ensureReady();
    } catch (_) {}

    const durationSec = this._getDurationSeconds();
    this.session = {
      active: true,
      mode,
      title,
      difficulty,
      backView: backView || (mode === 'weak' ? 'home' : 'setup-single'),
      pool,
      durationSec,
      remainingSec: durationSec,
      correct: 0,
      wrong: 0,
      streak: 0,
      maxStreak: 0,
      reactionMsList: [],
      noteStats: {}, // key -> { note, wrong, reactionTotal, reactionCount }
      wrongNoteObjects: new Map(),
      currentNote: null,
      noteShownAt: 0,
      currentHadError: false,
      lockedTransition: false,
    };

    this.view = 'drill-single';
    this.render();
    this._startCountdownTimer();
    this._advanceSingleNote();
  }

  _renderDrillSingle() {
    const s = this.session;
    this.root.innerHTML = `
      <div class="trainer-shell">
        <div class="drill-workspace">
          <div class="drill-hud">
            <div class="hud-left">
              <button type="button" class="btn btn-ghost btn-xs" id="btn-end-drill">Kết thúc sớm</button>
              <span class="drill-lesson-title">${escapeHtml(s.title)}</span>
            </div>

            <div class="hud-metrics">
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">THỜI GIAN</span>
                <span class="lcd-val mono-val" id="hud-timer">${formatTimer(s.remainingSec)}</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">ĐÚNG</span>
                <span class="lcd-val mono-val accent-green" id="hud-correct">0</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">SAI</span>
                <span class="lcd-val mono-val accent-red" id="hud-wrong">0</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">CHÍNH XÁC</span>
                <span class="lcd-val mono-val" id="hud-acc">100%</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">PHẢN XẠ TB</span>
                <span class="lcd-val mono-val accent-cyan" id="hud-react">—</span>
              </div>
            </div>

            <div class="hud-right">
              <button type="button" class="btn btn-indigo-outline btn-xs" id="btn-replay-sample" title="Nghe lại cao độ nốt mẫu (Space)">
                🔊 Nghe lại
              </button>
              <label class="mini-check desktop-only">
                <input type="checkbox" id="drill-toggle-labels" ${this.config.showKeyLabels ? 'checked' : ''} />
                <span>Tên phím</span>
              </label>
            </div>
          </div>

          <div class="staff-stage">
            <div id="trainer-staff-box" class="staff-box"></div>
            <div id="drill-feedback-bar" class="drill-feedback-bar">Hãy nhìn khuông nhạc hoặc nghe nốt mẫu rồi bấm phím đàn bên dưới</div>
          </div>

          ${this._renderPianoKeyboardHtml()}
        </div>
      </div>
    `;

    this._bindPianoKeyboardEvents();
    this.root.querySelector('#btn-end-drill').addEventListener('click', () => {
      this._finishSession();
    });
    this.root.querySelector('#btn-replay-sample').addEventListener('click', () => {
      if (this.session?.currentNote) {
        this.audio.playTrainerPiano(this.session.currentNote.midi, 0.7).catch(() => {});
      }
    });
    const toggleLbl = this.root.querySelector('#drill-toggle-labels');
    if (toggleLbl) {
      toggleLbl.addEventListener('change', (e) => {
        this.config.showKeyLabels = e.target.checked;
        this._syncPianoKeyLabels();
      });
    }
  }

  _advanceSingleNote() {
    const s = this.session;
    if (!s || !s.active) return;

    const prevKey = s.currentNote ? s.currentNote.key : null;
    const next = pickRandomNote(s.pool, prevKey);
    s.currentNote = next;
    s.noteShownAt = performance.now();
    s.currentHadError = false;
    s.lockedTransition = false;

    const staffBox = this.root.querySelector('#trainer-staff-box');
    renderSingleNoteStaff(staffBox, next, { state: 'neutral' });

    const fb = this.root.querySelector('#drill-feedback-bar');
    if (fb) {
      fb.className = 'drill-feedback-bar';
      fb.textContent = this.config.playSample
        ? 'Đã phát nốt mẫu · Chọn phím đúng trên đàn'
        : 'Chọn nốt tương ứng trên bàn phím Piano';
    }

    if (this.config.playSample && next) {
      this.audio.playTrainerPiano(next.midi, 0.72).catch(() => {});
    }
  }

  _handleSingleNoteAnswer(pc, keyEl) {
    const s = this.session;
    if (!s || !s.active || !s.currentNote || s.lockedTransition) return;

    const target = s.currentNote;
    const staffBox = this.root.querySelector('#trainer-staff-box');
    const fb = this.root.querySelector('#drill-feedback-bar');

    if (!s.noteStats[target.key]) {
      s.noteStats[target.key] = { note: target, wrong: 0, reactionTotal: 0, reactionCount: 0 };
    }

    if (pc === target.pitchClass) {
      const reactionMs = performance.now() - s.noteShownAt;
      s.lockedTransition = true;
      s.correct += 1;
      s.streak += 1;
      if (s.streak > s.maxStreak) s.maxStreak = s.streak;
      s.reactionMsList.push(reactionMs);

      s.noteStats[target.key].reactionTotal += reactionMs;
      s.noteStats[target.key].reactionCount += 1;
      recordTrainerOutcome(target, true, reactionMs);

      this._flashPianoKey(keyEl, 'correct');
      this.audio.playTrainerPiano(target.midi, 0.55).catch(() => {});
      renderSingleNoteStaff(staffBox, target, {
        state: 'correct',
        revealLabel: `${target.displayName.replace('#', '♯').replace('b', '♭')} (${(reactionMs / 1000).toFixed(2)}s)`,
      });

      if (fb) {
        fb.className = 'drill-feedback-bar fb-correct';
        fb.textContent = `Chính xác! ${target.displayName.replace('#', '♯').replace('b', '♭')} (${target.solfegeVi}) · ${(reactionMs / 1000).toFixed(2)} giây`;
      }

      this._updateDrillHud();
      clearTimeout(this._nextNoteTimer);
      this._nextNoteTimer = setTimeout(() => {
        this._advanceSingleNote();
      }, 240);
    } else {
      s.wrong += 1;
      s.streak = 0;
      s.noteStats[target.key].wrong += 1;
      s.wrongNoteObjects.set(target.key, target);
      recordTrainerOutcome(target, false, 0);

      this._flashPianoKey(keyEl, 'wrong');
      this.audio.playTrainerWrong().catch(() => {});

      const answerHint = `${target.displayName.replace('#', '♯').replace('b', '♭')} (${target.solfegeVi})`;
      renderSingleNoteStaff(staffBox, target, {
        state: 'wrong',
        revealLabel: answerHint,
      });

      if (fb) {
        fb.className = 'drill-feedback-bar fb-wrong';
        fb.textContent = `Chưa đúng! Nốt này là ${answerHint} — hãy bấm đúng phím để tiếp tục`;
      }

      this._updateDrillHud();
    }
  }

  // ==========================================================================
  // 5. LOGIC CHẾ ĐỘ 2 (LUYỆN NỐT CHẠY — CHẠY LIÊN TỤC KHÔNG DỪNG KHI SAI)
  // ==========================================================================
  async _launchScrollSession(lesson) {
    this.stopActiveSession();
    try {
      await this.audio.ensureReady();
    } catch (_) {}

    const pool = buildLessonNotePool(lesson);
    const bpm = this.config.scrollBpm || lesson.defaultBpm || 45;
    const durationSec = this._getDurationSeconds();

    this.session = {
      active: true,
      mode: 'scroll',
      lesson,
      title: `${lesson.title} (${bpm} BPM)`,
      difficulty: lesson.difficulty || 'easy',
      backView: 'setup-scroll',
      pool,
      bpm,
      durationSec,
      remainingSec: durationSec,
      correct: 0,
      wrong: 0,
      streak: 0,
      maxStreak: 0,
      reactionMsList: [],
      noteStats: {},
      wrongNoteObjects: new Map(),
      scrollingView: null,
      items: [], // { id, note, x, state: 'pending'|'correct'|'wrong'|'missed', enteredZoneAt }
      nextId: 1,
      lastSpawnKey: null,
      beatAccumulator: 0,
      beatIndex: 0,
      pixelsPerBeat: 138,
      lastFrameTs: performance.now(),
    };

    this.view = 'drill-scroll';
    this.render();
    this._startCountdownTimer();
    this._startScrollLoop();
  }

  _renderDrillScroll() {
    const s = this.session;
    const sigInfo = KEY_SIGNATURES[s.lesson.keySigId] || KEY_SIGNATURES['0'];

    this.root.innerHTML = `
      <div class="trainer-shell">
        <div class="drill-workspace">
          <div class="drill-hud">
            <div class="hud-left">
              <button type="button" class="btn btn-ghost btn-xs" id="btn-end-drill">Kết thúc sớm</button>
              <span class="drill-lesson-title">${escapeHtml(s.title)}</span>
              <span class="sig-badge mono-val">${escapeHtml(sigInfo.label)}</span>
            </div>

            <div class="hud-metrics">
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">THỜI GIAN</span>
                <span class="lcd-val mono-val" id="hud-timer">${formatTimer(s.remainingSec)}</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">ĐÚNG</span>
                <span class="lcd-val mono-val accent-green" id="hud-correct">0</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">SAI / LỠ</span>
                <span class="lcd-val mono-val accent-red" id="hud-wrong">0</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">CHÍNH XÁC</span>
                <span class="lcd-val mono-val" id="hud-acc">100%</span>
              </div>
              <div class="hud-cell lcd-cell-sm">
                <span class="lcd-label">PHẢN XẠ TB</span>
                <span class="lcd-val mono-val accent-cyan" id="hud-react">—</span>
              </div>
            </div>

            <div class="hud-right">
              <label class="mini-check">
                <input type="checkbox" id="scroll-toggle-metro" ${this.config.metronomeOn ? 'checked' : ''} />
                <span>Metronome</span>
              </label>
              <label class="mini-check desktop-only">
                <input type="checkbox" id="drill-toggle-labels" ${this.config.showKeyLabels ? 'checked' : ''} />
                <span>Tên phím</span>
              </label>
            </div>
          </div>

          <div class="staff-stage">
            <div id="trainer-scroll-box" class="staff-box scroll-staff-box"></div>
            <div id="drill-feedback-bar" class="drill-feedback-bar">Bấm phím đàn đúng khi nốt tiến vào vùng vạch xanh lá · Chú ý hóa biểu đầu khuông!</div>
          </div>

          ${this._renderPianoKeyboardHtml()}
        </div>
      </div>
    `;

    const box = this.root.querySelector('#trainer-scroll-box');
    s.scrollingView = new ScrollingStaffView(box, {
      clef: s.lesson.clef,
      keySigId: s.lesson.keySigId,
    });

    this._bindPianoKeyboardEvents();
    this.root.querySelector('#btn-end-drill').addEventListener('click', () => {
      this._finishSession();
    });
    this.root.querySelector('#scroll-toggle-metro').addEventListener('change', (e) => {
      this.config.metronomeOn = e.target.checked;
    });
    const toggleLbl = this.root.querySelector('#drill-toggle-labels');
    if (toggleLbl) {
      toggleLbl.addEventListener('change', (e) => {
        this.config.showKeyLabels = e.target.checked;
        this._syncPianoKeyLabels();
      });
    }
  }

  _startScrollLoop() {
    const s = this.session;
    if (!s || !s.active || !s.scrollingView) return;

    // Sinh sẵn 2 nốt đầu tiên để người tập thấy ngay luồng nốt tiến vào vạch chuẩn
    this._spawnScrollNote(s.scrollingView.targetX + s.pixelsPerBeat * 1.45);
    this._spawnScrollNote(s.scrollingView.targetX + s.pixelsPerBeat * 2.45);

    this._resumeScrollLoop();
  }

  _resumeScrollLoop() {
    const s = this.session;
    if (
      !s ||
      !s.active ||
      !s.scrollingView ||
      this.view !== 'drill-scroll' ||
      !this.isSectionActive ||
      document.hidden
    ) {
      return;
    }

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    s.lastFrameTs = performance.now();

    const step = (now) => {
      if (
        !this.session ||
        !this.session.active ||
        this.view !== 'drill-scroll' ||
        !this.isSectionActive ||
        document.hidden
      ) {
        this._rafId = null;
        return;
      }

      const dt = Math.min(0.05, Math.max(0.001, (now - s.lastFrameTs) / 1000));
      s.lastFrameTs = now;

      const beatPerSec = s.bpm / 60;
      const speedPxPerSec = beatPerSec * s.pixelsPerBeat;
      const dx = speedPxPerSec * dt;

      // Đếm nhịp Metronome & sinh nốt mới đều đặn mỗi phách
      s.beatAccumulator += beatPerSec * dt;
      if (s.beatAccumulator >= 1) {
        s.beatAccumulator -= 1;
        s.beatIndex = (s.beatIndex + 1) % 4;
        if (this.config.metronomeOn) {
          this.audio.playTrainerClick(s.beatIndex === 0).catch(() => {});
        }
        // Giữ khoảng cách tối thiểu 120px với nốt ngoài cùng bên phải
        const rightMostX = s.items.reduce((mx, it) => Math.max(mx, it.x), -Infinity);
        const spawnX = Math.max(s.scrollingView.spawnX, rightMostX + s.pixelsPerBeat);
        this._spawnScrollNote(spawnX);
      }

      const targetX = s.scrollingView.targetX;
      const hitEnterX = targetX + 115;
      const missLimitX = targetX - 58;
      let hudDirty = false;

      for (let i = s.items.length - 1; i >= 0; i--) {
        const item = s.items[i];
        item.x -= dx;
        s.scrollingView.updateNoteX(item);

        // Ghi nhận thời điểm nốt bắt đầu vào vùng phản xạ
        if (item.state === 'pending' && item.enteredZoneAt === 0 && item.x <= hitEnterX) {
          item.enteredZoneAt = now;
        }

        // Trôi qua khỏi vùng vạch xanh mà chưa bấm -> Đỏ (Bỏ lỡ), KHÔNG dừng hình
        if (item.state === 'pending' && item.x < missLimitX) {
          item.state = 'missed';
          s.scrollingView.setNoteState(item, 'missed');
          s.wrong += 1;
          s.streak = 0;

          if (!s.noteStats[item.note.key]) {
            s.noteStats[item.note.key] = {
              note: item.note,
              wrong: 0,
              reactionTotal: 0,
              reactionCount: 0,
            };
          }
          s.noteStats[item.note.key].wrong += 1;
          s.wrongNoteObjects.set(item.note.key, item.note);
          recordTrainerOutcome(item.note, false, 0);

          const fb = this.root.querySelector('#drill-feedback-bar');
          if (fb) {
            fb.className = 'drill-feedback-bar fb-wrong';
            fb.textContent = `Bỏ lỡ ${item.note.displayName.replace('#', '♯').replace('b', '♭')} — Bắt tiếp nốt kế!`;
          }
          hudDirty = true;
        }

        if (item.x < s.scrollingView.despawnX) {
          s.scrollingView.removeNoteNode(item);
          s.items.splice(i, 1);
        }
      }

      if (hudDirty) this._updateDrillHud();

      this._rafId = requestAnimationFrame(step);
    };

    this._rafId = requestAnimationFrame(step);
  }

  _spawnScrollNote(xPos) {
    const s = this.session;
    if (!s || !s.scrollingView) return;
    const note = pickRandomNote(s.pool, s.lastSpawnKey);
    if (!note) return;
    s.lastSpawnKey = note.key;

    const item = {
      id: s.nextId++,
      note,
      x: xPos,
      state: 'pending',
      enteredZoneAt: 0,
      el: null,
    };
    s.scrollingView.addNoteNode(item);
    s.items.push(item);
  }

  _handleScrollNoteAnswer(pc, keyEl) {
    const s = this.session;
    if (!s || !s.active || !s.scrollingView) return;

    const targetX = s.scrollingView.targetX;
    // Tìm nốt 'pending' gần vạch chuẩn nhất trong vùng nhận [targetX - 58, targetX + 125]
    const candidates = s.items
      .filter((it) => it.state === 'pending' && it.x >= targetX - 58 && it.x <= targetX + 125)
      .sort((a, b) => a.x - b.x);

    if (candidates.length === 0) {
      // Vẫn phát tiếng phím đàn để người dùng cảm nhận cao độ mà không phá nhịp
      this.audio.playTrainerPiano(60 + pc, 0.35, 0.5).catch(() => {});
      return;
    }

    const item = candidates[0];
    const target = item.note;
    const fb = this.root.querySelector('#drill-feedback-bar');

    if (!s.noteStats[target.key]) {
      s.noteStats[target.key] = { note: target, wrong: 0, reactionTotal: 0, reactionCount: 0 };
    }

    if (pc === target.pitchClass) {
      const now = performance.now();
      const rawReact = item.enteredZoneAt > 0 ? now - item.enteredZoneAt : 420;
      const reactionMs = Math.max(120, Math.min(4000, rawReact));

      item.state = 'correct';
      s.scrollingView.setNoteState(item, 'correct');

      s.correct += 1;
      s.streak += 1;
      if (s.streak > s.maxStreak) s.maxStreak = s.streak;
      s.reactionMsList.push(reactionMs);

      s.noteStats[target.key].reactionTotal += reactionMs;
      s.noteStats[target.key].reactionCount += 1;
      recordTrainerOutcome(target, true, reactionMs);

      this._flashPianoKey(keyEl, 'correct');
      this.audio.playTrainerPiano(target.midi, 0.45).catch(() => {});

      if (fb) {
        fb.className = 'drill-feedback-bar fb-correct';
        fb.textContent = `Chuẩn! ${target.displayName.replace('#', '♯').replace('b', '♭')} (${target.solfegeVi}) · Chuỗi ${s.streak}`;
      }
    } else {
      // BẤM SAI TRONG CHẾ ĐỘ NỐT CHẠY: Đổi nốt sang ĐỎ và TIẾP TỤC CHẠY (tuyệt đối không dừng hình)
      item.state = 'wrong';
      s.scrollingView.setNoteState(item, 'wrong');

      s.wrong += 1;
      s.streak = 0;
      s.noteStats[target.key].wrong += 1;
      s.wrongNoteObjects.set(target.key, target);
      recordTrainerOutcome(target, false, 0);

      this._flashPianoKey(keyEl, 'wrong');
      this.audio.playTrainerWrong().catch(() => {});

      if (fb) {
        fb.className = 'drill-feedback-bar fb-wrong';
        fb.textContent = `Sai (${target.displayName.replace('#', '♯').replace('b', '♭')}) — Giữ nhịp sang nốt kế tiếp!`;
      }
    }

    this._updateDrillHud();
  }

  // ==========================================================================
  // 6. ĐỒNG HỒ ĐẾM NGƯỢC & CẬP NHẬT HUD
  // ==========================================================================
  _startCountdownTimer() {
    clearInterval(this._timerInterval);
    this._timerInterval = setInterval(() => {
      const s = this.session;
      if (!s || !s.active) return;
      s.remainingSec -= 1;
      const timerEl = this.root.querySelector('#hud-timer');
      if (timerEl) {
        timerEl.textContent = formatTimer(s.remainingSec);
        timerEl.classList.toggle('timer-low', s.remainingSec <= 10);
      }
      if (s.remainingSec <= 0) {
        this._finishSession();
      }
    }, 1000);
  }

  _updateDrillHud() {
    const s = this.session;
    if (!s) return;
    const total = s.correct + s.wrong;
    const acc = total > 0 ? Math.round((s.correct / total) * 100) : 100;
    const avgReact =
      s.reactionMsList.length > 0
        ? (s.reactionMsList.reduce((a, b) => a + b, 0) / s.reactionMsList.length / 1000).toFixed(2)
        : null;

    const cEl = this.root.querySelector('#hud-correct');
    const wEl = this.root.querySelector('#hud-wrong');
    const aEl = this.root.querySelector('#hud-acc');
    const rEl = this.root.querySelector('#hud-react');

    if (cEl) cEl.textContent = String(s.correct);
    if (wEl) wEl.textContent = String(s.wrong);
    if (aEl) aEl.textContent = `${acc}%`;
    if (rEl) rEl.textContent = avgReact ? `${avgReact}s` : '—';
  }

  // ==========================================================================
  // 7. MÀN HÌNH TỔNG KẾT PHIÊN TẬP (END-OF-SESSION REPORT)
  // ==========================================================================
  _finishSession() {
    const s = this.session;
    if (!s) return;

    this.stopActiveSession();

    const total = s.correct + s.wrong;
    const accuracyPct = total > 0 ? Math.round((s.correct / total) * 100) : 0;
    const avgReactionSec =
      s.reactionMsList.length > 0
        ? Number(
            (s.reactionMsList.reduce((a, b) => a + b, 0) / s.reactionMsList.length / 1000).toFixed(2)
          )
        : 0;

    const rank = computeSessionRank({
      accuracyPct,
      avgReactionSec: avgReactionSec || 1.5,
      total,
      difficulty: s.difficulty,
    });

    // Tìm tối đa 5 nốt sai nhiều nhất hoặc phản xạ chậm nhất trong phiên
    const weakEntries = Object.values(s.noteStats)
      .map((st) => ({
        note: st.note,
        wrong: st.wrong,
        avgMs: st.reactionCount > 0 ? st.reactionTotal / st.reactionCount : 0,
      }))
      .filter((x) => x.wrong > 0 || x.avgMs > 1200)
      .sort((a, b) => {
        if (b.wrong !== a.wrong) return b.wrong - a.wrong;
        return b.avgMs - a.avgMs;
      })
      .slice(0, 5);

    this.lastMistakeNotes = Array.from(s.wrongNoteObjects.values());
    this.lastReport = {
      title: s.title,
      mode: s.mode,
      backView: s.backView,
      difficulty: s.difficulty,
      pool: s.pool,
      lesson: s.lesson || null,
      total,
      correct: s.correct,
      wrong: s.wrong,
      maxStreak: s.maxStreak,
      accuracyPct,
      avgReactionSec,
      rank,
      weakEntries,
    };

    if (total > 0) {
      saveTrainerSessionSummary({
        title: s.title,
        mode: s.mode,
        accuracyPct,
        avgReactionSec,
        total,
        maxStreak: s.maxStreak,
      });
    }

    this.view = 'report';
    this.render();
  }

  _renderReport() {
    const r = this.lastReport;
    if (!r) {
      this.view = 'home';
      this.render();
      return;
    }

    const weakHtml =
      r.weakEntries.length === 0
        ? `<div class="report-empty-weak">Tuyệt vời! Bạn không mắc lỗi hay khựng nhịp đáng kể nào trong phiên này.</div>`
        : r.weakEntries
            .map(
              (item) => `
          <div class="weak-row">
            <div class="weak-note-name">
              <strong class="mono-val">${item.note.displayName.replace('#', '♯').replace('b', '♭')}</strong>
              <span>${escapeHtml(item.note.solfegeVi)} · ${escapeHtml(item.note.staffPositionText)}</span>
            </div>
            <div class="weak-note-stat mono-val">
              ${item.wrong > 0 ? `<span class="badge-err">${item.wrong} lỗi</span>` : ''}
              ${item.avgMs > 0 ? `<span class="badge-time">${(item.avgMs / 1000).toFixed(2)}s</span>` : ''}
            </div>
          </div>
        `
            )
            .join('');

    this.root.innerHTML = `
      <div class="trainer-shell">
        <div class="report-panel">
          <div class="report-header">
            <div class="rank-badge" style="border-color: ${r.rank.color}; color: ${r.rank.color}">
              ${escapeHtml(r.rank.grade)}
            </div>
            <div class="report-title-col">
              <span class="report-kicker">TỔNG KẾT PHIÊN LUYỆN TẬP</span>
              <h2 class="report-rank-title" style="color: ${r.rank.color}">${escapeHtml(r.rank.title)}</h2>
              <p class="report-lesson-sub">${escapeHtml(r.title)}</p>
            </div>
          </div>

          <div class="report-metrics-grid">
            <div class="r-metric">
              <span class="r-label">ĐỘ CHÍNH XÁC</span>
              <strong class="r-val mono-val accent-green">${r.accuracyPct}%</strong>
            </div>
            <div class="r-metric">
              <span class="r-label">TỔNG / ĐÚNG / SAI</span>
              <strong class="r-val mono-val">${r.total} · <span class="accent-green">${r.correct}</span> · <span class="accent-red">${r.wrong}</span></strong>
            </div>
            <div class="r-metric">
              <span class="r-label">MAX STREAK</span>
              <strong class="r-val mono-val">${r.maxStreak} nốt</strong>
            </div>
            <div class="r-metric">
              <span class="r-label">PHẢN XẠ TRUNG BÌNH</span>
              <strong class="r-val mono-val accent-cyan">${r.avgReactionSec > 0 ? `${r.avgReactionSec.toFixed(2)} giây / nốt` : '—'}</strong>
              <span class="r-sub">${escapeHtml(r.rank.speedComment)}</span>
            </div>
          </div>

          <div class="report-weak-box">
            <h3 class="report-sec-title">Phân tích điểm yếu (Tối đa 5 nốt)</h3>
            <div class="weak-list">${weakHtml}</div>
          </div>

          <div class="report-actions">
            ${
              this.lastMistakeNotes.length > 0
                ? `<button type="button" class="btn btn-rose-outline btn-lg" id="btn-drill-mistakes">Ôn ngay các nốt vừa sai (${this.lastMistakeNotes.length})</button>`
                : ''
            }
            <button type="button" class="btn btn-cyan-solid btn-lg" id="btn-retry-lesson">Luyện lại bài này</button>
            <button type="button" class="btn btn-ghost btn-lg" id="btn-choose-other">Chọn bài khác</button>
          </div>
        </div>
      </div>
    `;

    const drillMistakesBtn = this.root.querySelector('#btn-drill-mistakes');
    if (drillMistakesBtn) {
      drillMistakesBtn.addEventListener('click', () => {
        this._launchSingleSession({
          mode: 'weak',
          title: `Ôn nốt vừa sai (${this.lastMistakeNotes.length} nốt)`,
          difficulty: 'medium',
          pool: [...this.lastMistakeNotes],
          backView: r.backView,
        });
      });
    }

    this.root.querySelector('#btn-retry-lesson').addEventListener('click', () => {
      if (r.mode === 'scroll' && r.lesson) {
        this._launchScrollSession(r.lesson);
      } else {
        this._launchSingleSession({
          mode: r.mode,
          title: r.title,
          difficulty: r.difficulty,
          pool: r.pool,
          backView: r.backView,
        });
      }
    });

    this.root.querySelector('#btn-choose-other').addEventListener('click', () => {
      this.view = r.backView || 'home';
      this.render();
    });
  }

  // ==========================================================================
  // 8. CHẾ ĐỘ 4: TRA CỨU NỐT TRÊN KHUÔNG NHẠC TƯƠNG TÁC
  // ==========================================================================
  _renderReference() {
    this.root.innerHTML = `
      <div class="trainer-shell">
        <div class="drill-workspace">
          <div class="drill-hud">
            <div class="hud-left">
              <button type="button" class="btn btn-ghost btn-xs" data-nav="home">← Quay lại</button>
              <span class="drill-lesson-title">Tra cứu vị trí nốt trên khuông nhạc</span>
            </div>

            <div class="ref-controls">
              <div class="seg-group" id="ref-clef-group">
                <button type="button" class="seg-btn${this.config.refClef === 'treble' ? ' active' : ''}" data-rclef="treble">Khóa Sol</button>
                <button type="button" class="seg-btn${this.config.refClef === 'bass' ? ' active' : ''}" data-rclef="bass">Khóa Fa</button>
                <button type="button" class="seg-btn${this.config.refClef === 'alto' ? ' active' : ''}" data-rclef="alto">Khóa Đô</button>
              </div>
              <div class="seg-group" id="ref-acc-group">
                <button type="button" class="seg-btn${this.config.refAccidental === 0 ? ' active' : ''}" data-racc="0">Tự nhiên</button>
                <button type="button" class="seg-btn${this.config.refAccidental === 1 ? ' active' : ''}" data-racc="1">Thăng ♯</button>
                <button type="button" class="seg-btn${this.config.refAccidental === -1 ? ' active' : ''}" data-racc="-1">Giáng ♭</button>
              </div>
            </div>
          </div>

          <div class="staff-stage">
            <div id="ref-staff-box" class="staff-box ref-staff-box"></div>
            <div id="ref-info-readout" class="ref-info-readout">
              Bấm trực tiếp vào một nốt trên khuông nhạc hoặc phím đàn bên dưới để tra cứu &amp; nghe tiếng
            </div>
          </div>

          ${this._renderPianoKeyboardHtml()}
        </div>
      </div>
    `;

    this._redrawReferenceStaff();
    this._bindPianoKeyboardEvents();

    this.root.querySelector('[data-nav="home"]').addEventListener('click', () => {
      this.view = 'home';
      this.render();
    });

    this.root.querySelector('#ref-clef-group').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rclef]');
      if (!btn) return;
      this.config.refClef = btn.dataset.rclef;
      this._activeRefNoteKey = null;
      this.root.querySelectorAll('#ref-clef-group .seg-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      this._redrawReferenceStaff();
    });

    this.root.querySelector('#ref-acc-group').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-racc]');
      if (!btn) return;
      this.config.refAccidental = Number(btn.dataset.racc);
      this._activeRefNoteKey = null;
      this.root.querySelectorAll('#ref-acc-group .seg-btn').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      this._redrawReferenceStaff();
    });
  }

  _redrawReferenceStaff() {
    const box = this.root.querySelector('#ref-staff-box');
    if (!box) return;
    this._refNotes = renderReferenceStaff(box, {
      clef: this.config.refClef,
      accidentalFilter: this.config.refAccidental,
      activeNoteKey: this._activeRefNoteKey,
      onSelectNote: (noteObj) => this._selectReferenceNote(noteObj),
    });
  }

  _selectReferenceNote(noteObj) {
    if (!noteObj) return;
    this._activeRefNoteKey = noteObj.key;
    this._redrawReferenceStaff();
    this.audio.playTrainerPiano(noteObj.midi, 0.75).catch(() => {});

    const readout = this.root.querySelector('#ref-info-readout');
    if (readout) {
      const freq = midiToFreq(noteObj.midi).toFixed(1);
      const disp = noteObj.displayName.replace('#', '♯').replace('b', '♭');
      readout.innerHTML = `
        <strong class="mono-val">${disp}</strong>
        <span class="dot-sep">·</span>
        <span>${escapeHtml(noteObj.solfegeVi)}</span>
        <span class="dot-sep">·</span>
        <span class="accent-cyan">${escapeHtml(noteObj.staffPositionText)} (${CLEF_META[noteObj.clef]?.label || ''})</span>
        <span class="dot-sep">·</span>
        <span class="mono-val">${freq} Hz</span>
      `;
    }
  }

  // ==========================================================================
  // 9. BÀN PHÍM PIANO 12 PHÍM TƯƠNG TÁC (DESKTOP + TOUCH MOBILE)
  // ==========================================================================
  _renderPianoKeyboardHtml() {
    const showLbl = this.config.showKeyLabels;
    const whites = PIANO_KEYS_12.filter((k) => !k.isBlack);
    const blacks = PIANO_KEYS_12.filter((k) => k.isBlack);

    const whiteHtml = whites
      .map(
        (k) => `
      <button type="button" class="piano-key white-key" data-pc="${k.pc}" aria-label="${k.label}">
        <span class="pk-kbd desktop-only">${k.kbd}</span>
        <span class="pk-name${showLbl ? '' : ' hidden'}">${k.short}</span>
      </button>
    `
      )
      .join('');

    const blackHtml = blacks
      .map((k) => {
        const leftPct = ((k.pos / 7) * 100).toFixed(4);
        return `
        <button type="button" class="piano-key black-key" data-pc="${k.pc}" style="left: ${leftPct}%" aria-label="${k.label}">
          <span class="pk-kbd desktop-only">${k.kbd}</span>
          <span class="pk-name${showLbl ? '' : ' hidden'}">${k.short}</span>
        </button>
      `;
      })
      .join('');

    return `
      <div class="trainer-piano-dock">
        <div class="piano-keyboard" id="trainer-piano-keyboard" role="group" aria-label="Bàn phím Piano 12 nốt">
          <div class="white-keys-layer">${whiteHtml}</div>
          <div class="black-keys-layer">${blackHtml}</div>
        </div>
      </div>
    `;
  }

  _bindPianoKeyboardEvents() {
    const kb = this.root.querySelector('#trainer-piano-keyboard');
    if (!kb) return;
    kb.addEventListener('pointerdown', (e) => {
      const keyBtn = e.target.closest('[data-pc]');
      if (!keyBtn) return;
      e.preventDefault();
      const pc = Number(keyBtn.dataset.pc);
      this._handlePianoKeyInput(pc, keyBtn);
    });
  }

  _syncPianoKeyLabels() {
    this.root.querySelectorAll('.piano-key .pk-name').forEach((el) => {
      el.classList.toggle('hidden', !this.config.showKeyLabels);
    });
  }

  _flashPianoKey(keyEl, stateClass) {
    if (!keyEl) return;
    keyEl.classList.remove('key-correct', 'key-wrong', 'key-active');
    void keyEl.offsetWidth;
    keyEl.classList.add(`key-${stateClass}`);
    clearTimeout(keyEl._flashTimer);
    keyEl._flashTimer = setTimeout(() => {
      keyEl.classList.remove(`key-${stateClass}`);
    }, 220);
  }

  _handlePianoKeyInput(pc, explicitEl = null) {
    const keyEl =
      explicitEl || this.root.querySelector(`#trainer-piano-keyboard [data-pc="${pc}"]`);

    if (this.view === 'drill-single') {
      this._handleSingleNoteAnswer(pc, keyEl);
    } else if (this.view === 'drill-scroll') {
      this._handleScrollNoteAnswer(pc, keyEl);
    } else if (this.view === 'reference') {
      this._flashPianoKey(keyEl, 'active');
      // Tìm nốt khớp pitchClass gần nhất trong danh sách Tra cứu đang mở
      const match = this._refNotes.find((n) => n.pitchClass === pc);
      if (match) {
        this._selectReferenceNote(match);
      } else {
        this.audio.playTrainerPiano(60 + pc, 0.7).catch(() => {});
      }
    }
  }

  // ==========================================================================
  // 10. PHÒNG LUYỆN ĐÀN PIANO TƯƠNG TÁC ĐA CHẾ ĐỘ (HYBRID WEB MIDI & ON-SCREEN)
  // ==========================================================================
  _renderDeviceBarHtml() {
    const devStatus = this.midi
      ? this.midi.getDeviceStatus()
      : { connected: false, label: 'Chế độ: Phím ảo & Bàn phím PC' };
    const rangeLbl = this.midi ? this.midi.getOctaveRangeLabel() : 'C3–B5';
    const octShift = this.midi ? this.midi.octaveShift : 0;
    const qwertyOn = this.midi ? this.midi.qwertyEnabled : true;
    const latchOn = this.midi ? this.midi.chordLatchEnabled : false;
    const latchedCount = this.midi ? this.midi.latchedNotes.size : 0;

    return `
      <div class="trainer-device-bar">
        <div class="device-bar-left">
          <div id="midi-status-pill" class="midi-status-pill${devStatus.connected ? ' connected' : ''}">
            <span id="midi-signal-led" class="midi-signal-led" aria-hidden="true"></span>
            <span id="midi-status-text">${escapeHtml(devStatus.label)}</span>
          </div>
        </div>

        <div class="device-bar-controls">
          <label class="device-ctrl-item" title="Chọn âm sắc đàn luyện tập">
            <span class="device-ctrl-lbl">Tiếng đàn</span>
            <select id="trainer-timbre-select" class="studio-select compact" aria-label="Tiếng đàn luyện tập">
              <option value="grand"${this.pianoConfig.timbre === 'grand' ? ' selected' : ''}>Grand Piano</option>
              <option value="rhodes"${this.pianoConfig.timbre === 'rhodes' ? ' selected' : ''}>Rhodes / EP Ấm</option>
              <option value="pad"${this.pianoConfig.timbre === 'pad' ? ' selected' : ''}>Soft Pad</option>
            </select>
          </label>

          <div class="octave-ctrl-group" role="group" aria-label="Dịch quãng tám bàn phím">
            <button type="button" id="btn-oct-down" class="btn-mini-pill" ${octShift <= -1 ? 'disabled' : ''} title="Dịch xuống 1 quãng tám">Oct -1</button>
            <span id="trainer-octave-badge" class="octave-badge mono-val">${rangeLbl}</span>
            <button type="button" id="btn-oct-up" class="btn-mini-pill" ${octShift >= 1 ? 'disabled' : ''} title="Dịch lên 1 quãng tám">Oct +1</button>
          </div>

          <button type="button" id="btn-qwerty-toggle" class="toggle-pill desktop-only${qwertyOn ? ' active' : ''}" aria-pressed="${qwertyOn}" title="Bật/Tắt gõ phím máy tính Z-M & Q-U">
            <span>Phím PC: ${qwertyOn ? 'Bật' : 'Tắt'}</span>
          </button>

          <button type="button" id="btn-chord-latch" class="toggle-pill${latchOn ? ' active' : ''}" aria-pressed="${latchOn}" title="Giữ sáng &amp; ngân từng nốt bấm bằng chuột để ghép hợp âm">
            <span>Giữ phím ghép hợp âm</span>
          </button>

          <button type="button" id="btn-clear-latch" class="btn btn-rose-outline btn-xs${latchedCount > 0 ? '' : ' hidden'}" title="Nhả toàn bộ phím đang giữ">
            Nhả phím (${latchedCount})
          </button>
        </div>
      </div>
    `;
  }

  _renderTopSectionTabsHtml() {
    const isPiano = this.view === 'piano-room';
    const isEar = this.view === 'ear-training';
    const isStaff = !isPiano && !isEar;
    return `
      <div class="trainer-top-tabs trainer-tabs-3" role="tablist" aria-label="Phân mục Học nhạc lý">
        <button type="button" class="seg-btn${isPiano ? ' active' : ''}" data-trainer-top="piano-room" role="tab" aria-selected="${isPiano}">
          🎹 Phòng Đàn Piano
        </button>
        <button type="button" class="seg-btn${isEar ? ' active' : ''}" data-trainer-top="ear-training" role="tab" aria-selected="${isEar}">
          🎧 Cảm Âm Hợp Âm
        </button>
        <button type="button" class="seg-btn${isStaff ? ' active' : ''}" data-trainer-top="home" role="tab" aria-selected="${isStaff}">
          🎼 Đọc Khuông Nhạc
        </button>
      </div>
    `;
  }

  _bindTopSectionTabsEvents() {
    this.root.querySelectorAll('[data-trainer-top]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.trainerTop;
        if (next === this.view) return;
        this.stopActiveSession();
        if (next === 'ear-training') {
          this.view = 'ear-training';
          if (!this.earState.question) {
            this.earState.question = generateEarQuestion({
              mode: this.earState.mode,
              difficulty: this.earState.difficulty,
            });
          }
        } else {
          this.view = next === 'home' ? 'home' : 'piano-room';
        }
        this.render();
      });
    });
  }

  _bindDeviceBarEvents() {
    const timbreSel = this.root.querySelector('#trainer-timbre-select');
    if (timbreSel) {
      timbreSel.addEventListener('change', (e) => {
        this.pianoConfig.timbre = e.target.value;
        this.audio.setTrainerTimbre(this.pianoConfig.timbre);
      });
    }

    const octDown = this.root.querySelector('#btn-oct-down');
    if (octDown && this.midi) {
      octDown.addEventListener('click', () => {
        this.midi.setOctaveShift(this.midi.octaveShift - 1);
      });
    }
    const octUp = this.root.querySelector('#btn-oct-up');
    if (octUp && this.midi) {
      octUp.addEventListener('click', () => {
        this.midi.setOctaveShift(this.midi.octaveShift + 1);
      });
    }

    const qwertyBtn = this.root.querySelector('#btn-qwerty-toggle');
    if (qwertyBtn && this.midi) {
      qwertyBtn.addEventListener('click', () => {
        const next = !this.midi.qwertyEnabled;
        this.midi.setQwertyEnabled(next);
        qwertyBtn.classList.toggle('active', next);
        qwertyBtn.setAttribute('aria-pressed', String(next));
        const span = qwertyBtn.querySelector('span');
        if (span) span.textContent = `Phím PC: ${next ? 'Bật' : 'Tắt'}`;
      });
    }

    const latchBtn = this.root.querySelector('#btn-chord-latch');
    if (latchBtn && this.midi) {
      latchBtn.addEventListener('click', () => {
        const next = !this.midi.chordLatchEnabled;
        this.midi.setChordLatch(next);
        latchBtn.classList.toggle('active', next);
        latchBtn.setAttribute('aria-pressed', String(next));
      });
    }

    const clearLatchBtn = this.root.querySelector('#btn-clear-latch');
    if (clearLatchBtn && this.midi) {
      clearLatchBtn.addEventListener('click', () => {
        this.midi.clearLatchedNotes();
      });
    }
  }

  _updateDeviceBarStatus() {
    const statusPill = this.root.querySelector('#midi-status-pill');
    const statusText = this.root.querySelector('#midi-status-text');
    const octBadge = this.root.querySelector('#trainer-octave-badge');
    const octDown = this.root.querySelector('#btn-oct-down');
    const octUp = this.root.querySelector('#btn-oct-up');
    if (!this.midi) return;

    const st = this.midi.getDeviceStatus();
    if (statusPill) statusPill.classList.toggle('connected', st.connected);
    if (statusText) statusText.textContent = st.label;
    if (octBadge) octBadge.textContent = this.midi.getOctaveRangeLabel();
    if (octDown) octDown.disabled = this.midi.octaveShift <= -1;
    if (octUp) octUp.disabled = this.midi.octaveShift >= 1;
  }

  _flashMidiSignalLed() {
    const led = this.root.querySelector('#midi-signal-led');
    if (!led) return;
    led.classList.add('is-pulse');
    clearTimeout(this._signalLedTimer);
    this._signalLedTimer = setTimeout(() => {
      if (led.isConnected) led.classList.remove('is-pulse');
    }, 150);
  }

  _renderPianoRoom() {
    this._stopChordWaitTimers();
    this._stopFallingLoop();
    this.audio.setTrainerTimbre(this.pianoConfig.timbre);

    const subModeHtml =
      this.pianoSubMode === 'chord-wait'
        ? this._renderChordWaitPanelHtml()
        : this.pianoSubMode === 'falling'
          ? this._renderFallingControlsHtml()
          : this._renderFreePlayHudHtml();

    const fallingCanvasHtml =
      this.pianoSubMode === 'falling'
        ? `
          <div class="falling-stage-wrap">
            <canvas id="falling-notes-canvas" aria-label="Sân khấu nốt rơi luyện giai điệu"></canvas>
            <div class="falling-hit-hint" id="falling-status-overlay">
              Bấm <strong>Bắt đầu</strong> rồi chạm phím đàn đúng thời điểm nốt rơi chạm vạch
            </div>
          </div>
        `
        : '';

    this.root.innerHTML = `
      <div class="trainer-shell">
        ${this._renderDeviceBarHtml()}
        ${this._renderTopSectionTabsHtml()}

        <div class="piano-room-wrap">
          <div class="piano-submode-bar">
            <div class="seg-group piano-submode-tabs" role="tablist" aria-label="Chế độ luyện đàn Piano">
              <button type="button" class="seg-btn${this.pianoSubMode === 'free' ? ' active' : ''}" data-piano-submode="free">
                Chơi tự do &amp; Dò Hợp âm
              </button>
              <button type="button" class="seg-btn${this.pianoSubMode === 'chord-wait' ? ' active' : ''}" data-piano-submode="chord-wait">
                Luyện Đệm Hợp Âm
              </button>
              <button type="button" class="seg-btn${this.pianoSubMode === 'falling' ? ' active' : ''}" data-piano-submode="falling">
                Nốt Rơi (Synthesia)
              </button>
            </div>
          </div>

          <div class="piano-mode-stage">${subModeHtml}</div>

          <div class="hybrid-kb-shell">
            <div class="mobile-kb-nav mobile-only" aria-label="Chuyển quãng trên Mobile">
              <div class="mobile-kb-oct-pills">
                <button type="button" class="btn-mini-pill" data-mobile-kb-jump="0">Quãng thấp</button>
                <button type="button" class="btn-mini-pill active" data-mobile-kb-jump="0.45">Quãng giữa</button>
                <button type="button" class="btn-mini-pill" data-mobile-kb-jump="1">Quãng cao</button>
              </div>
              <input type="range" id="mobile-kb-scroll" class="studio-range" min="0" max="100" value="35" aria-label="Cuộn ngang dải phím Piano" />
            </div>

            <div class="hybrid-kb-viewport" id="hybrid-kb-viewport">
              <div class="hybrid-piano-scroll-inner" id="hybrid-piano-scroll-inner">
                ${fallingCanvasHtml}
                ${this._renderHybridKeyboardHtml()}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindDeviceBarEvents();
    this._bindTopSectionTabsEvents();
    this._bindPianoRoomEvents();
    this._bindHybridKeyboardEvents();
    this._syncKeyboardScaleAndTargets();

    if (this.pianoSubMode === 'free') {
      this._updateLiveChordHud();
    } else if (this.pianoSubMode === 'chord-wait') {
      this._syncChordWaitUI();
    } else if (this.pianoSubMode === 'falling') {
      this._prepareFallingSong(this.falling.song, false);
      requestAnimationFrame(() => this._drawFallingNotesFrame());
    }

    // Tự căn giữa nhẹ dải phím trên Mobile để thấy ngay quãng C4 giữa đàn
    const vp = this.root.querySelector('#hybrid-kb-viewport');
    const scroller = this.root.querySelector('#mobile-kb-scroll');
    if (vp && window.innerWidth <= 768) {
      requestAnimationFrame(() => {
        const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth);
        vp.scrollLeft = Math.round(maxScroll * 0.36);
        if (scroller) scroller.value = '36';
      });
    }
  }

  _renderFreePlayHudHtml() {
    const keyOpts = KEY_OPTIONS.map(
      (k) => `<option value="${k.pc}"${k.pc === this.pianoConfig.scaleKeyPc ? ' selected' : ''}>${k.label}</option>`
    ).join('');
    const sustainDown = this.midi ? this.midi.sustainDown : false;

    return `
      <div class="free-play-hud">
        <div id="live-chord-display" class="live-chord-display">
          <div class="live-chord-main">
            <span class="live-chord-kicker">NHẬN DIỆN HỢP ÂM SỐNG</span>
            <div class="live-chord-symbol-row">
              <strong id="live-chord-symbol" class="live-chord-symbol">—</strong>
              <span id="live-sustain-badge" class="sustain-badge${sustainDown ? '' : ' hidden'}">SUSTAIN ON</span>
            </div>
            <span id="live-chord-quality" class="live-chord-quality">Bấm đàn MIDI, gõ phím PC (Z–M / Q–U) hoặc chạm nhiều phím để dò hợp âm</span>
          </div>
          <div id="live-chord-notes" class="live-chord-notes"></div>
        </div>

        <div class="scale-guide-panel">
          <div class="scale-guide-head">
            <span class="scale-guide-title">TÔ SÁNG ÂM GIAI (SCALE GUIDE)</span>
            <label class="mini-check accent-check">
              <input type="checkbox" id="pt-scale-guide-toggle" ${this.pianoConfig.showScaleGuide ? 'checked' : ''} />
              <span>Hiện gợi ý nốt đúng tông</span>
            </label>
          </div>
          <div class="scale-guide-controls">
            <label class="inline-field">
              <span class="inline-label">Tông</span>
              <select id="pt-scale-key" class="studio-select compact" aria-label="Chọn tông Scale Guide">${keyOpts}</select>
            </label>
            <label class="inline-field">
              <span class="inline-label">Âm giai</span>
              <select id="pt-scale-type" class="studio-select compact" aria-label="Chọn âm giai Scale Guide">
                <option value="major"${this.pianoConfig.scaleType === 'major' ? ' selected' : ''}>Trưởng (Major)</option>
                <option value="minor"${this.pianoConfig.scaleType === 'minor' ? ' selected' : ''}>Thứ (Minor)</option>
              </select>
            </label>
          </div>
          <p class="scale-guide-tip">Nốt có dấu chấm trắng là âm chủ (Root), chấm mờ là các nốt nằm trong âm giai.</p>
        </div>
      </div>
    `;
  }

  _renderChordWaitPanelHtml() {
    const cp = this.chordPractice;
    const allProgs = cp.customProgression
      ? [cp.customProgression, ...PIANO_CHORD_PROGRESSIONS]
      : PIANO_CHORD_PROGRESSIONS;

    const progOpts = allProgs
      .map((p) => `<option value="${p.id}"${p.id === cp.progression.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`)
      .join('');

    const cardsHtml = cp.progression.chords
      .map(
        (ch, idx) => `
      <div class="cw-chord-card${idx === cp.barIndex ? ' active' : ''}" data-cw-bar="${idx}">
        <div class="cw-card-top">
          <span class="cw-bar-lbl">Ô ${idx + 1}</span>
          ${ch.roman ? `<span class="cw-roman mono-val">${escapeHtml(ch.roman)}</span>` : ''}
        </div>
        <strong class="cw-symbol">${escapeHtml(ch.symbol)}</strong>
        <span class="cw-notes-sub mono-val">${escapeHtml(ch.noteLabels.join(' · '))}</span>
      </div>
    `
      )
      .join('');

    return `
      <div class="chord-wait-panel">
        <div class="cw-toolbar">
          <div class="cw-toolbar-left">
            <label class="inline-field">
              <span class="inline-label">Vòng hợp âm</span>
              <select id="cw-prog-select" class="studio-select compact" aria-label="Chọn vòng hợp âm luyện tập">${progOpts}</select>
            </label>
            <button type="button" id="btn-import-studio-chords" class="btn btn-indigo-outline btn-xs">
              Lấy vòng hợp âm từ Sáng tác Beat
            </button>
          </div>

          <div class="cw-toolbar-right">
            <div class="seg-group" id="cw-rhythm-group" role="group" aria-label="Kiểu luyện hợp âm">
              <button type="button" class="seg-btn${cp.rhythmMode === 'wait' ? ' active' : ''}" data-cw-mode="wait">Chờ bấm đúng</button>
              <button type="button" class="seg-btn${cp.rhythmMode === 'metronome' ? ' active' : ''}" data-cw-mode="metronome">Chạy theo nhịp</button>
            </div>
            <label class="cw-bpm-wrap${cp.rhythmMode === 'metronome' ? '' : ' hidden'}" id="cw-bpm-wrap">
              <span class="inline-label">BPM <strong id="cw-bpm-val" class="mono-val">${cp.bpm}</strong></span>
              <input type="range" id="cw-bpm-slider" class="studio-range" min="50" max="135" value="${cp.bpm}" aria-label="Tốc độ nhịp luyện hợp âm" />
            </label>
          </div>
        </div>

        <div class="cw-status-row">
          <div id="cw-target-callout" class="cw-target-callout">
            <span class="cw-prompt-lbl">HỢP ÂM CẦN BẤM:</span>
            <strong id="cw-target-symbol" class="cw-target-symbol">—</strong>
            <div id="cw-required-notes" class="cw-required-notes"></div>
          </div>
          <div class="cw-progress-badge">
            <span>ĐÃ HOÀN THÀNH</span>
            <strong id="cw-completed-val" class="mono-val">${cp.completedCount} hợp âm</strong>
          </div>
        </div>

        <div id="cw-chord-strip" class="cw-chord-strip">${cardsHtml}</div>
      </div>
    `;
  }

  _renderFallingControlsHtml() {
    const fn = this.falling;
    const allSongs = fn.customSong ? [fn.customSong, ...FALLING_NOTES_SONGS] : FALLING_NOTES_SONGS;
    const songOpts = allSongs
      .map((s) => `<option value="${s.id}"${s.id === fn.song.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`)
      .join('');

    const totalAttempts = fn.correctHits + fn.wrongHits;
    const accPct = totalAttempts > 0 ? Math.round((fn.correctHits / totalAttempts) * 100) : 100;

    return `
      <div class="falling-controls-panel">
        <div class="fn-row">
          <div class="fn-left">
            <label class="inline-field">
              <span class="inline-label">Bài luyện</span>
              <select id="fn-song-select" class="studio-select compact" aria-label="Chọn bài tập nốt rơi">${songOpts}</select>
            </label>
            <button type="button" id="btn-import-studio-melody" class="btn btn-indigo-outline btn-xs">
              Nạp giai điệu từ Sáng tác Beat
            </button>
          </div>

          <div class="fn-actions">
            <button type="button" id="btn-fn-play" class="btn btn-cyan-solid btn-xs">
              ${fn.playing ? 'Tạm dừng' : fn.finished ? 'Chơi lại' : 'Bắt đầu'}
            </button>
            <button type="button" id="btn-fn-reset" class="btn btn-ghost btn-xs">Đặt lại</button>
          </div>
        </div>

        <div class="fn-row fn-metrics-row">
          <div class="fn-settings">
            <label class="fn-speed-ctrl">
              <span class="inline-label">Tốc độ <strong id="fn-speed-val" class="mono-val">${fn.speedPct}%</strong></span>
              <input type="range" id="fn-speed-slider" class="studio-range" min="50" max="100" step="5" value="${fn.speedPct}" aria-label="Tốc độ bài nốt rơi" />
            </label>
            <label class="mini-check accent-check">
              <input type="checkbox" id="chk-fn-wait" ${fn.waitMode ? 'checked' : ''} />
              <span>Chờ bấm đúng từng nốt</span>
            </label>
          </div>

          <div class="fn-stats-pills">
            <span class="fn-stat-chip">Chuẩn: <strong id="fn-accuracy-val" class="mono-val accent-green">${accPct}%</strong></span>
            <span class="fn-stat-chip">Tiến độ: <strong id="fn-progress-val" class="mono-val">${fn.correctHits}/${fn.notes.length}</strong></span>
          </div>
        </div>
      </div>
    `;
  }

  _renderHybridKeyboardHtml() {
    const baseMidi = this.midi ? this.midi.baseMidi : 48;
    const totalSemis = 36; // 3 quãng tám (C..B x 3)
    const keys = [];
    let whiteCount = 0;

    for (let i = 0; i < totalSemis; i++) {
      const midi = baseMidi + i;
      const pc = ((midi % 12) + 12) % 12;
      const isBlack = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
      const kbd = getQwertyLabelForMidi(midi, baseMidi);
      const noteLabel = pc === 0 ? midiToNoteName(midi, false) : midiToNoteName(midi, false).replace(/\d+$/, '');
      if (!isBlack) {
        keys.push({ midi, pc, isBlack: false, whiteIndex: whiteCount, kbd, noteLabel });
        whiteCount += 1;
      } else {
        keys.push({ midi, pc, isBlack: true, leftWhiteAnchor: whiteCount, kbd, noteLabel });
      }
    }

    this._keyGeometry.clear();
    const whiteW = 1 / whiteCount;
    const blackW = whiteW * 0.62;

    const whiteHtml = keys
      .filter((k) => !k.isBlack)
      .map((k) => {
        this._keyGeometry.set(k.midi, {
          xRatio: k.whiteIndex * whiteW,
          wRatio: whiteW,
          isBlack: false,
        });
        return `
          <button type="button" class="h-key white" data-midi="${k.midi}" data-pc="${k.pc}" aria-label="${midiToNoteName(k.midi, false)}">
            ${k.kbd ? `<span class="h-key-kbd desktop-only">${k.kbd}</span>` : ''}
            <span class="h-key-lbl${k.pc === 0 ? ' is-c' : ''}">${k.noteLabel}</span>
          </button>
        `;
      })
      .join('');

    const blackHtml = keys
      .filter((k) => k.isBlack)
      .map((k) => {
        const leftPct = ((k.leftWhiteAnchor - 0.31) * whiteW * 100).toFixed(4);
        const widthPct = (blackW * 100).toFixed(4);
        this._keyGeometry.set(k.midi, {
          xRatio: (k.leftWhiteAnchor - 0.31) * whiteW,
          wRatio: blackW,
          isBlack: true,
        });
        return `
          <button type="button" class="h-key black" data-midi="${k.midi}" data-pc="${k.pc}" style="left: ${leftPct}%; width: ${widthPct}%" aria-label="${midiToNoteName(k.midi, false)}">
            ${k.kbd ? `<span class="h-key-kbd desktop-only">${k.kbd}</span>` : ''}
          </button>
        `;
      })
      .join('');

    return `
      <div class="hybrid-piano-keyboard" id="hybrid-piano-keyboard" role="group" aria-label="Bàn phím Piano tương tác 3 quãng tám">
        <div class="h-whites-layer">${whiteHtml}</div>
        <div class="h-blacks-layer">${blackHtml}</div>
      </div>
    `;
  }

  _rebuildHybridKeyboard() {
    const inner = this.root.querySelector('#hybrid-piano-scroll-inner');
    const oldKb = this.root.querySelector('#hybrid-piano-keyboard');
    if (!inner || !oldKb) return;
    oldKb.outerHTML = this._renderHybridKeyboardHtml();
    this._bindHybridKeyboardEvents();
    this._syncKeyboardScaleAndTargets();
    if (this.pianoSubMode === 'falling') {
      this._drawFallingNotesFrame();
    }
  }

  _bindPianoRoomEvents() {
    this.root.querySelectorAll('[data-piano-submode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.pianoSubmode;
        if (!next || next === this.pianoSubMode) return;
        this._stopChordWaitTimers();
        this._stopFallingLoop();
        this.falling.playing = false;
        if (this.midi) this.midi.releaseAll();
        this.pianoSubMode = next;
        this._renderPianoRoom();
      });
    });

    // Mobile octave jump & scroll slider
    const vp = this.root.querySelector('#hybrid-kb-viewport');
    const scroller = this.root.querySelector('#mobile-kb-scroll');
    if (vp && scroller) {
      scroller.addEventListener('input', (e) => {
        const ratio = Number(e.target.value) / 100;
        const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth);
        vp.scrollLeft = Math.round(maxScroll * ratio);
      });
      vp.addEventListener(
        'scroll',
        () => {
          const maxScroll = Math.max(1, vp.scrollWidth - vp.clientWidth);
          scroller.value = String(Math.round((vp.scrollLeft / maxScroll) * 100));
        },
        { passive: true }
      );
      this.root.querySelectorAll('[data-mobile-kb-jump]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ratio = Number(btn.dataset.mobileKbJump) || 0;
          const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth);
          const targetLeft = Math.round(maxScroll * ratio);
          vp.scrollLeft = targetLeft;
          scroller.value = String(maxScroll > 0 ? Math.round((targetLeft / maxScroll) * 100) : 0);
          this.root.querySelectorAll('[data-mobile-kb-jump]').forEach((b) =>
            b.classList.toggle('active', b === btn)
          );
        });
      });
    }

    if (this.pianoSubMode === 'free') {
      const toggle = this.root.querySelector('#pt-scale-guide-toggle');
      const keySel = this.root.querySelector('#pt-scale-key');
      const typeSel = this.root.querySelector('#pt-scale-type');
      if (toggle) {
        toggle.addEventListener('change', (e) => {
          this.pianoConfig.showScaleGuide = e.target.checked;
          this._syncKeyboardScaleAndTargets();
        });
      }
      if (keySel) {
        keySel.addEventListener('change', (e) => {
          this.pianoConfig.scaleKeyPc = Number(e.target.value);
          this._syncKeyboardScaleAndTargets();
          this._updateLiveChordHud();
        });
      }
      if (typeSel) {
        typeSel.addEventListener('change', (e) => {
          this.pianoConfig.scaleType = e.target.value;
          this._syncKeyboardScaleAndTargets();
          this._updateLiveChordHud();
        });
      }
    } else if (this.pianoSubMode === 'chord-wait') {
      const progSel = this.root.querySelector('#cw-prog-select');
      const impBtn = this.root.querySelector('#btn-import-studio-chords');
      const bpmSlider = this.root.querySelector('#cw-bpm-slider');
      const bpmWrap = this.root.querySelector('#cw-bpm-wrap');

      if (progSel) {
        progSel.addEventListener('change', (e) => {
          const id = e.target.value;
          const cp = this.chordPractice;
          const all = cp.customProgression
            ? [cp.customProgression, ...PIANO_CHORD_PROGRESSIONS]
            : PIANO_CHORD_PROGRESSIONS;
          const found = all.find((p) => p.id === id) || PIANO_CHORD_PROGRESSIONS[0];
          this._loadChordPracticeProgression(found);
        });
      }
      if (impBtn) {
        impBtn.addEventListener('click', () => {
          const ctx = this.getStudioContext ? this.getStudioContext() : null;
          if (!ctx || !Array.isArray(ctx.voicedChords) || ctx.voicedChords.length === 0) {
            this.showToast('Chưa có vòng hợp âm bên tab Sáng tác Beat.', true);
            return;
          }
          const custom = buildPracticeChordsFromStudio(ctx.voicedChords, ctx.keyPc, ctx.scaleType);
          if (!custom) return;
          custom.bpm = ctx.bpm || 80;
          this.chordPractice.customProgression = custom;
          this._loadChordPracticeProgression(custom);
          this._renderPianoRoom();
          this.showToast(`Đã nạp vòng hợp âm: ${custom.desc}`);
        });
      }
      this.root.querySelectorAll('[data-cw-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.cwMode === 'metronome' ? 'metronome' : 'wait';
          this.chordPractice.rhythmMode = mode;
          this.root.querySelectorAll('[data-cw-mode]').forEach((b) =>
            b.classList.toggle('active', b === btn)
          );
          if (bpmWrap) bpmWrap.classList.toggle('hidden', mode !== 'metronome');
          this._stopChordWaitTimers();
          if (mode === 'metronome') {
            this._startChordMetronomeLoop();
          }
        });
      });
      if (bpmSlider) {
        bpmSlider.addEventListener('input', (e) => {
          this.chordPractice.bpm = Number(e.target.value) || 80;
          const valEl = this.root.querySelector('#cw-bpm-val');
          if (valEl) valEl.textContent = String(this.chordPractice.bpm);
          if (this.chordPractice.rhythmMode === 'metronome') {
            this._stopChordWaitTimers();
            this._startChordMetronomeLoop();
          }
        });
      }
    } else if (this.pianoSubMode === 'falling') {
      const songSel = this.root.querySelector('#fn-song-select');
      const impBtn = this.root.querySelector('#btn-import-studio-melody');
      const playBtn = this.root.querySelector('#btn-fn-play');
      const resetBtn = this.root.querySelector('#btn-fn-reset');
      const speedSlider = this.root.querySelector('#fn-speed-slider');
      const waitChk = this.root.querySelector('#chk-fn-wait');

      if (songSel) {
        songSel.addEventListener('change', (e) => {
          const id = e.target.value;
          const fn = this.falling;
          const all = fn.customSong ? [fn.customSong, ...FALLING_NOTES_SONGS] : FALLING_NOTES_SONGS;
          const found = all.find((s) => s.id === id) || FALLING_NOTES_SONGS[0];
          this._prepareFallingSong(found, true);
        });
      }
      if (impBtn) {
        impBtn.addEventListener('click', () => {
          const ctx = this.getStudioContext ? this.getStudioContext() : null;
          const imported = ctx ? buildFallingSongFromStudio(ctx) : null;
          if (!imported) {
            this.showToast('Tab Sáng tác Beat chưa có nốt giai điệu MIDI nào. Hãy chấm hoặc ngân nga vài nốt trước!', true);
            return;
          }
          this.falling.customSong = imported;
          this._prepareFallingSong(imported, false);
          this._renderPianoRoom();
          this.showToast(`Đã nạp ${imported.notes.length} nốt MIDI từ Sáng tác Beat!`);
        });
      }
      if (playBtn) {
        playBtn.addEventListener('click', () => {
          this.audio.unlockSync();
          if (this.falling.finished) {
            this._prepareFallingSong(this.falling.song, true);
            this._startFallingLoop();
          } else if (this.falling.playing) {
            this._pauseFallingNotes();
          } else {
            this._startFallingLoop();
          }
        });
      }
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this._prepareFallingSong(this.falling.song, true);
        });
      }
      if (speedSlider) {
        speedSlider.addEventListener('input', (e) => {
          this.falling.speedPct = Number(e.target.value) || 85;
          const elVal = this.root.querySelector('#fn-speed-val');
          if (elVal) elVal.textContent = `${this.falling.speedPct}%`;
        });
      }
      if (waitChk) {
        waitChk.addEventListener('change', (e) => {
          this.falling.waitMode = e.target.checked;
          if (!this.falling.waitMode) {
            this.falling.waitingForNote = null;
            this._syncKeyboardScaleAndTargets();
          }
        });
      }
    }
  }

  _bindHybridKeyboardEvents() {
    const kb = this.root.querySelector('#hybrid-piano-keyboard');
    if (!kb) return;

    this._keyElByMidi.clear();
    kb.querySelectorAll('.h-key[data-midi]').forEach((el) => {
      const m = Number(el.dataset.midi);
      if (Number.isFinite(m)) this._keyElByMidi.set(m, el);
    });

    // Cảm ứng đa điểm mượt mà (nhiều ngón bấm hợp âm đồng thời qua pointerId riêng biệt)
    kb.addEventListener('pointerdown', (e) => {
      const keyEl = e.target.closest('.h-key[data-midi]');
      if (!keyEl || !this.midi) return;
      if (e.cancelable) e.preventDefault();
      this.audio.unlockSync();
      try { keyEl.setPointerCapture(e.pointerId); } catch (_) {}
      const midi = Number(keyEl.dataset.midi);
      this.midi.pointerNoteOn(e.pointerId, midi, 0.86);
    });

    const onRelease = (e) => {
      if (!this.midi) return;
      this.midi.pointerNoteOff(e.pointerId);
    };
    kb.addEventListener('pointerup', onRelease);
    kb.addEventListener('pointercancel', onRelease);
    kb.addEventListener('lostpointercapture', onRelease);
  }

  _syncKeyboardScaleAndTargets() {
    if (!this._keyElByMidi || this._keyElByMidi.size === 0) return;
    const guide = getScaleGuideInfo(this.pianoConfig.scaleKeyPc, this.pianoConfig.scaleType);
    const showGuide = this.pianoSubMode === 'free' && this.pianoConfig.showScaleGuide;

    const cwTarget =
      this.pianoSubMode === 'chord-wait' && this.chordPractice.progression
        ? this.chordPractice.progression.chords[this.chordPractice.barIndex]
        : null;
    const cwMidis = cwTarget ? new Set(cwTarget.midis) : null;
    const cwPcs = cwTarget ? new Set(cwTarget.pitchClasses) : null;
    const fnWaitMidi =
      this.pianoSubMode === 'falling' && this.falling.waitingForNote
        ? this.falling.waitingForNote.midi
        : null;

    this._keyElByMidi.forEach((el, midi) => {
      const pc = ((midi % 12) + 12) % 12;
      const inScale = showGuide && guide.scaleSet.has(pc);
      const isRoot = showGuide && pc === guide.keyPc;

      let isTarget = false;
      if (cwMidis && cwPcs) {
        // Ưu tiên sáng đúng thế bấm trong quãng chính, hoặc đánh dấu nốt cùng Pitch Class nếu khác quãng
        isTarget = cwMidis.has(midi) || (!cwMidis.size && cwPcs.has(pc));
      } else if (fnWaitMidi !== null) {
        isTarget = midi === fnWaitMidi || (!this._keyElByMidi.has(fnWaitMidi) && pc === ((fnWaitMidi % 12) + 12) % 12);
      }

      el.classList.toggle('in-scale', inScale);
      el.classList.toggle('scale-root', isRoot);
      el.classList.toggle('is-target', isTarget);
    });
  }

  _onUnifiedNoteOn(evt) {
    if (!evt || !Number.isFinite(evt.midi)) return;
    if (!this.isSectionActive) return;

    if (this.view === 'piano-room') {
      this.audio.trainerNoteOn(evt.midi, evt.velocity, this.pianoConfig.timbre).catch(() => {});
      if (this.pianoSubMode === 'falling' && this.falling.playing) {
        this._handleFallingNoteInput(evt.midi);
      }
      return;
    }

    // Trong các bài Đọc Khuông Nhạc cũ -> bàn phím USB-MIDI thật vẫn hoạt động mượt mà
    if (evt.source === 'midi') {
      const pc = ((Math.round(evt.midi) % 12) + 12) % 12;
      this._handlePianoKeyInput(pc);
    }
  }

  _onUnifiedNoteOff(evt) {
    if (!evt || !Number.isFinite(evt.midi)) return;
    this.audio.trainerNoteOff(evt.midi);
  }

  _onUnifiedActiveChange(snap) {
    const activeSet = new Set(snap.activeMidis || []);
    const latchSet = new Set(snap.latchedMidis || []);

    const clearBtn = this.root.querySelector('#btn-clear-latch');
    if (clearBtn) {
      clearBtn.classList.toggle('hidden', latchSet.size === 0);
      clearBtn.textContent = `Nhả phím (${latchSet.size})`;
    }

    if (!this.isSectionActive || this.view !== 'piano-room') return;

    this._keyElByMidi.forEach((el, midi) => {
      el.classList.toggle('is-active', activeSet.has(midi));
      el.classList.toggle('is-latched', latchSet.has(midi));
    });

    if (this.pianoSubMode === 'free') {
      this._updateLiveChordHud(snap);
    } else if (this.pianoSubMode === 'chord-wait') {
      this._evaluateChordWaitStep(snap.activeMidis || []);
    }
  }

  _updateLiveChordHud(snap = null) {
    const symEl = this.root.querySelector('#live-chord-symbol');
    const qualEl = this.root.querySelector('#live-chord-quality');
    const notesEl = this.root.querySelector('#live-chord-notes');
    const susEl = this.root.querySelector('#live-sustain-badge');
    if (!symEl || !qualEl || !notesEl) return;

    const activeMidis = snap ? snap.activeMidis : this.midi ? this.midi.getActiveMidis() : [];
    const sustainDown = snap ? snap.sustainDown : Boolean(this.midi && this.midi.sustainDown);
    if (susEl) susEl.classList.toggle('hidden', !sustainDown);

    const guide = getScaleGuideInfo(this.pianoConfig.scaleKeyPc, this.pianoConfig.scaleType);
    const detected = detectChordFromMidis(activeMidis, this.pianoConfig.showScaleGuide ? guide.preferFlats : null);

    if (!detected) {
      symEl.textContent = '—';
      symEl.classList.remove('has-chord');
      qualEl.textContent = 'Bấm đàn MIDI, gõ phím PC (Z–M / Q–U) hoặc chạm nhiều phím để dò hợp âm';
      notesEl.innerHTML = '';
      return;
    }

    if (detected.isChord) {
      symEl.textContent = detected.symbol;
      symEl.classList.add('has-chord');
      qualEl.textContent = `${detected.qualityVi} · ${detected.inversionText}`;
    } else {
      symEl.textContent = detected.symbol || detected.noteNames.join(' ');
      symEl.classList.remove('has-chord');
      qualEl.textContent = detected.qualityVi;
    }

    notesEl.innerHTML = detected.noteNames
      .map((name) => `<span class="live-note-pill mono-val">${escapeHtml(name)}</span>`)
      .join('');
  }

  // ==========================================================================
  // Chế độ 1 (Phòng Đàn): Luyện Đệm Hợp Âm (Wait Mode & Metronome)
  // ==========================================================================
  _loadChordPracticeProgression(prog) {
    this._stopChordWaitTimers();
    this.chordPractice.progression = prog;
    this.chordPractice.barIndex = 0;
    this.chordPractice.bpm = prog.bpm || 80;
    this.chordPractice.hitInCurrentBar = false;
    this.chordPractice.beatStep = 0;

    const bpmSlider = this.root.querySelector('#cw-bpm-slider');
    const bpmVal = this.root.querySelector('#cw-bpm-val');
    if (bpmSlider) bpmSlider.value = String(this.chordPractice.bpm);
    if (bpmVal) bpmVal.textContent = String(this.chordPractice.bpm);

    this._syncChordWaitUI();
    this._syncKeyboardScaleAndTargets();

    if (this.chordPractice.rhythmMode === 'metronome') {
      this._startChordMetronomeLoop();
    }
  }

  _syncChordWaitUI() {
    const cp = this.chordPractice;
    const prog = cp.progression;
    const current = prog.chords[cp.barIndex] || prog.chords[0];

    const symEl = this.root.querySelector('#cw-target-symbol');
    const compEl = this.root.querySelector('#cw-completed-val');
    if (symEl && current) {
      symEl.textContent = current.symbol;
    }
    if (compEl) {
      compEl.textContent = `${cp.completedCount} hợp âm`;
    }

    this.root.querySelectorAll('.cw-chord-card').forEach((card) => {
      const bIdx = Number(card.dataset.cwBar);
      card.classList.toggle('active', bIdx === cp.barIndex);
      card.classList.remove('completed');
    });

    const activeMidis = this.midi ? this.midi.getActiveMidis() : [];
    const matchRes = doesActiveMatchChord(activeMidis, current);
    const reqBox = this.root.querySelector('#cw-required-notes');
    if (reqBox && current) {
      reqBox.innerHTML = current.pitchClasses
        .map((pc, idx) => {
          const lbl = current.noteLabels[idx] || '';
          const isHit = matchRes.matchedPcs.has(pc);
          return `<span class="cw-req-pill mono-val${isHit ? ' hit' : ''}">${escapeHtml(lbl)}</span>`;
        })
        .join('');
    }
  }

  _evaluateChordWaitStep(activeMidis) {
    const cp = this.chordPractice;
    const prog = cp.progression;
    const current = prog.chords[cp.barIndex];
    if (!current || cp.hitInCurrentBar) return;

    const res = doesActiveMatchChord(activeMidis, current);
    // Cập nhật từng nốt sáng xanh theo thời gian thực khi người dùng ghép dần hợp âm
    const reqPills = this.root.querySelectorAll('#cw-required-notes .cw-req-pill');
    current.pitchClasses.forEach((pc, idx) => {
      if (reqPills[idx]) {
        reqPills[idx].classList.toggle('hit', res.matchedPcs.has(pc));
      }
    });

    if (!res.matched) return;

    cp.hitInCurrentBar = true;
    cp.completedCount += 1;

    const compEl = this.root.querySelector('#cw-completed-val');
    if (compEl) compEl.textContent = `${cp.completedCount} hợp âm`;

    const activeCard = this.root.querySelector(`.cw-chord-card[data-cw-bar="${cp.barIndex}"]`);
    if (activeCard) activeCard.classList.add('completed');

    current.midis.forEach((m) => {
      const kEl = this._keyElByMidi.get(m);
      if (kEl) {
        kEl.classList.add('is-correct');
        setTimeout(() => kEl.classList.remove('is-correct'), 340);
      }
    });

    // Phát hợp âm trọn vẹn êm ái xác nhận hoàn thành
    this.audio.playTrainerChordPreview(current.midis, 0.72, 0.62, this.pianoConfig.timbre).catch(() => {});

    if (cp.rhythmMode === 'wait') {
      clearTimeout(cp.advanceTimer);
      cp.advanceTimer = setTimeout(() => {
        if (!this.isSectionActive || this.view !== 'piano-room' || this.pianoSubMode !== 'chord-wait') return;
        if (this.midi && this.midi.chordLatchEnabled) {
          this.midi.clearLatchedNotes();
        }
        cp.barIndex = (cp.barIndex + 1) % prog.chords.length;
        cp.hitInCurrentBar = false;
        this._syncChordWaitUI();
        this._syncKeyboardScaleAndTargets();
      }, 380);
    }
  }

  _startChordMetronomeLoop() {
    this._stopChordWaitTimers();
    const cp = this.chordPractice;
    const beatMs = Math.max(250, Math.round((60 / Math.max(45, cp.bpm || 80)) * 1000));
    cp.beatStep = 0;

    const tick = () => {
      if (!this.isSectionActive || this.view !== 'piano-room' || this.pianoSubMode !== 'chord-wait') {
        this._stopChordWaitTimers();
        return;
      }
      const beatInBar = cp.beatStep % 4;
      this.audio.playTrainerClick(beatInBar === 0).catch(() => {});
      if (cp.beatStep > 0 && beatInBar === 0) {
        if (this.midi && this.midi.chordLatchEnabled) {
          this.midi.clearLatchedNotes();
        }
        cp.barIndex = (cp.barIndex + 1) % cp.progression.chords.length;
        cp.hitInCurrentBar = false;
        this._syncChordWaitUI();
        this._syncKeyboardScaleAndTargets();
      }
      cp.beatStep += 1;
    };

    tick();
    cp.metronomeTimer = setInterval(tick, beatMs);
  }

  _stopChordWaitTimers() {
    if (this.chordPractice.advanceTimer) {
      clearTimeout(this.chordPractice.advanceTimer);
      this.chordPractice.advanceTimer = null;
    }
    if (this.chordPractice.metronomeTimer) {
      clearInterval(this.chordPractice.metronomeTimer);
      this.chordPractice.metronomeTimer = null;
    }
    this.chordPractice.hitInCurrentBar = false;
  }

  // ==========================================================================
  // Chế độ 2 (Phòng Đàn): Tập Giai Điệu Nốt Rơi (Falling Notes Canvas)
  // ==========================================================================
  _prepareFallingSong(song, redraw = true) {
    this._stopFallingLoop();
    const s = song || FALLING_NOTES_SONGS[0];
    this.falling.song = s;
    this.falling.playing = false;
    this.falling.finished = false;
    this.falling.currentBeat = -1.5;
    this.falling.waitingForNote = null;
    this.falling.correctHits = 0;
    this.falling.wrongHits = 0;
    this.falling.notes = s.notes
      .map((n) => ({
        midi: n.midi,
        startBeat: n.startBeat,
        durationBeats: n.durationBeats || 0.85,
        hit: false,
        missed: false,
      }))
      .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

    this._updateFallingHudUI();
    this._syncKeyboardScaleAndTargets();
    if (redraw) this._drawFallingNotesFrame();
  }

  _updateFallingHudUI() {
    const fn = this.falling;
    const playBtn = this.root.querySelector('#btn-fn-play');
    const accEl = this.root.querySelector('#fn-accuracy-val');
    const progEl = this.root.querySelector('#fn-progress-val');
    const overlay = this.root.querySelector('#falling-status-overlay');

    if (playBtn) {
      playBtn.textContent = fn.playing ? 'Tạm dừng' : fn.finished ? 'Chơi lại' : 'Bắt đầu';
    }
    const totalAttempts = fn.correctHits + fn.wrongHits;
    const accPct = totalAttempts > 0 ? Math.round((fn.correctHits / totalAttempts) * 100) : 100;
    if (accEl) accEl.textContent = `${accPct}%`;
    if (progEl) progEl.textContent = `${fn.correctHits}/${fn.notes.length}`;

    if (overlay) {
      if (fn.finished) {
        overlay.classList.remove('hidden');
        overlay.innerHTML = `Hoàn thành bài luyện · Chính xác <strong class="accent-green">${accPct}%</strong> (${fn.correctHits}/${fn.notes.length} nốt)`;
      } else if (fn.waitingForNote) {
        overlay.classList.remove('hidden');
        overlay.innerHTML = `Đang chờ bấm đúng nốt: <strong class="accent-cyan">${midiToNoteName(fn.waitingForNote.midi, false)}</strong>`;
      } else if (fn.playing) {
        overlay.classList.add('hidden');
      } else {
        overlay.classList.remove('hidden');
        overlay.innerHTML = 'Bấm <strong>Bắt đầu</strong> rồi chạm phím đàn đúng thời điểm nốt rơi chạm vạch';
      }
    }
  }

  _startFallingLoop() {
    if (this.falling.rafId !== null) return;
    this.falling.playing = true;
    this.falling.finished = false;
    this.falling.lastFrameMs = performance.now();
    this._updateFallingHudUI();

    const step = (now) => {
      this.falling.rafId = null;
      if (
        !this.isSectionActive ||
        this.view !== 'piano-room' ||
        this.pianoSubMode !== 'falling' ||
        !this.falling.playing ||
        document.hidden
      ) {
        return;
      }

      const dtSec = Math.min(0.05, Math.max(0.001, (now - this.falling.lastFrameMs) / 1000));
      this.falling.lastFrameMs = now;

      const fn = this.falling;
      const baseBpm = fn.song.bpm || 80;
      const beatsPerSec = (baseBpm / 60) * ((fn.speedPct || 85) / 100);
      let nextBeat = fn.currentBeat + dtSec * beatsPerSec;

      if (fn.waitMode) {
        const nextTarget = fn.notes.find((n) => !n.hit);
        if (nextTarget && nextBeat >= nextTarget.startBeat) {
          nextBeat = nextTarget.startBeat;
          if (fn.waitingForNote !== nextTarget) {
            fn.waitingForNote = nextTarget;
            this._syncKeyboardScaleAndTargets();
            this._updateFallingHudUI();
          }
        } else if (fn.waitingForNote) {
          fn.waitingForNote = null;
          this._syncKeyboardScaleAndTargets();
          this._updateFallingHudUI();
        }
      } else {
        fn.notes.forEach((n) => {
          if (!n.hit && !n.missed && nextBeat - n.startBeat > 0.55) {
            n.missed = true;
            fn.wrongHits += 1;
            this._updateFallingHudUI();
          }
        });
      }

      fn.currentBeat = nextBeat;
      this._drawFallingNotesFrame();

      const totalBeats = fn.song.totalBeats || 16;
      const allDone = fn.notes.every((n) => n.hit || n.missed);
      if ((allDone && fn.currentBeat >= totalBeats) || fn.currentBeat >= totalBeats + 1.2) {
        fn.playing = false;
        fn.finished = true;
        fn.waitingForNote = null;
        this._syncKeyboardScaleAndTargets();
        this._updateFallingHudUI();
        this._drawFallingNotesFrame();
        return;
      }

      this.falling.rafId = requestAnimationFrame(step);
    };

    this.falling.rafId = requestAnimationFrame(step);
  }

  _pauseFallingNotes() {
    this.falling.playing = false;
    this._stopFallingLoop();
    if (this.view === 'piano-room' && this.pianoSubMode === 'falling') {
      this._updateFallingHudUI();
    }
  }

  _stopFallingLoop() {
    if (this.falling.rafId !== null) {
      cancelAnimationFrame(this.falling.rafId);
      this.falling.rafId = null;
    }
  }

  _handleFallingNoteInput(midi) {
    const fn = this.falling;
    const rounded = Math.round(midi);
    const pc = ((rounded % 12) + 12) % 12;

    if (fn.waitMode) {
      const target = fn.waitingForNote || fn.notes.find((n) => !n.hit);
      if (!target) return;

      // Chỉ xử lý khi đang chờ ở vạch hoặc nốt sắp chạm vạch trong ±0.55 phách
      if (Math.abs(target.startBeat - fn.currentBeat) > 0.55 && fn.waitingForNote !== target) {
        return;
      }

      const targetOutOfRange = !this._keyElByMidi.has(target.midi);
      const isMatch = rounded === target.midi || (targetOutOfRange && pc === ((target.midi % 12) + 12) % 12);

      if (isMatch) {
        target.hit = true;
        fn.correctHits += 1;
        fn.waitingForNote = null;
        const kEl = this._keyElByMidi.get(rounded);
        if (kEl) {
          kEl.classList.add('is-correct');
          setTimeout(() => kEl.classList.remove('is-correct'), 240);
        }
        this._syncKeyboardScaleAndTargets();
        this._updateFallingHudUI();
        this._drawFallingNotesFrame();
      } else {
        fn.wrongHits += 1;
        this._updateFallingHudUI();
      }
      return;
    }

    // Chế độ chạy liên tục: khớp nốt gần vạch trong ±0.55 phách
    const cand = fn.notes.find(
      (n) => !n.hit && !n.missed && n.midi === rounded && Math.abs(n.startBeat - fn.currentBeat) <= 0.55
    );
    if (cand) {
      cand.hit = true;
      fn.correctHits += 1;
      const kEl = this._keyElByMidi.get(rounded);
      if (kEl) {
        kEl.classList.add('is-correct');
        setTimeout(() => kEl.classList.remove('is-correct'), 240);
      }
    } else {
      fn.wrongHits += 1;
    }
    this._updateFallingHudUI();
    this._drawFallingNotesFrame();
  }

  _drawFallingNotesFrame() {
    const canvas = this.root.querySelector('#falling-notes-canvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    if (!wrap) return;

    const cssW = Math.max(240, wrap.clientWidth);
    const cssH = Math.max(150, wrap.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.round(cssW * dpr);
    const pxH = Math.round(cssH * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Nền lưới sân khấu nốt rơi
    ctx.fillStyle = 'rgba(7, 8, 13, 0.94)';
    ctx.fillRect(0, 0, cssW, cssH);

    // Đường kẻ dọc ngăn các quãng tám
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    this._keyGeometry.forEach((g, midi) => {
      if (midi % 12 === 0) {
        const x = Math.round(g.xRatio * cssW) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
    });

    const WINDOW_BEATS = 4.0;
    const hitY = cssH - 14;
    const pxPerBeat = (hitY - 8) / WINDOW_BEATS;
    const curBeat = this.falling.currentBeat;

    // Đường kẻ ngang mỗi phách
    const firstGrid = Math.floor(curBeat);
    const lastGrid = Math.ceil(curBeat + WINDOW_BEATS);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    for (let b = firstGrid; b <= lastGrid; b++) {
      const gy = hitY - (b - curBeat) * pxPerBeat;
      if (gy < 0 || gy > hitY) continue;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(cssW, gy);
      ctx.stroke();
    }

    // Vạch Hit Line chuẩn đáy canvas ngay trên bàn phím
    ctx.fillStyle = 'rgba(34, 211, 238, 0.25)';
    ctx.fillRect(0, hitY - 2, cssW, 4);

    // Vẽ từng thanh nốt rơi thẳng hàng tuyệt đối với phím bên dưới
    const baseMidi = this.midi ? this.midi.baseMidi : 48;
    this.falling.notes.forEach((n) => {
      let drawMidi = n.midi;
      if (!this._keyGeometry.has(drawMidi)) {
        while (drawMidi < baseMidi) drawMidi += 12;
        while (drawMidi > baseMidi + 35) drawMidi -= 12;
      }
      const g = this._keyGeometry.get(drawMidi);
      if (!g) return;

      const bottomY = hitY - (n.startBeat - curBeat) * pxPerBeat;
      const barH = Math.max(16, n.durationBeats * pxPerBeat - 3);
      const topY = bottomY - barH;
      if (bottomY < -20 || topY > cssH + 10) return;

      const x = g.xRatio * cssW + 2;
      const w = Math.max(8, g.wRatio * cssW - 4);
      const isWaitTarget = this.falling.waitingForNote === n;

      if (n.hit) {
        ctx.fillStyle = 'rgba(52, 211, 153, 0.85)';
      } else if (n.missed) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      } else if (g.isBlack) {
        ctx.fillStyle = isWaitTarget ? '#F4F4F5' : '#A78BFA';
      } else {
        ctx.fillStyle = isWaitTarget ? '#FFFFFF' : '#22D3EE';
      }

      const r = Math.min(6, w / 3, barH / 3);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, topY, w, barH, r);
      } else {
        ctx.rect(x, topY, w, barH);
      }
      ctx.fill();

      if (isWaitTarget) {
        ctx.strokeStyle = '#22D3EE';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      if (w >= 18 && barH >= 16) {
        ctx.fillStyle = n.hit || isWaitTarget || !g.isBlack ? '#08090F' : '#FAFAFA';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(n.midi, false), x + w / 2, topY + barH / 2);
      }
    });
  }

  // ==========================================================================
  // 11. LUYỆN CẢM ÂM HỢP ÂM, QUÃNG NHẠC & BẬC HÒA ÂM (EAR TRAINING)
  // ==========================================================================
  _clearEarTimers() {
    (this._earTimers || []).forEach((id) => clearTimeout(id));
    this._earTimers = [];
  }

  _playEarQuestionAudio(style = 'block') {
    const q = this.earState.question;
    if (!q || !Array.isArray(q.midis) || q.midis.length === 0) return;
    this._clearEarTimers();
    this.audio.unlockSync();

    const timbre = this.pianoConfig.timbre || 'grand';
    const playTarget = () => {
      if (q.mode === 'interval') {
        if (style === 'block') {
          this.audio.playTrainerChordPreview(q.midis, 0.95, 0.78, timbre).catch(() => {});
        } else {
          this.audio.playTrainerPiano(q.midis[0], 0.55, 0.80).catch(() => {});
          const tid = setTimeout(() => {
            this.audio.playTrainerPiano(q.midis[1], 0.75, 0.82).catch(() => {});
          }, 420);
          this._earTimers.push(tid);
        }
        return;
      }

      if (style === 'arp') {
        q.midis.forEach((m, idx) => {
          const tid = setTimeout(() => {
            this.audio.playTrainerChordPreview([m], 0.85, 0.76, timbre).catch(() => {});
          }, idx * 210);
          this._earTimers.push(tid);
        });
      } else {
        this.audio.playTrainerChordPreview(q.midis, 1.0, 0.75, timbre).catch(() => {});
      }
    };

    if (q.mode === 'degree' && q.anchorMidis && q.anchorMidis.length > 0) {
      this.audio.playTrainerChordPreview(q.anchorMidis, 0.52, 0.66, timbre).catch(() => {});
      const tid = setTimeout(playTarget, 680);
      this._earTimers.push(tid);
    } else {
      playTarget();
    }
  }

  _nextEarQuestion(autoPlay = true) {
    const prevId = this.earState.question ? this.earState.question.answerId : null;
    this.earState.question = generateEarQuestion({
      mode: this.earState.mode,
      difficulty: this.earState.difficulty,
      prevAnswerId: prevId,
    });
    this.earState.answered = false;
    this.earState.selectedId = null;
    this._renderEarTraining();
    if (autoPlay) {
      this._playEarQuestionAudio(this.earState.mode === 'interval' ? 'arp' : 'block');
    }
  }

  _renderEarTraining() {
    if (!this.earState.question) {
      this.earState.question = generateEarQuestion({
        mode: this.earState.mode,
        difficulty: this.earState.difficulty,
      });
    }
    const es = this.earState;
    const q = es.question;
    const st = es.stats;
    const accPct = st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;

    const optionsHtml = q.options
      .map((opt) => {
        let stateCls = '';
        if (es.answered) {
          if (opt.id === q.answerId) stateCls = ' is-correct';
          else if (opt.id === es.selectedId) stateCls = ' is-wrong';
        }
        return `
          <button type="button" class="ear-opt-btn${stateCls}" data-ear-opt="${escapeHtml(opt.id)}" ${es.answered ? 'disabled' : ''}>
            <strong class="ear-opt-title">${escapeHtml(opt.label)}</strong>
            <span class="ear-opt-hint">${escapeHtml(opt.hint)}</span>
          </button>
        `;
      })
      .join('');

    const feedbackHtml = es.answered
      ? `
        <div class="ear-feedback-banner${es.selectedId === q.answerId ? ' ok' : ' err'}">
          <strong>${es.selectedId === q.answerId ? '✓ Chính xác!' : '✗ Chưa đúng — Đáp án:'}</strong>
          <span>${escapeHtml(q.explanation)}</span>
        </div>
      `
      : `
        <div class="ear-feedback-banner idle">
          Bấm <strong>Nghe lại</strong> hoặc <strong>Nghe rải chậm</strong> rồi chọn tính chất bạn nghe được bên dưới.
        </div>
      `;

    this.root.innerHTML = `
      <div class="trainer-shell">
        ${this._renderDeviceBarHtml()}
        ${this._renderTopSectionTabsHtml()}

        <div class="ear-training-wrap">
          <div class="ear-top-controls">
            <div class="seg-group ear-mode-tabs" role="tablist" aria-label="Chế độ cảm âm">
              <button type="button" class="seg-btn${es.mode === 'chord' ? ' active' : ''}" data-ear-mode="chord">Loại Hợp Âm</button>
              <button type="button" class="seg-btn${es.mode === 'interval' ? ' active' : ''}" data-ear-mode="interval">Quãng Nhạc</button>
              <button type="button" class="seg-btn${es.mode === 'degree' ? ' active' : ''}" data-ear-mode="degree">Bậc Hợp Âm (I–vi)</button>
            </div>

            ${
              es.mode === 'chord'
                ? `
              <label class="inline-field">
                <span class="inline-label">Độ khó</span>
                <select id="ear-diff-select" class="studio-select compact" aria-label="Độ khó cảm âm hợp âm">
                  <option value="basic"${es.difficulty === 'basic' ? ' selected' : ''}>Cơ bản (Trưởng · Thứ · sus4)</option>
                  <option value="medium"${es.difficulty === 'medium' ? ' selected' : ''}>Trung cấp (+ 7 · maj7 · m7)</option>
                  <option value="advanced"${es.difficulty === 'advanced' ? ' selected' : ''}>Nâng cao (+ dim &amp; Thế đảo)</option>
                </select>
              </label>
            `
                : ''
            }

            <div class="ear-stats-bar">
              <span class="ear-stat-pill">Chuỗi đúng: <strong id="ear-streak-val" class="mono-val accent-green">${st.streak}</strong></span>
              <span class="ear-stat-pill">Kỷ lục: <strong class="mono-val">${st.bestStreak}</strong></span>
              <span class="ear-stat-pill">Độ chuẩn: <strong id="ear-acc-val" class="mono-val accent-cyan">${accPct}%</strong></span>
            </div>
          </div>

          <div class="ear-prompt-card">
            <div class="ear-prompt-head">
              <div>
                <span class="ear-kicker">${
                  es.mode === 'interval'
                    ? 'NGHE &amp; ĐOÁN QUÃNG 2 NỐT'
                    : es.mode === 'degree'
                      ? 'NGHE CHỦ ÂM (I) RỒI ĐOÁN BẬC KẾ TIẾP'
                      : 'NGHE &amp; PHÂN BIỆT MÀU SẮC HỢP ÂM'
                }</span>
                <h2 class="ear-prompt-title">${
                  es.mode === 'degree'
                    ? 'Lắng nghe hợp âm Chủ âm (I), sau đó nhận diện Bậc hợp âm thứ hai'
                    : es.mode === 'interval'
                      ? 'Nghe cao độ 2 nốt vang lên và gọi tên quãng chính xác'
                      : 'Nghe màu sắc hòa âm (Sáng · Buồn · Jazz/Lo-Fi · Treo · Giảm)'
                }</h2>
              </div>

              <div class="ear-play-actions">
                <button type="button" id="btn-ear-play-block" class="btn btn-cyan-solid btn-xs">
                  🔊 ${es.mode === 'interval' ? 'Nghe đồng thanh' : 'Nghe lại (Hợp âm)'}
                </button>
                <button type="button" id="btn-ear-play-arp" class="btn btn-indigo-outline btn-xs">
                  🎹 ${es.mode === 'interval' ? 'Nghe từng nốt' : 'Nghe rải chậm'}
                </button>
                <button type="button" id="btn-ear-next" class="btn btn-ghost btn-xs">
                  Câu tiếp theo →
                </button>
              </div>
            </div>

            ${feedbackHtml}
          </div>

          <div class="ear-options-grid">${optionsHtml}</div>
        </div>
      </div>
    `;

    this._bindDeviceBarEvents();
    this._bindTopSectionTabsEvents();
    this._bindEarTrainingEvents();
  }

  _bindEarTrainingEvents() {
    const qEl = (sel) => this.root.querySelector(sel);

    this.root.querySelectorAll('[data-ear-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.earMode;
        if (!nextMode || nextMode === this.earState.mode) return;
        this.earState.mode = nextMode;
        this._nextEarQuestion(true);
      });
    });

    qEl('#ear-diff-select')?.addEventListener('change', (e) => {
      this.earState.difficulty = e.target.value;
      this._nextEarQuestion(true);
    });

    qEl('#btn-ear-play-block')?.addEventListener('click', () => this._playEarQuestionAudio('block'));
    qEl('#btn-ear-play-arp')?.addEventListener('click', () => this._playEarQuestionAudio('arp'));
    qEl('#btn-ear-next')?.addEventListener('click', () => this._nextEarQuestion(true));

    this.root.querySelectorAll('[data-ear-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.earState.answered) return;
        const picked = btn.dataset.earOpt;
        const ok = picked === this.earState.question.answerId;
        this.earState.answered = true;
        this.earState.selectedId = picked;
        this.earState.stats = saveEarOutcome(ok);
        if (!ok) {
          this.audio.playTrainerWrong().catch(() => {});
        } else {
          this._playEarQuestionAudio('block');
        }
        this._renderEarTraining();
      });
    });
  }
}
