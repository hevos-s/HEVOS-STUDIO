// ============================================================================
// musicTrainer.js — Phân khu Học nhạc (Luyện Đọc Nốt & Phản Xạ Nhạc Lý)
// 4 Chế độ: Luyện từng nốt · Luyện nốt chạy · Ôn tập nốt sai · Tra cứu nốt
// ============================================================================

import { midiToFreq } from './theory.js?v=13';
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
} from './trainerData.js?v=13';
import {
  ScrollingStaffView,
  renderReferenceStaff,
  renderSingleNoteStaff,
} from './staffRenderer.js?v=13';

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
  constructor(rootEl, { audioEngine, showToast }) {
    this.root = rootEl;
    this.audio = audioEngine;
    this.showToast = showToast || (() => {});

    this.isSectionActive = false;
    this.view = 'home'; // 'home' | 'setup-single' | 'setup-scroll' | 'drill-single' | 'drill-scroll' | 'reference' | 'report'

    // Cấu hình người dùng
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
      } else if (this.isSectionActive && this.session && this.session.active) {
        this._startCountdownTimer();
        if (this.view === 'drill-scroll') {
          this._resumeScrollLoop();
        }
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    this._bindKeyboardShortcuts();
    this.render();
  }

  setSectionActive(active) {
    this.isSectionActive = Boolean(active);
    if (!active) {
      this.stopActiveSession();
    } else if (this.view === 'home') {
      this.render();
    }
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
    if (this.session) {
      this.session.active = false;
    }
    this.audio.stopTrainerAudio();
  }

  // ==========================================================================
  // Xử lý bàn phím máy tính (Desktop QWERTY)
  // ==========================================================================
  _bindKeyboardShortcuts() {
    this._onKeyDown = (e) => {
      if (!this.isSectionActive) return;
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
    if (this.view === 'home') {
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
}
