// ============================================================================
// trainerData.js — Giáo trình Học nhạc, Nhạc lý Ký âm (Khóa Sol/Fa/Đô, Hóa biểu),
// Bộ sinh bài tập không khóa bài, Xếp hạng phản xạ & Lưu thống kê LocalStorage
// ============================================================================

export const TRAINER_STORAGE_KEY = 'hevos_trainer_stats_v1';

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const LETTER_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const LETTER_TO_DIATONIC = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
export const SOLFEGE_VI = { C: 'Đô', D: 'Rê', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

export const CLEF_META = {
  treble: {
    id: 'treble',
    label: 'Khóa Sol',
    shortLabel: 'Sol',
    bottomDiatonic: 30, // E4 (octave 4 * 7 + 2)
    sharpSteps: [8, 5, 9, 6], // F5, C5, G5, D5
    flatSteps: [4, 7, 3, 6],  // B4, E5, A4, D5
  },
  bass: {
    id: 'bass',
    label: 'Khóa Fa',
    shortLabel: 'Fa',
    bottomDiatonic: 18, // G2 (octave 2 * 7 + 4)
    sharpSteps: [6, 3, 7, 4], // F3, C3, G3, D3
    flatSteps: [2, 5, 1, 4],  // B2, E3, A2, D3
  },
  alto: {
    id: 'alto',
    label: 'Khóa Đô (Alto)',
    shortLabel: 'Đô',
    bottomDiatonic: 24, // F3 (octave 3 * 7 + 3)
    sharpSteps: [7, 4, 8, 5], // F4, C4, G4, D4
    flatSteps: [3, 6, 2, 5],  // B3, E4, A3, D4
  },
};

export const KEY_SIGNATURES = {
  '0':  { id: '0',  label: 'Không dấu hóa', type: null, count: 0, map: {} },
  '1#': { id: '1#', label: '1 dấu thăng (F#)', type: 1, count: 1, map: { F: 1 } },
  '2#': { id: '2#', label: '2 dấu thăng (F#, C#)', type: 1, count: 2, map: { F: 1, C: 1 } },
  '4#': { id: '4#', label: '4 dấu thăng (F#, C#, G#, D#)', type: 1, count: 4, map: { F: 1, C: 1, G: 1, D: 1 } },
  '1b': { id: '1b', label: '1 dấu giáng (Bb)', type: -1, count: 1, map: { B: -1 } },
  '2b': { id: '2b', label: '2 dấu giáng (Bb, Eb)', type: -1, count: 2, map: { B: -1, E: -1 } },
  '4b': { id: '4b', label: '4 dấu giáng (Bb, Eb, Ab, Db)', type: -1, count: 4, map: { B: -1, E: -1, A: -1, D: -1 } },
};

// 12 phím chuẩn 1 quãng tám (kèm nhãn trùng âm & phím tắt QWERTY trên Desktop)
export const PIANO_KEYS_12 = [
  { pc: 0,  isBlack: false, label: 'C',      short: 'C',     kbd: 'A' },
  { pc: 1,  isBlack: true,  label: 'C#/Db',  short: 'C♯/D♭', kbd: 'W', pos: 1 },
  { pc: 2,  isBlack: false, label: 'D',      short: 'D',     kbd: 'S' },
  { pc: 3,  isBlack: true,  label: 'D#/Eb',  short: 'D♯/E♭', kbd: 'E', pos: 2 },
  { pc: 4,  isBlack: false, label: 'E',      short: 'E',     kbd: 'D' },
  { pc: 5,  isBlack: false, label: 'F',      short: 'F',     kbd: 'F' },
  { pc: 6,  isBlack: true,  label: 'F#/Gb',  short: 'F♯/G♭', kbd: 'T', pos: 4 },
  { pc: 7,  isBlack: false, label: 'G',      short: 'G',     kbd: 'G' },
  { pc: 8,  isBlack: true,  label: 'G#/Ab',  short: 'G♯/A♭', kbd: 'Y', pos: 5 },
  { pc: 9,  isBlack: false, label: 'A',      short: 'A',     kbd: 'H' },
  { pc: 10, isBlack: true,  label: 'A#/Bb',  short: 'A♯/B♭', kbd: 'U', pos: 6 },
  { pc: 11, isBlack: false, label: 'B',      short: 'B',     kbd: 'J' },
];

export const KEYBOARD_MAP = Object.fromEntries(
  PIANO_KEYS_12.map((k) => [k.kbd.toLowerCase(), k.pc])
);

export function diatonicIndex(letter, octave) {
  return octave * 7 + LETTER_TO_DIATONIC[letter];
}

export function diatonicToLetterOctave(dIdx) {
  const octave = Math.floor(dIdx / 7);
  const pos = ((dIdx % 7) + 7) % 7;
  return { letter: LETTERS[pos], octave };
}

export function describeStaffPosition(step) {
  if (step >= 0 && step <= 8) {
    if (step % 2 === 0) return `Dòng ${step / 2 + 1}`;
    return `Khe ${(step + 1) / 2}`;
  }
  if (step < 0) {
    const abs = Math.abs(step);
    if (abs % 2 === 0) return `Dòng phụ dưới ${abs / 2}`;
    return `Khe phụ dưới ${Math.ceil(abs / 2)}`;
  }
  const above = step - 8;
  if (above % 2 === 0) return `Dòng phụ trên ${above / 2}`;
  return `Khe phụ trên ${Math.ceil(above / 2)}`;
}

/**
 * Tạo đối tượng nốt nhạc hoàn chỉnh phục vụ vẽ khuông, phát tiếng Piano và chấm điểm
 * @param {Object} opts
 * @param {'treble'|'bass'|'alto'} opts.clef
 * @param {'C'|'D'|'E'|'F'|'G'|'A'|'B'} opts.letter
 * @param {number} opts.octave
 * @param {number|null} [opts.explicitAccidental] - null = theo hóa biểu; -1/0/1 = dấu hóa hiển thị cạnh nốt
 * @param {string} [opts.keySigId='0']
 */
export function createNoteObj({ clef, letter, octave, explicitAccidental = null, keySigId = '0' }) {
  const clefInfo = CLEF_META[clef] || CLEF_META.treble;
  const keySig = KEY_SIGNATURES[keySigId] || KEY_SIGNATURES['0'];
  const keyAcc = keySig.map[letter] || 0;
  const effAcc = explicitAccidental !== null ? explicitAccidental : keyAcc;

  const basePc = LETTER_TO_PC[letter];
  const rawSemi = (octave + 1) * 12 + basePc + effAcc;
  const pitchClass = ((rawSemi % 12) + 12) % 12;
  const dIdx = diatonicIndex(letter, octave);
  const staffStep = dIdx - clefInfo.bottomDiatonic;

  const accSuffix = effAcc === 1 ? '#' : effAcc === -1 ? 'b' : '';
  const accGlyph = effAcc === 1 ? '♯' : effAcc === -1 ? '♭' : '';
  const displayName = `${letter}${accSuffix}${octave}`;
  const solfegeVi = `${SOLFEGE_VI[letter]}${accGlyph} ${octave}`;

  // Dấu hóa cạnh nốt chỉ vẽ khi có explicitAccidental (trong Chế độ 1 hoặc ngoài hóa biểu)
  const noteAccidental = explicitAccidental !== null ? explicitAccidental : 0;

  return {
    key: `${clef}:${letter}${accSuffix}${octave}`,
    clef,
    letter,
    octave,
    accidental: noteAccidental,
    effectiveAccidental: effAcc,
    keySigId,
    midi: rawSemi,
    pitchClass,
    staffStep,
    displayName,
    solfegeVi,
    staffPositionText: describeStaffPosition(staffStep),
  };
}

export function parseNoteKey(keyStr) {
  const m = String(keyStr).match(/^(treble|bass|alto):([A-G])(#|b)?(\d)$/);
  if (!m) return null;
  const [, clef, letter, accStr, octStr] = m;
  const acc = accStr === '#' ? 1 : accStr === 'b' ? -1 : 0;
  return createNoteObj({
    clef,
    letter,
    octave: Number(octStr),
    explicitAccidental: acc,
    keySigId: '0',
  });
}

// ============================================================================
// Giáo trình Chế độ 1: Luyện từng nốt (Mở khóa 100%)
// ============================================================================
export const SINGLE_NOTE_GROUPS = [
  {
    group: 'Khóa Sol (Treble)',
    lessons: [
      {
        id: 'sol-intro',
        title: 'Nhập môn',
        desc: 'C4 – G4 (5 nốt cơ bản)',
        clef: 'treble',
        start: ['C', 4],
        end: ['G', 4],
        accMode: 'natural',
      },
      {
        id: 'sol-staff',
        title: 'Trong khuông',
        desc: 'E4 – F5 (9 nốt trong khuông)',
        clef: 'treble',
        start: ['E', 4],
        end: ['F', 5],
        accMode: 'natural',
      },
      {
        id: 'sol-ext',
        title: 'Mở rộng',
        desc: 'F3 – E6 (+3 dòng kẻ phụ)',
        clef: 'treble',
        start: ['F', 3],
        end: ['E', 6],
        accMode: 'natural',
      },
      {
        id: 'sol-sharp',
        title: 'Khóa Sol + Thăng ♯',
        desc: 'Trong khuông + C♯ D♯ F♯ G♯ A♯',
        clef: 'treble',
        start: ['E', 4],
        end: ['F', 5],
        accMode: 'sharp',
      },
      {
        id: 'sol-flat',
        title: 'Khóa Sol + Giáng ♭',
        desc: 'Trong khuông + D♭ E♭ G♭ A♭ B♭',
        clef: 'treble',
        start: ['E', 4],
        end: ['F', 5],
        accMode: 'flat',
      },
      {
        id: 'sol-12',
        title: 'Khóa Sol · 12 nốt',
        desc: 'F3 – E6 đủ 12 nốt thăng/giáng',
        clef: 'treble',
        start: ['F', 3],
        end: ['E', 6],
        accMode: 'chromatic',
      },
    ],
  },
  {
    group: 'Khóa Fa (Bass)',
    lessons: [
      {
        id: 'fa-staff',
        title: 'Trong khuông',
        desc: 'G2 – A3 (9 nốt trong khuông)',
        clef: 'bass',
        start: ['G', 2],
        end: ['A', 3],
        accMode: 'natural',
      },
      {
        id: 'fa-ext',
        title: 'Mở rộng',
        desc: 'A1 – F4 (+3 dòng kẻ phụ)',
        clef: 'bass',
        start: ['A', 1],
        end: ['F', 4],
        accMode: 'natural',
      },
      {
        id: 'fa-12',
        title: 'Khóa Fa · 12 nốt',
        desc: 'A1 – F4 đủ thăng/giáng',
        clef: 'bass',
        start: ['A', 1],
        end: ['F', 4],
        accMode: 'chromatic',
      },
    ],
  },
  {
    group: 'Mix Sol + Fa',
    lessons: [
      {
        id: 'mix-sol-fa',
        title: 'Sol + Fa xen kẽ',
        desc: 'Đổi ngẫu nhiên Khóa Sol & Khóa Fa',
        clef: 'mix-tb',
        ranges: [
          { clef: 'treble', start: ['C', 4], end: ['G', 5] },
          { clef: 'bass',   start: ['F', 2], end: ['C', 4] },
        ],
        accMode: 'natural',
      },
    ],
  },
  {
    group: 'Khóa Đô (Alto) & Tổng hợp',
    lessons: [
      {
        id: 'alto-staff',
        title: 'Khóa Đô · Trong khuông',
        desc: 'F3 – G4 (Đô giữa ở dòng 3)',
        clef: 'alto',
        start: ['F', 3],
        end: ['G', 4],
        accMode: 'natural',
      },
      {
        id: 'all-12',
        title: 'Tất cả khóa · 12 nốt',
        desc: 'Sol + Fa + Đô đủ thăng/giáng',
        clef: 'mix-all',
        ranges: [
          { clef: 'treble', start: ['C', 4], end: ['A', 5] },
          { clef: 'bass',   start: ['E', 2], end: ['C', 4] },
          { clef: 'alto',   start: ['E', 3], end: ['A', 4] },
        ],
        accMode: 'chromatic',
      },
    ],
  },
];

// ============================================================================
// Giáo trình Chế độ 2: Luyện nốt chạy (Mở khóa 100%, chia 3 cấp độ)
// ============================================================================
export const SCROLL_LESSON_GROUPS = [
  {
    group: 'Dễ (Khởi động & Ngũ cung)',
    difficulty: 'easy',
    lessons: [
      {
        id: 'scroll-c-pent',
        title: 'Đô ngũ cung · Dân ca',
        desc: '5 nốt C D E G A · Giai điệu Việt',
        difficulty: 'easy',
        clef: 'treble',
        keySigId: '0',
        defaultBpm: 36,
        start: ['C', 4],
        end: ['E', 5],
        allowedLetters: ['C', 'D', 'E', 'G', 'A'],
      },
      {
        id: 'scroll-g-pent',
        title: 'Sol ngũ cung · Chậm rãi',
        desc: '5 nốt G A B D E · Hóa biểu F♯',
        difficulty: 'easy',
        clef: 'treble',
        keySigId: '1#',
        defaultBpm: 36,
        start: ['D', 4],
        end: ['G', 5],
        allowedLetters: ['G', 'A', 'B', 'D', 'E'],
      },
      {
        id: 'scroll-c-easy',
        title: 'Đô trưởng · Khởi đầu',
        desc: 'Không dấu hóa · C4 – C5',
        difficulty: 'easy',
        clef: 'treble',
        keySigId: '0',
        defaultBpm: 40,
        start: ['C', 4],
        end: ['C', 5],
      },
      {
        id: 'scroll-g-easy',
        title: 'Sol trưởng · 1 dấu thăng',
        desc: 'Hóa biểu F♯ · D4 – G5',
        difficulty: 'easy',
        clef: 'treble',
        keySigId: '1#',
        defaultBpm: 42,
        start: ['D', 4],
        end: ['G', 5],
      },
      {
        id: 'scroll-f-easy',
        title: 'Fa trưởng · 1 dấu giáng',
        desc: 'Hóa biểu B♭ · C4 – F5',
        difficulty: 'easy',
        clef: 'treble',
        keySigId: '1b',
        defaultBpm: 42,
        start: ['C', 4],
        end: ['F', 5],
      },
    ],
  },
  {
    group: 'Trung bình (Hóa biểu 2 dấu & Tốc độ vừa)',
    difficulty: 'medium',
    lessons: [
      {
        id: 'scroll-c-med',
        title: 'Đô trưởng · Nhanh hơn',
        desc: 'Không dấu hóa · C4 – F5',
        difficulty: 'medium',
        clef: 'treble',
        keySigId: '0',
        defaultBpm: 62,
        start: ['C', 4],
        end: ['F', 5],
      },
      {
        id: 'scroll-d-med',
        title: 'Rê trưởng · 2 dấu thăng',
        desc: 'Hóa biểu F♯, C♯ · D4 – F♯5',
        difficulty: 'medium',
        clef: 'treble',
        keySigId: '2#',
        defaultBpm: 62,
        start: ['D', 4],
        end: ['F', 5],
      },
      {
        id: 'scroll-bb-med',
        title: 'Si giáng trưởng · 2 dấu giáng',
        desc: 'Hóa biểu B♭, E♭ · B♭3 – F5',
        difficulty: 'medium',
        clef: 'treble',
        keySigId: '2b',
        defaultBpm: 62,
        start: ['B', 3],
        end: ['F', 5],
      },
      {
        id: 'scroll-am-med',
        title: 'La thứ · Tự nhiên',
        desc: 'Âm giai Am · A3 – E5',
        difficulty: 'medium',
        clef: 'treble',
        keySigId: '0',
        defaultBpm: 64,
        start: ['A', 3],
        end: ['E', 5],
      },
      {
        id: 'scroll-g-pent-med',
        title: 'Sol ngũ cung · Nhịp vừa',
        desc: 'G A B D E · Tốc độ trung bình',
        difficulty: 'medium',
        clef: 'treble',
        keySigId: '1#',
        defaultBpm: 68,
        start: ['D', 4],
        end: ['G', 5],
        allowedLetters: ['G', 'A', 'B', 'D', 'E'],
      },
    ],
  },
  {
    group: 'Khó (Hóa biểu 4 dấu & Thực chiến nhanh)',
    difficulty: 'hard',
    lessons: [
      {
        id: 'scroll-c-fast',
        title: 'Đô trưởng · Tốc độ',
        desc: 'Không dấu hóa · A3 – A5 tốc độ cao',
        difficulty: 'hard',
        clef: 'treble',
        keySigId: '0',
        defaultBpm: 94,
        start: ['A', 3],
        end: ['A', 5],
      },
      {
        id: 'scroll-e-hard',
        title: 'Mi trưởng · 4 dấu thăng',
        desc: 'Hóa biểu F♯, C♯, G♯, D♯',
        difficulty: 'hard',
        clef: 'treble',
        keySigId: '4#',
        defaultBpm: 88,
        start: ['E', 4],
        end: ['G', 5],
      },
      {
        id: 'scroll-ab-hard',
        title: 'La giáng trưởng · 4 dấu giáng',
        desc: 'Hóa biểu B♭, E♭, A♭, D♭',
        difficulty: 'hard',
        clef: 'treble',
        keySigId: '4b',
        defaultBpm: 88,
        start: ['A', 3],
        end: ['A', 5],
      },
      {
        id: 'scroll-am-pent',
        title: 'La ngũ cung thứ · Truyền thống',
        desc: '5 nốt A C D E G · Cảm giác Blues/Nam',
        difficulty: 'hard',
        clef: 'treble',
        keySigId: '0',
        defaultBpm: 96,
        start: ['A', 3],
        end: ['G', 5],
        allowedLetters: ['A', 'C', 'D', 'E', 'G'],
      },
    ],
  },
];

export function findSingleLesson(id) {
  for (const g of SINGLE_NOTE_GROUPS) {
    const found = g.lessons.find((l) => l.id === id);
    if (found) return found;
  }
  return SINGLE_NOTE_GROUPS[0].lessons[1];
}

export function findScrollLesson(id) {
  for (const g of SCROLL_LESSON_GROUPS) {
    const found = g.lessons.find((l) => l.id === id);
    if (found) return found;
  }
  return SCROLL_LESSON_GROUPS[0].lessons[0];
}

function buildRangeNotes({ clef, start, end, accMode = 'natural', keySigId = '0', allowedLetters = null }) {
  const startIdx = diatonicIndex(start[0], start[1]);
  const endIdx = diatonicIndex(end[0], end[1]);
  const notes = [];

  for (let d = startIdx; d <= endIdx; d++) {
    const { letter, octave } = diatonicToLetterOctave(d);
    if (allowedLetters && !allowedLetters.includes(letter)) continue;

    if (accMode === 'natural' || keySigId !== '0') {
      notes.push(
        createNoteObj({
          clef,
          letter,
          octave,
          explicitAccidental: keySigId !== '0' ? null : 0,
          keySigId,
        })
      );
      continue;
    }

    // Tự nhiên luôn có mặt
    notes.push(createNoteObj({ clef, letter, octave, explicitAccidental: 0 }));

    // Dấu thăng hợp lệ trên các bậc có phím đen (trừ E và B để tránh nhầm E#/B# cho người học)
    if ((accMode === 'sharp' || accMode === 'chromatic') && ['C', 'D', 'F', 'G', 'A'].includes(letter)) {
      notes.push(createNoteObj({ clef, letter, octave, explicitAccidental: 1 }));
    }

    // Dấu giáng hợp lệ trên các bậc có phím đen (trừ C và F)
    if ((accMode === 'flat' || accMode === 'chromatic') && ['D', 'E', 'G', 'A', 'B'].includes(letter)) {
      notes.push(createNoteObj({ clef, letter, octave, explicitAccidental: -1 }));
    }
  }

  return notes;
}

export function buildLessonNotePool(lesson) {
  if (Array.isArray(lesson.ranges)) {
    return lesson.ranges.flatMap((r) =>
      buildRangeNotes({
        clef: r.clef,
        start: r.start,
        end: r.end,
        accMode: lesson.accMode || 'natural',
        keySigId: lesson.keySigId || '0',
      })
    );
  }
  return buildRangeNotes(lesson);
}

export function pickRandomNote(pool, lastKey = null) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const filtered = lastKey ? pool.filter((n) => n.key !== lastKey) : pool;
  const src = filtered.length > 0 ? filtered : pool;
  return src[Math.floor(Math.random() * src.length)];
}

/**
 * Tính Xếp hạng Trình độ & nhận xét tốc độ phản xạ sau mỗi phiên tập
 */
export function computeSessionRank({ accuracyPct, avgReactionSec, total, difficulty = 'easy' }) {
  if (!total || total === 0) {
    return {
      grade: '—',
      title: 'Chưa có dữ liệu',
      speedComment: 'Hãy bấm ít nhất 1 nốt để ghi nhận đánh giá.',
      color: '#9CA3AF',
    };
  }

  const diffBonus = difficulty === 'hard' ? 8 : difficulty === 'medium' ? 4 : 0;
  const speedScore =
    avgReactionSec <= 0.75 ? 100
    : avgReactionSec <= 1.05 ? 90
    : avgReactionSec <= 1.45 ? 78
    : avgReactionSec <= 2.1 ? 65
    : 50;

  const combined = accuracyPct * 0.72 + speedScore * 0.28 + (accuracyPct >= 85 ? diffBonus : 0);

  let speedComment = 'Cần tăng tốc';
  if (avgReactionSec <= 0.85) speedComment = 'Phản xạ cực nhanh';
  else if (avgReactionSec <= 1.25) speedComment = 'Rất nhanh';
  else if (avgReactionSec <= 1.85) speedComment = 'Ổn định';

  if (accuracyPct >= 95 && avgReactionSec <= 1.1 && total >= 8) {
    return { grade: 'S', title: 'Bậc thầy Đọc nốt (S-Rank)', speedComment, color: '#34D399' };
  }
  if (combined >= 86) {
    return { grade: 'A', title: 'Nhanh nhạy (A-Rank)', speedComment, color: '#10B981' };
  }
  if (combined >= 74) {
    return { grade: 'B', title: 'Khá vững (B-Rank)', speedComment, color: '#60A5FA' };
  }
  if (combined >= 58) {
    return { grade: 'C', title: 'Cơ bản (C-Rank)', speedComment, color: '#F59E0B' };
  }
  return { grade: 'D', title: 'Mới làm quen', speedComment, color: '#FB7185' };
}

// ============================================================================
// Lưu trữ Thống kê & Lịch sử lỗi sai (LocalStorage)
// ============================================================================
export function loadTrainerStats() {
  const empty = {
    totalPracticed: 0,
    totalCorrect: 0,
    bestAccuracy: 0,
    bestStreak: 0,
    notes: {}, // key -> { wrong, total, totalReactionMs, hits, lastWrongAt }
    recentSessions: [],
  };
  try {
    const raw = localStorage.getItem(TRAINER_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      ...empty,
      ...parsed,
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
      recentSessions: Array.isArray(parsed.recentSessions) ? parsed.recentSessions : [],
    };
  } catch (_) {
    return empty;
  }
}

function saveTrainerStats(stats) {
  try {
    localStorage.setItem(TRAINER_STORAGE_KEY, JSON.stringify(stats));
  } catch (_) {}
}

export function recordTrainerOutcome(noteObj, isCorrect, reactionMs = 0) {
  if (!noteObj || !noteObj.key) return;
  const stats = loadTrainerStats();
  stats.totalPracticed += 1;
  if (isCorrect) stats.totalCorrect += 1;

  const entry = stats.notes[noteObj.key] || {
    wrong: 0,
    total: 0,
    hits: 0,
    totalReactionMs: 0,
    lastWrongAt: 0,
  };
  entry.total += 1;
  if (isCorrect) {
    entry.hits += 1;
    if (reactionMs > 0 && reactionMs < 15000) {
      entry.totalReactionMs += reactionMs;
    }
  } else {
    entry.wrong += 1;
    entry.lastWrongAt = Date.now();
  }
  stats.notes[noteObj.key] = entry;
  saveTrainerStats(stats);
}

export function saveTrainerSessionSummary(summary) {
  const stats = loadTrainerStats();
  if (summary.accuracyPct > stats.bestAccuracy && summary.total >= 5) {
    stats.bestAccuracy = summary.accuracyPct;
  }
  if (summary.maxStreak > stats.bestStreak) {
    stats.bestStreak = summary.maxStreak;
  }
  stats.recentSessions.unshift({
    title: summary.title,
    mode: summary.mode,
    accuracyPct: summary.accuracyPct,
    avgReactionSec: summary.avgReactionSec,
    total: summary.total,
    at: Date.now(),
  });
  stats.recentSessions = stats.recentSessions.slice(0, 12);
  saveTrainerStats(stats);
}

/**
 * Lấy danh sách các nốt hay bấm sai nhất để luyện riêng ở Chế độ 3 (Ôn tập nốt sai)
 */
export function getWeakNotesList(limit = 16) {
  const stats = loadTrainerStats();
  const entries = Object.entries(stats.notes)
    .filter(([, v]) => v.wrong > 0)
    .sort((a, b) => {
      const scoreA = a[1].wrong * 3 + (a[1].wrong / Math.max(1, a[1].total)) * 5;
      const scoreB = b[1].wrong * 3 + (b[1].wrong / Math.max(1, b[1].total)) * 5;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b[1].lastWrongAt || 0) - (a[1].lastWrongAt || 0);
    })
    .slice(0, limit);

  const result = [];
  for (const [key, stat] of entries) {
    const note = parseNoteKey(key);
    if (note) {
      result.push({ ...note, wrongCount: stat.wrong, totalCount: stat.total });
    }
  }
  return result;
}
