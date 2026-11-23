// ============================================================================
// earTraining.js — Luyện Cảm Âm Hợp Âm, Quãng Nhạc & Bậc Hòa Âm (Ear Training)
// Hỗ trợ 3 chế độ: Loại Hợp Âm (Cơ bản -> Nâng cao), Quãng Nhạc & Bậc Hợp Âm (I-vi)
// ============================================================================

import { midiToNoteName, pcToNoteName } from './theory.js?v=37';

const EAR_STORAGE_KEY = 'hevos_ear_training_v1';

export const EAR_CHORD_TYPES = [
  {
    id: 'maj',
    label: 'Trưởng (Major)',
    shortLabel: 'Trưởng',
    intervals: [0, 4, 7],
    level: 'basic',
    hint: 'Âm sắc sáng, vui tươi và ổn định (1 – 3 – 5).',
  },
  {
    id: 'min',
    label: 'Thứ (Minor)',
    shortLabel: 'Thứ',
    intervals: [0, 3, 7],
    level: 'basic',
    hint: 'Âm sắc buồn, sâu lắng và giàu cảm xúc (1 – b3 – 5).',
  },
  {
    id: 'sus4',
    label: 'Treo bậc 4 (sus4)',
    shortLabel: 'sus4',
    intervals: [0, 5, 7],
    level: 'basic',
    hint: 'Cảm giác mở rộng, lơ lửng chưa kết câu (1 – 4 – 5).',
  },
  {
    id: '7',
    label: 'Át 7 (Dominant 7)',
    shortLabel: '7',
    intervals: [0, 4, 7, 10],
    level: 'medium',
    hint: 'Căng nhẹ kiểu Blues/R&B, thôi thúc kéo về chủ âm (1 – 3 – 5 – b7).',
  },
  {
    id: 'maj7',
    label: 'Trưởng 7 (maj7)',
    shortLabel: 'maj7',
    intervals: [0, 4, 7, 11],
    level: 'medium',
    hint: 'Êm ái, mơ màng đậm chất Lo-Fi & City Pop (1 – 3 – 5 – 7).',
  },
  {
    id: 'm7',
    label: 'Thứ 7 (m7)',
    shortLabel: 'm7',
    intervals: [0, 3, 7, 10],
    level: 'medium',
    hint: 'Mượt mà, ấm áp chuẩn R&B / Neo-Soul (1 – b3 – 5 – b7).',
  },
  {
    id: 'dim',
    label: 'Giảm (Diminished)',
    shortLabel: 'dim',
    intervals: [0, 3, 6],
    level: 'advanced',
    hint: 'Căng thẳng, huyền bí và chật hẹp (1 – b3 – b5).',
  },
];

export const EAR_INTERVAL_TYPES = [
  { id: 'M2', label: 'Quãng 2 Trưởng (M2)',   shortLabel: '2 Trưởng',  semis: 2,  hint: '2 bán cung — liền bậc như "Chúc mừng sinh nhật"' },
  { id: 'm3', label: 'Quãng 3 Thứ (m3)',      shortLabel: '3 Thứ',     semis: 3,  hint: '3 bán cung — buồn nhẹ, mở đầu bài Greensleeves' },
  { id: 'M3', label: 'Quãng 3 Trưởng (M3)',   shortLabel: '3 Trưởng',  semis: 4,  hint: '4 bán cung — sáng rõ, nốt 1→3 của hợp âm Trưởng' },
  { id: 'P4', label: 'Quãng 4 Đúng (P4)',     shortLabel: '4 Đúng',    semis: 5,  hint: '5 bán cung — chắc nịch như tiếng còi / Hành khúc' },
  { id: 'P5', label: 'Quãng 5 Đúng (P5)',     shortLabel: '5 Đúng',    semis: 7,  hint: '7 bán cung — mở rộng, hùng tráng như Star Wars' },
  { id: 'M6', label: 'Quãng 6 Trưởng (M6)',   shortLabel: '6 Trưởng',  semis: 9,  hint: '9 bán cung — bay bổng, ngân nga ấm áp' },
  { id: 'm7', label: 'Quãng 7 Thứ (m7)',      shortLabel: '7 Thứ',     semis: 10, hint: '10 bán cung — cảm giác Blues/Funk gợi mở' },
  { id: 'M7', label: 'Quãng 7 Trưởng (M7)',   shortLabel: '7 Trưởng',  semis: 11, hint: '11 bán cung — sát quãng 8, mơ màng (Take On Me)' },
  { id: 'P8', label: 'Quãng 8 Đúng (Octave)', shortLabel: 'Quãng 8',   semis: 12, hint: '12 bán cung — 2 nốt cùng tên ở 2 tầng cao thấp' },
];

export const EAR_DEGREE_TYPES = [
  { id: 'I',   label: 'Bậc I (Chủ âm Trưởng)',     shortLabel: 'I (Chủ)',     rootOffset: 0, intervals: [0, 4, 7], hint: 'Về nhà bình yên, vững chãi hoàn toàn' },
  { id: 'ii',  label: 'Bậc ii (Thứ dịu nhẹ)',     shortLabel: 'ii (Thứ 2)',  rootOffset: 2, intervals: [0, 3, 7], hint: 'Bước đệm mềm chuẩn bị sang bậc V (ii – V – I)' },
  { id: 'iii', label: 'Bậc iii (Thứ sâu lắng)',    shortLabel: 'iii (Thứ 3)', rootOffset: 4, intervals: [0, 3, 7], hint: 'Màu buồn man mác, nối mượt từ I sang vi hoặc IV' },
  { id: 'IV',  label: 'Bậc IV (Hạ át mở rộng)',    shortLabel: 'IV (Trưởng 4)', rootOffset: 5, intervals: [0, 4, 7], hint: 'Nâng cảm xúc sáng lên (điệp khúc Pop)' },
  { id: 'V',   label: 'Bậc V (Át dẫn câu)',        shortLabel: 'V (Át 5)',    rootOffset: 7, intervals: [0, 4, 7], hint: 'Căng tràn năng lượng, muốn hút ngay về bậc I' },
  { id: 'vi',  label: 'Bậc vi (Song song Thứ)',    shortLabel: 'vi (Thứ 6)',  rootOffset: 9, intervals: [0, 3, 7], hint: 'Bất ngờ chuyển cảm xúc sang Thứ ngọt ngào' },
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function generateEarQuestion({ mode = 'chord', difficulty = 'medium', prevAnswerId = null } = {}) {
  const rootMidi = 53 + Math.floor(Math.random() * 12); // F3..E4 vừa tai
  const keyPc = ((rootMidi % 12) + 12) % 12;
  const preferFlats = [1, 3, 5, 6, 8, 10].includes(keyPc);
  const rootName = pcToNoteName(keyPc, preferFlats);

  if (mode === 'interval') {
    const candidates = EAR_INTERVAL_TYPES;
    let pool = candidates;
    if (prevAnswerId && candidates.length > 1) {
      pool = candidates.filter((c) => c.id !== prevAnswerId);
    }
    const target = pickRandom(pool);
    const midis = [rootMidi, rootMidi + target.semis];
    const noteNames = midis.map((m) => midiToNoteName(m, preferFlats));

    return {
      mode: 'interval',
      difficulty,
      answerId: target.id,
      answerLabel: target.label,
      rootMidi,
      anchorMidis: [],
      midis,
      noteNames,
      explanation: `${target.label}: ${noteNames.join(' → ')} (${target.hint})`,
      options: candidates.map((c) => ({ id: c.id, label: c.label, shortLabel: c.shortLabel, hint: c.hint })),
    };
  }

  if (mode === 'degree') {
    const tonicRoot = 60 + (Math.floor(Math.random() * 5) - 2); // Quanh C4
    const tKeyPc = ((tonicRoot % 12) + 12) % 12;
    const tFlats = [1, 3, 5, 6, 8, 10].includes(tKeyPc);
    const tName = pcToNoteName(tKeyPc, tFlats);

    let pool = EAR_DEGREE_TYPES;
    if (prevAnswerId && pool.length > 1) {
      pool = pool.filter((d) => d.id !== prevAnswerId);
    }
    const target = pickRandom(pool);
    const anchorMidis = [tonicRoot, tonicRoot + 4, tonicRoot + 7];
    const chordRoot = tonicRoot + target.rootOffset;
    const midis = target.intervals.map((iv) => chordRoot + iv);
    const noteNames = midis.map((m) => midiToNoteName(m, tFlats));

    return {
      mode: 'degree',
      difficulty,
      answerId: target.id,
      answerLabel: target.label,
      rootMidi: chordRoot,
      anchorMidis,
      midis,
      noteNames,
      explanation: `Trong tông ${tName} Trưởng (Chủ âm I = ${tName}): ${target.label} là hợp âm gồm [${noteNames.join(' · ')}]. ${target.hint}`,
      options: EAR_DEGREE_TYPES.map((d) => ({ id: d.id, label: d.label, shortLabel: d.shortLabel, hint: d.hint })),
    };
  }

  // Mặc định: mode === 'chord'
  const allowedLevels =
    difficulty === 'basic'
      ? new Set(['basic'])
      : difficulty === 'advanced'
        ? new Set(['basic', 'medium', 'advanced'])
        : new Set(['basic', 'medium']);
  const optionsPool = EAR_CHORD_TYPES.filter((c) => allowedLevels.has(c.level));
  let pickPool = optionsPool;
  if (prevAnswerId && optionsPool.length > 1) {
    pickPool = optionsPool.filter((c) => c.id !== prevAnswerId);
  }
  const target = pickRandom(pickPool);

  let midis = target.intervals.map((iv) => rootMidi + iv);
  let inversionLabel = 'Thế bấm gốc';
  if (difficulty === 'advanced' && midis.length >= 3 && Math.random() < 0.45) {
    // Đảo nốt bass lên 1 quãng tám để luyện tai nâng cao
    midis = [...midis.slice(1), midis[0] + 12].sort((a, b) => a - b);
    inversionLabel = 'Đảo 1 (1st Inversion)';
  }
  const noteNames = midis.map((m) => midiToNoteName(m, preferFlats));

  return {
    mode: 'chord',
    difficulty,
    answerId: target.id,
    answerLabel: `${rootName} ${target.label}`,
    rootMidi,
    anchorMidis: [],
    midis,
    noteNames,
    explanation: `${rootName} ${target.label} (${inversionLabel}): [${noteNames.join(' · ')}] — ${target.hint}`,
    options: optionsPool.map((c) => ({ id: c.id, label: c.label, shortLabel: c.shortLabel, hint: c.hint })),
  };
}

export function loadEarStats() {
  try {
    const raw = localStorage.getItem(EAR_STORAGE_KEY);
    if (!raw) return { total: 0, correct: 0, streak: 0, bestStreak: 0 };
    const parsed = JSON.parse(raw);
    return {
      total: Number(parsed.total) || 0,
      correct: Number(parsed.correct) || 0,
      streak: Number(parsed.streak) || 0,
      bestStreak: Number(parsed.bestStreak) || 0,
    };
  } catch (_) {
    return { total: 0, correct: 0, streak: 0, bestStreak: 0 };
  }
}

export function saveEarOutcome(isCorrect) {
  const st = loadEarStats();
  st.total += 1;
  if (isCorrect) {
    st.correct += 1;
    st.streak += 1;
    if (st.streak > st.bestStreak) st.bestStreak = st.streak;
  } else {
    st.streak = 0;
  }
  try {
    localStorage.setItem(EAR_STORAGE_KEY, JSON.stringify(st));
  } catch (_) {}
  return st;
}
