// ============================================================================
// midiController.js — Bộ Điều Khiển Nhập Liệu Hợp Nhất (Web MIDI + QWERTY + Cảm ứng Đa điểm + Chord Latch)
// Hoạt động hoàn hảo 100% không cần phần cứng ngoài; tự động Plug & Play khi cắm đàn USB-MIDI.
// ============================================================================

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

    // Thiết bị phần cứng đang kết nối (hoặc mô phỏng khi test)
    this.connectedDevices = [];
    this._simulatedDeviceName = null;

    // Quãng nốt & cấu hình nhập liệu
    this.octaveShift = 0; // -1 | 0 | +1
    this.baseMidi = 48;   // C3 mặc định (dịch -1 -> C2=36, +1 -> C4=60)
    this.qwertyEnabled = true;
    this.chordLatchEnabled = false;
    this.sustainDown = false;

    // Trạng thái nốt đang giữ theo từng nguồn để không xung đột nhả phím
    this.heldMidi = new Map();         // midi -> { velocity, deviceName }
    this.heldQwertyKeyToMidi = new Map(); // key -> midi
    this.heldPointers = new Map();     // pointerId -> midi
    this.sustainedNotes = new Set();   // midi giữ bởi Sustain Pedal (CC 64)
    this.latchedNotes = new Set();     // midi giữ bởi Chord Latch (chuột đơn điểm)

    this._listeners = new Set();
    this._qwertyActiveCheck = () => false;
    this._boundInputs = new Set();
    this._keyboardBound = false;

    this._bindKeyboardListeners();
  }

  setQwertyActiveCheck(fn) {
    this._qwertyActiveCheck = typeof fn === 'function' ? fn : () => false;
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

  getDeviceStatus() {
    const devices = this._simulatedDeviceName
      ? [this._simulatedDeviceName, ...this.connectedDevices.filter((d) => d !== this._simulatedDeviceName)]
      : [...this.connectedDevices];
    const connected = devices.length > 0;
    const primaryDevice = connected ? devices[0] : null;
    return {
      connected,
      devices,
      primaryDevice,
      label: connected
        ? `Đã kết nối MIDI: ${primaryDevice}`
        : 'Chế độ: Phím ảo & Bàn phím PC',
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
  // Web MIDI Plug & Play (Tùy chọn tự động, không báo lỗi khi thiếu phần cứng)
  // ==========================================================================
  async initWebMidi() {
    if (this.midiAccess) return true;
    if (this.midiInitPromise) return this.midiInitPromise;
    if (!this.midiSupported) return false;

    this.midiInitPromise = (async () => {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        this.midiAccess = access;
        this._syncMidiInputs();
        access.onstatechange = () => {
          this._syncMidiInputs();
        };
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

  _syncMidiInputs() {
    if (!this.midiAccess) return;
    const prevPrimary = this.getDeviceStatus().primaryDevice;
    const names = [];
    const activeSet = new Set();

    try {
      this.midiAccess.inputs.forEach((input) => {
        if (!input || input.state !== 'connected') return;
        const name = (input.name || input.manufacturer || 'Thiết bị MIDI USB').trim();
        names.push(name);
        activeSet.add(input);
        if (!this._boundInputs.has(input)) {
          this._boundInputs.add(input);
          input.onmidimessage = (evt) => {
            if (!evt || !evt.data || evt.data.length < 2) return;
            const status = evt.data[0];
            const data1 = evt.data[1];
            const data2 = evt.data.length > 2 ? evt.data[2] : 0;
            this.handleRawMidiMessage(status, data1, data2, name);
          };
        }
      });
    } catch (_) {}

    this._boundInputs.forEach((inp) => {
      if (!activeSet.has(inp)) {
        try { inp.onmidimessage = null; } catch (_) {}
        this._boundInputs.delete(inp);
      }
    });

    const changed =
      names.length !== this.connectedDevices.length ||
      names.some((n, i) => this.connectedDevices[i] !== n);
    this.connectedDevices = names;

    if (changed) {
      const status = this.getDeviceStatus();
      this._emit('onDeviceChange', {
        ...status,
        newlyConnected: Boolean(status.primaryDevice && status.primaryDevice !== prevPrimary),
      });
    }
  }

  simulateDeviceState(connected, deviceName = 'Virtual MIDI Keyboard') {
    const nextName = connected ? String(deviceName || 'Virtual MIDI Keyboard').trim() : null;
    if (this._simulatedDeviceName === nextName) return this.getDeviceStatus();
    const prevPrimary = this.getDeviceStatus().primaryDevice;
    this._simulatedDeviceName = nextName;
    const status = this.getDeviceStatus();
    this._emit('onDeviceChange', {
      ...status,
      newlyConnected: Boolean(status.primaryDevice && status.primaryDevice !== prevPrimary),
    });
    return status;
  }

  injectMidiMessage(status, data1, data2 = 0, deviceName = 'Virtual MIDI Keyboard') {
    if (!this._simulatedDeviceName && !this.connectedDevices.length && deviceName) {
      this.simulateDeviceState(true, deviceName);
    }
    this.handleRawMidiMessage(status, data1, data2, deviceName);
  }

  handleRawMidiMessage(status, data1, data2 = 0, deviceName = 'MIDI Keyboard') {
    const cmd = status & 0xf0;
    const channel = status & 0x0f;

    // 0x90 với velocity > 0 là Note On
    if (cmd === 0x90 && data2 > 0) {
      const midi = clampMidi(data1);
      const velocity = Math.max(0.05, Math.min(1, data2 / 127));
      this.heldMidi.set(midi, { velocity, rawVelocity: data2, deviceName });
      this.sustainedNotes.delete(midi);
      this._emit('onSignal', { source: 'midi', type: 'noteOn', midi, velocity, deviceName });
      this._emit('onNoteOn', {
        midi,
        velocity,
        rawVelocity: data2,
        channel,
        source: 'midi',
        deviceName,
      });
      this._emitActiveSnapshot();
      return;
    }

    // 0x80 hoặc 0x90 với velocity === 0 là Note Off
    if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
      const midi = clampMidi(data1);
      this.heldMidi.delete(midi);
      if (this.sustainDown) {
        this.sustainedNotes.add(midi);
      } else if (!this._isSounding(midi)) {
        this._emit('onNoteOff', { midi, channel, source: 'midi', deviceName });
      }
      this._emit('onSignal', { source: 'midi', type: 'noteOff', midi, deviceName });
      this._emitActiveSnapshot();
      return;
    }

    // 0xB0 Control Change: CC 64 là Sustain Pedal (bàn đạp vang)
    if (cmd === 0xb0 && data1 === 64) {
      const isDown = data2 >= 64;
      this._emit('onSignal', { source: 'midi', type: 'cc64', down: isDown, deviceName });
      if (isDown === this.sustainDown) return;
      this.sustainDown = isDown;
      this._emit('onSustainChange', { sustainDown: this.sustainDown, source: 'midi' });
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

export const midiController = new UnifiedMidiController();
