// ============================================================================
// midiExport.js — Bộ mã hóa nhị phân chuẩn Standard MIDI File Format 1 (.mid)
// Xuất trọn bộ beat đa track (tối đa 4 track chuẩn General MIDI, PPQ = 480):
//   Track 1: Chords (Hop am)    — Channel 0
//   Track 2: Bass (Bass nen)    — Channel 1
//   Track 3: Melody (Giai dieu) — Channel 2
//   Track 4: Drums (Trong)      — Channel 9 (Kênh 10 GM Drums)
// Dùng chung nguồn sinh tiết tấu Swing/Humanize với audioEngine.js
// ============================================================================

import {
  generateAccompanimentEvents,
  generateDrumEvents,
  generateMelodyEvents,
  isMixerChannelAudible,
} from './audioEngine.js?v=11';

export const MIDI_PPQ = 480;

const CHORD_GM_PROGRAM = {
  rhodes: 4,  // Electric Piano 1 (Rhodes)
  piano: 0,   // Acoustic Grand Piano
  pad: 89,    // Pad 2 (Warm)
  guitar: 24, // Acoustic Guitar (Nylon)
};

const BASS_GM_PROGRAM = 33; // Electric Bass (Finger)

const MELODY_GM_PROGRAM = {
  bell: 11,  // Vibraphone / Soft Bell
  lead: 81,  // Lead 2 (Sawtooth)
  flute: 73, // Flute
  ep: 4,     // Electric Piano 1
};

function encodeVLQ(value) {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function uint32BE(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function uint16BE(n) {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function asciiBytes(str) {
  const arr = [];
  for (let i = 0; i < str.length; i++) {
    arr.push(str.charCodeAt(i) & 0x7f);
  }
  return arr;
}

/**
 * Đóng gói 1 Track Chunk ('MTrk') từ mảng sự kiện theo tick tuyệt đối.
 * Đảm bảo: tick >= 0, sắp xếp tăng dần, Note Off luôn đứng trước Note On nếu trùng tick,
 * tính đúng Delta-Time VLQ và kết thúc bằng FF 2F 00 (End of Track).
 */
function buildTrackChunk(events) {
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.order - b.order;
  });

  const data = [];
  let lastTick = 0;

  for (const ev of events) {
    const tick = Math.max(lastTick, Math.max(0, Math.round(ev.tick)));
    const delta = tick - lastTick;
    lastTick = tick;
    data.push(...encodeVLQ(delta), ...ev.bytes);
  }

  // End of Track meta event (bắt buộc ở cuối mọi track)
  data.push(0x00, 0xff, 0x2f, 0x00);

  return [...asciiBytes('MTrk'), ...uint32BE(data.length), ...data];
}

/**
 * Chuyển danh sách nốt { midi, startBeat, durationBeat, velocity } thành cặp Note On / Note Off
 * an toàn tuyệt đối (không dính nốt, không trùng Note On cùng cao độ, không cụt nốt).
 */
function appendNoteEvents(targetEvents, notes, channel, maxTick) {
  const ch = channel & 0x0f;
  const sortedNotes = [...notes].sort((a, b) => {
    if (a.startBeat !== b.startBeat) return a.startBeat - b.startBeat;
    return a.midi - b.midi;
  });

  const activeByPitch = new Map(); // midi -> { onEv, offEv }

  for (const n of sortedNotes) {
    const midi = Math.max(0, Math.min(127, Math.round(n.midi)));
    const startTick = Math.max(0, Math.min(maxTick - 12, Math.round(n.startBeat * MIDI_PPQ)));
    const rawDurBeat = n.durationBeat ?? n.durationBeats ?? 0.25;
    const durTicks = Math.max(24, Math.round(rawDurBeat * MIDI_PPQ));
    const endTick = Math.min(maxTick, Math.max(startTick + 12, startTick + durTicks));
    const vel = Math.max(1, Math.min(127, Math.round((n.velocity ?? 0.78) * 127)));

    const prev = activeByPitch.get(midi);
    if (prev) {
      if (prev.onEv.tick === startTick) {
        // Trùng chính xác tick bắt đầu cùng cao độ -> giữ nốt dài/mạnh hơn, tránh trùng Note On
        if (endTick > prev.offEv.tick) prev.offEv.tick = endTick;
        if (vel > prev.onEv.bytes[2]) prev.onEv.bytes[2] = vel;
        continue;
      }
      if (prev.offEv.tick > startTick) {
        // Ngắt gọn nốt trước ngay tại startTick (Note Off order=2 sẽ chạy TRƯỚC Note On order=3)
        prev.offEv.tick = Math.max(prev.onEv.tick + 1, startTick);
      }
    }

    const onEv = {
      tick: startTick,
      order: 3, // Note On đứng sau Note Off nếu trùng tick
      bytes: [0x90 | ch, midi, vel],
    };
    const offEv = {
      tick: endTick,
      order: 2, // Note Off luôn ưu tiên đứng trước Note On nếu trùng tick
      bytes: [0x80 | ch, midi, 0],
    };

    targetEvents.push(onEv, offEv);
    activeByPitch.set(midi, { onEv, offEv });
  }
}

/**
 * Tạo dữ liệu nhị phân Standard MIDI File Format 1 trọn beat (tối đa 4 track GM),
 * tôn trọng trạng thái Mute/Solo của Mixer và đồng bộ 100% Swing/Humanize với trình phát.
 */
export function buildMidiFile({
  bpm = 84,
  totalBars = 4,
  humanize = 55,
  voicedChords = [],
  chordStyle = 'rnb',
  chordTimbre = 'rhodes',
  drumPattern = 'lofi',
  melodyNotes = [],
  melodyTimbre = 'bell',
  mixer = null,
}) {
  const maxTick = totalBars * 4 * MIDI_PPQ;
  const clampedBpm = Math.max(40, Math.min(240, Number(bpm) || 84));
  const usPerQuarter = Math.round(60_000_000 / clampedBpm);

  // Kiểm tra quyền phát theo Mixer Mute / Solo (bỏ qua kênh Giọng thu nháp vì là audio)
  const chordsAudible = isMixerChannelAudible(mixer, 'chords');
  const melodyAudible = isMixerChannelAudible(mixer, 'melody');
  const drumsAudible = isMixerChannelAudible(mixer, 'drums');

  if (!chordsAudible && !melodyAudible && !drumsAudible) {
    return {
      ok: false,
      bytes: null,
      tracks: [],
      error: 'Tất cả kênh nhạc cụ đang bị tắt tiếng (Mute/Solo). Hãy bật ít nhất 1 kênh để xuất MIDI.',
    };
  }

  const trackSpecs = [];

  // --- Track 1 & Track 2: Chords (Ch 0) + Bass (Ch 1) ---
  if (chordsAudible && voicedChords.length > 0) {
    const { chordEvents, bassEvents } = generateAccompanimentEvents({
      voicedChords,
      totalBars,
      bpm: clampedBpm,
      chordStyle,
      drumPattern,
      humanize,
    });

    if (chordEvents.length > 0) {
      trackSpecs.push({
        name: 'Chords (Hop am)',
        shortVi: 'Hợp âm',
        channel: 0,
        program: CHORD_GM_PROGRAM[chordTimbre] ?? 4,
        notes: chordEvents,
      });
    }

    if (bassEvents.length > 0) {
      trackSpecs.push({
        name: 'Bass (Bass nen)',
        shortVi: 'Bass',
        channel: 1,
        program: BASS_GM_PROGRAM,
        notes: bassEvents,
      });
    }
  }

  // --- Track 3: Melody (Ch 2) ---
  if (melodyAudible) {
    const melEvents = generateMelodyEvents({
      melodyNotes,
      totalBars,
      bpm: clampedBpm,
      humanize,
    });
    if (melEvents.length > 0) {
      trackSpecs.push({
        name: 'Melody (Giai dieu)',
        shortVi: 'Giai điệu',
        channel: 2,
        program: MELODY_GM_PROGRAM[melodyTimbre] ?? 11,
        notes: melEvents,
      });
    }
  }

  // --- Track 4: Drums (BẮT BUỘC Channel 9 = Kênh 10 GM Drums) ---
  if (drumsAudible && drumPattern && drumPattern !== 'off') {
    const drumEvents = generateDrumEvents({
      totalBars,
      bpm: clampedBpm,
      drumPattern,
      chordStyle,
      humanize,
    });
    if (drumEvents.length > 0) {
      trackSpecs.push({
        name: 'Drums (Trong)',
        shortVi: 'Trống',
        channel: 9,
        program: 0, // Standard GM Drum Kit trên kênh 10
        notes: drumEvents,
      });
    }
  }

  if (trackSpecs.length === 0) {
    return {
      ok: false,
      bytes: null,
      tracks: [],
      error: 'Không có nốt nhạc nào trên các kênh đang bật. Hãy bật Hợp âm/Trống hoặc chấm thêm nốt giai điệu.',
    };
  }

  // Mã hóa từng Track thành MTrk; chèn Tempo (BPM) & Nhịp 4/4 tại tick 0 của Track đầu tiên
  const encodedTracks = trackSpecs.map((spec, idx) => {
    const events = [];
    const nameBytes = asciiBytes(spec.name);
    events.push({
      tick: 0,
      order: 0,
      bytes: [0xff, 0x03, nameBytes.length, ...nameBytes],
    });

    if (idx === 0) {
      // Meta Event: Set Tempo (BPM hiện tại)
      events.push({
        tick: 0,
        order: 0,
        bytes: [
          0xff,
          0x51,
          0x03,
          (usPerQuarter >> 16) & 0xff,
          (usPerQuarter >> 8) & 0xff,
          usPerQuarter & 0xff,
        ],
      });
      // Meta Event: Time Signature 4/4
      events.push({
        tick: 0,
        order: 0,
        bytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08],
      });
    }

    // Program Change chuẩn General MIDI cho kênh tương ứng
    events.push({
      tick: 0,
      order: 1,
      bytes: [0xc0 | (spec.channel & 0x0f), spec.program & 0x7f],
    });

    appendNoteEvents(events, spec.notes, spec.channel, maxTick);
    return buildTrackChunk(events);
  });

  // Header Chunk ('MThd'): Format 1, số track thực tế (1..4), PPQ = 480
  const header = [
    ...asciiBytes('MThd'),
    ...uint32BE(6),
    ...uint16BE(1),
    ...uint16BE(encodedTracks.length),
    ...uint16BE(MIDI_PPQ),
  ];

  const allBytes = [...header];
  for (const trk of encodedTracks) {
    allBytes.push(...trk);
  }

  return {
    ok: true,
    bytes: new Uint8Array(allBytes),
    tracks: trackSpecs.map((s) => ({
      name: s.name,
      shortVi: s.shortVi,
      channel: s.channel,
      program: s.program,
      noteCount: s.notes.length,
    })),
    error: null,
  };
}

/**
 * Giữ lại helper buildMidiBytes tương thích ngược (trả về Uint8Array trực tiếp)
 */
export function buildMidiBytes(params) {
  const res = buildMidiFile(params);
  return res.bytes || new Uint8Array(0);
}

/**
 * Tạo và kích hoạt tải xuống file .mid trực tiếp trên trình duyệt
 */
export function downloadMidiFile(params, filename = 'hevos-studio-beat.mid') {
  const result = buildMidiFile(params);
  if (!result.ok || !result.bytes) {
    return result;
  }

  const blob = new Blob([result.bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mid') ? filename : `${filename}.mid`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  return {
    ...result,
    byteLength: result.bytes.length,
    filename: a.download,
  };
}
