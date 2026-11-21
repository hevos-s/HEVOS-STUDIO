// ============================================================================
// pianoRoll.js — Bảng chấm MIDI trực quan 60fps trên HTML5 Canvas
// Hỗ trợ tô sáng Âm giai & Hợp âm theo từng ô nhịp, Chuột & Cảm ứng (Pointer)
// ============================================================================

import {
  getScaleSet,
  isBlackKey,
  midiToNoteName,
  shouldPreferFlats,
  snapMidiToScale,
} from './theory.js?v=25';

const MIN_MIDI = 48; // C3
const MAX_MIDI = 84; // C6
const NUM_ROWS = MAX_MIDI - MIN_MIDI + 1; // 37 bán cung

export class PianoRoll {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks; // { onChange, onSelect, onAudition, onHistoryPush }

    // Trạng thái bài nhạc (được đồng bộ từ app.js)
    this.notes = [];
    this.totalBars = 4;
    this.keyPc = 0;
    this.scaleType = 'major';
    this.voicedChords = [];
    this.selectedNoteId = null;

    // Cài đặt thao tác
    this.mode = 'edit';       // 'edit' | 'erase' | 'scroll'
    this.scaleLock = true;    // Khóa kéo/vẽ vào đúng tông
    this.gridStep = 0.25;     // 0.25 (1/16) | 0.5 (1/8) | 0 (tự do)
    this.zoom = 1.0;          // 0.65 .. 2.2

    // Trạng thái hiển thị & cuộn
    this.width = 600;
    this.height = 340;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scrollX = 0;
    this.scrollY = 0;
    this._initializedScroll = false;

    // Playhead & quản lý vòng lặp theo hiển thị phân khu / tab
    this.isActive = false;
    this.getPlayheadBeat = callbacks.getPlayheadBeat || (() => 0);
    this.getIsPlaying = callbacks.getIsPlaying || (() => false);
    this._rafId = null;
    this._dirty = true;

    // Tương tác Pointer
    this.activePointerId = null;
    this.dragState = null;
    this.activePianoKey = null;
    this._lastTap = { time: 0, noteId: null };
    this._hoverCursor = 'crosshair';

    this._bindEvents();
    this._setupResizeObserver();
    this._onVisibilityChange = () => {
      if (document.hidden) {
        this.stopAnimationLoop();
      } else if (this.isActive && this.getIsPlaying()) {
        this.startAnimationLoop();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
    this.requestDraw();
  }

  // --- Kích thước hình học đáp ứng Desktop & Mobile ---
  get keyWidth() {
    return this.width < 520 ? 48 : 60;
  }

  get headerHeight() {
    return 32;
  }

  get rowHeight() {
    return this.width < 520 ? 26 : 23;
  }

  get beatWidth() {
    const gridAvailW = Math.max(240, this.width - this.keyWidth);
    // Ở mức zoom = 1: trên desktop vừa khít 4 ô (16 phách), tối thiểu 46px/phách cho dễ chạm
    const base = Math.max(46, gridAvailW / 16);
    return base * this.zoom;
  }

  get totalBeats() {
    return this.totalBars * 4;
  }

  get contentWidth() {
    return this.totalBeats * this.beatWidth;
  }

  get contentHeight() {
    return NUM_ROWS * this.rowHeight;
  }

  setData({ notes, totalBars, keyPc, scaleType, voicedChords, selectedNoteId }) {
    if (notes !== undefined) this.notes = notes;
    if (totalBars !== undefined) this.totalBars = totalBars;
    if (keyPc !== undefined) this.keyPc = keyPc;
    if (scaleType !== undefined) this.scaleType = scaleType;
    if (voicedChords !== undefined) this.voicedChords = voicedChords;
    if (selectedNoteId !== undefined) this.selectedNoteId = selectedNoteId;
    this._clampScroll();
    this.requestDraw();
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.style.cursor =
      mode === 'scroll' ? 'grab' : mode === 'erase' ? 'not-allowed' : 'crosshair';
    this.requestDraw();
  }

  setScaleLock(locked) {
    this.scaleLock = Boolean(locked);
  }

  setGridStep(gridStep) {
    this.gridStep = gridStep;
    this.requestDraw();
  }

  setZoom(nextZoom) {
    this.zoom = Math.max(0.65, Math.min(2.2, nextZoom));
    this._clampScroll();
    this.requestDraw();
  }

  centerOnVocalRange() {
    // Tự động căn giữa quãng nốt hiện có, hoặc C4–C5 (MIDI 66) nếu chưa có nốt
    let targetMidMidi = 66; // F#4
    if (Array.isArray(this.notes) && this.notes.length > 0) {
      let minMidi = Infinity;
      let maxMidi = -Infinity;
      for (const note of this.notes) {
        if (typeof note.midi === 'number') {
          if (note.midi < minMidi) minMidi = note.midi;
          if (note.midi > maxMidi) maxMidi = note.midi;
        }
      }
      if (Number.isFinite(minMidi) && Number.isFinite(maxMidi)) {
        targetMidMidi = (minMidi + maxMidi) / 2;
      }
    }
    const rowIdx = MAX_MIDI - targetMidMidi;
    const gridH = Math.max(100, this.height - this.headerHeight);
    this.scrollY = rowIdx * this.rowHeight - gridH * 0.48;
    this._clampScroll();
    if (this.isActive && !document.hidden && this.width >= 10 && this.height >= 10) {
      this.draw();
    }
    this.requestDraw();
  }

  _clampScroll() {
    const gridW = Math.max(1, this.width - this.keyWidth);
    const gridH = Math.max(1, this.height - this.headerHeight);
    const maxScrollX = Math.max(0, this.contentWidth - gridW);
    const maxScrollY = Math.max(0, this.contentHeight - gridH);
    this.scrollX = Math.max(0, Math.min(maxScrollX, this.scrollX));
    this.scrollY = Math.max(0, Math.min(maxScrollY, this.scrollY));
  }

  // --- Quy đổi tọa độ ---
  midiToY(midi) {
    return this.headerHeight + (MAX_MIDI - midi) * this.rowHeight - this.scrollY;
  }

  yToMidi(y) {
    const row = Math.floor((y - this.headerHeight + this.scrollY) / this.rowHeight);
    return Math.max(MIN_MIDI, Math.min(MAX_MIDI, MAX_MIDI - row));
  }

  beatToX(beat) {
    return this.keyWidth + beat * this.beatWidth - this.scrollX;
  }

  xToBeat(x) {
    return (x - this.keyWidth + this.scrollX) / this.beatWidth;
  }

  _snapBeat(beat, floor = false) {
    const step = this.gridStep > 0 ? this.gridStep : 0.125;
    const snapped = floor ? Math.floor(beat / step) * step : Math.round(beat / step) * step;
    return Math.max(0, Math.min(this.totalBeats - step, Number(snapped.toFixed(4))));
  }

  _snapMidiIfLocked(midi, barIndex = 0) {
    if (!this.scaleLock) return Math.max(MIN_MIDI, Math.min(MAX_MIDI, Math.round(midi)));
    const barChordPcs = this.voicedChords[barIndex]?.allPitchClasses || null;
    const snapped = snapMidiToScale(midi, this.keyPc, this.scaleType, barChordPcs, 0.15);
    return Math.max(MIN_MIDI, Math.min(MAX_MIDI, snapped));
  }

  _findNoteAt(x, y, isTouch = false) {
    if (x < this.keyWidth || y < this.headerHeight) return null;
    const padY = isTouch ? 4 : 2;
    const resizeZone = isTouch ? 18 : 11;

    // Quét ngược để ưu tiên nốt vẽ trên cùng
    for (let i = this.notes.length - 1; i >= 0; i--) {
      const n = this.notes[i];
      const nx = this.beatToX(n.startBeat);
      const nw = Math.max(10, n.durationBeats * this.beatWidth);
      const ny = this.midiToY(n.midi);
      const nh = this.rowHeight;

      if (x >= nx - 2 && x <= nx + nw + 4 && y >= ny - padY && y <= ny + nh + padY) {
        const effectiveResize = Math.min(resizeZone, nw * 0.42);
        const onRightEdge = x >= nx + nw - effectiveResize;
        return { note: n, onRightEdge };
      }
    }
    return null;
  }

  // --- Quản lý vòng lặp vẽ theo trạng thái hoạt động ---
  setActive(active) {
    this.isActive = Boolean(active);
    if (!this.isActive) {
      this.stopAnimationLoop();
    } else {
      this.requestDraw();
    }
  }

  stopAnimationLoop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  startAnimationLoop() {
    if (!this.isActive || document.hidden || this._rafId !== null) return;
    const tick = () => {
      this._rafId = null;
      if (!this.isActive || document.hidden) return;
      this.draw();
      if (this.getIsPlaying() || this.dragState || this.activePianoKey !== null) {
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  requestDraw() {
    this._dirty = true;
    if (!this.isActive || document.hidden) return;
    if (this._rafId === null) {
      this.startAnimationLoop();
    }
  }

  _setupResizeObserver() {
    this._updateSize = () => {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      this.width = Math.floor(rect.width);
      this.height = Math.floor(rect.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      const nextCanvasW = Math.floor(this.width * this.dpr);
      const nextCanvasH = Math.floor(this.height * this.dpr);
      if (this.canvas.width !== nextCanvasW) this.canvas.width = nextCanvasW;
      if (this.canvas.height !== nextCanvasH) this.canvas.height = nextCanvasH;

      if (!this._initializedScroll) {
        this._initializedScroll = true;
        this.centerOnVocalRange();
      } else {
        this._clampScroll();
      }
      if (this.isActive && !document.hidden && this.width >= 10 && this.height >= 10) {
        this.draw();
      }
      this.requestDraw();
    };

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._updateSize);
      this._ro.observe(this.canvas);
      if (this.canvas.parentElement) {
        this._ro.observe(this.canvas.parentElement);
      }
    }
    window.addEventListener('resize', this._updateSize);
    requestAnimationFrame(this._updateSize);
  }

  resize(recenter = false) {
    if (this._updateSize) this._updateSize();
    if (recenter && this.height >= 10) {
      this.centerOnVocalRange();
    }
    if (this.isActive && !document.hidden && this.width >= 10 && this.height >= 10) {
      this.draw();
    }
  }

  render() {
    if (this.width >= 10 && this.height >= 10) {
      this.draw();
    }
  }

  // --- Xử lý sự kiện chuột & cảm ứng (Pointer Events) ---
  _bindEvents() {
    this.canvas.style.touchAction = 'none';

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const pt = this._getLocalPoint(e);
      const hit = this._findNoteAt(pt.x, pt.y, false);
      if (hit) {
        this._deleteNoteById(hit.note.id);
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        this.scrollX += (e.deltaX || e.deltaY) * 0.9;
      } else {
        this.scrollY += e.deltaY * 0.85;
      }
      this._clampScroll();
      this.requestDraw();
    }, { passive: false });

    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this._onPointerUp(e));
  }

  _getLocalPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  _onPointerDown(e) {
    if (e.button === 2) return; // Chuột phải đã xử lý trong contextmenu
    if (this.activePointerId !== null) return;

    const pt = this._getLocalPoint(e);
    const isTouch = e.pointerType === 'touch';
    this.activePointerId = e.pointerId;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}

    // 1. Chạm vào bàn phím đàn dọc bên trái -> phát tiếng nghe thử
    if (pt.x < this.keyWidth && pt.y >= this.headerHeight) {
      const midi = this.yToMidi(pt.y);
      this.activePianoKey = midi;
      this.dragState = { type: 'piano', lastMidi: midi };
      if (this.cb.onAudition) this.cb.onAudition(midi);
      this.requestDraw();
      return;
    }

    // 2. Chạm vào thanh header ô nhịp -> cuộn ngang nhanh
    if (pt.y < this.headerHeight) {
      this.dragState = {
        type: 'pan',
        startX: pt.x,
        startY: pt.y,
        origScrollX: this.scrollX,
        origScrollY: this.scrollY,
      };
      return;
    }

    // 3. Chế độ Cuộn lưới (Scroll) hoặc nhấn chuột giữa
    if (this.mode === 'scroll' || e.button === 1) {
      this.canvas.style.cursor = 'grabbing';
      this.dragState = {
        type: 'pan',
        startX: pt.x,
        startY: pt.y,
        origScrollX: this.scrollX,
        origScrollY: this.scrollY,
      };
      return;
    }

    // 4. Chế độ Xóa (Erase)
    if (this.mode === 'erase') {
      this.dragState = { type: 'erase', pushedHistory: false };
      const hit = this._findNoteAt(pt.x, pt.y, isTouch);
      if (hit) {
        if (this.cb.onHistoryPush) this.cb.onHistoryPush();
        this.dragState.pushedHistory = true;
        this._removeNoteNoHistory(hit.note.id);
      }
      return;
    }

    // 5. Chế độ Vẽ / Sửa (Edit)
    const hit = this._findNoteAt(pt.x, pt.y, isTouch);

    if (hit) {
      const { note, onRightEdge } = hit;
      const now = performance.now();

      // Kiểm tra nhấp đúp để xóa nhanh (trên Desktop chuột hoặc chạm đúp rất nhanh)
      if (
        !onRightEdge &&
        this._lastTap.noteId === note.id &&
        now - this._lastTap.time < 320
      ) {
        this._lastTap = { time: 0, noteId: null };
        this._deleteNoteById(note.id);
        this.dragState = null;
        return;
      }
      this._lastTap = { time: now, noteId: note.id };

      this._selectNote(note.id);
      if (this.cb.onAudition && !onRightEdge) this.cb.onAudition(note.midi);

      if (onRightEdge) {
        this.dragState = {
          type: 'resize',
          noteId: note.id,
          origDur: note.durationBeats,
          startX: pt.x,
          moved: false,
          snapshotPushed: false,
        };
      } else {
        this.dragState = {
          type: 'move',
          noteId: note.id,
          startX: pt.x,
          startY: pt.y,
          origBeat: note.startBeat,
          origMidi: note.midi,
          lastAuditionMidi: note.midi,
          moved: false,
          snapshotPushed: false,
        };
      }
      this.requestDraw();
      return;
    }

    // Chạm ô trống -> tạo nốt mới ngay lập tức (nghe tiếng luôn!)
    const rawBeat = Math.max(0, this.xToBeat(pt.x));
    const startBeat = this._snapBeat(rawBeat, true);
    if (startBeat >= this.totalBeats) return;

    const barIdx = Math.min(Math.floor(startBeat / 4), Math.max(0, this.totalBars - 1));
    const rawMidi = this.yToMidi(pt.y);
    const midi = this._snapMidiIfLocked(rawMidi, barIdx);

    const defaultDur = Math.min(
      Math.max(0.5, this.gridStep || 0.5),
      this.totalBeats - startBeat
    );

    if (this.cb.onHistoryPush) this.cb.onHistoryPush();

    const newNote = {
      id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      midi,
      startBeat,
      durationBeats: Math.max(0.25, defaultDur),
      velocity: 0.82,
    };

    this.notes = [...this.notes, newNote];
    this._selectNote(newNote.id);
    if (this.cb.onAudition) this.cb.onAudition(newNote.midi);
    if (this.cb.onChange) this.cb.onChange(this.notes);

    // Cho phép kéo tiếp ngay sau khi chấm để chỉnh cao độ hoặc vị trí cực mượt
    this.dragState = {
      type: 'move',
      noteId: newNote.id,
      startX: pt.x,
      startY: pt.y,
      origBeat: newNote.startBeat,
      origMidi: newNote.midi,
      lastAuditionMidi: newNote.midi,
      moved: false,
      snapshotPushed: true, // Đã lưu undo khi vừa tạo nốt
    };
    this.requestDraw();
  }

  _onPointerMove(e) {
    const pt = this._getLocalPoint(e);
    const isTouch = e.pointerType === 'touch';

    // Cập nhật con trỏ chuột (hover feedback trên Desktop)
    if (!this.dragState && !isTouch) {
      if (this.mode === 'scroll') {
        this.canvas.style.cursor = 'grab';
      } else if (this.mode === 'erase') {
        this.canvas.style.cursor = 'not-allowed';
      } else if (pt.x < this.keyWidth) {
        this.canvas.style.cursor = 'pointer';
      } else {
        const hit = this._findNoteAt(pt.x, pt.y, false);
        if (hit) {
          this.canvas.style.cursor = hit.onRightEdge ? 'ew-resize' : 'move';
        } else {
          this.canvas.style.cursor = 'crosshair';
        }
      }
      return;
    }

    if (!this.dragState || e.pointerId !== this.activePointerId) return;

    if (this.dragState.type === 'piano') {
      const midi = this.yToMidi(pt.y);
      if (midi !== this.dragState.lastMidi) {
        this.dragState.lastMidi = midi;
        this.activePianoKey = midi;
        if (this.cb.onAudition) this.cb.onAudition(midi);
        this.requestDraw();
      }
      return;
    }

    if (this.dragState.type === 'pan') {
      this.scrollX = this.dragState.origScrollX - (pt.x - this.dragState.startX);
      this.scrollY = this.dragState.origScrollY - (pt.y - this.dragState.startY);
      this._clampScroll();
      this.requestDraw();
      return;
    }

    if (this.dragState.type === 'erase') {
      const hit = this._findNoteAt(pt.x, pt.y, isTouch);
      if (hit) {
        if (!this.dragState.pushedHistory && this.cb.onHistoryPush) {
          this.cb.onHistoryPush();
          this.dragState.pushedHistory = true;
        }
        this._removeNoteNoHistory(hit.note.id);
      }
      return;
    }

    const note = this.notes.find((n) => n.id === this.dragState.noteId);
    if (!note) return;

    if (this.dragState.type === 'resize') {
      const dx = pt.x - this.dragState.startX;
      if (!this.dragState.moved && Math.abs(dx) < 3) return;
      if (!this.dragState.snapshotPushed && this.cb.onHistoryPush) {
        this.cb.onHistoryPush();
        this.dragState.snapshotPushed = true;
      }
      this.dragState.moved = true;

      const deltaBeats = dx / this.beatWidth;
      const step = this.gridStep > 0 ? this.gridStep : 0.125;
      const rawDur = this.dragState.origDur + deltaBeats;
      const snappedDur = Math.max(step, Math.round(rawDur / step) * step);
      const maxDur = Math.max(step, this.totalBeats - note.startBeat);
      const finalDur = Math.min(maxDur, Number(snappedDur.toFixed(4)));

      if (finalDur !== note.durationBeats) {
        note.durationBeats = finalDur;
        if (this.cb.onChange) this.cb.onChange(this.notes);
        this.requestDraw();
      }
      return;
    }

    if (this.dragState.type === 'move') {
      const dx = pt.x - this.dragState.startX;
      const dy = pt.y - this.dragState.startY;
      if (!this.dragState.moved && Math.hypot(dx, dy) < 5) return;

      if (!this.dragState.snapshotPushed && this.cb.onHistoryPush) {
        this.cb.onHistoryPush();
        this.dragState.snapshotPushed = true;
      }
      this.dragState.moved = true;

      const deltaBeats = dx / this.beatWidth;
      const step = this.gridStep > 0 ? this.gridStep : 0.125;
      const nextBeat = Math.max(
        0,
        Math.min(
          this.totalBeats - note.durationBeats,
          Math.round((this.dragState.origBeat + deltaBeats) / step) * step
        )
      );

      const deltaSemi = -Math.round(dy / this.rowHeight);
      const targetBar = Math.min(Math.floor(nextBeat / 4), Math.max(0, this.totalBars - 1));
      const nextMidi = this._snapMidiIfLocked(this.dragState.origMidi + deltaSemi, targetBar);

      let changed = false;
      if (Number(nextBeat.toFixed(4)) !== note.startBeat) {
        note.startBeat = Number(nextBeat.toFixed(4));
        changed = true;
      }
      if (nextMidi !== note.midi) {
        note.midi = nextMidi;
        changed = true;
        if (nextMidi !== this.dragState.lastAuditionMidi) {
          this.dragState.lastAuditionMidi = nextMidi;
          if (this.cb.onAudition) this.cb.onAudition(nextMidi);
        }
      }

      if (changed) {
        if (this.cb.onChange) this.cb.onChange(this.notes);
        this.requestDraw();
      }
    }
  }

  _onPointerUp(e) {
    if (e.pointerId !== this.activePointerId) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    this.activePointerId = null;
    this.activePianoKey = null;
    this.dragState = null;
    if (this.mode === 'scroll') this.canvas.style.cursor = 'grab';
    this.requestDraw();
  }

  _selectNote(noteId) {
    this.selectedNoteId = noteId;
    if (this.cb.onSelect) this.cb.onSelect(noteId);
  }

  _deleteNoteById(noteId) {
    if (this.cb.onHistoryPush) this.cb.onHistoryPush();
    this._removeNoteNoHistory(noteId);
  }

  _removeNoteNoHistory(noteId) {
    this.notes = this.notes.filter((n) => n.id !== noteId);
    if (this.selectedNoteId === noteId) {
      this._selectNote(null);
    }
    if (this.cb.onChange) this.cb.onChange(this.notes);
    this.requestDraw();
  }

  // ============================================================================
  // Hàm vẽ Canvas 60fps — Phong cách Pro DAW (FL Studio / Ableton Live)
  // ============================================================================
  draw() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const kw = this.keyWidth;
    const hh = this.headerHeight;
    const rh = this.rowHeight;
    const bw = this.beatWidth;
    const monoFont = '"JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace';

    const scaleSet = getScaleSet(this.keyPc, this.scaleType);
    const preferFlats = shouldPreferFlats(this.keyPc, this.scaleType);
    const isPlaying = this.getIsPlaying();
    const playBeat = isPlaying ? this.getCurrentBeatSafe() : 0;
    const activeBar = isPlaying ? Math.floor(playBeat / 4) : -1;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Nền Monochrome Graphite sâu
    ctx.fillStyle = '#0C0C0F';
    ctx.fillRect(0, 0, w, h);

    // 2. Vùng lưới chính (clip bên phải bàn phím và bên dưới thước đo)
    ctx.save();
    ctx.beginPath();
    ctx.rect(kw, hh, w - kw, h - hh);
    ctx.clip();

    const firstRow = Math.max(0, Math.floor(this.scrollY / rh) - 1);
    const lastRow = Math.min(NUM_ROWS - 1, Math.ceil((this.scrollY + h - hh) / rh) + 1);

    // 2a. Vẽ nền hàng Monochrome: tách rõ hàng phím trắng & phím đen + tông
    for (let r = firstRow; r <= lastRow; r++) {
      const midi = MAX_MIDI - r;
      const pc = ((midi % 12) + 12) % 12;
      const y = hh + r * rh - this.scrollY;
      const black = isBlackKey(midi);
      const inScale = scaleSet.has(pc);
      const isRoot = pc === this.keyPc;

      if (black) {
        ctx.fillStyle = inScale ? '#121216' : '#0D0D10';
      } else if (isRoot) {
        ctx.fillStyle = '#1B1B21';
      } else if (inScale) {
        ctx.fillStyle = '#16161B';
      } else {
        ctx.fillStyle = '#111115';
      }
      ctx.fillRect(kw, y, w - kw, rh);

      // 2b. Tô sáng tinh tế các nốt thuộc HỢP ÂM của từng ô nhịp (tông trắng bạc mờ)
      for (let bar = 0; bar < this.totalBars; bar++) {
        const vc = this.voicedChords[bar];
        if (!vc || !vc.allPitchClasses.has(pc)) continue;

        const bx = this.beatToX(bar * 4);
        const barPxW = 4 * bw;
        if (bx + barPxW < kw || bx > w) continue;

        const isChordRoot = pc === vc.rootPc;
        const isCurrentBar = bar === activeBar;

        if (isChordRoot) {
          ctx.fillStyle = isCurrentBar
            ? 'rgba(255, 255, 255, 0.12)'
            : 'rgba(255, 255, 255, 0.065)';
        } else {
          ctx.fillStyle = isCurrentBar
            ? 'rgba(255, 255, 255, 0.075)'
            : 'rgba(255, 255, 255, 0.035)';
        }
        ctx.fillRect(bx + 1, y + 0.5, barPxW - 2, rh - 1);

        // Thanh đánh dấu mảnh đầu ô nhịp
        ctx.fillStyle = isChordRoot
          ? 'rgba(255, 255, 255, 0.58)'
          : 'rgba(255, 255, 255, 0.30)';
        ctx.fillRect(bx + 1, y + 2, 2.5, rh - 4);
      }

      // Đường kẻ ngang phân tách bán cung (đậm nhẹ tại mỗi quãng tám C)
      ctx.strokeStyle = pc === 0 ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(kw, Math.round(y + rh) - 0.5);
      ctx.lineTo(w, Math.round(y + rh) - 0.5);
      ctx.stroke();
    }

    // 2c. Đường kẻ dọc chia ô nhịp, phách và lưới con (1/16 hoặc 1/8)
    const subDiv = this.gridStep === 0.5 ? 2 : 4;
    for (let b = 0; b <= this.totalBeats; b++) {
      const x = Math.round(this.beatToX(b)) + 0.5;
      if (x >= kw - 2 && x <= w + 2) {
        const isBarLine = b % 4 === 0;
        ctx.strokeStyle = isBarLine ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = isBarLine ? 1.25 : 1;
        ctx.beginPath();
        ctx.moveTo(x, hh);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      if (b < this.totalBeats && bw >= 40) {
        for (let s = 1; s < subDiv; s++) {
          const sx = Math.round(this.beatToX(b + s / subDiv)) + 0.5;
          if (sx < kw || sx > w) continue;
          ctx.strokeStyle =
            s === subDiv / 2
              ? 'rgba(255, 255, 255, 0.045)'
              : 'rgba(255, 255, 255, 0.02)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(sx, hh);
          ctx.lineTo(sx, h);
          ctx.stroke();
        }
      }
    }

    // 2d. Gợi ý trực quan khi chưa có nốt nào
    if (this.notes.length === 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(161, 161, 170, 0.45)';
      ctx.font = '500 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const msg =
        w < 520
          ? 'Chạm vào hàng sáng để chấm nốt • Hoặc nhấn Ngân nga MIDI'
          : 'Chạm vào lưới sáng hợp âm để chấm nốt • Hoặc nhấn Ngân nga MIDI (R) để thu giai điệu';
      ctx.fillText(msg, kw + (w - kw) / 2, hh + (h - hh) / 2);
      ctx.restore();
    }

    // 2e. Vẽ các thanh nốt MIDI tông Trắng Bạc / Ghi Sáng hài hòa
    for (const note of this.notes) {
      const nx = this.beatToX(note.startBeat);
      const nw = Math.max(9, note.durationBeats * bw - 1.5);
      const ny = this.midiToY(note.midi) + 1.5;
      const nh = rh - 3;

      if (nx + nw < kw || nx > w || ny + nh < hh || ny > h) continue;

      const isSelected = note.id === this.selectedNoteId;
      const isActiveNow =
        isPlaying && playBeat >= note.startBeat && playBeat < note.startBeat + note.durationBeats;

      this._drawRoundedRect(ctx, nx + 0.5, ny, nw, nh, 4);
      if (isActiveNow) {
        ctx.fillStyle = '#FFFFFF';
      } else if (isSelected) {
        ctx.fillStyle = '#F4F4F5';
      } else {
        ctx.fillStyle = '#D4D4D8';
      }
      ctx.fill();

      // Vạch sáng cạnh trên
      if (nw > 4) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillRect(nx + 1.5, ny + 1, Math.max(0, nw - 2), 1.5);
      }

      // Viền ngoài sắc nét
      this._drawRoundedRect(ctx, nx + 0.5, ny, nw, nh, 4);
      ctx.strokeStyle = isSelected ? '#FFFFFF' : '#27272A';
      ctx.lineWidth = isSelected ? 1.6 : 1;
      ctx.stroke();

      // Tay nắm kéo độ dài cạnh phải
      if (nw >= 20) {
        ctx.fillStyle = 'rgba(9, 9, 11, 0.45)';
        ctx.fillRect(nx + nw - 4, ny + 3, 1.5, nh - 6);
      }

      // Tên nốt Monospace ngay bên trong thanh nốt
      if (nw >= 26) {
        ctx.fillStyle = '#09090B';
        ctx.font = `700 10px ${monoFont}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(midiToNoteName(note.midi, preferFlats), nx + 4.5, ny + nh / 2 + 0.5);
      }
    }

    // 2f. Kim chạy thời gian DAW (Playhead trắng bạc sắc nét)
    if (isPlaying || playBeat > 0) {
      const px = Math.round(this.beatToX(playBeat)) + 0.5;
      if (px >= kw && px <= w) {
        ctx.strokeStyle = '#FAFAFA';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px, hh);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
    }

    ctx.restore(); // Kết thúc clip lưới chính

    // 3. Bàn phím đàn Monochrome bên trái
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, hh, kw, h - hh);
    ctx.clip();

    const blackKeyW = Math.round(kw * 0.62);

    for (let r = firstRow; r <= lastRow; r++) {
      const midi = MAX_MIDI - r;
      const pc = ((midi % 12) + 12) % 12;
      const y = hh + r * rh - this.scrollY;
      const black = isBlackKey(midi);
      const inScale = scaleSet.has(pc);
      const isRoot = pc === this.keyPc;
      const isPressed = this.activePianoKey === midi;

      if (!black) {
        ctx.fillStyle = isPressed ? '#FFFFFF' : inScale ? '#E4E4E7' : '#D4D4D8';
        ctx.fillRect(0, y, kw - 1, rh);

        ctx.strokeStyle = '#A1A1AA';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y + rh) - 0.5);
        ctx.lineTo(kw - 1, Math.round(y + rh) - 0.5);
        ctx.stroke();

        if (isRoot) {
          ctx.fillStyle = '#18181B';
          ctx.fillRect(kw - 4, y + 1.5, 3, rh - 3);
        } else if (inScale) {
          ctx.fillStyle = 'rgba(24, 24, 27, 0.45)';
          ctx.fillRect(kw - 3, y + 4, 2, rh - 8);
        }

        if (pc === 0 || isRoot || isPressed) {
          ctx.fillStyle = '#09090B';
          ctx.font = pc === 0 || isRoot ? `700 10px ${monoFont}` : `600 9px ${monoFont}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(midiToNoteName(midi, preferFlats), kw - 7, y + rh / 2 + 0.5);
        }
      } else {
        ctx.fillStyle = '#D4D4D8';
        ctx.fillRect(blackKeyW - 1, y, kw - blackKeyW, rh);

        ctx.strokeStyle = '#A1A1AA';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(blackKeyW - 1, Math.round(y + rh / 2) + 0.5);
        ctx.lineTo(kw - 1, Math.round(y + rh / 2) + 0.5);
        ctx.stroke();

        if (isRoot) {
          ctx.fillStyle = '#18181B';
          ctx.fillRect(kw - 4, y + 1.5, 3, rh - 3);
        } else if (inScale) {
          ctx.fillStyle = 'rgba(24, 24, 27, 0.45)';
          ctx.fillRect(kw - 3, y + 4, 2, rh - 8);
        }

        ctx.fillStyle = isPressed ? '#71717A' : '#18181B';
        ctx.fillRect(0, y + 1, blackKeyW, rh - 2);

        ctx.fillStyle = isPressed ? '#A1A1AA' : '#27272A';
        ctx.fillRect(0, y + 1, blackKeyW - 2, 2);
        ctx.strokeStyle = '#09090B';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, y + 1.5, blackKeyW - 1, rh - 3);

        if (isPressed || isRoot) {
          ctx.fillStyle = isPressed ? '#FAFAFA' : '#A1A1AA';
          ctx.font = `600 8.5px ${monoFont}`;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(midiToNoteName(midi, preferFlats), blackKeyW - 4, y + rh / 2 + 0.5);
        }
      }
    }

    ctx.strokeStyle = '#09090B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(kw - 0.5, hh);
    ctx.lineTo(kw - 0.5, h);
    ctx.stroke();

    ctx.restore();

    // 4. Thước đo nhịp DAW (Time Ruler) phía trên cùng
    ctx.fillStyle = '#0E0E12';
    ctx.fillRect(0, 0, w, hh);

    ctx.fillStyle = '#141418';
    ctx.fillRect(0, 0, kw, hh);
    ctx.fillStyle = '#A1A1AA';
    ctx.font = `700 9.5px ${monoFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PIANO', kw / 2, hh / 2 + 0.5);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(kw - 0.5, 0);
    ctx.lineTo(kw - 0.5, hh);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(kw, 0, w - kw, hh);
    ctx.clip();

    for (let bar = 0; bar < this.totalBars; bar++) {
      const bx = this.beatToX(bar * 4);
      const barW = 4 * bw;
      if (bx + barW < kw || bx > w) continue;

      const vc = this.voicedChords[bar];
      const isCur = bar === activeBar;

      if (isCur) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(bx, 0, barW, hh);
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(bx) + 0.5, 0);
      ctx.lineTo(Math.round(bx) + 0.5, hh);
      ctx.stroke();

      ctx.fillStyle = isCur ? '#FFFFFF' : '#E4E4E7';
      ctx.font = `700 11px ${monoFont}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(String(bar + 1), bx + 5, 3.5);

      if (vc) {
        ctx.fillStyle = isCur ? '#D4D4D8' : '#71717A';
        ctx.font = `600 10px ${monoFont}`;
        ctx.fillText(vc.symbol, bx + 18, 4);
      }

      for (let sub = 1; sub < 4; sub++) {
        const sx = Math.round(this.beatToX(bar * 4 + sub)) + 0.5;
        if (sx < kw || sx > w) continue;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx, hh - 9);
        ctx.lineTo(sx, hh);
        ctx.stroke();

        if (bw >= 38) {
          ctx.fillStyle = '#71717A';
          ctx.font = `500 9px ${monoFont}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${bar + 1}.${sub + 1}`, sx + 3, hh - 2);
        }
      }
    }

    if (isPlaying || playBeat > 0) {
      const px = Math.round(this.beatToX(playBeat)) + 0.5;
      if (px >= kw && px <= w) {
        ctx.fillStyle = '#FAFAFA';
        ctx.beginPath();
        ctx.moveTo(px - 6, hh - 11);
        ctx.lineTo(px + 6, hh - 11);
        ctx.lineTo(px + 6, hh - 7);
        ctx.lineTo(px, hh);
        ctx.lineTo(px - 6, hh - 7);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, hh - 0.5);
    ctx.lineTo(w, hh - 0.5);
    ctx.stroke();

    ctx.restore();
  }

  getCurrentBeatSafe() {
    try {
      return this.getPlayheadBeat();
    } catch (_) {
      return 0;
    }
  }

  _drawRoundedRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }
}
