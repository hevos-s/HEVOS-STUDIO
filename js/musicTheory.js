// ============================================================================
// musicTheory.js — Nhận diện Hợp âm Sống (Live Chord Detector), Tô sáng Âm giai,
// Giáo trình Luyện Đệm Hợp Âm (Wait Mode) & Kho Giai Điệu Nốt Rơi (Falling Notes)
// ============================================================================

import {
  SCALES,
  getScaleSet,
  midiToNoteName,
  pcToNoteName,
  shouldPreferFlats,
} from './theory.js?v=32';

// Ưu tiên giáng chuẩn khi gốc hợp âm là các giọng giáng phổ biến trong nhạc nhẹ (Eb, Bb, Ab, Db, Gb, F, Fm, Cm, Gm)
const FLAT_PREF_ROOTS = new Set([1, 3, 5, 6, 8, 10]);

// Danh sách mẫu hợp âm (sắp xếp ưu tiên hợp âm 4 nốt & 3 nốt chuẩn trước biến thể/đảo)
const CHORD_TEMPLATES = [
  // Hợp âm 5 nốt / Mở rộng 9
  { intervals: [0, 2, 4, 7, 11], suffix: 'maj9',  qualityVi: 'Trưởng 9 (maj9)',      baseScore: 95 },
  { intervals: [0, 2, 3, 7, 10], suffix: 'm9',    qualityVi: 'Thứ 9 (m9)',           baseScore: 95 },
  { intervals: [0, 2, 4, 7, 10], suffix: '9',     qualityVi: 'Át 9 (Dominant 9)',    baseScore: 94 },

  // Hợp âm 4 nốt tiêu chuẩn
  { intervals: [0, 4, 7, 11],    suffix: 'maj7',  qualityVi: 'Trưởng 7 (maj7)',      baseScore: 102 },
  { intervals: [0, 3, 7, 10],    suffix: 'm7',    qualityVi: 'Thứ 7 (m7)',           baseScore: 102 },
  { intervals: [0, 4, 7, 10],    suffix: '7',     qualityVi: 'Át 7 (Dominant 7)',    baseScore: 101 },
  { intervals: [0, 2, 4, 7],     suffix: 'add9',  qualityVi: 'Trưởng thêm bậc 9 (add9)', baseScore: 98 },
  { intervals: [0, 2, 3, 7],     suffix: 'madd9', qualityVi: 'Thứ thêm bậc 9 (madd9)', baseScore: 97 },
  { intervals: [0, 5, 7, 10],    suffix: '7sus4', qualityVi: 'Át 7 treo bậc 4 (7sus4)', baseScore: 94 },
  { intervals: [0, 3, 6, 10],    suffix: 'm7b5',  qualityVi: 'Nửa giảm (m7b5)',      baseScore: 93 },
  { intervals: [0, 3, 6, 9],     suffix: 'dim7',  qualityVi: 'Giảm 7 (dim7)',        baseScore: 92 },
  { intervals: [0, 4, 7, 9],     suffix: '6',     qualityVi: 'Trưởng 6 (6)',         baseScore: 91 },
  { intervals: [0, 3, 7, 9],     suffix: 'm6',    qualityVi: 'Thứ 6 (m6)',           baseScore: 91 },

  // Hợp âm 3 nốt cơ bản & Sus
  { intervals: [0, 4, 7],        suffix: '',      qualityVi: 'Trưởng (Major)',       baseScore: 100 },
  { intervals: [0, 3, 7],        suffix: 'm',     qualityVi: 'Thứ (Minor)',          baseScore: 100 },
  { intervals: [0, 5, 7],        suffix: 'sus4',  qualityVi: 'Treo bậc 4 (sus4)',    baseScore: 96 },
  { intervals: [0, 2, 7],        suffix: 'sus2',  qualityVi: 'Treo bậc 2 (sus2)',    baseScore: 95 },
  { intervals: [0, 3, 6],        suffix: 'dim',   qualityVi: 'Giảm (dim)',           baseScore: 92 },
  { intervals: [0, 4, 8],        suffix: 'aug',   qualityVi: 'Tăng (aug)',           baseScore: 90 },

  // Shell voicing (bỏ bậc 5) cho hợp âm 7 đánh gọn tay trái/Neo-Soul
  { intervals: [0, 4, 11],       suffix: 'maj7',  qualityVi: 'Trưởng 7 (Shell maj7)', baseScore: 86 },
  { intervals: [0, 3, 10],       suffix: 'm7',    qualityVi: 'Thứ 7 (Shell m7)',     baseScore: 86 },
  { intervals: [0, 4, 10],       suffix: '7',     qualityVi: 'Át 7 (Shell 7)',       baseScore: 85 },
];

/**
 * Nhận diện hợp âm thời gian thực từ tập các nốt MIDI đang vang.
 * Hỗ trợ hợp âm Trưởng, Thứ, 7, maj7, m7, sus4, add9 và hợp âm đảo bass (Slash Chord).
 */
export function detectChordFromMidis(midis, preferFlatsHint = null) {
  const uniqueMidis = Array.from(
    new Set((Array.isArray(midis) ? midis : Array.from(midis || [])).filter(Number.isFinite).map((m) => Math.round(m)))
  ).sort((a, b) => a - b);

  if (uniqueMidis.length === 0) return null;

  const bassMidi = uniqueMidis[0];
  const bassPc = ((bassMidi % 12) + 12) % 12;
  const pcs = [];
  const pcSet = new Set();
  uniqueMidis.forEach((m) => {
    const pc = ((m % 12) + 12) % 12;
    if (!pcSet.has(pc)) {
      pcSet.add(pc);
      pcs.push(pc);
    }
  });

  const noteUseFlats = preferFlatsHint !== null ? Boolean(preferFlatsHint) : FLAT_PREF_ROOTS.has(bassPc);
  const noteNames = uniqueMidis.map((m) => midiToNoteName(m, noteUseFlats));

  if (pcs.length < 3) {
    return {
      isChord: false,
      symbol: null,
      baseSymbol: null,
      qualityVi: 'Chạm từ 3 nốt trở lên để nhận diện hợp âm',
      noteNames,
      pcs,
      bassPc,
      isInversion: false,
      inversionText: '',
    };
  }

  let best = null;

  for (const rootPc of pcs) {
    const relSet = new Set(pcs.map((pc) => ((pc - rootPc) + 12) % 12));

    for (const tpl of CHORD_TEMPLATES) {
      // Toàn bộ nốt trong mẫu hợp âm phải có mặt
      let allReqPresent = true;
      for (const iv of tpl.intervals) {
        if (!relSet.has(iv)) {
          allReqPresent = false;
          break;
        }
      }
      if (!allReqPresent) continue;

      // Không bỏ sót nốt thừa lạc ngoài mẫu (để phân biệt chính xác add9/6/7 với triad)
      const tplSet = new Set(tpl.intervals);
      let extraNotes = 0;
      relSet.forEach((iv) => {
        if (!tplSet.has(iv)) extraNotes += 1;
      });
      if (extraNotes > 0) continue;

      let score = tpl.baseScore + tpl.intervals.length * 4;
      const isInversion = rootPc !== bassPc;
      if (!isInversion) {
        score += 14; // Ưu tiên hợp âm đứng đúng nốt gốc dưới đáy
      } else {
        score -= 2;
      }

      // Ngoại lệ ngữ cảnh nhạc lý: Am7 với bass C rất dễ nhầm C6, ưu tiên C6 ở thế gốc trừ khi có âm thứ rõ ràng
      if (!best || score > best.score) {
        best = { rootPc, tpl, score, isInversion };
      }
    }
  }

  if (!best) {
    return {
      isChord: false,
      symbol: noteNames.map((n) => n.replace(/\d+$/, '')).join(' + '),
      baseSymbol: null,
      qualityVi: 'Tổ hợp nốt tự do / Voicing mở',
      noteNames,
      pcs,
      bassPc,
      isInversion: false,
      inversionText: '',
    };
  }

  const useFlats =
    preferFlatsHint !== null
      ? Boolean(preferFlatsHint)
      : FLAT_PREF_ROOTS.has(best.rootPc) ||
        (best.tpl.suffix.startsWith('m') && (best.rootPc === 0 || best.rootPc === 7 || best.rootPc === 2));
  const useBassFlats =
    preferFlatsHint !== null ? Boolean(preferFlatsHint) : useFlats || FLAT_PREF_ROOTS.has(bassPc);
  const rootName = pcToNoteName(best.rootPc, useFlats);
  const bassName = pcToNoteName(bassPc, useBassFlats);
  const baseSymbol = `${rootName}${best.tpl.suffix}`;
  const symbol = best.isInversion ? `${baseSymbol}/${bassName}` : baseSymbol;

  return {
    isChord: true,
    symbol,
    baseSymbol,
    rootPc: best.rootPc,
    bassPc,
    isInversion: best.isInversion,
    inversionText: best.isInversion ? `Hợp âm đảo · Bass ${bassName}` : 'Thế bấm gốc',
    qualityVi: best.tpl.qualityVi,
    noteNames,
    pcs,
  };
}

const EXTRA_SCALES = {
  pentatonic_major: {
    id: 'pentatonic_major',
    label: 'Ngũ cung Trưởng (Pentatonic)',
    intervals: [0, 2, 4, 7, 9],
    baseScale: 'major',
  },
  pentatonic_minor: {
    id: 'pentatonic_minor',
    label: 'Ngũ cung Thứ (Pentatonic)',
    intervals: [0, 3, 5, 7, 10],
    baseScale: 'minor',
  },
};

export function getScaleGuideInfo(keyPc = 3, scaleType = 'major') {
  const safePc = ((Number(keyPc) || 0) % 12 + 12) % 12;
  const extra = EXTRA_SCALES[scaleType];
  const scaleObj = extra || SCALES[scaleType] || SCALES.major;
  const baseScaleType = extra ? extra.baseScale : scaleObj.id;
  const preferFlats = shouldPreferFlats(safePc, baseScaleType);
  const scaleSet = extra
    ? new Set(extra.intervals.map((iv) => (safePc + iv) % 12))
    : getScaleSet(safePc, scaleObj.id);
  const keyName = pcToNoteName(safePc, preferFlats);
  return {
    keyPc: safePc,
    scaleType: scaleObj.id,
    scaleSet,
    preferFlats,
    label: `${keyName} ${scaleObj.label}`,
  };
}

// ============================================================================
// Chế độ 1: Luyện Đệm Hợp Âm (Wait Mode / Chờ bấm đúng)
// ============================================================================
function buildChordItem(symbol, roman, midis, preferFlats = false) {
  const pcs = Array.from(new Set(midis.map((m) => ((m % 12) + 12) % 12)));
  return {
    symbol,
    roman,
    midis: [...midis].sort((a, b) => a - b),
    pitchClasses: pcs,
    noteLabels: midis.map((m) => midiToNoteName(m, preferFlats).replace(/\d+$/, '')),
  };
}

export const PIANO_CHORD_PROGRESSIONS = [
  {
    id: 'neo-soul-eb',
    name: 'Neo-Soul: Fm7 – Bb7 – Ebmaj7 – Cm7',
    desc: 'Vòng ii7 – V7 – Imaj7 – vim7 đậm chất R&B / Neo-Soul tại Eb Trưởng',
    keyPc: 3,
    scaleType: 'major',
    bpm: 78,
    chords: [
      buildChordItem('Fm7',    'ii7',   [53, 56, 60, 63], true),
      buildChordItem('Bb7',    'V7',    [58, 62, 65, 68], true),
      buildChordItem('Ebmaj7', 'Imaj7', [51, 55, 58, 62], true),
      buildChordItem('Cm7',    'vim7',  [48, 51, 55, 58], true),
    ],
  },
  {
    id: 'pop-ballad-c',
    name: 'Pop Ballad: I – V – vi – IV (C – G – Am – F)',
    desc: 'Vòng hợp âm quốc dân dễ tập trên mọi bàn phím (Đô Trưởng)',
    keyPc: 0,
    scaleType: 'major',
    bpm: 76,
    chords: [
      buildChordItem('C',  'I',  [48, 52, 55], false),
      buildChordItem('G',  'V',  [55, 59, 62], false),
      buildChordItem('Am', 'vi', [57, 60, 64], false),
      buildChordItem('F',  'IV', [53, 57, 60], false),
    ],
  },
  {
    id: 'kpop-stage-fm',
    name: 'K-Pop / YG Stage: Fm7 – Dbmaj7 – Eb – C7',
    desc: 'Vòng thứ hiện đại giàu kịch tính (Fa Thứ)',
    keyPc: 5,
    scaleType: 'minor',
    bpm: 92,
    chords: [
      buildChordItem('Fm7',    'im7',    [53, 56, 60, 63], true),
      buildChordItem('Dbmaj7', 'VImaj7', [49, 53, 56, 60], true),
      buildChordItem('Eb',     'VII',    [51, 55, 58],     true),
      buildChordItem('C7',     'V7',     [48, 52, 55, 58], false),
    ],
  },
  {
    id: 'jazz-251-c',
    name: 'Jazz / Lo-Fi: Dm7 – G7 – Cmaj7 – Am7',
    desc: 'Luyện thế bấm hợp âm 7 mượt mà cho Jazz & Lo-Fi Chill',
    keyPc: 0,
    scaleType: 'major',
    bpm: 84,
    chords: [
      buildChordItem('Dm7',   'ii7',   [50, 53, 57, 60], false),
      buildChordItem('G7',    'V7',    [55, 59, 62, 65], false),
      buildChordItem('Cmaj7', 'Imaj7', [48, 52, 55, 59], false),
      buildChordItem('Am7',   'vim7',  [57, 60, 64, 67], false),
    ],
  },
];

/**
 * Chuyển đổi vòng hợp âm từ Sáng tác Beat thành giáo trình luyện bấm trực tiếp trong C3–B5
 */
export function buildPracticeChordsFromStudio(voicedChords, keyPc = 0, scaleType = 'major') {
  if (!Array.isArray(voicedChords) || voicedChords.length === 0) return null;
  const preferFlats = shouldPreferFlats(keyPc, scaleType);

  const chords = voicedChords.map((vc) => {
    const rawList = Array.isArray(vc.rootOrderedMidis) && vc.rootOrderedMidis.length > 0
      ? vc.rootOrderedMidis
      : Array.isArray(vc.upperMidis) && vc.upperMidis.length > 0
        ? vc.upperMidis
        : [vc.bassMidi || 60];

    const normalized = rawList.map((raw) => {
      let m = Math.round(raw);
      while (m < 48) m += 12;
      while (m > 83) m -= 12;
      return m;
    });
    const dedup = Array.from(new Set(normalized)).sort((a, b) => a - b);
    const pcs = Array.from(new Set(dedup.map((m) => ((m % 12) + 12) % 12)));

    return {
      symbol: vc.symbol || 'Chord',
      roman: vc.roman || '',
      midis: dedup,
      pitchClasses: pcs,
      noteLabels: dedup.map((m) => midiToNoteName(m, preferFlats).replace(/\d+$/, '')),
    };
  });

  const keyName = pcToNoteName(keyPc, preferFlats);
  const scaleShort = (SCALES[scaleType] || SCALES.major).shortLabel;
  return {
    id: 'studio-imported',
    name: `Từ Sáng tác Beat (${keyName} ${scaleShort})`,
    desc: chords.map((c) => c.symbol).join(' – '),
    keyPc,
    scaleType,
    bpm: 80,
    chords,
  };
}

/**
 * Kiểm tra tập nốt đang bấm đã đáp ứng đủ toàn bộ cao độ (Pitch Class) của hợp âm mục tiêu hay chưa
 */
export function doesActiveMatchChord(activeMidis, targetChord) {
  if (!targetChord || !Array.isArray(targetChord.pitchClasses) || targetChord.pitchClasses.length === 0) {
    return { matched: false, matchedPcs: new Set(), missingPcs: [] };
  }
  const activePcSet = new Set(
    (activeMidis || []).filter(Number.isFinite).map((m) => ((Math.round(m) % 12) + 12) % 12)
  );
  const matchedPcs = new Set();
  const missingPcs = [];

  targetChord.pitchClasses.forEach((pc) => {
    if (activePcSet.has(pc)) {
      matchedPcs.add(pc);
    } else {
      missingPcs.push(pc);
    }
  });

  return {
    matched: missingPcs.length === 0,
    matchedPcs,
    missingPcs,
  };
}

// ============================================================================
// Chế độ 2: Tập Giai Điệu Nốt Rơi (Falling Notes kiểu Synthesia)
// ============================================================================
export const FALLING_NOTES_SONGS = [
  {
    id: 'finger-5-c',
    name: 'Luyện ngón 5 ngón cơ bản (C4–G4)',
    desc: 'Bài tập khởi động ngón tay cái đến ngón út chuẩn vị trí C Major',
    keyPc: 0,
    scaleType: 'major',
    bpm: 88,
    totalBeats: 16,
    notes: [
      { midi: 60, startBeat: 0,    durationBeats: 0.9 },
      { midi: 62, startBeat: 1,    durationBeats: 0.9 },
      { midi: 64, startBeat: 2,    durationBeats: 0.9 },
      { midi: 65, startBeat: 3,    durationBeats: 0.9 },
      { midi: 67, startBeat: 4,    durationBeats: 0.9 },
      { midi: 65, startBeat: 5,    durationBeats: 0.9 },
      { midi: 64, startBeat: 6,    durationBeats: 0.9 },
      { midi: 62, startBeat: 7,    durationBeats: 0.9 },
      { midi: 60, startBeat: 8,    durationBeats: 0.9 },
      { midi: 64, startBeat: 9,    durationBeats: 0.9 },
      { midi: 67, startBeat: 10,   durationBeats: 0.9 },
      { midi: 64, startBeat: 11,   durationBeats: 0.9 },
      { midi: 65, startBeat: 12,   durationBeats: 0.9 },
      { midi: 62, startBeat: 13,   durationBeats: 0.9 },
      { midi: 60, startBeat: 14,   durationBeats: 1.8 },
    ],
  },
  {
    id: 'arpeggio-cafg',
    name: 'Rải hợp âm tay phải (C – Am – F – G)',
    desc: 'Làm quen quãng rải 1-3-5-8 quen thuộc trong nhạc Pop & Ballad',
    keyPc: 0,
    scaleType: 'major',
    bpm: 82,
    totalBeats: 16,
    notes: [
      // C
      { midi: 60, startBeat: 0,  durationBeats: 0.9 },
      { midi: 64, startBeat: 1,  durationBeats: 0.9 },
      { midi: 67, startBeat: 2,  durationBeats: 0.9 },
      { midi: 72, startBeat: 3,  durationBeats: 0.9 },
      // Am
      { midi: 57, startBeat: 4,  durationBeats: 0.9 },
      { midi: 60, startBeat: 5,  durationBeats: 0.9 },
      { midi: 64, startBeat: 6,  durationBeats: 0.9 },
      { midi: 69, startBeat: 7,  durationBeats: 0.9 },
      // F
      { midi: 53, startBeat: 8,  durationBeats: 0.9 },
      { midi: 57, startBeat: 9,  durationBeats: 0.9 },
      { midi: 60, startBeat: 10, durationBeats: 0.9 },
      { midi: 65, startBeat: 11, durationBeats: 0.9 },
      // G -> C
      { midi: 55, startBeat: 12, durationBeats: 0.9 },
      { midi: 59, startBeat: 13, durationBeats: 0.9 },
      { midi: 62, startBeat: 14, durationBeats: 0.9 },
      { midi: 60, startBeat: 15, durationBeats: 0.95 },
    ],
  },
  {
    id: 'pop-canon-c',
    name: 'Giai điệu Pop Ballad (Cảm hứng Canon)',
    desc: 'Giai điệu dịu dàng nối âm mượt trên quãng C4–G5',
    keyPc: 0,
    scaleType: 'major',
    bpm: 78,
    totalBeats: 16,
    notes: [
      { midi: 64, startBeat: 0,  durationBeats: 1.8 },
      { midi: 62, startBeat: 2,  durationBeats: 1.8 },
      { midi: 60, startBeat: 4,  durationBeats: 1.8 },
      { midi: 59, startBeat: 6,  durationBeats: 1.8 },
      { midi: 57, startBeat: 8,  durationBeats: 1.8 },
      { midi: 55, startBeat: 10, durationBeats: 1.8 },
      { midi: 57, startBeat: 12, durationBeats: 0.9 },
      { midi: 60, startBeat: 13, durationBeats: 0.9 },
      { midi: 59, startBeat: 14, durationBeats: 0.9 },
      { midi: 60, startBeat: 15, durationBeats: 0.95 },
    ],
  },
  {
    id: 'neosoul-lick-eb',
    name: 'Câu luyến Ngũ Cung Neo-Soul (Eb Trưởng)',
    desc: 'Tập bấm kết hợp phím đen & phím trắng trên thang âm Eb Ngũ cung',
    keyPc: 3,
    scaleType: 'major',
    bpm: 76,
    totalBeats: 16,
    notes: [
      { midi: 63, startBeat: 0,    durationBeats: 0.9 }, // Eb4
      { midi: 65, startBeat: 1,    durationBeats: 0.9 }, // F4
      { midi: 67, startBeat: 2,    durationBeats: 0.9 }, // G4
      { midi: 70, startBeat: 3,    durationBeats: 0.9 }, // Bb4
      { midi: 72, startBeat: 4,    durationBeats: 1.4 }, // C5
      { midi: 70, startBeat: 5.5,  durationBeats: 0.9 }, // Bb4
      { midi: 67, startBeat: 6.5,  durationBeats: 1.3 }, // G4
      { midi: 65, startBeat: 8,    durationBeats: 0.9 }, // F4
      { midi: 67, startBeat: 9,    durationBeats: 0.9 }, // G4
      { midi: 65, startBeat: 10,   durationBeats: 0.9 }, // F4
      { midi: 63, startBeat: 11,   durationBeats: 1.8 }, // Eb4
      { midi: 67, startBeat: 13,   durationBeats: 0.9 }, // G4
      { midi: 65, startBeat: 14,   durationBeats: 0.9 }, // F4
      { midi: 63, startBeat: 15,   durationBeats: 0.95 }, // Eb4
    ],
  },
  {
    id: 'hook-vpop-eb',
    name: 'Câu Hook Pop Ballad (Eb Trưởng)',
    desc: 'Mô-típ điệp khúc neo Chord Tone kết hợp bước lướt êm tai cho Chặng 6',
    keyPc: 3,
    scaleType: 'major',
    bpm: 80,
    totalBeats: 16,
    notes: [
      { midi: 67, startBeat: 0,    durationBeats: 0.9 }, // G4
      { midi: 70, startBeat: 1,    durationBeats: 0.9 }, // Bb4
      { midi: 72, startBeat: 2,    durationBeats: 1.4 }, // C5
      { midi: 70, startBeat: 3.5,  durationBeats: 0.45 }, // Bb4
      { midi: 68, startBeat: 4,    durationBeats: 0.9 }, // Ab4
      { midi: 67, startBeat: 5,    durationBeats: 0.9 }, // G4
      { midi: 65, startBeat: 6,    durationBeats: 1.8 }, // F4
      { midi: 67, startBeat: 8,    durationBeats: 0.9 }, // G4
      { midi: 70, startBeat: 9,    durationBeats: 0.9 }, // Bb4
      { midi: 75, startBeat: 10,   durationBeats: 1.4 }, // Eb5
      { midi: 74, startBeat: 11.5, durationBeats: 0.45 }, // D5
      { midi: 72, startBeat: 12,   durationBeats: 0.9 }, // C5
      { midi: 70, startBeat: 13,   durationBeats: 0.9 }, // Bb4
      { midi: 67, startBeat: 14,   durationBeats: 1.8 }, // G4
    ],
  },
];

/**
 * Nạp trực tiếp tuyến Giai điệu MIDI từ tab Sáng tác Beat thành bài Nốt Rơi
 */
export function buildFallingSongFromStudio({
  melodyNotes = [],
  bpm = 84,
  totalBars = 4,
  keyPc = 0,
  scaleType = 'major',
} = {}) {
  if (!Array.isArray(melodyNotes) || melodyNotes.length === 0) return null;

  const sorted = melodyNotes
    .filter((n) => n && Number.isFinite(n.midi) && Number.isFinite(n.startBeat))
    .map((n) => {
      let m = Math.round(n.midi);
      while (m < 48) m += 12;
      while (m > 83) m -= 12;
      const startBeat = Math.max(0, Number(n.startBeat));
      const dur = Math.max(0.25, Number(n.durationBeats ?? n.durationBeat ?? 0.5));
      return { midi: m, startBeat, durationBeats: dur };
    })
    .sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);

  if (sorted.length === 0) return null;

  const lastBeat = sorted.reduce((acc, n) => Math.max(acc, n.startBeat + n.durationBeats), 0);
  const totalBeats = Math.max((Number(totalBars) || 4) * 4, Math.ceil(lastBeat));

  return {
    id: 'studio-melody',
    name: `Giai điệu Sáng tác Beat (${sorted.length} nốt)`,
    desc: 'Được nạp trực tiếp từ lưới Piano Roll của bạn',
    keyPc,
    scaleType,
    bpm: Math.max(40, Math.min(180, Number(bpm) || 84)),
    totalBeats,
    notes: sorted,
  };
}

// ============================================================================
// Lưu Tiến Độ Học Viện Nhạc Lý (localStorage: hevos_theory_progress_v1)
// ============================================================================
export const THEORY_PROGRESS_KEY = 'hevos_theory_progress_v1';

function createEmptyProgress() {
  return {
    completedLessonIds: [],
    bestScores: {},
    lastLessonId: null,
    updatedAt: Date.now(),
  };
}

export function loadTheoryProgress() {
  try {
    const raw = localStorage.getItem(THEORY_PROGRESS_KEY);
    if (!raw) return createEmptyProgress();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return createEmptyProgress();
    return {
      completedLessonIds: Array.isArray(parsed.completedLessonIds)
        ? Array.from(new Set(parsed.completedLessonIds.map(String)))
        : [],
      bestScores: parsed.bestScores && typeof parsed.bestScores === 'object' ? { ...parsed.bestScores } : {},
      lastLessonId: parsed.lastLessonId ? String(parsed.lastLessonId) : null,
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch (_) {
    return createEmptyProgress();
  }
}

export function saveTheoryProgress(data) {
  const safe = {
    completedLessonIds: Array.isArray(data?.completedLessonIds)
      ? Array.from(new Set(data.completedLessonIds.map(String)))
      : [],
    bestScores: data?.bestScores && typeof data.bestScores === 'object' ? { ...data.bestScores } : {},
    lastLessonId: data?.lastLessonId ? String(data.lastLessonId) : null,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(THEORY_PROGRESS_KEY, JSON.stringify(safe));
  } catch (_) {}
  return safe;
}

export function setLastLessonId(lessonId) {
  const cur = loadTheoryProgress();
  cur.lastLessonId = lessonId ? String(lessonId) : null;
  return saveTheoryProgress(cur);
}

export function recordLessonExerciseScore(lessonId, accuracyPct) {
  const id = String(lessonId || '');
  if (!id) return { progress: loadTheoryProgress(), newlyCompleted: false, accuracyPct: 0 };
  const pct = Math.max(0, Math.min(100, Math.round(Number(accuracyPct) || 0)));
  const cur = loadTheoryProgress();
  const prevBest = Number(cur.bestScores[id]) || 0;
  const wasCompleted = cur.completedLessonIds.includes(id);

  cur.bestScores[id] = Math.max(prevBest, pct);
  cur.lastLessonId = id;
  let newlyCompleted = false;
  if (pct >= 80 && !wasCompleted) {
    cur.completedLessonIds.push(id);
    newlyCompleted = true;
  }
  const saved = saveTheoryProgress(cur);
  return {
    progress: saved,
    newlyCompleted,
    passed: pct >= 80,
    accuracyPct: pct,
  };
}

export { renderTheoryDiagramHtml } from './theoryDiagrams.js?v=32';

export function resetTheoryProgress() {
  const empty = createEmptyProgress();
  try {
    localStorage.setItem(THEORY_PROGRESS_KEY, JSON.stringify(empty));
  } catch (_) {}
  return empty;
}
