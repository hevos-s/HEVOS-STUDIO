// ============================================================================
// midiController.js — Bộ Điều Khiển Nhập Liệu Hợp Nhất (Web MIDI + QWERTY + Cảm ứng Đa điểm + Chord Latch)
// Hoạt động hoàn hảo 100% không cần phần cứng ngoài; tự động Plug & Play đa cổng khi cắm USB-MIDI.
// ============================================================================

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteLabel(midi) {
  const m = Math.max(0, Math.min(127, Math.round(Number(midi) || 60)));
  const pc = ((m % 12) + 12) % 12;
  const oct = Math.floor(m / 12) - 1;
  return `${NOTE_NAMES_SHARP[pc]}${oct}`;
}

export const QWERTY_NOTE_MAP = {
  // Hàng dưới: Quãng 1 (0..11) — Z X C V B N M & phím đen S D G H J
  z: 0,
  s: 1,
  x: 2,
  d: 3,
  c: 4,
  v: 5,
  g: 6,
  b: 7,
  h: 8,
  n: 9,
  j: 10,
  m: 11,
  // Hàng trên: Quãng 2 (12..23) — Q W E R T Y U & phím đen 2 3 5 6 7
  q: 12,
  '2': 13,
  w: 14,
  '3': 15,
  e: 16,
  r: 17,
  '5': 18,
  t: 19,
  '6': 20,
  y: 21,
  '7': 22,
  u: 23,
};

const OFFSET_TO_QWERTY = Object.fromEntries(
  Object.entries(QWERTY_NOTE_MAP).map(([key, offset]) => [offset, key.toUpperCase()])
);

export function getQwertyLabelForMidi(midi, baseMidi = 48) {
  const offset = Math.round(midi) - baseMidi;
  return OFFSET_TO_QWERTY[offset] || '';
}

function clampMidi(midi) {
  return Math.max(21, Math.min(108, Math.round(Number(midi) || 60)));
}

export class UnifiedMidiController {
  constructor() {
    this.midiAccess = null;
    this.midiSupported =
      typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
    this.midiInitPromise = null;

    // Thiết bị phần cứng đang kết nối (lắng nghe đồng thời tất cả cổng mặc định)
    this.connectedInputs = []; // [{ id, name, manufacturer, state }]
    this.connectedDevices = [];
    this.selectedInputId = 'all';
    this._simulatedInputs = [];
    this._simulatedDeviceName = null;
    this.lastMidiSignal = null;

    // Quãng nốt & cấu hình nhập liệu
    this.octaveShift = 0; // -1 | 0 | +1
    this.baseMidi = 48;   // C3 mặc định (dịch -1 -> C2=36, +1 -> C4=60)
    this.qwertyEnabled = true;
    this.chordLatchEnabled = false;
    this.sustainDown = false;

    // Trạng thái nốt đang giữ theo từng nguồn để không xung đột nhả phím
    this.heldMidi = new Map();            // midi -> { velocity, deviceName, channel }
    this.heldQwertyKeyToMidi = new Map(); // key -> midi
    this.heldPointers = new Map();        // pointerId -> midi
    this.sustainedNotes = new Set();      // midi giữ bởi Sustain Pedal (CC 64)
    this.latchedNotes = new Set();        // midi giữ bởi Chord Latch (chuột đơn điểm)

    this._listeners = new Set();
    this._qwertyActiveCheck = () => false;
    this._audioUnlockHandler = null;
    this._portHandlers = new Map(); // MIDIInput -> { id, name, handler, usesAddEventListener }
    this._openingPorts = new Set(); // Các MIDIInput đang chờ await input.open()
    this._stateChangeHandler = null;
    this._keyboardBound = false;

    this._bindKeyboardListeners();
  }

  setQwertyActiveCheck(fn) {
    this._qwertyActiveCheck = typeof fn === 'function' ? fn : () => false;
  }

  setAudioUnlockHandler(fn) {
    this._audioUnlockHandler = typeof fn === 'function' ? fn : null;
  }

  _unlockAudioOnMidi() {
    try {
      if (this._audioUnlockHandler) {
        this._audioUnlockHandler();
      }
    } catch (_) {}

    if (typeof window === 'undefined' || typeof window.Tone === 'undefined') return;
    const Tone = window.Tone;
    try {
      if (typeof Tone.start === 'function') {
        const res = Tone.start();
        if (res && typeof res.catch === 'function') res.catch(() => {});
      }
      const ctx = typeof Tone.getContext === 'function' ? Tone.getContext() : Tone.context;
      if (ctx && ctx.state !== 'running' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
      if (ctx && ctx.rawContext && ctx.rawContext !== ctx && ctx.rawContext.state !== 'running') {
        if (typeof ctx.rawContext.resume === 'function') {
          const rp = ctx.rawContext.resume();
          if (rp && typeof rp.catch === 'function') rp.catch(() => {});
        }
      }
    } catch (_) {}
  }

  subscribe(listenerObj) {
    if (!listenerObj || typeof listenerObj !== 'object') return () => {};
    this._listeners.add(listenerObj);
    return () => {
      this._listeners.delete(listenerObj);
    };
  }

  _emit(method, payload) {
    this._listeners.forEach((l) => {
      if (typeof l[method] === 'function') {
        try {
          l[method](payload);
        } catch (err) {
          console.warn(`[HEVOS MidiController ${method}]`, err);
        }
      }
    });
  }

  _emitActiveSnapshot() {
    this._emit('onActiveChange', {
      activeMidis: this.getActiveMidis(),
      latchedMidis: Array.from(this.latchedNotes).sort((a, b) => a - b),
      sustainedMidis: Array.from(this.sustainedNotes).sort((a, b) => a - b),
      sustainDown: this.sustainDown,
    });
  }

  _isPhysicalHeldElsewhere(midi) {
    if (this.heldMidi.has(midi)) return true;
    for (const m of this.heldQwertyKeyToMidi.values()) {
      if (m === midi) return true;
    }
    for (const m of this.heldPointers.values()) {
      if (m === midi) return true;
    }
    return false;
  }

  _isSounding(midi) {
    return (
      this._isPhysicalHeldElsewhere(midi) ||
      this.sustainedNotes.has(midi) ||
      this.latchedNotes.has(midi)
    );
  }

  getActiveMidis() {
    const out = new Set();
    this.heldMidi.forEach((_, m) => out.add(m));
    this.heldQwertyKeyToMidi.forEach((m) => out.add(m));
    this.heldPointers.forEach((m) => out.add(m));
    this.sustainedNotes.forEach((m) => out.add(m));
    this.latchedNotes.forEach((m) => out.add(m));
    return Array.from(out).sort((a, b) => a - b);
  }

  _isSecondaryPortName(name = '') {
    return /^(midiin2|midiout|2-\s|microsoft gs|loopbe)/i.test(String(name || '').trim());
  }

  _sortPortEntriesPrimaryFirst(entries) {
    return [...entries].sort((a, b) => {
      const aSec = this._isSecondaryPortName(a.name) ? 1 : 0;
      const bSec = this._isSecondaryPortName(b.name) ? 1 : 0;
      return aSec - bSec;
    });
  }

  _getAllMergedInputs() {
    const map = new Map();
    this._simulatedInputs.forEach((inp) => {
      if (inp && inp.id) map.set(inp.id, inp);
    });
    if (this._simulatedDeviceName && !this._simulatedInputs.length) {
      map.set('sim-virtual-0', { id: 'sim-virtual-0', name: this._simulatedDeviceName, state: 'connected' });
    }
    this.connectedInputs.forEach((inp) => {
      if (inp && inp.id) map.set(inp.id, inp);
    });
    return this._sortPortEntriesPrimaryFirst(Array.from(map.values()));
  }

  setSelectedInputId(inputId) {
    const nextId = inputId && inputId !== 'all' ? String(inputId) : 'all';
    if (nextId === this.selectedInputId) return this.selectedInputId;
    this.selectedInputId = nextId;
    this._emit('onDeviceChange', {
      ...this.getDeviceStatus(),
      newlyConnected: false,
    });
    return this.selectedInputId;
  }

  getDeviceStatus() {
    const inputs = this._getAllMergedInputs();
    const devices = inputs.map((i) => i.name);
    const connected = inputs.length > 0;
    const validSelected =
      this.selectedInputId !== 'all' && inputs.some((i) => i.id === this.selectedInputId);
    const effectiveSelectedId = validSelected ? this.selectedInputId : 'all';
    const chosen = validSelected ? inputs.find((i) => i.id === effectiveSelectedId) : inputs[0];
    const primaryDevice = chosen ? chosen.name : null;

    let label = 'Chế độ: Phím ảo & Bàn phím PC';
    if (connected) {
      if (effectiveSelectedId === 'all') {
        label =
          inputs.length > 1
            ? `Đã kết nối MIDI: ${primaryDevice} (+${inputs.length - 1} cổng)`
            : `Đã kết nối MIDI: ${primaryDevice}`;
      } else {
        label = `MIDI: ${primaryDevice}`;
      }
    }

    return {
      connected,
      devices,
      inputs,
      selectedInputId: effectiveSelectedId,
      primaryDevice,
      lastSignal: this.lastMidiSignal,
      label,
    };
  }

  getOctaveRangeLabel() {
    const startOct = Math.floor(this.baseMidi / 12) - 1;
    const endOct = startOct + 2;
    return `C${startOct}–B${endOct}`;
  }

  setOctaveShift(shift) {
    const nextShift = Math.max(-1, Math.min(1, Math.round(Number(shift) || 0)));
    if (nextShift === this.octaveShift) return this.octaveShift;
    this.octaveShift = nextShift;
    this.baseMidi = 48 + nextShift * 12;
    this._emit('onOctaveChange', {
      octaveShift: this.octaveShift,
      baseMidi: this.baseMidi,
      rangeLabel: this.getOctaveRangeLabel(),
    });
    return this.octaveShift;
  }

  setQwertyEnabled(enabled) {
    const next = Boolean(enabled);
    if (next === this.qwertyEnabled) return;
    this.qwertyEnabled = next;
    if (!next) {
      const toRelease = Array.from(new Set(this.heldQwertyKeyToMidi.values()));
      this.heldQwertyKeyToMidi.clear();
      toRelease.forEach((midi) => {
        if (!this._isSounding(midi)) {
          this._emit('onNoteOff', { midi, source: 'qwerty' });
        }
      });
      this._emitActiveSnapshot();
    }
  }

  setChordLatch(enabled) {
    const next = Boolean(enabled);
    if (next === this.chordLatchEnabled) return;
    this.chordLatchEnabled = next;
    if (!next) {
      this.clearLatchedNotes();
    }
  }

  clearLatchedNotes() {
    if (this.latchedNotes.size === 0) return;
    const oldLatched = Array.from(this.latchedNotes);
    this.latchedNotes.clear();
    oldLatched.forEach((midi) => {
      if (!this._isPhysicalHeldElsewhere(midi) && !this.sustainedNotes.has(midi)) {
        this._emit('onNoteOff', { midi, source: 'latch' });
      }
    });
    this._emitActiveSnapshot();
  }

  // ==========================================================================
  // Web MIDI Plug & Play — Tách biệt phần cứng khỏi DOM, mở & gắn từng cổng độc lập
  // ==========================================================================
  async initWebMidi() {
    if (this.midiAccess) {
      await this._syncMidiInputs();
      return true;
    }
    if (this.midiInitPromise) return this.midiInitPromise;
    if (!this.midiSupported) return false;

    this.midiInitPromise = (async () => {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        this.midiAccess = access;

        if (!this._stateChangeHandler) {
          this._stateChangeHandler = () => {
            this._syncMidiInputs().catch(() => {});
          };
        }
        if (typeof access.addEventListener === 'function') {
          access.addEventListener('statechange', this._stateChangeHandler);
        } else {
          access.onstatechange = this._stateChangeHandler;
        }

        await this._syncMidiInputs();
        return true;
      } catch (_) {
        // Không hiển thị thông báo lỗi gây hoang mang nếu trình duyệt chặn/không hỗ trợ Web MIDI
        return false;
      } finally {
        this.midiInitPromise = null;
      }
    })();

    return this.midiInitPromise;
  }

  async refreshInputs() {
    if (!this.midiAccess) {
      return this.initWebMidi();
    }
    await this._syncMidiInputs();
    return true;
  }

  async _bindInputPort(input, id, name) {
    if (!input) return false;
    try {
      if (!this._portHandlers.has(input)) {
        const handler = (evt) => {
          if (!evt || !evt.data || evt.data.length === 0) return;
          const status = evt.data[0];
          const data1 = evt.data.length > 1 ? evt.data[1] : 0;
          const data2 = evt.data.length > 2 ? evt.data[2] : 0;
          this.handleRawMidiMessage(status, data1, data2, name, id);
        };
        const usesAddEventListener = typeof input.addEventListener === 'function';
        if (usesAddEventListener) {
          input.addEventListener('midimessage', handler);
        } else {
          input.onmidimessage = handler;
        }
        this._portHandlers.set(input, { id, name, handler, usesAddEventListener });
      }

      if (typeof input.open === 'function' && input.connection !== 'open' && !this._openingPorts.has(input)) {
        this._openingPorts.add(input);
        try {
          await input.open();
        } finally {
          this._openingPorts.delete(input);
        }
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async _syncMidiInputs() {
    if (!this.midiAccess) return;
    const prevPrimary = this.getDeviceStatus().primaryDevice;
    const rawEntries = [];
    const activeSet = new Set();

    try {
      const rawInputs =
        typeof this.midiAccess.inputs?.values === 'function'
          ? Array.from(this.midiAccess.inputs.values())
          : [];
      if (rawInputs.length === 0 && typeof this.midiAccess.inputs?.forEach === 'function') {
        this.midiAccess.inputs.forEach((inp) => rawInputs.push(inp));
      }

      rawInputs.forEach((input, idx) => {
        if (!input || input.state !== 'connected') return;
        const id = String(input.id || `midi-in-${idx}`);
        const name = String(input.name || input.manufacturer || `Thiết bị MIDI ${idx + 1}`).trim();
        activeSet.add(input);
        rawEntries.push({
          input,
          id,
          name,
          manufacturer: String(input.manufacturer || '').trim(),
          state: input.state,
        });
      });
    } catch (_) {}

    const sortedEntries = this._sortPortEntriesPrimaryFirst(rawEntries);
    const nextInputs = sortedEntries.map(({ id, name, manufacturer, state }) => ({
      id,
      name,
      manufacturer,
      state,
    }));

    // Gỡ listener chỉ khỏi các cổng đã rút ra
    this._portHandlers.forEach((entry, inp) => {
      if (!activeSet.has(inp)) {
        try {
          if (entry.usesAddEventListener && typeof inp.removeEventListener === 'function') {
            inp.removeEventListener('midimessage', entry.handler);
          } else {
            inp.onmidimessage = null;
          }
        } catch (_) {}
        this._portHandlers.delete(inp);
      }
    });

    const nextSig = nextInputs.map((i) => `${i.id}:${i.name}`).join('|');
    const prevSig = this.connectedInputs.map((i) => `${i.id}:${i.name}`).join('|');
    this.connectedInputs = nextInputs;
    this.connectedDevices = nextInputs.map((i) => i.name);

    if (
      this.selectedInputId !== 'all' &&
      !nextInputs.some((i) => i.id === this.selectedInputId) &&
      !this._simulatedInputs.some((i) => i.id === this.selectedInputId)
    ) {
      this.selectedInputId = 'all';
    }

    if (nextSig !== prevSig) {
      const status = this.getDeviceStatus();
      this._emit('onDeviceChange', {
        ...status,
        newlyConnected: Boolean(status.primaryDevice && status.primaryDevice !== prevPrimary),
      });
    }

    // Mở & gắn trình lắng nghe độc lập cho TỪNG cổng (SE61 & MIDIIN2 (SE61) không ghi đè hoặc làm hỏng nhau)
    await Promise.allSettled(
      sortedEntries.map(({ input, id, name }) => this._bindInputPort(input, id, name))
    );
  }

  simulateMidiPorts(ports = []) {
    const prevPrimary = this.getDeviceStatus().primaryDevice;
    this._simulatedInputs = Array.isArray(ports)
      ? ports.map((p, idx) => ({
          id: String(p.id || `sim-${idx}`),
          name: String(p.name || `Virtual MIDI ${idx + 1}`).trim(),
          state: 'connected',
        }))
      : [];
    this._simulatedDeviceName = this._simulatedInputs.length ? this._simulatedInputs[0].name : null;
    if (this.selectedInputId !== 'all' && !this._simulatedInputs.some((i) => i.id === this.selectedInputId)) {
      this.selectedInputId = 'all';
    }
    const status = this.getDeviceStatus();
    this._emit('onDeviceChange', {
      ...status,
      newlyConnected: Boolean(status.primaryDevice && status.primaryDevice !== prevPrimary),
    });
    return status;
  }

  simulateDeviceState(connected, deviceName = 'Virtual MIDI Keyboard') {
    const nextName = connected ? String(deviceName || 'Virtual MIDI Keyboard').trim() : null;
    if (this._simulatedDeviceName === nextName && this._simulatedInputs.length <= 1) {
      return this.getDeviceStatus();
    }
    const prevPrimary = this.getDeviceStatus().primaryDevice;
    this._simulatedDeviceName = nextName;
    this._simulatedInputs = nextName
      ? [{ id: 'sim-virtual-0', name: nextName, state: 'connected' }]
      : [];
    const status = this.getDeviceStatus();
    this._emit('onDeviceChange', {
      ...status,
      newlyConnected: Boolean(status.primaryDevice && status.primaryDevice !== prevPrimary),
    });
    return status;
  }

  injectMidiMessage(status, data1, data2 = 0, deviceName = 'Virtual MIDI Keyboard', inputId = null) {
    if (!this._simulatedDeviceName && !this.connectedInputs.length && deviceName) {
      this.simulateDeviceState(true, deviceName);
    }
    this.handleRawMidiMessage(status, data1, data2, deviceName, inputId);
  }

  handleRawMidiMessage(status, data1 = 0, data2 = 0, deviceName = 'MIDI Keyboard', inputId = null) {
    if (!Number.isFinite(status)) return;
    // Bỏ qua các bản tin đồng bộ xung nhịp / active sensing (0xF8, 0xFE, SysEx >= 0xF0)
    if (status >= 0xf0) return;

    // Lọc theo cổng đang chọn nếu người dùng không để chế độ "Tất cả thiết bị MIDI"
    if (this.selectedInputId !== 'all' && inputId && inputId !== this.selectedInputId) {
      return;
    }

    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1; // Kênh MIDI 1..16

    // Note On: 0x90..0x9F với velocity > 0
    if (command === 0x90 && data2 > 0) {
      // Mở khóa Web Audio ngay lập tức khi nhận Note On từ đàn cứng dù chưa click chuột vào web
      this._unlockAudioOnMidi();

      const midi = clampMidi(data1);
      const velocity = Math.max(0.05, Math.min(1, data2 / 127));
      const noteName = midiToNoteLabel(midi);
      this.heldMidi.set(midi, { velocity, rawVelocity: data2, channel, deviceName });
      this.sustainedNotes.delete(midi);

      const signalPayload = {
        source: 'midi',
        type: 'noteOn',
        channel,
        midi,
        noteName,
        velocity,
        rawVelocity: data2,
        deviceName,
        inputId,
        label: `Tín hiệu MIDI: Ch${channel} · ${noteName} · Lực ${data2}`,
        at: Date.now(),
      };
      this.lastMidiSignal = signalPayload;
      this._emit('onSignal', signalPayload);
      this._emit('onNoteOn', {
        midi,
        velocity,
        rawVelocity: data2,
        channel,
        noteName,
        source: 'midi',
        deviceName,
        inputId,
      });
      this._emitActiveSnapshot();
      return;
    }

    // Note Off: 0x80..0x8F HOẶC 0x90..0x9F với velocity === 0
    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      const midi = clampMidi(data1);
      const noteName = midiToNoteLabel(midi);
      this.heldMidi.delete(midi);
      if (this.sustainDown) {
        this.sustainedNotes.add(midi);
      } else if (!this._isSounding(midi)) {
        this._emit('onNoteOff', { midi, channel, noteName, source: 'midi', deviceName, inputId });
      }
      const signalPayload = {
        source: 'midi',
        type: 'noteOff',
        channel,
        midi,
        noteName,
        deviceName,
        inputId,
        label: `Tín hiệu MIDI: Ch${channel} · ${noteName} · Nhả`,
        at: Date.now(),
      };
      this.lastMidiSignal = signalPayload;
      this._emit('onSignal', signalPayload);
      this._emitActiveSnapshot();
      return;
    }

    // Control Change 64: Sustain Pedal (0xB0..0xBF, data1 === 64)
    if (command === 0xb0 && data1 === 64) {
      const isDown = data2 >= 64;
      const signalPayload = {
        source: 'midi',
        type: 'cc64',
        channel,
        down: isDown,
        deviceName,
        inputId,
        label: `Tín hiệu MIDI: Ch${channel} · Sustain ${isDown ? 'ON' : 'OFF'}`,
        at: Date.now(),
      };
      this.lastMidiSignal = signalPayload;
      this._emit('onSignal', signalPayload);

      if (isDown === this.sustainDown) return;
      this.sustainDown = isDown;
      this._emit('onSustainChange', { sustainDown: this.sustainDown, channel, source: 'midi' });
      if (!isDown && this.sustainedNotes.size > 0) {
        const toRelease = Array.from(this.sustainedNotes);
        this.sustainedNotes.clear();
        toRelease.forEach((midi) => {
          if (!this._isPhysicalHeldElsewhere(midi) && !this.latchedNotes.has(midi)) {
            this._emit('onNoteOff', { midi, source: 'sustain' });
          }
        });
      }
      this._emitActiveSnapshot();
    }
  }

  // ==========================================================================
  // Phím Ảo Cảm Ứng Đa Điểm & Chuột (Pointer + Chord Latch)
  // ==========================================================================
  pointerNoteOn(pointerId, midi, velocity = 0.84) {
    const m = clampMidi(midi);
    const vel = Math.max(0.08, Math.min(1, Number(velocity) || 0.84));

    if (this.chordLatchEnabled) {
      if (this.latchedNotes.has(m)) {
        this.latchedNotes.delete(m);
        if (!this._isSounding(m)) {
          this._emit('onNoteOff', { midi: m, source: 'latch' });
        }
        this._emitActiveSnapshot();
        return { latched: false, toggledOff: true };
      }
      this.latchedNotes.add(m);
      this.sustainedNotes.delete(m);
      this._emit('onNoteOn', { midi: m, velocity: vel, source: 'pointer', latched: true });
      this._emitActiveSnapshot();
      return { latched: true, toggledOff: false };
    }

    const prevMidi = this.heldPointers.get(pointerId);
    if (prevMidi === m) return { latched: false };
    if (prevMidi !== undefined) {
      this.heldPointers.delete(pointerId);
      if (this.sustainDown) {
        this.sustainedNotes.add(prevMidi);
      } else if (!this._isSounding(prevMidi)) {
        this._emit('onNoteOff', { midi: prevMidi, source: 'pointer' });
      }
    }

    const alreadyActive = this._isPhysicalHeldElsewhere(m);
    this.heldPointers.set(pointerId, m);
    this.sustainedNotes.delete(m);
    if (!alreadyActive) {
      this._emit('onNoteOn', { midi: m, velocity: vel, source: 'pointer' });
    }
    this._emitActiveSnapshot();
    return { latched: false };
  }

  pointerNoteOff(pointerId) {
    if (this.chordLatchEnabled) return;
    if (!this.heldPointers.has(pointerId)) return;
    const m = this.heldPointers.get(pointerId);
    this.heldPointers.delete(pointerId);

    if (this.sustainDown) {
      this.sustainedNotes.add(m);
    } else if (!this._isSounding(m)) {
      this._emit('onNoteOff', { midi: m, source: 'pointer' });
    }
    this._emitActiveSnapshot();
  }

  // ==========================================================================
  // Bàn phím Máy tính PC (QWERTY 2 Quãng tám)
  // ==========================================================================
  _bindKeyboardListeners() {
    if (this._keyboardBound || typeof window === 'undefined') return;
    this._keyboardBound = true;

    window.addEventListener('keydown', (e) => {
      if (!this.qwertyEnabled || !this._qwertyActiveCheck()) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = String(e.key || '').toLowerCase();
      const offset = QWERTY_NOTE_MAP[key];
      if (offset === undefined) return;

      e.preventDefault();
      if (this.heldQwertyKeyToMidi.has(key)) return;

      const midi = clampMidi(this.baseMidi + offset);
      const alreadyHeld = this._isPhysicalHeldElsewhere(midi);
      this.heldQwertyKeyToMidi.set(key, midi);
      this.sustainedNotes.delete(midi);

      if (!alreadyHeld) {
        this._emit('onNoteOn', { midi, velocity: 0.85, source: 'qwerty', key });
      }
      this._emitActiveSnapshot();
    });

    window.addEventListener('keyup', (e) => {
      const key = String(e.key || '').toLowerCase();
      if (!this.heldQwertyKeyToMidi.has(key)) return;
      const midi = this.heldQwertyKeyToMidi.get(key);
      this.heldQwertyKeyToMidi.delete(key);

      if (this.sustainDown) {
        this.sustainedNotes.add(midi);
      } else if (!this._isSounding(midi)) {
        this._emit('onNoteOff', { midi, source: 'qwerty', key });
      }
      this._emitActiveSnapshot();
    });

    window.addEventListener('blur', () => {
      this.releaseAll();
    });
  }

  releaseAll() {
    const active = this.getActiveMidis();
    this.heldMidi.clear();
    this.heldQwertyKeyToMidi.clear();
    this.heldPointers.clear();
    this.sustainedNotes.clear();
    this.latchedNotes.clear();
    if (this.sustainDown) {
      this.sustainDown = false;
      this._emit('onSustainChange', { sustainDown: false, source: 'reset' });
    }
    active.forEach((midi) => {
      this._emit('onNoteOff', { midi, source: 'reset' });
    });
    if (active.length > 0) {
      this._emitActiveSnapshot();
    }
  }
}

const GLOBAL_MIDI_KEY = '__HEVOS_UNIFIED_MIDI_CONTROLLER__';
export const midiController =
  (typeof globalThis !== 'undefined' && globalThis[GLOBAL_MIDI_KEY]) ||
  new UnifiedMidiController();
if (typeof globalThis !== 'undefined') {
  globalThis[GLOBAL_MIDI_KEY] = midiController;
}
