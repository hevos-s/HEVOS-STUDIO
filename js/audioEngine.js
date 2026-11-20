// ============================================================================
// audioEngine.js — Bộ máy Âm thanh Tone.js: Đệm hợp âm có hồn, 4 chất tiếng,
// 4 kiểu đệm, Nhịp trống, Giai điệu, Giọng thu nháp, Mixer 4 kênh & Xuất Audio
// ============================================================================

import { buildBarChordEvents, midiToToneNote } from './theory.js?v=10';

export const CHORD_TIMBRES = [
  { id: 'rhodes', label: 'Rhodes / EP Ấm' },
  { id: 'piano',  label: 'Grand Piano Êm' },
  { id: 'pad',    label: 'Pad Lo-Fi Mơ Màng' },
  { id: 'guitar', label: 'Guitar Acoustic Gảy' },
];

export const CHORD_STYLES = [
  { id: 'rnb',    label: 'Lơi nhịp R&B / Neo-Soul' },
  { id: 'ballad', label: 'Rải Ballad' },
  { id: 'pop',    label: 'Đệm Pop Hiện Đại' },
  { id: 'strum',  label: 'Quạt chả Acoustic' },
];

export const DRUM_PATTERNS = [
  { id: 'off',       label: 'Tắt trống' },
  { id: 'metronome', label: 'Đập nhịp Metronome' },
  { id: 'lofi',      label: 'Lo-Fi / R&B' },
  { id: 'pop',       label: 'Pop' },
  { id: 'ballad',    label: 'Ballad' },
];

export const MELODY_TIMBRES = [
  { id: 'bell',  label: 'Chuông êm / Pluck' },
  { id: 'lead',  label: 'Synth Lead ấm' },
  { id: 'flute', label: 'Sáo / Vocal Pad' },
  { id: 'ep',    label: 'Electric Piano' },
];

// Bản đồ nốt trống chuẩn General MIDI (Kênh 10 / MIDI Channel 9)
export const GM_DRUM_NOTES = {
  kick: 36,      // C1  — Bass Drum 1
  rim: 37,       // C#1 — Side Stick / Rimshot
  snare: 38,     // D1  — Acoustic Snare
  closedHat: 42, // F#1 — Closed Hi-Hat
  openHat: 46,   // A#1 — Open Hi-Hat
};

/**
 * Kiểm tra một kênh trên Mixer có đang phát tiếng hay không (tôn trọng cả Mute & Solo)
 */
export function isMixerChannelAudible(mixer, channelKey) {
  if (!mixer || !mixer[channelKey]) return true;
  const anySolo = Object.values(mixer).some((ch) => Boolean(ch && ch.solo));
  const ch = mixer[channelKey];
  return !ch.muted && (!anySolo || Boolean(ch.solo));
}

/**
 * Hàm nhiễu giả ngẫu nhiên thuần (deterministic) trả về giá trị trong [-1, 1]
 * giúp độ tự nhiên (Humanize) nghe phiêu như người thật và đồng nhất giữa trình phát & xuất MIDI.
 */
function deterministicUnit(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return (x - Math.floor(x)) * 2 - 1;
}

/**
 * Áp dụng độ lơi Swing cho các phách lẻ (đồng bộ giữa Hợp âm, Bass và Trống)
 */
export function applySwingBeat(beat, totalBeats, chordStyle = 'rnb', drumPattern = 'lofi', humanize = 55) {
  const humanAmt = Math.max(0, Math.min(100, Number(humanize) || 0)) / 100;
  const swingAmountBeats =
    (chordStyle === 'rnb' || drumPattern === 'lofi' ? 0.055 : 0.025) * humanAmt;

  const frac = beat - Math.floor(beat);
  let b = beat;
  if (Math.abs(frac - 0.5) < 0.04) {
    b += swingAmountBeats;
  } else if (Math.abs(frac - 0.75) < 0.04) {
    b += swingAmountBeats * 0.65;
  } else if (Math.abs(frac - 0.25) < 0.04) {
    b += swingAmountBeats * 0.28;
  }
  return Math.max(0, Math.min(totalBeats - 0.03, b));
}

/**
 * Hàm thuần sinh toàn bộ sự kiện nốt Hợp âm (tay phải) và Bass nền cho cả vòng lặp.
 * Trả về { chordEvents, bassEvents, allEvents } dạng { midi, startBeat, durationBeat, velocity, role }.
 * Đã áp dụng đầy đủ Voice Leading, Kiểu đệm, độ dài Loop (4/8 ô), Swing & Humanize.
 */
export function generateAccompanimentEvents({
  voicedChords = [],
  totalBars = 4,
  bpm = 84,
  chordStyle = 'rnb',
  drumPattern = 'lofi',
  humanize = 55,
}) {
  const totalBeats = totalBars * 4;
  const clampedBpm = Math.max(40, Math.min(240, Number(bpm) || 84));
  const beatsPerSec = clampedBpm / 60;
  const humanAmt = Math.max(0, Math.min(100, Number(humanize) || 0)) / 100;

  const chordEvents = [];
  const bassEvents = [];
  const allEvents = [];

  voicedChords.slice(0, totalBars).forEach((vc, barIdx) => {
    const barEvents = buildBarChordEvents(vc, barIdx, chordStyle);
    barEvents.forEach((ev, evIdx) => {
      const swungBeat = applySwingBeat(
        ev.startBeat,
        totalBeats,
        chordStyle,
        drumPattern,
        humanize
      );

      // Humanize vi thời gian (±8..14ms) và lực nhấn (velocity) theo từng nốt
      const seed = (barIdx + 1) * 131 + (evIdx + 1) * 37 + ev.midi * 7;
      const timeNoise = deterministicUnit(seed);
      const velNoise = deterministicUnit(seed + 503);

      // Giữ độ lệch Bass gọn hơn nhẹ nhàng so với tay phải để nền vững nhịp
      const maxJitterSec = (ev.role === 'bass' ? 0.008 : 0.013) * humanAmt;
      let jitterBeats = timeNoise * maxJitterSec * beatsPerSec;
      // Nốt mở đầu tại phách 0 chỉ dịch >= 0 để không âm tick
      if (swungBeat + jitterBeats < 0) jitterBeats = Math.abs(jitterBeats) * 0.5;

      const startBeat = Math.max(0, Math.min(totalBeats - 0.04, swungBeat + jitterBeats));
      const rawDur = ev.durationBeat ?? ev.durationBeats ?? 0.5;
      const durationBeat = Math.max(0.08, Math.min(rawDur, totalBeats - startBeat));
      const velocity = Math.max(
        0.18,
        Math.min(0.96, ev.velocity + velNoise * 0.085 * humanAmt)
      );

      const noteEvent = {
        midi: Math.max(0, Math.min(127, Math.round(ev.midi))),
        startBeat: Number(startBeat.toFixed(5)),
        durationBeat: Number(durationBeat.toFixed(5)),
        velocity: Number(velocity.toFixed(3)),
        role: ev.role === 'bass' ? 'bass' : 'chord',
      };

      allEvents.push(noteEvent);
      if (noteEvent.role === 'bass') {
        bassEvents.push(noteEvent);
      } else {
        chordEvents.push(noteEvent);
      }
    });
  });

  return { chordEvents, bassEvents, allEvents };
}

/**
 * Hàm thuần sinh toàn bộ sự kiện Trống cho cả vòng lặp (4 hoặc 8 ô) với chuẩn GM Drum Map:
 * Kick=36, Rimshot=37, Snare=38, Closed Hi-Hat=42, Open Hi-Hat=46.
 * Trả về mảng { midi, startBeat, durationBeat, velocity, drumType, openHat }.
 */
export function generateDrumEvents({
  totalBars = 4,
  bpm = 84,
  drumPattern = 'lofi',
  chordStyle = 'rnb',
  humanize = 55,
}) {
  if (!drumPattern || drumPattern === 'off') return [];

  const totalBeats = totalBars * 4;
  const clampedBpm = Math.max(40, Math.min(240, Number(bpm) || 84));
  const beatsPerSec = clampedBpm / 60;
  const humanAmt = Math.max(0, Math.min(100, Number(humanize) || 0)) / 100;
  const events = [];
  let seqIdx = 0;

  const add = (bar, beat, drumType, baseVel = 0.75, openHat = false) => {
    seqIdx += 1;
    const absBeat = bar * 4 + beat;
    let b = applySwingBeat(absBeat, totalBeats, chordStyle, drumPattern, humanize);

    // R&B / Lo-Fi kéo Snare/Rim hơi lùi nhịp tạo độ chill (pocket)
    if (drumPattern === 'lofi' && (drumType === 'rim' || drumType === 'snare')) {
      b += 0.009 * humanAmt * beatsPerSec;
    }

    // Humanize nhẹ cho trống (trừ metronome cần chính xác tuyệt đối)
    const isMetronome = drumType === 'clickAccent' || drumType === 'click';
    const seed = (bar + 1) * 197 + seqIdx * 41;
    let jitterBeats = 0;
    let velDelta = 0;
    if (!isMetronome && humanAmt > 0) {
      const maxDrumJitterSec = (drumType === 'hat' ? 0.009 : 0.006) * humanAmt;
      jitterBeats = deterministicUnit(seed) * maxDrumJitterSec * beatsPerSec;
      if (b + jitterBeats < 0) jitterBeats = 0;
      velDelta = deterministicUnit(seed + 701) * 0.075 * humanAmt;
    }

    const startBeat = Math.max(0, Math.min(totalBeats - 0.04, b + jitterBeats));
    const defaultDur = openHat ? 0.35 : drumType === 'kick' || drumType === 'snare' ? 0.25 : 0.15;
    const durationBeat = Math.max(0.06, Math.min(defaultDur, totalBeats - startBeat));
    const velocity = Math.max(0.16, Math.min(0.98, baseVel + velDelta));

    let midi = GM_DRUM_NOTES.kick;
    if (drumType === 'kick') midi = GM_DRUM_NOTES.kick;
    else if (drumType === 'rim' || drumType === 'clickAccent' || drumType === 'click') midi = GM_DRUM_NOTES.rim;
    else if (drumType === 'snare') midi = GM_DRUM_NOTES.snare;
    else if (drumType === 'hat') midi = openHat ? GM_DRUM_NOTES.openHat : GM_DRUM_NOTES.closedHat;

    events.push({
      midi,
      startBeat: Number(startBeat.toFixed(5)),
      durationBeat: Number(durationBeat.toFixed(5)),
      velocity: Number(velocity.toFixed(3)),
      drumType,
      openHat: Boolean(openHat),
    });
  };

  for (let bar = 0; bar < totalBars; bar++) {
    if (drumPattern === 'metronome') {
      add(bar, 0, 'clickAccent', 0.90);
      add(bar, 1, 'click', 0.58);
      add(bar, 2, 'click', 0.58);
      add(bar, 3, 'click', 0.58);
    } else if (drumPattern === 'lofi') {
      // Kick ấm lơi nhịp
      add(bar, 0.0, 'kick', 0.88);
      if (bar % 2 === 1) add(bar, 1.75, 'kick', 0.45);
      add(bar, 2.5, 'kick', 0.78);
      // Rimshot + snare mềm ở phách 2 và 4
      add(bar, 1.0, 'rim', 0.72);
      add(bar, 1.0, 'snare', 0.40);
      add(bar, 3.0, 'rim', 0.76);
      add(bar, 3.0, 'snare', 0.45);
      // Hi-hat nhấp nhô tự nhiên
      for (let step = 0; step < 8; step++) {
        const vel = step % 2 === 0 ? 0.52 : 0.28;
        add(bar, step * 0.5, 'hat', vel, step === 7 && bar % 2 === 1);
      }
    } else if (drumPattern === 'pop') {
      // Pop năng động
      add(bar, 0.0, 'kick', 0.92);
      add(bar, 1.5, 'kick', 0.72);
      add(bar, 2.0, 'kick', 0.86);
      add(bar, 1.0, 'snare', 0.82);
      add(bar, 1.0, 'rim', 0.45);
      add(bar, 3.0, 'snare', 0.86);
      add(bar, 3.0, 'rim', 0.48);
      for (let step = 0; step < 8; step++) {
        const vel = step % 2 === 0 ? 0.58 : 0.34;
        add(bar, step * 0.5, 'hat', vel, step === 7);
      }
    } else if (drumPattern === 'ballad') {
      // Ballad tinh tế, thoáng cho giọng hát
      add(bar, 0.0, 'kick', 0.80);
      add(bar, 2.5, 'kick', 0.64);
      add(bar, 1.0, 'rim', 0.56);
      add(bar, 3.0, 'rim', 0.62);
      add(bar, 3.0, 'snare', 0.32);
      for (let step = 0; step < 8; step++) {
        const vel = step % 2 === 0 ? 0.34 : 0.20;
        add(bar, step * 0.5, 'hat', vel, false);
      }
    }
  }

  return events;
}

/**
 * Hàm thuần chuẩn hóa danh sách nốt Giai điệu MIDI từ bảng Piano Roll
 */
export function generateMelodyEvents({ melodyNotes = [], totalBars = 4, bpm = 84, humanize = 0 }) {
  const totalBeats = totalBars * 4;
  const clampedBpm = Math.max(40, Math.min(240, Number(bpm) || 84));
  const beatsPerSec = clampedBpm / 60;
  const humanAmt = Math.max(0, Math.min(100, Number(humanize) || 0)) / 100;
  const events = [];

  melodyNotes.forEach((note, idx) => {
    if (note.startBeat < 0 || note.startBeat >= totalBeats) return;
    const seed = (idx + 1) * 73 + note.midi * 13;
    let jitterBeats = humanAmt > 0 ? deterministicUnit(seed) * 0.004 * humanAmt * beatsPerSec : 0;
    if (note.startBeat + jitterBeats < 0) jitterBeats = 0;

    const startBeat = Math.max(0, Math.min(totalBeats - 0.04, note.startBeat + jitterBeats));
    const rawDur = note.durationBeat ?? note.durationBeats ?? 0.5;
    const durationBeat = Math.max(0.06, Math.min(rawDur, totalBeats - startBeat));
    const velocity = Math.max(0.2, Math.min(0.98, note.velocity ?? 0.82));

    events.push({
      midi: Math.max(0, Math.min(127, Math.round(note.midi))),
      startBeat: Number(startBeat.toFixed(5)),
      durationBeat: Number(durationBeat.toFixed(5)),
      velocity: Number(velocity.toFixed(3)),
    });
  });

  return events;
}

class AudioEngine {
  constructor() {
    this.initialized = false;
    this.isPlaying = false;
    this.isExporting = false;

    // Trạng thái nhạc hiện hành để dựng lại lịch phát
    this.state = {
      bpm: 84,
      totalBars: 4,
      humanize: 55,
      chordTimbre: 'rhodes',
      chordStyle: 'rnb',
      drumPattern: 'lofi',
      melodyTimbre: 'bell',
      voicedChords: [],
      melodyNotes: [],
      mixer: {
        chords: { volume: 78, muted: false, solo: false },
        melody: { volume: 82, muted: false, solo: false },
        drums:  { volume: 68, muted: false, solo: false },
        vocal:  { volume: 75, muted: false, solo: false },
        vocal2: { volume: 72, muted: false, solo: false },
      },
    };

    // Nodes
    this.masterLimiter = null;
    this.masterEQ = null;
    this.masterBus = null;
    this.reverbSend = null;
    this.reverb = null;
    this.reverbReturn = null;
    this.chordChorus = null;

    this.channels = {};
    this.chordSynths = {};
    this.melodySynths = {};
    this.drums = {};
    this.countInSynth = null;
    this.trainerPiano = null;
    this.trainerWrongSynth = null;
    this.trainerClickSynth = null;

    // Thu nháp MIDI cũ (single track legacy)
    this.vocalPlayer = null;
    this.hasRawVocal = false;
    this._vocalObjectUrl = null;
    this._pendingVocalSource = null;
    this._muteVocalDuringRecord = false;
    this._recordingTrackMask = null;

    // 2 Kênh Thu âm Vocal Studio chuyên sâu (Lead + Backing/Ad-lib) kèm kệ hiệu ứng thời gian thực
    this.vocalTracks = {
      lead: this._makeEmptyVocalTrack('lead', 'vocal'),
      backing: this._makeEmptyVocalTrack('backing', 'vocal2'),
    };

    // Tone.Part & scheduled event IDs
    this.chordPart = null;
    this.melodyPart = null;
    this.drumPart = null;
    this.vocalEventId = null;

    // Chống trùng timestamp cho các bộ gõ monophonic
    this._lastDrumTime = { kick: -1, snare: -1, rim: -1, hat: -1, click: -1 };
    this._countInTimers = [];
    this._countInCancelled = false;
    this._loopEndCallbackId = null;
  }

  /**
   * Mở khóa Web Audio Context an toàn (tương thích iOS Safari & Chrome)
   */
  async ensureReady() {
    if (typeof window.Tone === 'undefined') {
      throw new Error('Không tìm thấy thư viện Tone.js. Vui lòng kiểm tra kết nối mạng.');
    }
    const Tone = window.Tone;
    await Tone.start();
    if (Tone.context.state !== 'running') {
      await Tone.context.resume();
    }
    if (!this.initialized) {
      this._initGraph();
    }
  }

  _initGraph() {
    const Tone = window.Tone;

    // Chuỗi Master ấm tai, chống vỡ tiếng
    this.masterLimiter = new Tone.Limiter(-1.5).toDestination();
    this.masterEQ = new Tone.EQ3({
      low: 1.2,
      mid: 0,
      high: -1.2,
      lowFrequency: 180,
      highFrequency: 4600,
    }).connect(this.masterLimiter);
    this.masterBus = new Tone.Gain(0.92).connect(this.masterEQ);

    // Reverb chung song song (Dry luôn kêu ngay không chờ tạo IR)
    this.reverbSend = new Tone.Gain(1);
    this.reverb = new Tone.Reverb({ decay: 2.3, preDelay: 0.018, wet: 1 });
    this.reverbReturn = new Tone.Gain(0.32).connect(this.masterBus);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);

    // Chorus ấm cho đàn đệm
    this.chordChorus = new Tone.Chorus({
      frequency: 1.3,
      delayTime: 3.4,
      depth: 0.42,
      wet: 0.34,
    }).start();

    // 5 Kênh Mixer độc lập (thêm Hát bè vocal2)
    this.channels = {
      chords: new Tone.Gain(0.8).connect(this.masterBus),
      melody: new Tone.Gain(0.85).connect(this.masterBus),
      drums:  new Tone.Gain(0.7).connect(this.masterBus),
      vocal:  new Tone.Gain(0.75).connect(this.masterBus),
      vocal2: new Tone.Gain(0.72).connect(this.masterBus),
    };

    // Đồng hồ đo mức tín hiệu từng kênh (Post-fader Level Meters)
    this.channelMeters = {
      chords: new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
      melody: new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
      drums:  new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
      vocal:  new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
      vocal2: new Tone.Meter({ normalRange: true, smoothing: 0.78 }),
    };
    Object.keys(this.channels).forEach((key) => {
      this.channels[key].connect(this.channelMeters[key]);
    });

    // Nối Chorus vào kênh hợp âm một lần duy nhất
    this.chordChorus.connect(this.channels.chords);

    // Bộ lọc làm ấm cho kênh Ngân nga MIDI cũ
    this.vocalHPF = new Tone.Filter(95, 'highpass');
    this.vocalComp = new Tone.Compressor(-18, 3);
    this.vocalReverbSend = new Tone.Gain(0.16);
    this.vocalHPF.connect(this.vocalComp);
    this.vocalComp.connect(this.channels.vocal);
    this.vocalComp.connect(this.vocalReverbSend);
    this.vocalReverbSend.connect(this.reverbSend);

    // Dựng kệ hiệu ứng thời gian thực riêng biệt cho 2 kênh Vocal Studio (Giọng chính & Hát bè)
    this.vocalTracks.lead.chain = this._createVocalChain(this.channels.vocal);
    this.vocalTracks.backing.chain = this._createVocalChain(this.channels.vocal2);

    // Bộ trống tổng hợp sắc nét
    this._initDrums();

    // Tiếng gõ đếm vào (Count-in) đi thẳng ra masterBus để luôn nghe rõ kể cả khi tắt trống
    this.countInSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.045, sustain: 0, release: 0.03 },
      volume: -6,
    }).connect(this.masterBus);

    // Khởi tạo sẵn 2 tiếng mặc định
    this._getChordSynth(this.state.chordTimbre);
    this._getMelodySynth(this.state.melodyTimbre);
    this._ensureTrainerSynths();

    this.applyMixer(this.state.mixer);
    this.initialized = true;

    // Áp dụng các FX / Vocal đã nạp sẵn trước khi mở khóa AudioContext
    ['lead', 'backing'].forEach((tid) => {
      const t = this.vocalTracks[tid];
      if (t.pendingFx) this.updateVocalTrackFx(tid, t.pendingFx);
      if (t.pendingBlob) {
        const blob = t.pendingBlob;
        const off = t.syncOffsetMs;
        t.pendingBlob = null;
        this.setVocalTrackAudio(tid, blob, off).catch(() => {});
      }
    });
  }

  _makeEmptyVocalTrack(id, mixerKey) {
    return {
      id,
      mixerKey,
      player: null,
      objectUrl: null,
      eventId: null,
      syncOffsetMs: 0,
      hasAudio: false,
      chain: null,
      pendingBlob: null,
      pendingFx: null,
      loadSeq: 0,
    };
  }

  /**
   * Tạo kệ hiệu ứng Tone.js riêng cho mỗi kênh Vocal:
   * Player -> Gate -> HPF/LPF -> EQ3 -> Compressor -> Warm Dist -> PitchShift -> Chorus -> Panner -> Channel + (Reverb & Delay Send)
   */
  _createVocalChain(destChannel) {
    const Tone = window.Tone;
    const input = new Tone.Gain(1);
    const gate = new Tone.Gate({ threshold: -100, smoothing: 0.05 });
    const hpf = new Tone.Filter(90, 'highpass');
    const lpf = new Tone.Filter(18000, 'lowpass');
    const eq = new Tone.EQ3({
      low: 0,
      mid: 0,
      high: 0,
      lowFrequency: 220,
      highFrequency: 4500,
    });
    const comp = new Tone.Compressor({
      threshold: -18,
      ratio: 3.5,
      attack: 0.008,
      release: 0.14,
    });
    const dist = new Tone.Distortion({ distortion: 0.28, wet: 0 });
    const pitch = new Tone.PitchShift({ pitch: 0, windowSize: 0.08, delayTime: 0, wet: 0 });
    const chorus = new Tone.Chorus({
      frequency: 1.35,
      delayTime: 3.4,
      depth: 0.35,
      wet: 0,
    }).start();
    const panner = new Tone.Panner(0);

    // Song song Reverb & Delay (Dry luôn phát ngay kể cả khi Reverb đang dựng Impulse Response)
    const reverbSend = new Tone.Gain(0.14);
    const reverb = new Tone.Reverb({ decay: 1.5, preDelay: 0.015, wet: 1 });
    const delaySend = new Tone.Gain(0);
    const delay = new Tone.FeedbackDelay({ delayTime: 0.35, feedback: 0.3, wet: 1 });

    input.connect(gate);
    gate.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(eq);
    eq.connect(comp);
    comp.connect(dist);
    dist.connect(pitch);
    pitch.connect(chorus);
    chorus.connect(panner);
    panner.connect(destChannel);

    panner.connect(reverbSend);
    reverbSend.connect(reverb);
    reverb.connect(destChannel);

    panner.connect(delaySend);
    delaySend.connect(delay);
    delay.connect(destChannel);

    return {
      input,
      gate,
      hpf,
      lpf,
      eq,
      comp,
      dist,
      pitch,
      chorus,
      panner,
      reverbSend,
      reverb,
      delaySend,
      delay,
      lastDecay: 1.5,
      delayDiv: '8n',
    };
  }

  _ensureTrainerSynths() {
    if (this.trainerPiano) return;
    const Tone = window.Tone;
    if (!Tone || !this.masterBus) return;

    const filter = new Tone.Filter(2800, 'lowpass');
    const revSend = new Tone.Gain(0.22).connect(this.reverbSend);
    this.trainerPiano = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 10,
      volume: -6,
      oscillator: {
        type: 'custom',
        partials: [1, 0.42, 0.2, 0.09, 0.04],
      },
      envelope: { attack: 0.006, decay: 1.4, sustain: 0.14, release: 0.75 },
    });
    this.trainerPiano.connect(filter);
    filter.connect(this.masterBus);
    filter.connect(revSend);

    this.trainerWrongSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.09, sustain: 0, release: 0.05 },
      volume: -13,
    }).connect(this.masterBus);

    this.trainerClickSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
      volume: -10,
    }).connect(this.masterBus);
  }

  _initDrums() {
    const Tone = window.Tone;
    const drumBus = this.channels.drums;

    // Kick sâu gọn
    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.045,
      octaves: 5.2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.30, sustain: 0.01, release: 0.22 },
      volume: -4,
    }).connect(drumBus);

    // Snare noise (lọc bandpass gọn)
    const snareFilter = new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 0.9 }).connect(drumBus);
    const snareNoise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.05 },
      volume: -9,
    }).connect(snareFilter);
    snareFilter.connect(new Tone.Gain(0.18).connect(this.reverbSend));

    // Rimshot / Snare tonal body (rất hợp Lo-Fi / R&B / Ballad)
    const rim = new Tone.MembraneSynth({
      pitchDecay: 0.015,
      octaves: 2.2,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.04 },
      volume: -9,
    }).connect(drumBus);

    // Hi-hat mượt (white noise lọc highpass, không bị chói gắt)
    const hatFilter = new Tone.Filter({ type: 'highpass', frequency: 7200 }).connect(drumBus);
    const hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.042, sustain: 0, release: 0.02 },
      volume: -15,
    }).connect(hatFilter);

    // Metronome click đi qua kênh trống
    const click = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      volume: -7,
    }).connect(drumBus);

    this.drums = { kick, snareNoise, rim, hat, click };
  }

  _getChordSynth(timbreId) {
    const Tone = window.Tone;
    if (this.chordSynths[timbreId]) return this.chordSynths[timbreId];

    let synth;
    let filter;
    const revSend = new Tone.Gain(0.32).connect(this.reverbSend);

    if (timbreId === 'piano') {
      filter = new Tone.Filter(2600, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 14,
        volume: -11,
        oscillator: {
          type: 'custom',
          partials: [1, 0.45, 0.22, 0.10, 0.045, 0.018],
        },
        envelope: { attack: 0.007, decay: 1.85, sustain: 0.16, release: 1.3 },
      });
      revSend.gain.value = 0.40;
      synth.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(revSend);
    } else if (timbreId === 'pad') {
      filter = new Tone.Filter(1400, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 14,
        volume: -14,
        oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
        envelope: { attack: 0.26, decay: 0.9, sustain: 0.68, release: 1.6 },
      });
      revSend.gain.value = 0.62;
      synth.connect(filter);
      filter.connect(this.chordChorus);
      filter.connect(revSend);
    } else if (timbreId === 'guitar') {
      filter = new Tone.Filter(3300, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 14,
        volume: -10,
        oscillator: {
          type: 'custom',
          partials: [1, 0.68, 0.44, 0.28, 0.16, 0.08, 0.035],
        },
        envelope: { attack: 0.004, decay: 0.9, sustain: 0.04, release: 0.48 },
      });
      revSend.gain.value = 0.24;
      synth.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(revSend);
    } else {
      // Mặc định: Warm Rhodes / Electric Piano
      filter = new Tone.Filter(2700, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        maxPolyphony: 14,
        volume: -10,
        harmonicity: 2,
        modulationIndex: 1.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.012, decay: 1.6, sustain: 0.28, release: 1.35 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.008, decay: 0.45, sustain: 0.05, release: 0.35 },
      });
      revSend.gain.value = 0.36;
      synth.connect(filter);
      filter.connect(this.chordChorus);
      filter.connect(revSend);
    }

    this.chordSynths[timbreId] = synth;
    return synth;
  }

  _getMelodySynth(timbreId) {
    const Tone = window.Tone;
    if (this.melodySynths[timbreId]) return this.melodySynths[timbreId];

    let synth;
    let filter;
    const revSend = new Tone.Gain(0.36).connect(this.reverbSend);

    if (timbreId === 'lead') {
      filter = new Tone.Filter(2350, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 8,
        volume: -10,
        oscillator: { type: 'fatsawtooth', count: 2, spread: 14 },
        envelope: { attack: 0.022, decay: 0.35, sustain: 0.58, release: 0.35 },
      });
      revSend.gain.value = 0.34;
    } else if (timbreId === 'flute') {
      filter = new Tone.Filter(2900, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 8,
        volume: -7,
        oscillator: { type: 'custom', partials: [1, 0.26, 0.09, 0.03] },
        envelope: { attack: 0.06, decay: 0.28, sustain: 0.70, release: 0.50 },
      });
      revSend.gain.value = 0.50;
    } else if (timbreId === 'ep') {
      filter = new Tone.Filter(3600, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        maxPolyphony: 8,
        volume: -8,
        harmonicity: 2,
        modulationIndex: 2.1,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.008, decay: 1.1, sustain: 0.22, release: 0.85 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.05, release: 0.25 },
      });
      revSend.gain.value = 0.32;
    } else {
      // Mặc định: Chuông êm / Pluck
      filter = new Tone.Filter(3800, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        maxPolyphony: 8,
        volume: -7,
        harmonicity: 3,
        modulationIndex: 1.45,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.92, sustain: 0.12, release: 0.78 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.004, decay: 0.24, sustain: 0.02, release: 0.2 },
      });
      revSend.gain.value = 0.40;
    }

    synth.connect(filter);
    filter.connect(this.channels.melody);
    filter.connect(revSend);
    this.melodySynths[timbreId] = synth;
    return synth;
  }

  /**
   * Cập nhật âm lượng, Mute và Solo cho Mixer 4 kênh (không nổ tiếng)
   */
  applyMixer(mixer) {
    this.state.mixer = JSON.parse(JSON.stringify(mixer));
    if (!this.initialized) return;

    for (const [key, ch] of Object.entries(mixer)) {
      const node = this.channels[key];
      if (!node) continue;
      const isAudible = isMixerChannelAudible(mixer, key);
      const norm = Math.max(0, Math.min(100, ch.volume)) / 100;
      const gain = isAudible ? Math.pow(norm, 1.55) * 1.15 : 0;
      node.gain.rampTo(gain, 0.03);
    }
  }

  /**
   * Cập nhật dữ liệu bài nhạc và xây dựng lại toàn bộ lịch phát sạch sẽ
   */
  updateConfig(partial) {
    const prevChordTimbre = this.state.chordTimbre;
    const prevMelodyTimbre = this.state.melodyTimbre;
    Object.assign(this.state, partial);

    if (!this.initialized) return;

    // Ngắt tiếng synth cũ nếu người dùng đổi chất tiếng
    if (prevChordTimbre !== this.state.chordTimbre && this.chordSynths[prevChordTimbre]) {
      this.chordSynths[prevChordTimbre].releaseAll();
    }
    if (prevMelodyTimbre !== this.state.melodyTimbre && this.melodySynths[prevMelodyTimbre]) {
      this.melodySynths[prevMelodyTimbre].releaseAll();
    }

    this.rebuildSchedule();
  }

  /**
   * Gắn bản thu giọng mộc (Blob WAV từ PCM hoặc AudioBuffer) vào kênh Giọng thu nháp
   */
  async setRawVocalBuffer(source) {
    if (this.vocalPlayer) {
      try {
        this.vocalPlayer.stop();
        this.vocalPlayer.dispose();
      } catch (_) {}
      this.vocalPlayer = null;
    }
    if (this._vocalObjectUrl) {
      try { URL.revokeObjectURL(this._vocalObjectUrl); } catch (_) {}
      this._vocalObjectUrl = null;
    }

    const blobOrBuffer = source && source.wavBlob instanceof Blob ? source.wavBlob : source;
    this.hasRawVocal = Boolean(blobOrBuffer);
    if (!blobOrBuffer || !this.initialized) {
      this._pendingVocalSource = blobOrBuffer || null;
      return;
    }

    const Tone = window.Tone;
    let toneBuf;
    if (blobOrBuffer instanceof Blob) {
      const url = URL.createObjectURL(blobOrBuffer);
      this._vocalObjectUrl = url;
      toneBuf = new Tone.ToneAudioBuffer();
      try {
        await toneBuf.load(url);
      } catch (_) {
        const arrBuf = await blobOrBuffer.arrayBuffer();
        const decoded = await Tone.context.decodeAudioData(arrBuf);
        toneBuf = new Tone.ToneAudioBuffer(decoded);
      }
    } else {
      toneBuf = new Tone.ToneAudioBuffer(blobOrBuffer);
    }

    this.vocalPlayer = new Tone.Player(toneBuf).connect(this.vocalHPF);
    this._pendingVocalSource = null;

    if (this.initialized) {
      this.rebuildSchedule();
    }
  }

  _rampParam(param, val, dur = 0.025) {
    if (param == null) return;
    if (typeof param.rampTo === 'function') {
      param.rampTo(val, dur);
    } else if ('value' in param) {
      param.value = val;
    }
  }

  /**
   * Nạp hoặc xóa bản thu Vocal Studio cho từng kênh ('lead' | 'backing')
   */
  async setVocalTrackAudio(trackId, blobOrBuffer, syncOffsetMs = 0) {
    const track = this.vocalTracks[trackId];
    if (!track) return;

    track.loadSeq += 1;
    const mySeq = track.loadSeq;

    // Tránh phát đè giữa bản thu nháp MIDI cũ và kênh Giọng chính Vocal Studio
    if (trackId === 'lead' && blobOrBuffer) {
      if (this.vocalPlayer) {
        try {
          this.vocalPlayer.stop();
          this.vocalPlayer.dispose();
        } catch (_) {}
        this.vocalPlayer = null;
      }
      this._pendingVocalSource = null;
      this.hasRawVocal = false;
    }

    if (track.player) {
      try {
        track.player.stop();
        track.player.dispose();
      } catch (_) {}
      track.player = null;
    }
    if (track.objectUrl) {
      try { URL.revokeObjectURL(track.objectUrl); } catch (_) {}
      track.objectUrl = null;
    }

    const source = blobOrBuffer && blobOrBuffer.wavBlob instanceof Blob ? blobOrBuffer.wavBlob : blobOrBuffer;
    track.syncOffsetMs = Number(syncOffsetMs) || 0;

    if (!source) {
      track.hasAudio = false;
      track.pendingBlob = null;
      if (this.initialized) this.rebuildSchedule();
      return;
    }

    track.hasAudio = true;
    if (!this.initialized || !track.chain) {
      track.pendingBlob = source;
      return;
    }

    const Tone = window.Tone;
    let toneBuf;
    let createdUrl = null;

    if (source instanceof Blob) {
      createdUrl = URL.createObjectURL(source);
      toneBuf = new Tone.ToneAudioBuffer();
      try {
        await toneBuf.load(createdUrl);
      } catch (_) {
        const arrBuf = await source.arrayBuffer();
        const decoded = await Tone.context.decodeAudioData(arrBuf);
        toneBuf = new Tone.ToneAudioBuffer(decoded);
      }
    } else {
      toneBuf = new Tone.ToneAudioBuffer(source);
    }

    // Nếu trong lúc giải mã bất đồng bộ đã có bản mới hơn thay thế -> hủy bản cũ
    if (track.loadSeq !== mySeq) {
      if (createdUrl) {
        try { URL.revokeObjectURL(createdUrl); } catch (_) {}
      }
      try { toneBuf.dispose(); } catch (_) {}
      return;
    }

    track.objectUrl = createdUrl;
    track.player = new Tone.Player(toneBuf).connect(track.chain.input);
    track.pendingBlob = null;

    if (this.initialized) {
      this.rebuildSchedule();
    }
  }

  /**
   * Cập nhật độ bù trễ thời gian thực (-250ms .. +250ms) cho kênh Vocal
   */
  setVocalTrackSyncOffset(trackId, syncOffsetMs) {
    const track = this.vocalTracks[trackId];
    if (!track) return;
    track.syncOffsetMs = Math.max(-250, Math.min(250, Number(syncOffsetMs) || 0));
    if (this.initialized && track.player && track.player.loaded) {
      this.rebuildSchedule();
    }
  }

  clearVocalTrack(trackId) {
    return this.setVocalTrackAudio(trackId, null, 0);
  }

  /**
   * Cập nhật thông số hiệu ứng phòng thu (Gate, EQ, Comp, Pitch, Reverb, Delay, Pan) thời gian thực
   */
  updateVocalTrackFx(trackId, fx) {
    const track = this.vocalTracks[trackId];
    if (!track || !fx) return;
    track.pendingFx = { ...fx };

    const chain = track.chain;
    if (!this.initialized || !chain) return;

    try {
      const gateThresh = Number(fx.gate ?? -60);
      chain.gate.threshold = gateThresh <= -59 ? -100 : gateThresh;

      this._rampParam(chain.hpf.frequency, Math.max(20, Math.min(2000, Number(fx.hpf ?? 90))));
      this._rampParam(chain.lpf.frequency, Math.max(800, Math.min(20000, Number(fx.lpf ?? 18000))));

      this._rampParam(chain.eq.low, Number(fx.eqLow ?? 0));
      this._rampParam(chain.eq.mid, Number(fx.eqMid ?? 0));
      this._rampParam(chain.eq.high, Number(fx.eqHigh ?? 0));

      const compPct = Math.max(0, Math.min(100, Number(fx.comp ?? 35)));
      this._rampParam(chain.comp.threshold, -8 - (compPct / 100) * 24);
      this._rampParam(chain.comp.ratio, 1.5 + (compPct / 100) * 5.5);

      const distPct = Math.max(0, Math.min(100, Number(fx.dist ?? 0)));
      this._rampParam(chain.dist.wet, distPct / 100);

      const pitchSemis = Math.max(-12, Math.min(12, Number(fx.pitch ?? 0)));
      if (Math.abs(pitchSemis) < 0.05) {
        chain.pitch.pitch = 0;
        this._rampParam(chain.pitch.wet, 0);
      } else {
        chain.pitch.pitch = pitchSemis;
        this._rampParam(chain.pitch.wet, 1);
      }

      const chorusPct = Math.max(0, Math.min(100, Number(fx.chorus ?? 0)));
      this._rampParam(chain.chorus.wet, chorusPct / 100);

      const panVal = Math.max(-1, Math.min(1, Number(fx.pan ?? 0) / 100));
      this._rampParam(chain.panner.pan, panVal);

      const revMix = Math.max(0, Math.min(100, Number(fx.reverbMix ?? 18)));
      this._rampParam(chain.reverbSend.gain, (revMix / 100) * 0.85, 0.03);

      const revDecay = Math.max(0.4, Math.min(6.0, Number(fx.reverbDecay ?? 1.5)));
      if (Math.abs(revDecay - chain.lastDecay) > 0.04) {
        chain.lastDecay = revDecay;
        chain.reverb.decay = revDecay;
      }

      chain.delayDiv = fx.delayDiv || '8n';
      this._syncVocalDelayTimes();
      const delMix = Math.max(0, Math.min(100, Number(fx.delayMix ?? 0)));
      this._rampParam(chain.delaySend.gain, (delMix / 100) * 0.72, 0.03);
    } catch (err) {
      console.warn('[HEVOS STUDIO Vocal FX]', err);
    }
  }

  _syncVocalDelayTimes() {
    if (!this.initialized) return;
    const beatSec = 60 / Math.max(40, Math.min(240, Number(this.state.bpm) || 84));
    ['lead', 'backing'].forEach((tid) => {
      const chain = this.vocalTracks[tid].chain;
      if (!chain) return;
      const div = chain.delayDiv || '8n';
      const sec = div === '4n' ? beatSec : div === '8n.' ? beatSec * 0.75 : beatSec * 0.5;
      this._rampParam(chain.delay.delayTime, Math.max(0.05, Math.min(1.0, sec)), 0.03);
    });
  }

  _clearParts() {
    const Tone = window.Tone;
    if (this.chordPart) {
      this.chordPart.dispose();
      this.chordPart = null;
    }
    if (this.melodyPart) {
      this.melodyPart.dispose();
      this.melodyPart = null;
    }
    if (this.drumPart) {
      this.drumPart.dispose();
      this.drumPart = null;
    }
    if (this.vocalEventId !== null) {
      Tone.Transport.clear(this.vocalEventId);
      this.vocalEventId = null;
    }
    ['lead', 'backing'].forEach((tid) => {
      const tr = this.vocalTracks[tid];
      if (tr && tr.eventId !== null) {
        Tone.Transport.clear(tr.eventId);
        tr.eventId = null;
      }
    });
    if (this._loopEndCallbackId !== null) {
      Tone.Transport.clear(this._loopEndCallbackId);
      this._loopEndCallbackId = null;
    }
    Tone.Transport.cancel(0);
  }

  /**
   * Hủy sự kiện cũ và lập lịch lại toàn bộ: Hợp âm, Giai điệu, Trống, Giọng thu nháp
   */
  rebuildSchedule() {
    if (!this.initialized) return;
    const Tone = window.Tone;

    // Nếu có vocal source chờ từ trước lúc init
    if (this._pendingVocalSource && !this.vocalPlayer) {
      const pending = this._pendingVocalSource;
      this._pendingVocalSource = null;
      this.setRawVocalBuffer(pending).catch(() => {});
    }

    this._clearParts();

    const { bpm, totalBars, humanize, chordStyle, chordTimbre, melodyTimbre, drumPattern, voicedChords, melodyNotes } =
      this.state;
    const beatSec = 60 / bpm;
    const totalBeats = totalBars * 4;
    const loopDurationSec = totalBeats * beatSec;

    Tone.Transport.bpm.value = bpm;
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = loopDurationSec;

    this._syncVocalDelayTimes();

    // --- 1. Lập lịch Hợp âm & Bass (dùng chung nguồn sinh thuần với bộ xuất MIDI) ---
    const chordSynth = this._getChordSynth(chordTimbre);
    const { allEvents: accEvents } = generateAccompanimentEvents({
      voicedChords,
      totalBars,
      bpm,
      chordStyle,
      drumPattern,
      humanize,
    });

    const chordPartEvents = accEvents.map((ev) => [
      Math.max(0, Math.min(loopDurationSec - 0.015, ev.startBeat * beatSec)),
      {
        midi: ev.midi,
        durSec: Math.max(0.06, ev.durationBeat * beatSec),
        vel: ev.velocity,
      },
    ]);

    this.chordPart = new Tone.Part((time, val) => {
      try {
        chordSynth.triggerAttackRelease(
          midiToToneNote(val.midi),
          val.durSec,
          time,
          val.vel
        );
      } catch (_) {}
    }, chordPartEvents);
    this.chordPart.start(0);

    // --- 2. Lập lịch Giai điệu MIDI (Piano Roll) ---
    const melodySynth = this._getMelodySynth(melodyTimbre);
    const melEvents = generateMelodyEvents({
      melodyNotes,
      totalBars,
      bpm,
      humanize,
    });
    const melodyPartEvents = melEvents.map((ev) => [
      Math.max(0, Math.min(loopDurationSec - 0.01, ev.startBeat * beatSec)),
      {
        midi: ev.midi,
        durSec: Math.max(0.06, ev.durationBeat * beatSec),
        vel: ev.velocity,
      },
    ]);

    this.melodyPart = new Tone.Part((time, val) => {
      try {
        melodySynth.triggerAttackRelease(
          midiToToneNote(val.midi),
          val.durSec,
          time,
          val.vel
        );
      } catch (_) {}
    }, melodyPartEvents);
    this.melodyPart.start(0);

    // --- 3. Lập lịch Nhịp trống (dùng chung nguồn sinh thuần với bộ xuất MIDI) ---
    if (drumPattern !== 'off') {
      const drumEvents = generateDrumEvents({
        totalBars,
        bpm,
        drumPattern,
        chordStyle,
        humanize,
      });
      const drumPartEvents = drumEvents.map((ev) => [
        Math.max(0, Math.min(loopDurationSec - 0.01, ev.startBeat * beatSec)),
        {
          type: ev.drumType,
          vel: ev.velocity,
          openHat: ev.openHat,
        },
      ]);
      this.drumPart = new Tone.Part((time, ev) => {
        this._triggerDrum(ev.type, time, ev.vel, ev.openHat);
      }, drumPartEvents);
      this.drumPart.start(0);
    }

    // --- 4. Lập lịch 2 Kênh Giọng Hát Vocal Studio (hỗ trợ Sync Offset -250..+250ms & Overdub) ---
    ['lead', 'backing'].forEach((tid) => {
      this._scheduleVocalTrackPlayer(this.vocalTracks[tid], loopDurationSec);
    });

    // Kênh Giọng thu nháp Ngân nga -> MIDI (chỉ phát khi chưa có Track Giọng chính từ Vocal Studio)
    if (
      !this._muteVocalDuringRecord &&
      this._recordingTrackMask !== 'all' &&
      !this.vocalTracks.lead.hasAudio &&
      this.vocalPlayer &&
      this.vocalPlayer.loaded
    ) {
      this.vocalEventId = Tone.Transport.schedule((time) => {
        try {
          this.vocalPlayer.stop(time);
          this.vocalPlayer.start(time, 0, loopDurationSec);
        } catch (_) {}
      }, 0);
    }
  }

  _scheduleVocalTrackPlayer(track, loopDurationSec) {
    if (!track || !track.player || !track.player.loaded) return;
    const Tone = window.Tone;

    try {
      track.player.stop();
    } catch (_) {}

    const isMasked =
      this._recordingTrackMask === 'all' ||
      this._recordingTrackMask === track.id ||
      (this._muteVocalDuringRecord && !this._recordingTrackMask && track.id === 'lead');
    if (isMasked) return;

    const offsetSec = (track.syncOffsetMs || 0) / 1000;
    const bufDur = track.player.buffer ? track.player.buffer.duration : loopDurationSec;

    if (offsetSec < 0) {
      const absOff = Math.min(Math.max(0, bufDur - 0.05), Math.abs(offsetSec));
      const playDur = Math.max(0.05, Math.min(loopDurationSec, bufDur - absOff));
      track.eventId = Tone.Transport.schedule((time) => {
        try {
          track.player.stop(time);
          track.player.start(time, absOff, playDur);
        } catch (_) {}
      }, 0);

      if (this.isPlaying && Tone.Transport.state === 'started') {
        const curLoopSec = ((Tone.Transport.seconds % loopDurationSec) + loopDurationSec) % loopDurationSec;
        const bufOffset = absOff + curLoopSec;
        const rem = Math.min(loopDurationSec - curLoopSec, bufDur - bufOffset);
        if (rem > 0.04) {
          try {
            track.player.start(Tone.now() + 0.02, bufOffset, rem);
          } catch (_) {}
        }
      }
    } else {
      const startSec = Math.min(Math.max(0, loopDurationSec - 0.05), offsetSec);
      const playDur = Math.max(0.05, Math.min(loopDurationSec - startSec, bufDur));
      track.eventId = Tone.Transport.schedule((time) => {
        try {
          track.player.stop(time);
          track.player.start(time, 0, playDur);
        } catch (_) {}
      }, startSec);

      if (this.isPlaying && Tone.Transport.state === 'started') {
        const curLoopSec = ((Tone.Transport.seconds % loopDurationSec) + loopDurationSec) % loopDurationSec;
        if (curLoopSec >= startSec) {
          const bufOffset = curLoopSec - startSec;
          const rem = Math.min(loopDurationSec - curLoopSec, bufDur - bufOffset);
          if (rem > 0.04) {
            try {
              track.player.start(Tone.now() + 0.02, bufOffset, rem);
            } catch (_) {}
          }
        }
      }
    }
  }

  _triggerDrum(type, time, vel, openHat = false) {
    const safeTime = (key, t) => {
      const next = Math.max(t, this._lastDrumTime[key] + 0.003);
      this._lastDrumTime[key] = next;
      return next;
    };

    try {
      if (type === 'kick') {
        this.drums.kick.triggerAttackRelease('C1', '8n', safeTime('kick', time), vel);
      } else if (type === 'snare') {
        this.drums.snareNoise.triggerAttackRelease('16n', safeTime('snare', time), vel);
      } else if (type === 'rim') {
        this.drums.rim.triggerAttackRelease('G3', '32n', safeTime('rim', time), vel);
      } else if (type === 'hat') {
        this.drums.hat.envelope.decay = openHat ? 0.16 : 0.042;
        this.drums.hat.triggerAttackRelease('32n', safeTime('hat', time), vel);
      } else if (type === 'clickAccent') {
        this.drums.click.triggerAttackRelease('C6', '32n', safeTime('click', time), vel);
      } else if (type === 'click') {
        this.drums.click.triggerAttackRelease('G5', '32n', safeTime('click', time), vel);
      }
    } catch (_) {}
  }

  /**
   * Nghe thử ngay 1 nốt giai điệu (khi chạm vào Piano Roll hoặc bàn phím dọc)
   */
  async auditionMelodyNote(midi, duration = 0.28) {
    await this.ensureReady();
    const synth = this._getMelodySynth(this.state.melodyTimbre);
    try {
      synth.triggerAttackRelease(midiToToneNote(midi), duration, window.Tone.now(), 0.8);
    } catch (_) {}
  }

  /**
   * Nghe thử ngay 1 hợp âm (khi người dùng chọn hợp âm trong Chord Picker)
   */
  async auditionChord(voicedChord) {
    await this.ensureReady();
    const synth = this._getChordSynth(this.state.chordTimbre);
    const now = window.Tone.now();
    const notes = [voicedChord.bassMidi, ...voicedChord.upperMidis];
    notes.forEach((midi, idx) => {
      try {
        synth.triggerAttackRelease(midiToToneNote(midi), 0.9, now + idx * 0.022, 0.72 - idx * 0.03);
      } catch (_) {}
    });
  }

  /**
   * Ước lượng độ trễ tổng (Tone lookAhead + start offset + phần cứng đầu ra) để căn thẳng đầu beat 0
   */
  getRecordLatencyCompSec() {
    const Tone = window.Tone;
    const lookAhead = Tone && Tone.context ? (Tone.context.lookAhead || 0.1) : 0.1;
    const baseLatency =
      Tone && Tone.context && Tone.context.rawContext && typeof Tone.context.rawContext.baseLatency === 'number'
        ? Tone.context.rawContext.baseLatency
        : 0.02;
    return Math.max(0.06, Math.min(0.22, lookAhead + 0.03 + baseLatency));
  }

  async play(fromStart = false, { muteVocal = false, recordingTrack = null } = {}) {
    await this.ensureReady();
    const Tone = window.Tone;
    this._muteVocalDuringRecord = Boolean(muteVocal);
    this._recordingTrackMask = recordingTrack;
    if (fromStart) {
      Tone.Transport.stop();
      Tone.Transport.seconds = 0;
    }
    this.rebuildSchedule();
    Tone.Transport.start('+0.03', fromStart ? 0 : Tone.Transport.seconds);
    this.isPlaying = true;
  }

  stop() {
    if (!this.initialized) return;
    const Tone = window.Tone;
    this.cancelCountIn();
    Tone.Transport.stop();
    Tone.Transport.seconds = 0;
    this.isPlaying = false;
    this._muteVocalDuringRecord = false;
    this._recordingTrackMask = null;

    // Nhả hết nốt đang ngân
    Object.values(this.chordSynths).forEach((s) => {
      try { s.releaseAll(); } catch (_) {}
    });
    Object.values(this.melodySynths).forEach((s) => {
      try { s.releaseAll(); } catch (_) {}
    });
    if (this.vocalPlayer) {
      try { this.vocalPlayer.stop(); } catch (_) {}
    }
    ['lead', 'backing'].forEach((tid) => {
      const tr = this.vocalTracks[tid];
      if (tr && tr.player) {
        try { tr.player.stop(); } catch (_) {}
      }
    });
  }

  /**
   * Trả về vị trí playhead hiện tại theo đơn vị beat (0 .. totalBars*4) cho 60fps Canvas
   */
  getCurrentBeat() {
    if (!this.initialized || !this.isPlaying) return 0;
    const Tone = window.Tone;
    const totalBeats = this.state.totalBars * 4;
    const loopSec = totalBeats * (60 / this.state.bpm);
    if (loopSec <= 0) return 0;
    const sec = ((Tone.Transport.seconds % loopSec) + loopSec) % loopSec;
    return (sec / loopSec) * totalBeats;
  }

  /**
   * Đọc mức tín hiệu tức thời [0..1] trên 5 kênh Mixer cho đèn Level Meter
   */
  getChannelLevels() {
    const empty = { chords: 0, melody: 0, drums: 0, vocal: 0, vocal2: 0 };
    if (!this.initialized || !this.isPlaying || !this.channelMeters) return empty;
    const out = {};
    for (const [key, meter] of Object.entries(this.channelMeters)) {
      let raw = 0;
      try {
        const val = meter.getValue();
        raw = Array.isArray(val) ? Math.max(...val) : Number(val) || 0;
      } catch (_) {}
      out[key] = raw > 0.0005 ? Math.min(1, Math.pow(raw * 2.8, 0.62)) : 0;
    }
    return out;
  }

  /**
   * Đếm vào 1 ô nhịp (4 phách rõ ràng) trước khi thu micro
   * Trả về true nếu hoàn thành trọn 4 phách, false nếu bị hủy giữa chừng
   */
  async runCountIn(onBeat) {
    await this.ensureReady();
    this.stop();
    this._countInCancelled = false;
    this._countInTimers = [];

    const Tone = window.Tone;
    const beatSec = 60 / this.state.bpm;
    const startAudioTime = Tone.now() + 0.05;

    for (let i = 0; i < 4; i++) {
      const pitch = i === 0 ? 'C6' : 'G5';
      const vel = i === 0 ? 0.9 : 0.65;
      try {
        this.countInSynth.triggerAttackRelease(pitch, '32n', startAudioTime + i * beatSec, vel);
      } catch (_) {}
    }

    return new Promise((resolve) => {
      for (let i = 0; i < 4; i++) {
        const t = setTimeout(() => {
          if (this._countInCancelled) return;
          if (onBeat) onBeat(i + 1); // 1, 2, 3, 4
        }, Math.max(0, Math.round((0.05 + i * beatSec) * 1000)));
        this._countInTimers.push(t);
      }

      const endTimer = setTimeout(() => {
        this._countInTimers = [];
        resolve(!this._countInCancelled);
      }, Math.round((0.05 + 4 * beatSec) * 1000));
      this._countInTimers.push(endTimer);
    });
  }

  cancelCountIn() {
    this._countInCancelled = true;
    this._countInTimers.forEach((id) => clearTimeout(id));
    this._countInTimers = [];
  }

  /**
   * Thu lại trọn 1 vòng lặp từ đầu ra Master bằng Tone.Recorder và tải xuống
   */
  async exportLoopAudio(onProgress) {
    await this.ensureReady();
    if (this.isExporting) return null;
    const Tone = window.Tone;

    if (typeof MediaRecorder === 'undefined' || !Tone.Recorder) {
      throw new Error('Trình duyệt hiện tại không hỗ trợ Tone.Recorder để xuất âm thanh.');
    }

    this.isExporting = true;
    const wasPlaying = this.isPlaying;
    this.stop();

    const recorder = new Tone.Recorder();
    this.masterLimiter.connect(recorder);

    const totalBeats = this.state.totalBars * 4;
    const loopDurationSec = totalBeats * (60 / this.state.bpm);
    const hasVocalTail = this.vocalTracks.lead.hasAudio || this.vocalTracks.backing.hasAudio;
    const tailSec = hasVocalTail ? 1.1 : 0.55;

    try {
      this.rebuildSchedule();
      Tone.Transport.loop = false; // Chỉ phát đúng 1 vòng + đuôi reverb
      await recorder.start();
      Tone.Transport.start('+0.04', 0);
      this.isPlaying = true;

      const startMs = performance.now();
      const totalMs = (loopDurationSec + tailSec) * 1000;

      await new Promise((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - startMs;
          const pct = Math.min(99, Math.round((elapsed / totalMs) * 100));
          if (onProgress) onProgress(pct);
          if (elapsed >= totalMs) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      });

      this.stop();
      const blob = await recorder.stop();
      if (onProgress) onProgress(100);

      // Xác định đuôi file chuẩn theo MIME thực tế
      const mime = blob.type || 'audio/webm';
      let ext = 'webm';
      if (mime.includes('mp4') || mime.includes('m4a')) ext = 'm4a';
      else if (mime.includes('ogg')) ext = 'ogg';
      else if (mime.includes('wav')) ext = 'wav';

      return { blob, ext, mime };
    } finally {
      try {
        this.masterLimiter.disconnect(recorder);
        recorder.dispose();
      } catch (_) {}
      Tone.Transport.loop = true;
      this.isExporting = false;
      if (wasPlaying) {
        this.rebuildSchedule();
      }
    }
  }

  /**
   * Phát tiếng Piano mẫu & phản hồi riêng cho phân khu Học nhạc (không bị ảnh hưởng bởi Mute Studio)
   */
  async playTrainerPiano(midi, duration = 0.65, velocity = 0.82) {
    await this.ensureReady();
    this._ensureTrainerSynths();
    try {
      this.trainerPiano.triggerAttackRelease(
        midiToToneNote(midi),
        duration,
        window.Tone.now(),
        velocity
      );
    } catch (_) {}
  }

  async playTrainerWrong() {
    await this.ensureReady();
    this._ensureTrainerSynths();
    try {
      this.trainerWrongSynth.triggerAttackRelease('F2', 0.09, window.Tone.now(), 0.55);
    } catch (_) {}
  }

  async playTrainerClick(accent = false) {
    await this.ensureReady();
    this._ensureTrainerSynths();
    try {
      this.trainerClickSynth.triggerAttackRelease(
        accent ? 'C6' : 'G5',
        '32n',
        window.Tone.now(),
        accent ? 0.72 : 0.45
      );
    } catch (_) {}
  }

  stopTrainerAudio() {
    if (this.trainerPiano) {
      try {
        this.trainerPiano.releaseAll();
      } catch (_) {}
    }
  }
}

export const audioEngine = new AudioEngine();
