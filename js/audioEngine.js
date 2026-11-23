// ============================================================================
// audioEngine.js — Bộ máy Âm thanh Tone.js: Đệm hợp âm có hồn, 4 chất tiếng,
// 4 kiểu đệm, Nhịp trống, Giai điệu, Giọng thu nháp, Mixer 4 kênh & Xuất Audio
// ============================================================================

import { buildBarChordEvents, midiToToneNote } from './theory.js?v=35';

const getToneContext = (Tone) =>
  Tone && typeof Tone.getContext === 'function' ? Tone.getContext() : Tone?.context;
const getToneTransport = (Tone) =>
  Tone && typeof Tone.getTransport === 'function' ? Tone.getTransport() : Tone?.Transport;
const getToneDestination = (Tone) =>
  Tone && typeof Tone.getDestination === 'function' ? Tone.getDestination() : Tone?.Destination;
const getToneNow = (Tone) => {
  const ctx = getToneContext(Tone);
  if (ctx && typeof ctx.now === 'function') return ctx.now();
  return Tone && typeof Tone.now === 'function' ? Tone.now() : 0;
};

export const CHORD_TIMBRES = [
  { id: 'dark_brass',   label: 'Dark Brass (K-Pop)' },
  { id: 'stage_pluck',  label: 'Stage Pluck / Lead' },
  { id: 'rhodes',       label: 'Rhodes / EP Ấm' },
  { id: 'modern_piano', label: 'Piano Pop Trầm Ấm' },
  { id: 'piano',        label: 'Grand Piano Êm' },
  { id: 'pad',          label: 'Pad Lo-Fi Mơ Màng' },
  { id: 'guitar',       label: 'Guitar Acoustic Gảy' },
];

export const CHORD_STYLES = [
  {
    id: 'yg_bounce',
    group: 'Đệm Sân Khấu · K-Pop / US-UK',
    shortLabel: 'YG Stage Bounce',
    label: 'YG / K-Pop Stage Bounce',
    desc: 'K-Pop / YG Stage · Dập staccato dứt khoát, chừa khoảng thở cho rap/vocal, drop 808 bùng nổ.',
  },
  {
    id: 'usuk_stage',
    group: 'Đệm Sân Khấu · K-Pop / US-UK',
    shortLabel: 'US-UK Stage Pop',
    label: 'US-UK Anthemic Stage Pop',
    desc: 'US-UK Stage Pop · Synth pulse tràn năng lượng sân vận động kết hợp quãng 8 cao trào.',
  },
  {
    id: 'alt_punk',
    group: 'Đệm Sân Khấu · K-Pop / US-UK',
    shortLabel: 'GD Alt-Pop Bounce',
    label: 'GD Alt-Pop / Avant-Garde',
    desc: 'GD Alt-Pop · Nhấn phách nghịch cá tính cùng bass chạy đều kiểu Crooked / Sober.',
  },
  {
    id: 'block',
    group: 'Đệm Phím Piano Cơ Bản',
    shortLabel: 'Block Chord',
    label: 'Block Chord (Cùng lúc)',
    desc: 'Block Chord · Bấm các nốt hợp âm cùng lúc. Phù hợp đoạn cần chắc nhịp, cao trào hoặc đệm hát đơn giản.',
  },
  {
    id: 'broken_1357',
    group: 'Đệm Phím Piano Cơ Bản',
    shortLabel: 'Broken 1-3-5 / 1-3-5-7',
    label: 'Broken 1-3-5 / 1-3-5-7',
    desc: 'Broken Chord / Arpeggio · Chơi từng nốt theo thứ tự 1-3-5 hoặc 1-3-5-7. Phù hợp Ballad, Pop và đoạn cần chuyển động.',
  },
  {
    id: 'pattern_158',
    group: 'Đệm Phím Piano Cơ Bản',
    shortLabel: 'Rải 1-5-8 Piano',
    label: 'Rải 1-5-8 Piano',
    desc: 'Rải 1-5-8 · Quy tắc rải tay trái 1 → 5 → 8 có pedal ngân nối tiếp tay phải, chuẩn cảm giác đệm phím đàn Piano.',
  },
  {
    id: 'bass_chord',
    group: 'Đệm Phím Piano Cơ Bản',
    shortLabel: 'Bass + Chord',
    label: 'Bass + Chord (Đệm hát)',
    desc: 'Bass + Chord · Tay trái chơi nốt trầm, tay phải chơi hợp âm. Nền tảng quan trọng để đệm hát.',
  },
  {
    id: 'rnb',
    group: 'Đệm Beat & Groove Hiện Đại',
    shortLabel: 'R&B / Neo-Soul',
    label: 'Lơi nhịp R&B / Neo-Soul',
    desc: 'R&B / Neo-Soul · Rải lơi nhịp, đảo phách êm tai với ghost chords và bước dẫn passing bass.',
  },
  {
    id: 'pop_groove',
    group: 'Đệm Beat & Groove Hiện Đại',
    shortLabel: 'Pop Trầm Ấm',
    label: 'Pop Trầm Ấm / Pulse',
    desc: 'Pop Trầm Ấm · Bass sâu chắc nhịp kết hợp rải nốt trên tạo chiều sâu, rất hợp tiếng Piano Pop Trầm Ấm.',
  },
  {
    id: 'pop',
    group: 'Đệm Beat & Groove Hiện Đại',
    shortLabel: 'Pop Hiện Đại',
    label: 'Đệm Pop Hiện Đại',
    desc: 'Pop Hiện Đại · Chặt nhịp gọn gàng, giàu năng lượng theo từng ô nhịp.',
  },
  {
    id: 'ballad',
    group: 'Đệm Beat & Groove Hiện Đại',
    shortLabel: 'Rải Ballad',
    label: 'Rải Ballad',
    desc: 'Rải Ballad · Mềm mại có sustain pedal cảm xúc và câu đáp dịu dàng giữa các ô.',
  },
  {
    id: 'lofi',
    group: 'Đệm Beat & Groove Hiện Đại',
    shortLabel: 'Chill / Lo-Fi',
    label: 'Chill / Lo-Fi Rải Chậm',
    desc: 'Chill / Lo-Fi · Rải chậm sâu lắng, hợp với hợp âm maj7/m7 thư giãn.',
  },
  {
    id: 'strum',
    group: 'Đệm Beat & Groove Hiện Đại',
    shortLabel: 'Quạt Acoustic',
    label: 'Quạt chả Acoustic',
    desc: 'Quạt chả Acoustic · Mô phỏng lên xuống dây đàn guitar acoustic.',
  },
];

export const DRUM_PATTERNS = [
  { id: 'off',        label: 'Tắt trống' },
  { id: 'custom_seq', label: 'Tự soạn Step Sequencer (16 bước)' },
  { id: 'kpop_trap',  label: 'K-Pop / YG Trap Stage' },
  { id: 'stage_pop',  label: 'US-UK Stage Pop' },
  { id: 'alt_hiphop', label: 'G-Dragon / Alt Bounce' },
  { id: 'metronome',  label: 'Đập nhịp Metronome' },
  { id: 'lofi',       label: 'Lo-Fi / R&B' },
  { id: 'pop',        label: 'Pop' },
  { id: 'ballad',     label: 'Ballad' },
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
  clap: 39,      // D#1 — Hand Clap
  closedHat: 42, // F#1 — Closed Hi-Hat
  openHat: 46,   // A#1 — Open Hi-Hat
  crash: 49,     // C#2 — Crash Cymbal 1
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
  const isTightStage =
    chordStyle === 'yg_bounce' ||
    chordStyle === 'usuk_stage' ||
    drumPattern === 'kpop_trap' ||
    drumPattern === 'stage_pop';
  const swingAmountBeats =
    (isTightStage
      ? 0.004
      : chordStyle === 'alt_punk' || drumPattern === 'alt_hiphop'
        ? 0.015
        : chordStyle === 'rnb' || drumPattern === 'lofi'
          ? 0.045
          : 0.020) * humanAmt;

  const frac = beat - Math.floor(beat);
  let b = beat;
  if (Math.abs(frac - 0.5) < 0.04) {
    b += swingAmountBeats;
  } else if (Math.abs(frac - 0.75) < 0.04) {
    b += swingAmountBeats * 0.60;
  } else if (Math.abs(frac - 0.25) < 0.04) {
    b += swingAmountBeats * 0.25;
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

  const lenChords = voicedChords.length;
  voicedChords.slice(0, totalBars).forEach((vc, barIdx) => {
    const nextVc = lenChords > 0 ? voicedChords[(barIdx + 1) % Math.min(lenChords, totalBars)] : null;
    const barEvents = buildBarChordEvents(vc, barIdx, chordStyle, nextVc, totalBars);
    barEvents.forEach((ev, evIdx) => {
      const swungBeat = applySwingBeat(
        ev.startBeat,
        totalBeats,
        chordStyle,
        drumPattern,
        humanize
      );

      // Humanize tinh tế bám chắc nhịp chính (Bass giữ chắc grid, Chord lơi nhẹ ±2.5ms)
      const seed = (barIdx + 1) * 131 + (evIdx + 1) * 37 + ev.midi * 7;
      const timeNoise = deterministicUnit(seed);
      const velNoise = deterministicUnit(seed + 503);

      const beatFrac = ev.startBeat - Math.floor(ev.startBeat);
      const isDownbeat = beatFrac < 0.01 || beatFrac > 0.99;
      const maxJitterSec = (ev.role === 'bass' ? (isDownbeat ? 0 : 0.0015) : 0.004) * humanAmt;
      let jitterBeats = timeNoise * maxJitterSec * beatsPerSec;
      if (swungBeat + jitterBeats < 0) jitterBeats = 0;

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
  customDrumGrid = null,
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

    // R&B / Lo-Fi lùi nhẹ Snare/Rim đồng bộ cùng 1 seed theo (bar, beat) để không bị flam 2 tiếng lệch nhau
    if (drumPattern === 'lofi' && (drumType === 'rim' || drumType === 'snare')) {
      b += 0.007 * humanAmt * beatsPerSec;
    }

    // Humanize tinh tế giữ chặt trục nhịp (Kick phách đầu bám khít grid, Snare/Rim dùng chung pocket seed)
    const isMetronome = drumType === 'clickAccent' || drumType === 'click';
    const beatBucket = Math.round(beat * 100);
    const seed =
      drumType === 'rim' || drumType === 'snare'
        ? (bar + 1) * 197 + beatBucket * 17
        : (bar + 1) * 197 + seqIdx * 41;
    let jitterBeats = 0;
    let velDelta = 0;
    if (!isMetronome && humanAmt > 0) {
      const maxDrumJitterSec =
        (drumType === 'hat' ? 0.004 : drumType === 'kick' ? (beat === 0 ? 0 : 0.0015) : 0.002) *
        humanAmt;
      jitterBeats = deterministicUnit(seed) * maxDrumJitterSec * beatsPerSec;
      if (b + jitterBeats < 0) jitterBeats = 0;
      velDelta = deterministicUnit((bar + 1) * 197 + seqIdx * 41 + 701) * 0.075 * humanAmt;
    }

    const startBeat = Math.max(0, Math.min(totalBeats - 0.04, b + jitterBeats));
    const defaultDur = openHat ? 0.35 : drumType === 'kick' || drumType === 'snare' ? 0.25 : 0.15;
    const durationBeat = Math.max(0.06, Math.min(defaultDur, totalBeats - startBeat));
    const velocity = Math.max(0.16, Math.min(0.98, baseVel + velDelta));

    let midi = GM_DRUM_NOTES.kick;
    if (drumType === 'kick') midi = GM_DRUM_NOTES.kick;
    else if (drumType === 'rim' || drumType === 'clickAccent' || drumType === 'click') midi = GM_DRUM_NOTES.rim;
    else if (drumType === 'snare') midi = GM_DRUM_NOTES.snare;
    else if (drumType === 'clap') midi = GM_DRUM_NOTES.clap;
    else if (drumType === 'crash') midi = GM_DRUM_NOTES.crash;
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
    } else if (drumPattern === 'kpop_trap') {
      // K-Pop / YG Trap Stage: Kick 808 nặng uy lực + Clap/Snare layered + Hi-hat roll 1/16 & 1/32 + Crash/Fill chuyển ô
      const isTurnaround = bar === totalBars - 1 || bar % 4 === 3;
      if (bar % 4 === 0) add(bar, 0.0, 'crash', 0.84);

      add(bar, 0.0, 'kick', 0.95);
      if (bar % 2 === 1) add(bar, 0.75, 'kick', 0.72);
      add(bar, 1.5, 'kick', 0.88);
      if (bar % 2 === 0) add(bar, 2.5, 'kick', 0.84);
      if (isTurnaround) add(bar, 2.75, 'kick', 0.78);

      // Clap + Snare layer đánh bật trên sân khấu
      add(bar, 1.0, 'clap', 0.88);
      add(bar, 1.0, 'snare', 0.62);
      add(bar, 3.0, 'clap', 0.92);
      add(bar, 3.0, 'snare', 0.68);
      if (isTurnaround) {
        // Turnaround fill báo chuyển nhịp
        add(bar, 3.5, 'snare', 0.72);
        add(bar, 3.5, 'clap', 0.66);
        add(bar, 3.75, 'snare', 0.86);
        add(bar, 3.75, 'clap', 0.82);
      }

      // Hi-hat 1/8 + 1/16 & các cụm roll 1/32 đậm chất Trap K-Pop
      const rollBeats = [0.0, 0.5, 1.0, 1.5, 1.625, 1.75, 1.875, 2.0, 2.25, 2.5, 3.0, 3.25, 3.5];
      rollBeats.forEach((hb, idx) => {
        const isFastRoll = hb % 0.25 !== 0;
        add(bar, hb, 'hat', isFastRoll ? 0.36 + (idx % 2) * 0.14 : 0.48, false);
      });
      if (bar % 2 === 1) {
        add(bar, 3.625, 'hat', 0.42, false);
        add(bar, 3.75, 'hat', 0.50, false);
        add(bar, 3.8125, 'hat', 0.44, false);
        add(bar, 3.875, 'hat', 0.54, false);
      }
      add(bar, 2.75, 'hat', 0.56, !isTurnaround);
    } else if (drumPattern === 'stage_pop') {
      // US-UK Stage Pop: Đập Four-on-the-Floor / Driving Synth Pop + Open Hat phách nghịch + Clap lớn
      const isTurnaround = bar === totalBars - 1 || bar % 4 === 3;
      if (bar % 4 === 0) add(bar, 0.0, 'crash', 0.86);

      add(bar, 0.0, 'kick', 0.94);
      add(bar, 1.0, 'kick', 0.86);
      add(bar, 2.0, 'kick', 0.92);
      add(bar, 3.0, 'kick', 0.86);
      if (bar % 2 === 1) add(bar, 3.5, 'kick', 0.72);

      add(bar, 1.0, 'clap', 0.88);
      add(bar, 1.0, 'snare', 0.68);
      add(bar, 3.0, 'clap', 0.92);
      add(bar, 3.0, 'snare', 0.74);
      if (isTurnaround) {
        add(bar, 3.5, 'snare', 0.72);
        add(bar, 3.75, 'snare', 0.88);
        add(bar, 3.75, 'clap', 0.84);
      }

      for (let step = 0; step < 8; step++) {
        const isOffBeat = step % 2 === 1;
        add(bar, step * 0.5, 'hat', isOffBeat ? 0.62 : 0.34, isOffBeat);
      }
    } else if (drumPattern === 'alt_hiphop') {
      // G-Dragon / Alt Bounce: Hip-Hop x Punk-Pop đảo phách cá tính + Fill triplet cuối ô
      const isTurnaround = bar === totalBars - 1 || bar % 4 === 3;
      if (bar % 4 === 0) add(bar, 0.0, 'crash', 0.82);

      add(bar, 0.0, 'kick', 0.94);
      add(bar, 1.5, 'kick', 0.82);
      add(bar, 2.0, 'kick', 0.88);
      if (bar % 2 === 1) add(bar, 2.5, 'kick', 0.74);

      add(bar, 1.0, 'snare', 0.88);
      add(bar, 1.0, 'clap', 0.74);
      add(bar, 3.0, 'snare', 0.90);
      add(bar, 3.0, 'clap', 0.78);
      add(bar, 1.75, 'rim', 0.48);

      for (let step = 0; step < 8; step++) {
        const vel = step % 2 === 1 ? 0.58 : 0.38;
        add(bar, step * 0.5, 'hat', vel, step === 3 || (step === 7 && !isTurnaround));
      }
      if (isTurnaround) {
        add(bar, 3.5, 'snare', 0.68);
        add(bar, 3.6667, 'snare', 0.76);
        add(bar, 3.8333, 'snare', 0.88);
        add(bar, 3.8333, 'clap', 0.80);
      }
    } else if (drumPattern === 'custom_seq' && customDrumGrid) {
      // Lưới 16 bước (Step Sequencer) do người dùng tự soạn
      const laneDefs = [
        { key: 'kick', drumType: 'kick', openHat: false },
        { key: 'snare', drumType: 'snare', openHat: false },
        { key: 'clap', drumType: 'clap', openHat: false },
        { key: 'hat', drumType: 'hat', openHat: false },
        { key: 'openHat', drumType: 'hat', openHat: true },
        { key: 'perc', drumType: 'rim', openHat: false },
      ];
      for (let step = 0; step < 16; step++) {
        const beat = step * 0.25;
        laneDefs.forEach(({ key, drumType, openHat }) => {
          const arr = customDrumGrid[key];
          if (!Array.isArray(arr)) return;
          const val = arr[step] || 0;
          if (val <= 0) return;
          const vel = val >= 2 ? 0.94 : 0.72;
          const type = key === 'perc' && step === 0 && val >= 2 && bar % 4 === 0 ? 'crash' : drumType;
          add(bar, beat, type, vel, openHat);
        });
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
      customDrumGrid: null,
      mixer: {
        chords: { volume: 78, muted: false, solo: false },
        melody: { volume: 82, muted: false, solo: false },
        drums:  { volume: 68, muted: false, solo: false },
        vocal:  { volume: 75, muted: false, solo: false },
        vocal2: { volume: 72, muted: false, solo: false },
      },
    };

    // Nodes
    this.masterCeiling = null;
    this.masterPeakMeter = null;
    this.masterLimiter = null;
    this.masterComp = null;
    this.masterLoudnessGain = null;
    this.masterEQ = null;
    this.masterBus = null;
    this.reverbSend = null;
    this.reverb = null;
    this.reverbReturn = null;
    this.chordChorus = null;

    this.channels = {};
    this.chordSynths = {};
    this.bassSynth = null;
    this.melodySynths = {};
    this.drums = {};
    this.countInSynth = null;
    this.trainerPiano = null;
    this.trainerSynths = {};
    this.trainerTimbre = 'grand';
    this._heldTrainerMidis = new Set();
    this._activeTrainerNotes = new Map();
    this._heldStudioMidis = new Set();
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

    // Chống trùng timestamp & khóa bật tắt Playback
    this._lastTriggerTime = this._createTriggerMap();
    this._playStartPromise = null;
    this._readyPromise = null;
    this._contextConfigured = false;
    this._lastScheduledBpm = null;
    this._countInTimers = [];
    this._countInCancelled = false;
    this._loopEndCallbackId = null;
  }

  _createTriggerMap() {
    return {
      chord: -1,
      bass: -1,
      melody: -1,
      trainer: -1,
      kick: -1,
      kickClick: -1,
      snare: -1,
      clap: -1,
      clapTail: -1,
      crash: -1,
      rim: -1,
      hat: -1,
      click: -1,
    };
  }

  isAudioRunning() {
    if (typeof window === 'undefined' || typeof window.Tone === 'undefined') return false;
    const ctx = getToneContext(window.Tone);
    return Boolean(ctx && ctx.state === 'running');
  }

  _configurePreferredContext() {
    if (this.initialized || this._contextConfigured || typeof window === 'undefined' || typeof window.Tone === 'undefined') {
      return;
    }
    const Tone = window.Tone;
    const isDesktop = window.innerWidth > 768;
    this._contextConfigured = true;
    if (!isDesktop) return;
    try {
      if (typeof Tone.Context === 'function' && typeof Tone.setContext === 'function') {
        Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.25 }), true);
      }
    } catch (err) {
      console.warn('[HEVOS STUDIO Desktop AudioContext]', err);
    }
  }

  /**
   * Kích hoạt & mở khóa Web Audio đồng bộ ngay bên trong thao tác chạm (chống câm iOS/Android)
   */
  unlockSync() {
    if (typeof window === 'undefined' || typeof window.Tone === 'undefined') return false;
    this._configurePreferredContext();
    const Tone = window.Tone;
    const ctx = getToneContext(Tone);
    const rawCtx = (ctx && ctx.rawContext) || ctx;

    try {
      if (typeof Tone.start === 'function') {
        const res = Tone.start();
        if (res && typeof res.catch === 'function') res.catch(() => {});
      }
    } catch (_) {}

    if (ctx && ctx.state !== 'running') {
      try {
        if (typeof ctx.resume === 'function') {
          const p = ctx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => {});
        }
      } catch (_) {}

      if (rawCtx && rawCtx !== ctx) {
        try {
          if (typeof rawCtx.resume === 'function') {
            const rp = rawCtx.resume();
            if (rp && typeof rp.catch === 'function') rp.catch(() => {});
          }
        } catch (_) {}
      }

      if (rawCtx && typeof rawCtx.createBuffer === 'function' && rawCtx.destination) {
        try {
          const silentBuf = rawCtx.createBuffer(1, 1, rawCtx.sampleRate || 44100);
          const src = rawCtx.createBufferSource();
          src.buffer = silentBuf;
          src.connect(rawCtx.destination);
          src.start(0);
        } catch (_) {}
      }
    }

    return Boolean(ctx && ctx.state === 'running');
  }

  /**
   * Mở khóa Web Audio Context an toàn (không bao giờ treo deadlock nếu trình duyệt chặn autoplay, có timeout 900ms)
   */
  async ensureReady() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = (async () => {
      if (typeof window.Tone === 'undefined') {
        throw new Error('Không tìm thấy thư viện Tone.js. Vui lòng kiểm tra kết nối mạng.');
      }
      const Tone = window.Tone;
      const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;

      this._configurePreferredContext();
      this.unlockSync();

      const ctx = getToneContext(Tone);
      if (ctx && ctx.state !== 'running') {
        const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 900));
        const resumeTasks = [
          Promise.resolve()
            .then(() => (typeof Tone.start === 'function' ? Tone.start() : undefined))
            .catch(() => {}),
        ];
        if (typeof ctx.resume === 'function') {
          resumeTasks.push(
            Promise.resolve()
              .then(() => ctx.resume())
              .catch(() => {})
          );
        }
        if (ctx.rawContext && typeof ctx.rawContext.resume === 'function' && ctx.rawContext !== ctx) {
          resumeTasks.push(
            Promise.resolve()
              .then(() => ctx.rawContext.resume())
              .catch(() => {})
          );
        }
        await Promise.race([Promise.allSettled(resumeTasks), timeoutPromise]);
      }

      try {
        const activeCtx = getToneContext(Tone);
        if (activeCtx) {
          activeCtx.lookAhead = isDesktop ? 0.25 : 0.15;
        }
        const dest = getToneDestination(Tone);
        if (dest) {
          dest.mute = false;
        }
      } catch (_) {}

      if (!this.initialized) {
        this._initGraph();
      }
    })();

    try {
      return await this._readyPromise;
    } finally {
      this._readyPromise = null;
    }
  }

  _initGraph() {
    const Tone = window.Tone;
    const transport = getToneTransport(Tone);
    if (transport) {
      try {
        transport.PPQ = 480;
      } catch (_) {}
    }

    // Mạch Master Loudness (-14 LUFS tự nhiên) & Bảo vệ đỉnh (-1.5 dBFS):
    // MasterBus -> EQ3 -> Loudness Gain (+2.5 dB) -> Compressor (-14 dB / 2.5:1) -> Limiter (-1.5 dBFS) -> Safety Ceiling (-1.5 dBFS) -> Destination
    this.masterCeiling = new Tone.WaveShaper((x) => {
      const ceiling = 0.841; // -1.5 dBFS
      const knee = 0.78;
      const ax = Math.abs(x);
      if (ax <= knee) return x;
      const head = ceiling - knee;
      return Math.sign(x) * (knee + head * Math.tanh((ax - knee) / head));
    }, 2048).toDestination();
    this.masterPeakMeter = new Tone.Meter({ normalRange: false, smoothing: 0.12 });
    this.masterCeiling.connect(this.masterPeakMeter);

    this.masterLimiter = new Tone.Limiter(-1.5).connect(this.masterCeiling);
    this.masterComp = new Tone.Compressor({
      threshold: -14,
      ratio: 2.5,
      knee: 12,
      attack: 0.012,
      release: 0.2,
    }).connect(this.masterLimiter);
    const boostAmp = typeof Tone.dbToGain === 'function' ? Tone.dbToGain(2.5) : Math.pow(10, 2.5 / 20);
    this.masterLoudnessGain = new Tone.Gain(boostAmp).connect(this.masterComp);
    this.masterEQ = new Tone.EQ3({
      low: 0.8,
      mid: 0,
      high: -0.5,
      lowFrequency: 180,
      highFrequency: 4600,
    }).connect(this.masterLoudnessGain);
    this.masterBus = new Tone.Gain(0.95).connect(this.masterEQ);

    // Reverb chung song song (tạo headroom sạch, không dồn rè)
    this.reverbSend = new Tone.Gain(1);
    this.reverb = new Tone.Reverb({ decay: 1.85, preDelay: 0.018, wet: 1 });
    this.reverbReturn = new Tone.Gain(0.24).connect(this.masterBus);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);

    // Chorus ấm nhẹ cho đàn đệm
    this.chordChorus = new Tone.Chorus({
      frequency: 1.25,
      delayTime: 3.2,
      depth: 0.30,
      wet: 0.25,
    }).start();

    // 5 Kênh Mixer độc lập cân bằng headroom dễ nghe ngang YouTube -14 LUFS
    this.channels = {
      chords: new Tone.Gain(0.78).connect(this.masterBus),
      melody: new Tone.Gain(0.78).connect(this.masterBus),
      drums:  new Tone.Gain(0.78).connect(this.masterBus),
      vocal:  new Tone.Gain(0.85).connect(this.masterBus),
      vocal2: new Tone.Gain(0.85).connect(this.masterBus),
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

    // Kệ hiệu ứng Vocal Studio sẽ được dựng lười (lazy) khi có giọng thu để giảm tải CPU/AudioThread

    // Bộ trống tổng hợp sắc nét
    this._initDrums();

    // Tiếng gõ đếm vào (Count-in) đi thẳng ra masterBus để luôn nghe rõ kể cả khi tắt trống
    this.countInSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.002, decay: 0.045, sustain: 0, release: 0.03 },
      volume: -10,
    }).connect(this.masterBus);

    // Khởi tạo sẵn 2 tiếng mặc định
    this._getChordSynth(this.state.chordTimbre);
    this._getMelodySynth(this.state.melodyTimbre);
    this._ensureTrainerSynths();

    this.applyMixer(this.state.mixer);
    this.initialized = true;

    // Chỉ nạp Vocal khi đã có file thu chờ sẵn (giữ DSP rảnh hoàn toàn lúc làm Beat)
    ['lead', 'backing'].forEach((tid) => {
      const t = this.vocalTracks[tid];
      if (t.pendingBlob) {
        const blob = t.pendingBlob;
        const off = t.syncOffsetMs;
        t.pendingBlob = null;
        this.setVocalTrackAudio(tid, blob, off).catch(() => {});
      }
    });
  }

  _ensureVocalTrackChain(trackId) {
    const track = this.vocalTracks[trackId];
    if (!track || !this.initialized) return null;
    if (!track.chain) {
      const destChannel = this.channels[track.mixerKey] || this.channels.vocal;
      track.chain = this._createVocalChain(destChannel);
      if (track.pendingFx) {
        const fx = track.pendingFx;
        this.updateVocalTrackFx(trackId, fx);
      }
    }
    return track.chain;
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
      volume: -5,
      oscillator: {
        type: 'custom',
        partials: [1, 0.42, 0.2, 0.09, 0.04],
      },
      envelope: { attack: 0.006, decay: 1.4, sustain: 0.14, release: 0.65 },
    });
    this.trainerPiano.maxPolyphony = 32;
    this.trainerPiano.connect(filter);
    filter.connect(this.masterBus);
    filter.connect(revSend);

    this.trainerWrongSynth = new Tone.Synth({
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.09, sustain: 0, release: 0.05 },
      volume: -10,
    }).connect(this.masterBus);

    this.trainerClickSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
      volume: -7,
    }).connect(this.masterBus);
  }

  _getTrainerSynth(timbreId = null) {
    const Tone = window.Tone;
    const key = timbreId === 'rhodes' || timbreId === 'pad' ? timbreId : 'grand';
    if (this.trainerSynths[key]) return this.trainerSynths[key];
    if (!Tone || !this.masterBus) return null;

    let synth;
    let filter;
    const revSend = new Tone.Gain(key === 'pad' ? 0.34 : 0.22).connect(this.reverbSend);

    if (key === 'rhodes') {
      filter = new Tone.Filter(2500, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        volume: -8.5,
        harmonicity: 2,
        modulationIndex: 1.35,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.008, decay: 1.35, sustain: 0.28, release: 0.60 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.008, decay: 0.38, sustain: 0.06, release: 0.24 },
      });
      synth.connect(filter);
      if (this.chordChorus) filter.connect(this.chordChorus);
      filter.connect(this.masterBus);
      filter.connect(revSend);
    } else if (key === 'pad') {
      filter = new Tone.Filter(1550, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -11.5,
        oscillator: { type: 'fatsawtooth', count: 2, spread: 16 },
        envelope: { attack: 0.14, decay: 0.70, sustain: 0.65, release: 0.68 },
      });
      synth.connect(filter);
      if (this.chordChorus) filter.connect(this.chordChorus);
      filter.connect(this.masterBus);
      filter.connect(revSend);
    } else {
      // Grand Piano sáng ấm rõ nét
      filter = new Tone.Filter(2800, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -7.5,
        oscillator: {
          type: 'custom',
          partials: [1, 0.48, 0.22, 0.09, 0.035, 0.012],
        },
        envelope: { attack: 0.006, decay: 1.5, sustain: 0.22, release: 0.65 },
      });
      synth.connect(filter);
      filter.connect(this.masterBus);
      filter.connect(revSend);
    }

    synth.maxPolyphony = 48;
    this.trainerSynths[key] = synth;
    return synth;
  }

  setTrainerTimbre(timbreId) {
    const key = timbreId === 'rhodes' || timbreId === 'pad' ? timbreId : 'grand';
    this.trainerTimbre = key;
    if (this.initialized) {
      this._getTrainerSynth(key);
    }
  }

  _initDrums() {
    const Tone = window.Tone;
    const drumBus = this.channels.drums;

    // Kick sâu gọn có transient click giúp đục rõ qua loa laptop/điện thoại (chuẩn loudness -14 LUFS)
    const kick = new Tone.MembraneSynth({
      pitchDecay: 0.042,
      octaves: 5.8,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.002, decay: 0.30, sustain: 0.01, release: 0.22 },
      volume: -5,
    }).connect(drumBus);

    const kickClick = new Tone.MembraneSynth({
      pitchDecay: 0.012,
      octaves: 2.0,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.022, sustain: 0, release: 0.01 },
      volume: -11,
    }).connect(drumBus);

    // Snare noise (lọc bandpass gọn)
    const snareFilter = new Tone.Filter({ type: 'bandpass', frequency: 1900, Q: 0.9 }).connect(drumBus);
    const snareNoise = new Tone.NoiseSynth({
      noise: { type: 'pink' },
      envelope: { attack: 0.002, decay: 0.14, sustain: 0, release: 0.05 },
      volume: -8.5,
    }).connect(snareFilter);
    snareFilter.connect(new Tone.Gain(0.18).connect(this.reverbSend));

    // Clap sân khấu 2 lớp (1350Hz + đuôi 1650Hz vang nhẹ)
    const clapFilter = new Tone.Filter({ type: 'bandpass', frequency: 1400, Q: 1.1 }).connect(drumBus);
    const clap = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.002, decay: 0.065, sustain: 0, release: 0.03 },
      volume: -8.5,
    }).connect(clapFilter);
    const clapTailFilter = new Tone.Filter({ type: 'bandpass', frequency: 1750, Q: 0.85 }).connect(drumBus);
    const clapTail = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.003, decay: 0.13, sustain: 0, release: 0.06 },
      volume: -10.5,
    }).connect(clapTailFilter);
    clapTailFilter.connect(new Tone.Gain(0.24).connect(this.reverbSend));

    // Rimshot / Snare tonal body (rất hợp Lo-Fi / R&B / Ballad)
    const rim = new Tone.MembraneSynth({
      pitchDecay: 0.015,
      octaves: 2.2,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.001, decay: 0.075, sustain: 0, release: 0.04 },
      volume: -8.5,
    }).connect(drumBus);

    // Hi-hat mượt (white noise lọc highpass, không bị chói gắt)
    const hatFilter = new Tone.Filter({ type: 'highpass', frequency: 7200 }).connect(drumBus);
    const hat = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.042, sustain: 0, release: 0.02 },
      volume: -13,
    }).connect(hatFilter);

    // Crash cymbal mở đầu đoạn drop sân khấu
    const crashFilter = new Tone.Filter({ type: 'highpass', frequency: 4800 }).connect(drumBus);
    const crash = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.004, decay: 0.55, sustain: 0, release: 0.25 },
      volume: -13,
    }).connect(crashFilter);
    crashFilter.connect(new Tone.Gain(0.28).connect(this.reverbSend));

    // Metronome click đi qua kênh trống
    const click = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
      volume: -7.5,
    }).connect(drumBus);

    this.drums = { kick, kickClick, snareNoise, clap, clapTail, rim, hat, crash, click };
  }

  _getBassSynth() {
    const Tone = window.Tone;
    if (this.bassSynth) return this.bassSynth;

    const eq = new Tone.EQ3({
      low: 2.8,
      mid: -1.0,
      high: -6,
      lowFrequency: 140,
      highFrequency: 1200,
    });
    const filter = new Tone.Filter(460, 'lowpass');
    const synth = new Tone.PolySynth(Tone.Synth, {
      volume: -9.5,
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.012, decay: 0.68, sustain: 0.36, release: 0.34 },
    });
    synth.maxPolyphony = 16;
    synth.connect(eq);
    eq.connect(filter);
    filter.connect(this.channels.chords);

    this.bassSynth = synth;
    return synth;
  }

  _getChordSynth(timbreId) {
    const Tone = window.Tone;
    if (this.chordSynths[timbreId]) return this.chordSynths[timbreId];

    let synth;
    let filter;
    const revSend = new Tone.Gain(0.24).connect(this.reverbSend);

    if (timbreId === 'dark_brass') {
      // Dark Synth Brass (YG / K-Pop / US-UK Stage): Fatsawtooth dày uy lực, ngắt gọn khi đánh staccato
      const punchEq = new Tone.EQ3({
        low: 2.0,
        mid: 1.8,
        high: -2.0,
        lowFrequency: 210,
        highFrequency: 3400,
      });
      const chorusSend = new Tone.Gain(0.20).connect(this.chordChorus);
      filter = new Tone.Filter(1950, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -11.5,
        oscillator: { type: 'fatsawtooth', count: 2, spread: 18 },
        envelope: { attack: 0.014, decay: 0.48, sustain: 0.48, release: 0.28 },
      });
      revSend.gain.value = 0.22;
      synth.connect(punchEq);
      punchEq.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(chorusSend);
      filter.connect(revSend);
    } else if (timbreId === 'stage_pluck') {
      // Stage Pluck / Lead (G-Dragon / Trap Soul): Nảy đanh dứt khoát, sáng rõ hợp với beat nhiều khoảng thở
      const chorusSend = new Tone.Gain(0.18).connect(this.chordChorus);
      filter = new Tone.Filter(2850, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -10.5,
        oscillator: { type: 'fatsawtooth', count: 2, spread: 11 },
        envelope: { attack: 0.004, decay: 0.34, sustain: 0.08, release: 0.22 },
      });
      revSend.gain.value = 0.24;
      synth.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(chorusSend);
      filter.connect(revSend);
    } else if (timbreId === 'modern_piano') {
      // Piano Pop Hiện Đại Trầm Ấm (Felt / Modern Upright Piano: thân ấm dày, dải cao êm không chói)
      const warmEq = new Tone.EQ3({
        low: 3.2,
        mid: 0.6,
        high: -3.5,
        lowFrequency: 230,
        highFrequency: 2800,
      });
      const chorusSend = new Tone.Gain(0.16).connect(this.chordChorus);
      filter = new Tone.Filter(1650, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -9.5,
        oscillator: {
          type: 'custom',
          partials: [1, 0.56, 0.22, 0.08, 0.025, 0.008],
        },
        envelope: { attack: 0.011, decay: 1.55, sustain: 0.20, release: 0.68 },
      });
      revSend.gain.value = 0.30;
      synth.connect(warmEq);
      warmEq.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(chorusSend);
      filter.connect(revSend);
    } else if (timbreId === 'piano') {
      filter = new Tone.Filter(2600, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -11.5,
        oscillator: {
          type: 'custom',
          partials: [1, 0.45, 0.22, 0.10, 0.045, 0.018],
        },
        envelope: { attack: 0.007, decay: 1.45, sustain: 0.16, release: 0.65 },
      });
      revSend.gain.value = 0.28;
      synth.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(revSend);
    } else if (timbreId === 'pad') {
      filter = new Tone.Filter(1450, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -14,
        oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
        envelope: { attack: 0.22, decay: 0.8, sustain: 0.62, release: 0.70 },
      });
      revSend.gain.value = 0.42;
      synth.connect(filter);
      filter.connect(this.chordChorus);
      filter.connect(revSend);
    } else if (timbreId === 'guitar') {
      filter = new Tone.Filter(3200, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -10.5,
        oscillator: {
          type: 'custom',
          partials: [1, 0.68, 0.44, 0.28, 0.16, 0.08, 0.035],
        },
        envelope: { attack: 0.004, decay: 0.85, sustain: 0.04, release: 0.45 },
      });
      revSend.gain.value = 0.20;
      synth.connect(filter);
      filter.connect(this.channels.chords);
      filter.connect(revSend);
    } else {
      // Mặc định: Warm Rhodes / Electric Piano (chuẩn loudness + release <= 0.7s chống nghẽn đa âm)
      filter = new Tone.Filter(2600, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        volume: -11.5,
        harmonicity: 2,
        modulationIndex: 1.4,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.010, decay: 1.35, sustain: 0.24, release: 0.62 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.008, decay: 0.40, sustain: 0.05, release: 0.25 },
      });
      revSend.gain.value = 0.26;
      synth.connect(filter);
      filter.connect(this.chordChorus);
      filter.connect(revSend);
    }

    synth.maxPolyphony = 64;
    this.chordSynths[timbreId] = synth;
    return synth;
  }

  _getMelodySynth(timbreId) {
    const Tone = window.Tone;
    if (this.melodySynths[timbreId]) return this.melodySynths[timbreId];

    let synth;
    let filter;
    const revSend = new Tone.Gain(0.28).connect(this.reverbSend);

    if (timbreId === 'lead') {
      filter = new Tone.Filter(2350, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -10.5,
        oscillator: { type: 'fatsawtooth', count: 2, spread: 14 },
        envelope: { attack: 0.020, decay: 0.32, sustain: 0.56, release: 0.35 },
      });
      revSend.gain.value = 0.26;
    } else if (timbreId === 'flute') {
      filter = new Tone.Filter(2900, 'lowpass');
      synth = new Tone.PolySynth(Tone.Synth, {
        volume: -9.5,
        oscillator: { type: 'custom', partials: [1, 0.26, 0.09, 0.03] },
        envelope: { attack: 0.055, decay: 0.28, sustain: 0.68, release: 0.50 },
      });
      revSend.gain.value = 0.38;
    } else if (timbreId === 'ep') {
      filter = new Tone.Filter(3500, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        volume: -9.5,
        harmonicity: 2,
        modulationIndex: 2.0,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.008, decay: 1.0, sustain: 0.22, release: 0.65 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.005, decay: 0.28, sustain: 0.05, release: 0.22 },
      });
      revSend.gain.value = 0.26;
    } else {
      // Mặc định: Chuông êm / Pluck
      filter = new Tone.Filter(3600, 'lowpass');
      synth = new Tone.PolySynth(Tone.FMSynth, {
        volume: -9.5,
        harmonicity: 3,
        modulationIndex: 1.4,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.005, decay: 0.85, sustain: 0.12, release: 0.60 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.02, release: 0.18 },
      });
      revSend.gain.value = 0.30;
    }

    synth.connect(filter);
    filter.connect(this.channels.melody);
    filter.connect(revSend);
    synth.maxPolyphony = 64;
    this.melodySynths[timbreId] = synth;
    return synth;
  }

  /**
   * Cập nhật âm lượng, Mute và Solo cho Mixer (đạt chuẩn loudness -14 LUFS tự nhiên khi chạy mặc định 75–82%)
   */
  applyMixer(mixer) {
    this.state.mixer = JSON.parse(JSON.stringify(mixer));
    if (!this.initialized) return;

    for (const [key, ch] of Object.entries(mixer)) {
      const node = this.channels[key];
      if (!node || !ch) continue;
      const isAudible = isMixerChannelAudible(mixer, key);
      const rawVol = Number.isFinite(Number(ch.volume)) ? Number(ch.volume) : 75;
      const norm = Math.max(0, Math.min(100, rawVol)) / 100;
      const scale = key === 'vocal' || key === 'vocal2' ? 0.85 : 0.78;
      const gain = isAudible ? Math.pow(norm, 1.55) * scale : 0;
      if (Number.isFinite(gain)) {
        node.gain.rampTo(gain, 0.03);
      }
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
        const decoded = await getToneContext(Tone).decodeAudioData(arrBuf);
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
    if (param == null || !Number.isFinite(val)) return;
    const safeDur = Number.isFinite(dur) ? Math.max(0.005, dur) : 0.025;
    if (typeof param.rampTo === 'function') {
      param.rampTo(val, safeDur);
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
    if (!this.initialized) {
      track.pendingBlob = source;
      return;
    }
    const chain = this._ensureVocalTrackChain(trackId);
    if (!chain) {
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
        const decoded = await getToneContext(Tone).decodeAudioData(arrBuf);
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
    track.player = new Tone.Player(toneBuf).connect(chain.input);
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

    if (!this.initialized) return;
    if (!track.chain && !track.hasAudio && !track.player) return;
    const chain = this._ensureVocalTrackChain(trackId);
    if (!chain) return;

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

  _resetTriggerTimes() {
    this._lastTriggerTime = this._createTriggerMap();
  }

  _nextSafeTime(key, rawTime) {
    const Tone = window.Tone;
    const ctx = getToneContext(Tone);
    // Dùng ctx.immediate() (thời gian phần cứng thực) thay vì ctx.now() (= currentTime + lookAhead),
    // tránh ép mọi sự kiện Transport dồn vào chu kỳ wake-up thô 75–125ms của worker gây lệch nhịp lúc nhanh lúc chậm
    const immediateNow =
      ctx && typeof ctx.immediate === 'function'
        ? ctx.immediate()
        : ctx && ctx.rawContext && Number.isFinite(ctx.rawContext.currentTime)
          ? ctx.rawContext.currentTime
          : 0;
    const floorImmediate = Number.isFinite(immediateNow) ? immediateNow + 0.002 : 0.002;
    const baseTime = Number.isFinite(rawTime) ? rawTime : floorImmediate;
    let prev = this._lastTriggerTime[key];
    if (!Number.isFinite(prev) || prev > floorImmediate + 4.0) {
      prev = floorImmediate - 0.001;
    }
    const safeTime = Math.max(baseTime, floorImmediate, prev + 0.0005);
    this._lastTriggerTime[key] = safeTime;
    return safeTime;
  }

  _releaseAllSynths() {
    if (this.bassSynth) {
      try {
        this.bassSynth.releaseAll();
      } catch (_) {}
    }
    Object.values(this.chordSynths).forEach((s) => {
      try {
        s.releaseAll();
      } catch (_) {}
    });
    Object.values(this.melodySynths).forEach((s) => {
      try {
        s.releaseAll();
      } catch (_) {}
    });
    this._resetTriggerTimes();
  }

  _clearParts() {
    const transport = getToneTransport(window.Tone);
    if (this.chordPart) {
      try { this.chordPart.stop(); this.chordPart.dispose(); } catch (_) {}
      this.chordPart = null;
    }
    if (this.melodyPart) {
      try { this.melodyPart.stop(); this.melodyPart.dispose(); } catch (_) {}
      this.melodyPart = null;
    }
    if (this.drumPart) {
      try { this.drumPart.stop(); this.drumPart.dispose(); } catch (_) {}
      this.drumPart = null;
    }
    if (this.vocalEventId !== null) {
      try { transport.clear(this.vocalEventId); } catch (_) {}
      this.vocalEventId = null;
    }
    ['lead', 'backing'].forEach((tid) => {
      const tr = this.vocalTracks[tid];
      if (tr && tr.eventId !== null) {
        try { transport.clear(tr.eventId); } catch (_) {}
        tr.eventId = null;
      }
    });
    if (this._loopEndCallbackId !== null) {
      try { transport.clear(this._loopEndCallbackId); } catch (_) {}
      this._loopEndCallbackId = null;
    }
    transport.cancel(0);
    this._releaseAllSynths();
  }

  /**
   * Hủy sự kiện cũ và lập lịch lại toàn bộ bằng Ticks chuẩn PPQ = 480:
   * Giữ nhịp chính xác tuyệt đối theo đồng hồ phần cứng AudioContext, chống trùng timestamp & bảo vệ NaN
   */
  rebuildSchedule() {
    if (!this.initialized) return;
    const Tone = window.Tone;
    const ctx = getToneContext(Tone);
    const transport = getToneTransport(Tone);

    // Nếu có vocal source chờ từ trước lúc init
    if (this._pendingVocalSource && !this.vocalPlayer) {
      const pending = this._pendingVocalSource;
      this._pendingVocalSource = null;
      this.setRawVocalBuffer(pending).catch(() => {});
    }

    const rawBpm = Number(this.state.bpm);
    const bpm = Number.isFinite(rawBpm) ? Math.max(40, Math.min(240, rawBpm)) : 84;
    const totalBars = this.state.totalBars === 8 ? 8 : 4;
    const rawHumanize = Number(this.state.humanize);
    const humanize = Number.isFinite(rawHumanize) ? Math.max(0, Math.min(100, rawHumanize)) : 55;
    const { chordStyle, chordTimbre, melodyTimbre, drumPattern, voicedChords, melodyNotes } =
      this.state;

    const beatSec = 60 / bpm;
    const totalBeats = totalBars * 4;
    const loopDurationSec = totalBeats * beatSec;
    if (!Number.isFinite(loopDurationSec) || loopDurationSec <= 0) return;

    const ppq = Math.max(192, Number(transport.PPQ) || 480);
    const totalTicks = Math.round(totalBeats * ppq);
    const wasStarted = transport.state === 'started';

    this._clearParts();

    // Đặt BPM ngay tại tick 0 khi dừng (tránh sót đoạn 120 BPM ở 0..lookAhead), hoặc cập nhật mượt tại immediate() khi đang phát
    if (!wasStarted) {
      try {
        transport.bpm.cancelScheduledValues(0);
        transport.bpm.setValueAtTime(bpm, 0);
      } catch (_) {
        transport.bpm.value = bpm;
      }
    } else if (this._lastScheduledBpm !== bpm) {
      const immediateSec =
        ctx && typeof ctx.immediate === 'function' ? ctx.immediate() : getToneNow(Tone);
      try {
        transport.bpm.setValueAtTime(bpm, Math.max(0, immediateSec));
      } catch (_) {
        transport.bpm.value = bpm;
      }
    }
    this._lastScheduledBpm = bpm;

    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = `${totalTicks}i`;

    this._syncVocalDelayTimes();

    // Chuẩn hóa danh sách sự kiện theo Ticks (giữ nguyên mốc phách chuẩn, chỉ tách +1 tick cho nốt trùng trên cùng synth)
    const toTickEvents = (rawEvents, singleKeyFn = null) => {
      rawEvents.sort((a, b) => a.tick - b.tick);
      if (singleKeyFn) {
        const lastTickByKey = new Map();
        return rawEvents.map((item) => {
          const k = singleKeyFn(item.val);
          let tk = Math.max(0, Math.min(totalTicks - 4, item.tick));
          const prev = lastTickByKey.get(k);
          if (prev !== undefined && tk <= prev) {
            tk = Math.min(totalTicks - 2, prev + 1);
          }
          lastTickByKey.set(k, tk);
          return [`${tk}i`, item.val];
        });
      }
      // Đối với PolySynth: giữ nhiều nốt cùng hợp âm bắn đúng tick beat, _nextSafeTime sẽ tự rải +0.5ms ở AudioContext
      return rawEvents.map((item) => [
        `${Math.max(0, Math.min(totalTicks - 2, item.tick))}i`,
        item.val,
      ]);
    };

    // --- 1. Lập lịch Hợp âm & Bass (tách riêng Warm Bass cho role='bass' và Chord Synth cho tay phải) ---
    const chordSynth = this._getChordSynth(chordTimbre);
    const bassSynth = this._getBassSynth();
    const { allEvents: accEvents } = generateAccompanimentEvents({
      voicedChords,
      totalBars,
      bpm,
      chordStyle,
      drumPattern,
      humanize,
    });

    const chordPartEvents = toTickEvents(
      accEvents
        .filter((ev) => Number.isFinite(ev.startBeat) && Number.isFinite(ev.midi))
        .map((ev) => ({
          tick: Math.round(Math.max(0, Math.min(totalBeats - 0.02, ev.startBeat)) * ppq),
          val: {
            midi: Math.max(24, Math.min(108, Math.round(ev.midi))),
            role: ev.role === 'bass' ? 'bass' : 'chord',
            durSec: Number.isFinite(ev.durationBeat)
              ? Math.max(0.05, Math.min(4.0, ev.durationBeat * beatSec))
              : 0.4,
            vel: Number.isFinite(ev.velocity)
              ? Math.max(0.08, Math.min(0.92, ev.velocity))
              : 0.65,
          },
        }))
    );

    this.chordPart = new Tone.Part((time, val) => {
      if (!Number.isFinite(time) || !val || !Number.isFinite(val.midi)) return;
      const isBass = val.role === 'bass';
      const safeTime = this._nextSafeTime(isBass ? 'bass' : 'chord', time);
      const dur = Number.isFinite(val.durSec) ? Math.max(0.04, Math.min(4.0, val.durSec)) : 0.4;
      const vel = Number.isFinite(val.vel) ? Math.max(0.05, Math.min(0.92, val.vel)) : 0.65;
      try {
        const targetSynth = isBass ? bassSynth : chordSynth;
        targetSynth.triggerAttackRelease(midiToToneNote(val.midi), dur, safeTime, vel);
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
    const melodyPartEvents = toTickEvents(
      melEvents
        .filter((ev) => Number.isFinite(ev.startBeat) && Number.isFinite(ev.midi))
        .map((ev) => ({
          tick: Math.round(Math.max(0, Math.min(totalBeats - 0.02, ev.startBeat)) * ppq),
          val: {
            midi: Math.max(24, Math.min(108, Math.round(ev.midi))),
            durSec: Number.isFinite(ev.durationBeat)
              ? Math.max(0.05, Math.min(4.0, ev.durationBeat * beatSec))
              : 0.3,
            vel: Number.isFinite(ev.velocity)
              ? Math.max(0.08, Math.min(0.92, ev.velocity))
              : 0.72,
          },
        }))
    );

    this.melodyPart = new Tone.Part((time, val) => {
      if (!Number.isFinite(time) || !val || !Number.isFinite(val.midi)) return;
      const safeTime = this._nextSafeTime('melody', time);
      const dur = Number.isFinite(val.durSec) ? Math.max(0.04, Math.min(4.0, val.durSec)) : 0.3;
      const vel = Number.isFinite(val.vel) ? Math.max(0.05, Math.min(0.92, val.vel)) : 0.72;
      try {
        melodySynth.triggerAttackRelease(midiToToneNote(val.midi), dur, safeTime, vel);
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
        customDrumGrid: this.state.customDrumGrid,
      });
      const drumPartEvents = toTickEvents(
        drumEvents
          .filter((ev) => Number.isFinite(ev.startBeat))
          .map((ev) => ({
            tick: Math.round(Math.max(0, Math.min(totalBeats - 0.02, ev.startBeat)) * ppq),
            val: {
              type: ev.drumType,
              vel: Number.isFinite(ev.velocity)
                ? Math.max(0.08, Math.min(0.92, ev.velocity))
                : 0.7,
              openHat: Boolean(ev.openHat),
            },
          })),
        (v) => v.type
      );
      this.drumPart = new Tone.Part((time, ev) => {
        if (!Number.isFinite(time) || !ev) return;
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
      this.vocalEventId = transport.schedule((time) => {
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
    const transport = getToneTransport(Tone);

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
      track.eventId = transport.schedule((time) => {
        try {
          track.player.stop(time);
          track.player.start(time, absOff, playDur);
        } catch (_) {}
      }, 0);

      if (this.isPlaying && transport.state === 'started') {
        const curLoopSec = ((transport.seconds % loopDurationSec) + loopDurationSec) % loopDurationSec;
        const bufOffset = absOff + curLoopSec;
        const rem = Math.min(loopDurationSec - curLoopSec, bufDur - bufOffset);
        if (rem > 0.04) {
          try {
            track.player.start(getToneNow(Tone) + 0.02, bufOffset, rem);
          } catch (_) {}
        }
      }
    } else {
      const startSec = Math.min(Math.max(0, loopDurationSec - 0.05), offsetSec);
      const playDur = Math.max(0.05, Math.min(loopDurationSec - startSec, bufDur));
      track.eventId = transport.schedule((time) => {
        try {
          track.player.stop(time);
          track.player.start(time, 0, playDur);
        } catch (_) {}
      }, startSec);

      if (this.isPlaying && transport.state === 'started') {
        const curLoopSec = ((transport.seconds % loopDurationSec) + loopDurationSec) % loopDurationSec;
        if (curLoopSec >= startSec) {
          const bufOffset = curLoopSec - startSec;
          const rem = Math.min(loopDurationSec - curLoopSec, bufDur - bufOffset);
          if (rem > 0.04) {
            try {
              track.player.start(getToneNow(Tone) + 0.02, bufOffset, rem);
            } catch (_) {}
          }
        }
      }
    }
  }

  _triggerDrum(type, time, vel, openHat = false) {
    if (!Number.isFinite(time)) return;
    const safeVel = Number.isFinite(vel) ? Math.max(0.05, Math.min(0.92, vel)) : 0.65;

    try {
      if (type === 'kick') {
        const kt = this._nextSafeTime('kick', time);
        this.drums.kick.triggerAttackRelease('C1', 0.14, kt, safeVel);
        if (this.drums.kickClick) {
          this.drums.kickClick.triggerAttackRelease('G3', 0.02, this._nextSafeTime('kickClick', time), safeVel * 0.65);
        }
      } else if (type === 'snare') {
        this.drums.snareNoise.triggerAttackRelease(0.08, this._nextSafeTime('snare', time), safeVel);
      } else if (type === 'clap') {
        if (this.drums.clap) {
          this.drums.clap.triggerAttackRelease(0.05, this._nextSafeTime('clap', time), safeVel);
        }
        if (this.drums.clapTail) {
          this.drums.clapTail.triggerAttackRelease(0.11, this._nextSafeTime('clapTail', time + 0.013), safeVel * 0.85);
        }
      } else if (type === 'crash') {
        if (this.drums.crash) {
          this.drums.crash.triggerAttackRelease(0.45, this._nextSafeTime('crash', time), safeVel * 0.72);
        }
      } else if (type === 'rim') {
        this.drums.rim.triggerAttackRelease('G3', 0.045, this._nextSafeTime('rim', time), safeVel);
      } else if (type === 'hat') {
        this.drums.hat.envelope.decay = openHat ? 0.16 : 0.042;
        this.drums.hat.triggerAttackRelease(openHat ? 0.16 : 0.04, this._nextSafeTime('hat', time), safeVel);
      } else if (type === 'clickAccent') {
        this.drums.click.triggerAttackRelease('C6', 0.03, this._nextSafeTime('click', time), safeVel);
      } else if (type === 'click') {
        this.drums.click.triggerAttackRelease('G5', 0.03, this._nextSafeTime('click', time), safeVel);
      }
    } catch (_) {}
  }

  /**
   * Nghe thử ngay 1 nốt giai điệu (khi chạm vào Piano Roll hoặc bàn phím dọc)
   */
  async auditionMelodyNote(midi, duration = 0.28) {
    if (!Number.isFinite(midi)) return;
    this.unlockSync();
    await this.ensureReady();
    const synth = this._getMelodySynth(this.state.melodyTimbre);
    const dur = Number.isFinite(duration) ? Math.max(0.05, duration) : 0.28;
    const t = this._nextSafeTime('melody', getToneNow(window.Tone) + 0.005);
    try {
      synth.triggerAttackRelease(midiToToneNote(Math.round(midi)), dur, t, 0.78);
    } catch (_) {}
  }

  /**
   * Nghe thử ngay 1 hợp âm (khi người dùng chọn hợp âm trong Chord Picker)
   */
  async auditionChord(voicedChord) {
    if (!voicedChord || !Number.isFinite(voicedChord.bassMidi)) return;
    this.unlockSync();
    await this.ensureReady();
    const synth = this._getChordSynth(this.state.chordTimbre);
    const bassSynth = this._getBassSynth();
    const baseNow = getToneNow(window.Tone) + 0.005;
    try {
      const bt = this._nextSafeTime('bass', baseNow);
      bassSynth.triggerAttackRelease(midiToToneNote(Math.round(voicedChord.bassMidi)), 0.85, bt, 0.74);
    } catch (_) {}
    const upper = voicedChord.upperMidis || [];
    upper.forEach((midi, idx) => {
      if (!Number.isFinite(midi)) return;
      const t = this._nextSafeTime('chord', baseNow + (idx + 1) * 0.022);
      const vel = Math.max(0.2, Math.min(0.9, 0.68 - idx * 0.03));
      try {
        synth.triggerAttackRelease(midiToToneNote(Math.round(midi)), 0.75, t, vel);
      } catch (_) {}
    });
  }

  /**
   * Ước lượng độ trễ tổng (Tone lookAhead + start offset + phần cứng đầu ra) để căn thẳng đầu beat 0
   */
  getRecordLatencyCompSec() {
    const Tone = window.Tone;
    const ctx = getToneContext(Tone);
    const lookAhead = ctx ? (ctx.lookAhead || 0.15) : 0.15;
    const baseLatency =
      ctx && ctx.rawContext && typeof ctx.rawContext.baseLatency === 'number'
        ? ctx.rawContext.baseLatency
        : 0.02;
    return Math.max(0.06, Math.min(0.40, lookAhead + 0.03 + baseLatency));
  }

  async play(fromStart = false, { muteVocal = false, recordingTrack = null } = {}) {
    this.unlockSync();
    if (this._playStartPromise) return this._playStartPromise;
    this._playStartPromise = (async () => {
      try {
        await this.ensureReady();
        const Tone = window.Tone;
        const ctx = getToneContext(Tone);
        const transport = getToneTransport(Tone);
        const dest = getToneDestination(Tone);
        if (dest) dest.mute = false;
        this._muteVocalDuringRecord = Boolean(muteVocal);
        this._recordingTrackMask = recordingTrack;
        if (fromStart || !this.isPlaying) {
          const imm = ctx && typeof ctx.immediate === 'function' ? ctx.immediate() : undefined;
          try { transport.stop(imm); } catch (_) { transport.stop(); }
          transport.cancel(0);
          transport.seconds = 0;
        }
        this.rebuildSchedule();
        const startPos = fromStart || !this.isPlaying ? 0 : transport.seconds;
        const leadIn = fromStart || !this.isPlaying ? '+0.10' : '+0.06';
        transport.start(leadIn, Number.isFinite(startPos) ? startPos : 0);
        this.isPlaying = true;
      } finally {
        this._playStartPromise = null;
      }
    })();
    return this._playStartPromise;
  }

  stop() {
    if (!this.initialized) return;
    const Tone = window.Tone;
    const ctx = getToneContext(Tone);
    const transport = getToneTransport(Tone);
    this.cancelCountIn();
    try {
      const imm = ctx && typeof ctx.immediate === 'function' ? ctx.immediate() : undefined;
      transport.stop(imm);
      transport.seconds = 0;
      transport.cancel(0);
    } catch (_) {}
    this.isPlaying = false;
    this._muteVocalDuringRecord = false;
    this._recordingTrackMask = null;

    // Nhả hết nốt đang ngân & reset bộ đếm timestamp
    this._releaseAllSynths();
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
   * Trả về vị trí playhead hiện tại theo đơn vị beat (0 .. totalBars*4) khớp đồng hồ phần cứng
   */
  getCurrentBeat() {
    if (!this.initialized || !this.isPlaying) return 0;
    const Tone = window.Tone;
    const ctx = getToneContext(Tone);
    const transport = getToneTransport(Tone);
    const totalBeats = this.state.totalBars * 4;
    const ppq = Math.max(192, Number(transport.PPQ) || 480);
    const totalTicks = totalBeats * ppq;
    if (totalTicks <= 0) return 0;

    const immediateSec = ctx && typeof ctx.immediate === 'function' ? ctx.immediate() : undefined;
    const rawTicks =
      immediateSec !== undefined && typeof transport.getTicksAtTime === 'function'
        ? transport.getTicksAtTime(immediateSec)
        : transport.ticks;
    if (!Number.isFinite(rawTicks) || rawTicks < 0) return 0;
    const curTicks = ((rawTicks % totalTicks) + totalTicks) % totalTicks;
    return (curTicks / totalTicks) * totalBeats;
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
    const startAudioTime = getToneNow(Tone) + 0.05;

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
    (this.masterCeiling || this.masterLimiter).connect(recorder);

    const totalBeats = this.state.totalBars * 4;
    const loopDurationSec = totalBeats * (60 / this.state.bpm);
    const hasVocalTail = this.vocalTracks.lead.hasAudio || this.vocalTracks.backing.hasAudio;
    const tailSec = hasVocalTail ? 1.1 : 0.55;

    const transport = getToneTransport(Tone);

    try {
      this.rebuildSchedule();
      transport.loop = false; // Chỉ phát đúng 1 vòng + đuôi reverb
      await recorder.start();
      transport.start('+0.04', 0);
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
        (this.masterCeiling || this.masterLimiter).disconnect(recorder);
        recorder.dispose();
      } catch (_) {}
      transport.loop = true;
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
    if (!Number.isFinite(midi)) return;
    this.unlockSync();
    await this.ensureReady();
    this._ensureTrainerSynths();
    const t = this._nextSafeTime('trainer', getToneNow(window.Tone) + 0.005);
    const dur = Number.isFinite(duration) ? Math.max(0.05, duration) : 0.65;
    const vel = Number.isFinite(velocity) ? Math.max(0.1, Math.min(0.95, velocity)) : 0.82;
    try {
      this.trainerPiano.triggerAttackRelease(
        midiToToneNote(Math.round(midi)),
        dur,
        t,
        vel
      );
    } catch (_) {}
  }

  async playTrainerWrong() {
    this.unlockSync();
    await this.ensureReady();
    this._ensureTrainerSynths();
    const t = this._nextSafeTime('trainer', getToneNow(window.Tone) + 0.005);
    try {
      this.trainerWrongSynth.triggerAttackRelease('F2', 0.09, t, 0.55);
    } catch (_) {}
  }

  async playTrainerClick(accent = false) {
    this.unlockSync();
    await this.ensureReady();
    this._ensureTrainerSynths();
    const t = this._nextSafeTime('click', getToneNow(window.Tone) + 0.005);
    try {
      this.trainerClickSynth.triggerAttackRelease(
        accent ? 'C6' : 'G5',
        '32n',
        t,
        accent ? 0.72 : 0.45
      );
    } catch (_) {}
  }

  stopTrainerAudio() {
    this._heldTrainerMidis.clear();
    this._activeTrainerNotes.clear();
    if (this.trainerPiano) {
      try {
        this.trainerPiano.releaseAll();
      } catch (_) {}
    }
    Object.values(this.trainerSynths || {}).forEach((s) => {
      try {
        s.releaseAll();
      } catch (_) {}
    });
  }

  async trainerNoteOn(midi, velocity = 0.82, timbreId = null) {
    if (!Number.isFinite(midi)) return;
    const rounded = Math.max(21, Math.min(108, Math.round(midi)));
    const vel = Number.isFinite(velocity) ? Math.max(0.08, Math.min(0.95, velocity)) : 0.82;
    this._heldTrainerMidis.add(rounded);
    this.unlockSync();

    if (!this.initialized || !this.isAudioRunning()) {
      await this.ensureReady();
    }
    const useTimbre = timbreId || this.trainerTimbre || 'grand';
    const synth = this._getTrainerSynth(useTimbre);
    if (!synth) return;

    const noteName = midiToToneNote(rounded);
    const t = this._nextSafeTime('trainer', getToneNow(window.Tone) + 0.004);
    try {
      if (!this._heldTrainerMidis.has(rounded)) {
        // Người dùng nhả tay nhanh trước khi AudioContext kịp mở xong -> ngân gọn không bị treo nốt
        synth.triggerAttackRelease(noteName, 0.24, t, vel);
        return;
      }
      if (this._activeTrainerNotes.has(rounded)) {
        const prevTimbre = this._activeTrainerNotes.get(rounded);
        const prevSynth = this._getTrainerSynth(prevTimbre);
        try { prevSynth?.triggerRelease(noteName, t); } catch (_) {}
      }
      synth.triggerAttack(noteName, t, vel);
      this._activeTrainerNotes.set(rounded, useTimbre);
    } catch (_) {}
  }

  trainerNoteOff(midi) {
    if (!Number.isFinite(midi)) return;
    const rounded = Math.max(21, Math.min(108, Math.round(midi)));
    this._heldTrainerMidis.delete(rounded);
    if (!this.initialized) return;

    const timbre = this._activeTrainerNotes.get(rounded) || this.trainerTimbre || 'grand';
    this._activeTrainerNotes.delete(rounded);
    const synth = this._getTrainerSynth(timbre);
    if (!synth) return;

    const t = this._nextSafeTime('trainer', getToneNow(window.Tone) + 0.004);
    try {
      synth.triggerRelease(midiToToneNote(rounded), t);
    } catch (_) {}
  }

  async playTrainerChordPreview(midis = [], duration = 0.85, velocity = 0.70, timbreId = null) {
    if (!Array.isArray(midis) || midis.length === 0) return;
    this.unlockSync();
    await this.ensureReady();
    const synth = this._getTrainerSynth(timbreId || this.trainerTimbre || 'grand');
    if (!synth) return;
    const dur = Number.isFinite(duration) ? Math.max(0.1, duration) : 0.85;
    const vel = Number.isFinite(velocity) ? Math.max(0.1, Math.min(0.92, velocity)) : 0.70;
    const baseNow = getToneNow(window.Tone) + 0.006;

    midis.forEach((m, idx) => {
      if (!Number.isFinite(m)) return;
      const t = this._nextSafeTime('trainer', baseNow + idx * 0.018);
      try {
        synth.triggerAttackRelease(midiToToneNote(Math.round(m)), dur, t, Math.max(0.2, vel - idx * 0.02));
      } catch (_) {}
    });
  }

  async studioMidiNoteOn(midi, velocity = 0.82) {
    if (!Number.isFinite(midi)) return;
    const rounded = Math.max(21, Math.min(108, Math.round(midi)));
    const vel = Number.isFinite(velocity) ? Math.max(0.08, Math.min(0.95, velocity)) : 0.82;
    this._heldStudioMidis.add(rounded);
    this.unlockSync();
    if (!this.initialized || !this.isAudioRunning()) {
      await this.ensureReady();
    }
    const synth = this._getMelodySynth(this.state.melodyTimbre);
    if (!synth) return;
    const noteName = midiToToneNote(rounded);
    const t = this._nextSafeTime('melody', getToneNow(window.Tone) + 0.004);
    try {
      if (!this._heldStudioMidis.has(rounded)) {
        synth.triggerAttackRelease(noteName, 0.24, t, vel);
        return;
      }
      synth.triggerAttack(noteName, t, vel);
    } catch (_) {}
  }

  studioMidiNoteOff(midi) {
    if (!Number.isFinite(midi)) return;
    const rounded = Math.max(21, Math.min(108, Math.round(midi)));
    this._heldStudioMidis.delete(rounded);
    if (!this.initialized) return;
    const synth = this._getMelodySynth(this.state.melodyTimbre);
    if (!synth) return;
    const t = this._nextSafeTime('melody', getToneNow(window.Tone) + 0.004);
    try {
      synth.triggerRelease(midiToToneNote(rounded), t);
    } catch (_) {}
  }

  async auditionDrumHit(drumType, openHat = false, velocity = 0.85) {
    if (!drumType) return;
    this.unlockSync();
    await this.ensureReady();
    const safeVel = Number.isFinite(velocity) ? Math.max(0.1, Math.min(0.95, velocity)) : 0.85;
    const t = getToneNow(window.Tone) + 0.008;
    this._triggerDrum(drumType, t, safeVel, Boolean(openHat));
  }

  /**
   * Kết xuất siêu tốc 1 vòng lặp Beat (Hợp âm + Giai điệu MIDI + Trống + Mixer + Timbre)
   * sang AudioBuffer Stereo 44.1kHz bằng OfflineAudioContext (hoạt động ngay cả trước khi bấm Phát)
   */
  async renderBeatOffline(overrideConfig = null) {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) {
      throw new Error('Trình duyệt không hỗ trợ OfflineAudioContext để kết xuất Beat.');
    }

    const cfg = {
      ...this.state,
      ...(overrideConfig || {}),
    };
    const bpm = Math.max(40, Math.min(240, Number(cfg.bpm) || 84));
    const totalBars = cfg.totalBars === 8 ? 8 : 4;
    const beatSec = 60 / bpm;
    const loopDurationSec = totalBars * 4 * beatSec;
    const sr = 44100;
    const totalFrames = Math.max(1, Math.ceil(loopDurationSec * sr));

    const { allEvents: accEvents } = generateAccompanimentEvents({
      voicedChords: cfg.voicedChords || [],
      totalBars,
      bpm,
      chordStyle: cfg.chordStyle || 'rnb',
      drumPattern: cfg.drumPattern || 'lofi',
      humanize: cfg.humanize ?? 55,
    });

    const melEvents = generateMelodyEvents({
      melodyNotes: cfg.melodyNotes || [],
      totalBars,
      bpm,
      humanize: cfg.humanize ?? 55,
    });

    const drumEvents =
      cfg.drumPattern && cfg.drumPattern !== 'off'
        ? generateDrumEvents({
            totalBars,
            bpm,
            drumPattern: cfg.drumPattern,
            chordStyle: cfg.chordStyle || 'rnb',
            humanize: cfg.humanize ?? 55,
            customDrumGrid: cfg.customDrumGrid ?? this.state.customDrumGrid,
          })
        : [];

    const mixer = cfg.mixer || this.state.mixer;
    const offline = new AC(2, totalFrames, sr);

    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;
    limiter.connect(offline.destination);

    const masterComp = offline.createDynamicsCompressor();
    masterComp.threshold.value = -14;
    masterComp.knee.value = 12;
    masterComp.ratio.value = 2.5;
    masterComp.attack.value = 0.012;
    masterComp.release.value = 0.2;
    masterComp.connect(limiter);

    const masterBus = offline.createGain();
    masterBus.gain.value = 1.3335; // +2.5 dB nhẹ nhàng vừa đủ bù headroom mức -14 LUFS
    masterBus.connect(masterComp);

    const getMixGain = (key) => {
      const ch = mixer[key] || { volume: 80, muted: false, solo: false };
      if (!isMixerChannelAudible(mixer, key)) return 0;
      const norm = Math.max(0, Math.min(100, ch.volume)) / 100;
      return Math.pow(norm, 1.55) * 0.92;
    };

    const chChords = offline.createGain();
    chChords.gain.value = getMixGain('chords');
    chChords.connect(masterBus);

    const chMelody = offline.createGain();
    chMelody.gain.value = getMixGain('melody');
    chMelody.connect(masterBus);

    const chDrums = offline.createGain();
    chDrums.gain.value = getMixGain('drums');
    chDrums.connect(masterBus);

    // PeriodicWave custom cho Piano & Guitar & Rhodes ấm sạch
    const makeWave = (partials) => {
      const real = new Float32Array(partials.length + 1);
      const imag = new Float32Array(partials.length + 1);
      partials.forEach((amp, i) => {
        imag[i + 1] = amp;
      });
      return offline.createPeriodicWave(real, imag);
    };
    const modernPianoWave = makeWave([1, 0.56, 0.22, 0.08, 0.025, 0.008]);
    const pianoWave = makeWave([1, 0.45, 0.22, 0.1, 0.045, 0.018]);
    const guitarWave = makeWave([1, 0.68, 0.44, 0.28, 0.16, 0.08, 0.035]);
    const fluteWave = makeWave([1, 0.26, 0.09, 0.03]);

    const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const cTimbre = cfg.chordTimbre || 'rhodes';
    const mTimbre = cfg.melodyTimbre || 'bell';

    // 1. Hợp âm & Bass
    if (chChords.gain.value > 0.001) {
      accEvents.forEach((ev) => {
        const start = Math.max(0, ev.startBeat * beatSec);
        if (start >= loopDurationSec - 0.01) return;
        const dur = Math.max(0.06, Math.min(ev.durationBeat * beatSec, loopDurationSec - start));
        const end = Math.min(loopDurationSec, start + dur + (cTimbre === 'pad' ? 0.35 : 0.18));
        const freq = midiToHz(ev.midi);
        const isBass = ev.role === 'bass';

        const osc = offline.createOscillator();
        const sub = offline.createOscillator();
        const filter = offline.createBiquadFilter();
        const env = offline.createGain();
        const pan = offline.createStereoPanner();

        osc.frequency.setValueAtTime(freq, start);
        if (isBass) {
          osc.type = 'triangle';
          sub.type = 'sine';
          sub.frequency.setValueAtTime(freq * 0.5, start);
          filter.frequency.setValueAtTime(560, start);
          pan.pan.value = 0;
        } else if (cTimbre === 'dark_brass') {
          osc.type = 'sawtooth';
          osc.detune.setValueAtTime(-10, start);
          sub.type = 'sawtooth';
          sub.detune.setValueAtTime(10, start);
          sub.frequency.setValueAtTime(freq, start);
          filter.frequency.setValueAtTime(2550, start);
          filter.frequency.exponentialRampToValueAtTime(1150, Math.min(end, start + 0.18));
          pan.pan.value = ((ev.midi % 9) - 4) * 0.04;
        } else if (cTimbre === 'stage_pluck') {
          osc.type = 'sawtooth';
          osc.detune.setValueAtTime(-6, start);
          sub.type = 'square';
          sub.detune.setValueAtTime(6, start);
          sub.frequency.setValueAtTime(freq, start);
          filter.frequency.setValueAtTime(3400, start);
          filter.frequency.exponentialRampToValueAtTime(980, Math.min(end, start + 0.16));
          pan.pan.value = ((ev.midi % 9) - 4) * 0.045;
        } else if (cTimbre === 'modern_piano') {
          osc.setPeriodicWave(modernPianoWave);
          sub.type = 'sine';
          sub.frequency.setValueAtTime(freq * 0.5, start);
          filter.frequency.setValueAtTime(1650, start);
          pan.pan.value = ((ev.midi % 12) - 5.5) * 0.028;
        } else if (cTimbre === 'piano') {
          osc.setPeriodicWave(pianoWave);
          sub.type = 'sine';
          sub.frequency.setValueAtTime(freq, start);
          filter.frequency.setValueAtTime(2600, start);
          pan.pan.value = ((ev.midi % 12) - 5.5) * 0.03;
        } else if (cTimbre === 'pad') {
          osc.type = 'sawtooth';
          osc.detune.setValueAtTime(-9, start);
          sub.type = 'sawtooth';
          sub.detune.setValueAtTime(9, start);
          sub.frequency.setValueAtTime(freq, start);
          filter.frequency.setValueAtTime(1400, start);
          pan.pan.value = ((ev.midi % 7) - 3) * 0.05;
        } else if (cTimbre === 'guitar') {
          osc.setPeriodicWave(guitarWave);
          sub.type = 'triangle';
          sub.frequency.setValueAtTime(freq, start);
          filter.frequency.setValueAtTime(3200, start);
          pan.pan.value = ((ev.midi % 9) - 4) * 0.035;
        } else {
          // Warm Rhodes / EP
          osc.type = 'sine';
          sub.type = 'triangle';
          sub.frequency.setValueAtTime(freq * 2, start);
          filter.frequency.setValueAtTime(2500, start);
          pan.pan.value = ((ev.midi % 12) - 5.5) * 0.025;
        }

        filter.type = 'lowpass';
        const peak = Math.max(0.02, ev.velocity * (isBass ? 0.25 : cTimbre === 'dark_brass' || cTimbre === 'stage_pluck' ? 0.13 : 0.14));
        const atk = !isBass && cTimbre === 'pad' ? 0.18 : cTimbre === 'stage_pluck' ? 0.004 : 0.009;
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(peak, Math.min(end - 0.02, start + atk));
        const midRatio = cTimbre === 'stage_pluck' ? 0.16 : cTimbre === 'dark_brass' ? 0.48 : 0.36;
        env.gain.exponentialRampToValueAtTime(Math.max(0.0005, peak * midRatio), Math.min(end, start + dur));
        env.gain.linearRampToValueAtTime(0.0001, end);

        const subG = offline.createGain();
        subG.gain.value = isBass ? 0.36 : cTimbre === 'pad' ? 0.5 : cTimbre === 'dark_brass' ? 0.65 : cTimbre === 'stage_pluck' ? 0.32 : cTimbre === 'modern_piano' ? 0.22 : 0.14;

        osc.connect(filter);
        sub.connect(subG);
        subG.connect(filter);
        filter.connect(env);
        env.connect(pan);
        pan.connect(chChords);

        osc.start(start);
        sub.start(start);
        osc.stop(end + 0.01);
        sub.stop(end + 0.01);
      });
    }

    // 2. Giai điệu MIDI (Piano Roll)
    if (chMelody.gain.value > 0.001) {
      melEvents.forEach((ev) => {
        const start = Math.max(0, ev.startBeat * beatSec);
        if (start >= loopDurationSec - 0.01) return;
        const dur = Math.max(0.06, Math.min(ev.durationBeat * beatSec, loopDurationSec - start));
        const end = Math.min(loopDurationSec, start + dur + 0.16);
        const freq = midiToHz(ev.midi);

        const osc = offline.createOscillator();
        const over = offline.createOscillator();
        const filter = offline.createBiquadFilter();
        const env = offline.createGain();

        osc.frequency.setValueAtTime(freq, start);
        if (mTimbre === 'lead') {
          osc.type = 'sawtooth';
          osc.detune.setValueAtTime(-6, start);
          over.type = 'sawtooth';
          over.detune.setValueAtTime(6, start);
          over.frequency.setValueAtTime(freq, start);
          filter.frequency.setValueAtTime(2350, start);
        } else if (mTimbre === 'flute') {
          osc.setPeriodicWave(fluteWave);
          over.type = 'sine';
          over.frequency.setValueAtTime(freq * 2, start);
          filter.frequency.setValueAtTime(2800, start);
        } else {
          // bell / ep
          osc.type = 'sine';
          over.type = 'triangle';
          over.frequency.setValueAtTime(mTimbre === 'bell' ? freq * 3 : freq * 2, start);
          filter.frequency.setValueAtTime(3600, start);
        }

        filter.type = 'lowpass';
        const peak = Math.max(0.02, ev.velocity * 0.22);
        const atk = mTimbre === 'flute' ? 0.045 : 0.007;
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(peak, Math.min(end - 0.015, start + atk));
        env.gain.exponentialRampToValueAtTime(Math.max(0.0005, peak * 0.3), Math.min(end, start + dur));
        env.gain.linearRampToValueAtTime(0.0001, end);

        const overG = offline.createGain();
        overG.gain.value = mTimbre === 'lead' ? 0.45 : 0.15;

        osc.connect(filter);
        over.connect(overG);
        overG.connect(filter);
        filter.connect(env);
        env.connect(chMelody);

        osc.start(start);
        over.start(start);
        osc.stop(end + 0.01);
        over.stop(end + 0.01);
      });
    }

    // 3. Bộ trống (Kick, Snare Noise, Rimshot, Hi-Hat, Metronome)
    if (drumEvents.length > 0 && chDrums.gain.value > 0.001) {
      const noiseBuf = offline.createBuffer(1, Math.floor(sr * 0.24), sr);
      const nData = noiseBuf.getChannelData(0);
      let seed = 918273;
      for (let i = 0; i < nData.length; i++) {
        seed = (seed * 16807) % 2147483647;
        nData[i] = (seed / 2147483647) * 2 - 1;
      }

      drumEvents.forEach((ev) => {
        const start = Math.max(0, ev.startBeat * beatSec);
        if (start >= loopDurationSec - 0.01) return;
        const vel = ev.velocity || 0.7;

        if (ev.drumType === 'kick') {
          const osc = offline.createOscillator();
          const env = offline.createGain();
          const stopAt = Math.min(loopDurationSec, start + 0.26);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(155, start);
          osc.frequency.exponentialRampToValueAtTime(42, Math.min(stopAt, start + 0.085));
          env.gain.setValueAtTime(vel * 0.56, start);
          env.gain.exponentialRampToValueAtTime(0.001, stopAt);
          osc.connect(env);
          env.connect(chDrums);
          osc.start(start);
          osc.stop(stopAt + 0.005);

          // Transient click giúp tiếng 808 / stage kick đánh đanh rõ
          const clickOsc = offline.createOscillator();
          const clickEnv = offline.createGain();
          const clickEnd = Math.min(loopDurationSec, start + 0.022);
          clickOsc.type = 'triangle';
          clickOsc.frequency.setValueAtTime(2200, start);
          clickOsc.frequency.exponentialRampToValueAtTime(180, clickEnd);
          clickEnv.gain.setValueAtTime(vel * 0.18, start);
          clickEnv.gain.exponentialRampToValueAtTime(0.001, clickEnd);
          clickOsc.connect(clickEnv);
          clickEnv.connect(chDrums);
          clickOsc.start(start);
          clickOsc.stop(clickEnd + 0.004);
        } else if (ev.drumType === 'clap') {
          [0, 0.013].forEach((offset, layerIdx) => {
            const cStart = start + offset;
            if (cStart >= loopDurationSec - 0.01) return;
            const src = offline.createBufferSource();
            src.buffer = noiseBuf;
            const filter = offline.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(layerIdx === 0 ? 1400 : 1750, cStart);
            filter.Q.setValueAtTime(layerIdx === 0 ? 1.1 : 0.85, cStart);
            const env = offline.createGain();
            const stopAt = Math.min(loopDurationSec, cStart + (layerIdx === 0 ? 0.065 : 0.135));
            env.gain.setValueAtTime(vel * (layerIdx === 0 ? 0.30 : 0.24), cStart);
            env.gain.exponentialRampToValueAtTime(0.001, stopAt);
            src.connect(filter);
            filter.connect(env);
            env.connect(chDrums);
            src.start(cStart);
            src.stop(stopAt + 0.005);
          });
        } else if (ev.drumType === 'crash') {
          const src = offline.createBufferSource();
          src.buffer = noiseBuf;
          src.loop = true;
          const filter = offline.createBiquadFilter();
          filter.type = 'highpass';
          filter.frequency.setValueAtTime(4800, start);
          const env = offline.createGain();
          const stopAt = Math.min(loopDurationSec, start + 0.58);
          env.gain.setValueAtTime(vel * 0.20, start);
          env.gain.exponentialRampToValueAtTime(0.001, stopAt);
          src.connect(filter);
          filter.connect(env);
          env.connect(chDrums);
          src.start(start);
          src.stop(stopAt + 0.005);
        } else if (ev.drumType === 'snare' || ev.drumType === 'hat') {
          const src = offline.createBufferSource();
          src.buffer = noiseBuf;
          const filter = offline.createBiquadFilter();
          filter.type = ev.drumType === 'hat' ? 'highpass' : 'bandpass';
          filter.frequency.setValueAtTime(ev.drumType === 'hat' ? 7200 : 1900, start);
          const env = offline.createGain();
          const dec = ev.drumType === 'hat' ? (ev.openHat ? 0.16 : 0.042) : 0.14;
          const stopAt = Math.min(loopDurationSec, start + dec);
          env.gain.setValueAtTime(vel * (ev.drumType === 'hat' ? 0.16 : 0.28), start);
          env.gain.exponentialRampToValueAtTime(0.001, stopAt);
          src.connect(filter);
          filter.connect(env);
          env.connect(chDrums);
          src.start(start);
          src.stop(stopAt + 0.005);
        } else {
          const osc = offline.createOscillator();
          const env = offline.createGain();
          const stopAt = Math.min(loopDurationSec, start + 0.055);
          osc.type = ev.drumType === 'rim' ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(
            ev.drumType === 'clickAccent' ? 1150 : ev.drumType === 'click' ? 780 : 390,
            start
          );
          env.gain.setValueAtTime(vel * 0.24, start);
          env.gain.exponentialRampToValueAtTime(0.001, stopAt);
          osc.connect(env);
          env.connect(chDrums);
          osc.start(start);
          osc.stop(stopAt + 0.005);
        }
      });
    }

    const rendered = await offline.startRendering();
    if (rendered && rendered.length > 512) {
      const fadeSamples = Math.min(264, Math.floor(rendered.length * 0.05));
      const ceiling = 0.841; // -1.5 dBFS
      const knee = 0.78;
      const head = ceiling - knee;
      for (let ch = 0; ch < rendered.numberOfChannels; ch++) {
        const data = rendered.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          const x = data[i];
          const ax = Math.abs(x);
          if (ax > knee) {
            data[i] = Math.sign(x) * (knee + head * Math.tanh((ax - knee) / head));
          }
        }
        for (let i = 0; i < fadeSamples; i++) {
          const idx = rendered.length - 1 - i;
          data[idx] *= i / fadeSamples;
        }
      }
    }
    return rendered;
  }

  getMasterPeakDb() {
    if (!this.initialized || !this.masterPeakMeter) return -Infinity;
    const val = this.masterPeakMeter.getValue();
    return Array.isArray(val) ? Math.max(...val) : Number(val);
  }

  getMasterChainSpec() {
    return {
      loudnessGainDb: 2.5,
      compThreshold: this.masterComp ? this.masterComp.threshold.value : -14,
      compRatio: this.masterComp ? this.masterComp.ratio.value : 2.5,
      compAttack: this.masterComp ? this.masterComp.attack.value : 0.012,
      compRelease: this.masterComp ? this.masterComp.release.value : 0.2,
      limiterThreshold: this.masterLimiter ? this.masterLimiter.threshold.value : -1.5,
      ceilingLinear: 0.841,
    };
  }

  getMasterOutputNode() {
    if (typeof window.Tone !== 'undefined' && typeof window.Tone.getDestination === 'function') {
      return window.Tone.getDestination();
    }
    return this.initialized ? (this.masterCeiling || this.masterLimiter) : null;
  }
}

export const audioEngine = new AudioEngine();
