// ============================================================================
// theoryExercises.js — Bộ Máy 6 Dạng Bài Tập Thực Hành Nhạc Lý Tương Tác
// Hỗ trợ đồng thời: Web MIDI USB · Cảm ứng đa điểm Mobile · QWERTY · Chuột
// ============================================================================

import {
  SCALES,
  getScalePitchClasses,
  midiToNoteName,
  pcToNoteName,
  shouldPreferFlats,
} from './theory.js?v=32';
import { getQwertyLabelForMidi } from './midiController.js?v=32';
import {
  detectChordFromMidis,
  doesActiveMatchChord,
  getScaleGuideInfo,
} from './musicTheory.js?v=32';

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================================
// Dữ liệu Ngân hàng Câu hỏi cho từng Chặng
// ============================================================================
const INTERVAL_BANK = [
  { id: 'M2', semis: 2, label: 'Quãng 2 Trưởng (M2)', hint: '2 bán cung · liền bậc tự nhiên như câu hát kể chuyện' },
  { id: 'm3', semis: 3, label: 'Quãng 3 Thứ (m3)', hint: '3 bán cung · màu buồn dịu, sâu lắng' },
  { id: 'M3', semis: 4, label: 'Quãng 3 Trưởng (M3)', hint: '4 bán cung · sáng sủa, ấm áp' },
  { id: 'P4', semis: 5, label: 'Quãng 4 Đúng (P4)', hint: '5 bán cung · chắc nịch, vang rõ' },
  { id: 'P5', semis: 7, label: 'Quãng 5 Đúng (P5)', hint: '7 bán cung · khung xương mở rộng, hùng tráng' },
  { id: 'M6', semis: 9, label: 'Quãng 6 Trưởng (M6)', hint: '9 bán cung · bay bổng ngọt ngào cho điệp khúc' },
  { id: 'm7', semis: 10, label: 'Quãng 7 Thứ (m7)', hint: '10 bán cung · nét Blues/R&B lơ lửng' },
  { id: 'M7', semis: 11, label: 'Quãng 7 Trưởng (M7)', hint: '11 bán cung · mơ màng kiểu City Pop / Neo-Soul' },
];

const GROOVE_PATTERNS = {
  'quarter-44': {
    title: 'Đếm 4 phách chuẩn (4/4)',
    subtitle: 'Gõ đều theo 4 phách lớn: 1 – 2 – 3 – 4 (chờ hết 4 tiếng Count-in)',
    swingPct: 0,
    targets: [
      { beat: 0, label: '1' },
      { beat: 1, label: '2' },
      { beat: 2, label: '3' },
      { beat: 3, label: '4' },
    ],
  },
  'eighth-grid': {
    title: 'Kết hợp Phách Đen & Móc đơn (1/8)',
    subtitle: 'Gõ đúng vào phách 1, 2, "2-và", 3, 4 và "4-và"',
    swingPct: 0,
    targets: [
      { beat: 0, label: '1' },
      { beat: 1, label: '2' },
      { beat: 1.5, label: 'và' },
      { beat: 2, label: '3' },
      { beat: 3, label: '4' },
      { beat: 3.5, label: 'và' },
    ],
  },
  'syncopation-swing': {
    title: 'Đảo phách & Độ lơi Swing 58% (R&B)',
    subtitle: 'Nhấn chắc phách 1, bắt nhịp lơi vào "1-và", đón phách "2-và" và phách 4',
    swingPct: 58,
    targets: [
      { beat: 0, label: '1' },
      { beat: 0.58, label: 'lơi' },
      { beat: 1.58, label: 'ĐẢO!' },
      { beat: 2.58, label: 'lơi' },
      { beat: 3, label: '4' },
    ],
  },
};

const SCALE_PRESETS = {
  'c-major': {
    id: 'c-major',
    name: 'C Trưởng (Major)',
    keyPc: 0,
    scaleType: 'major',
    preferFlats: false,
    rootMidi: 60,
    intervals: [0, 2, 4, 5, 7, 9, 11, 12],
  },
  'a-minor': {
    id: 'a-minor',
    name: 'A Thứ tự nhiên (Natural Minor)',
    keyPc: 9,
    scaleType: 'minor',
    preferFlats: false,
    rootMidi: 57,
    intervals: [0, 2, 3, 5, 7, 8, 10, 12],
  },
  'c-pent-major': {
    id: 'c-pent-major',
    name: 'C Ngũ cung Trưởng (Pentatonic)',
    keyPc: 0,
    scaleType: 'pentatonic_major',
    preferFlats: false,
    rootMidi: 60,
    intervals: [0, 2, 4, 7, 9, 12],
  },
  'eb-pent-major': {
    id: 'eb-pent-major',
    name: 'Eb Ngũ cung Trưởng (R&B)',
    keyPc: 3,
    scaleType: 'pentatonic_major',
    preferFlats: true,
    rootMidi: 63,
    intervals: [0, 2, 4, 7, 9, 12],
  },
  'eb-major': {
    id: 'eb-major',
    name: 'Eb Trưởng (Major)',
    keyPc: 3,
    scaleType: 'major',
    preferFlats: true,
    rootMidi: 63,
    intervals: [0, 2, 4, 5, 7, 9, 11, 12],
  },
};

const SCALE_IMPOSTOR_ROUNDS = [
  {
    keyLabel: 'C Trưởng (C D E F G A B)',
    notes: [60, 62, 64, 66, 67, 69, 67],
    impostorIndex: 3,
    labels: ['C4', 'D4', 'E4', 'F#4', 'G4', 'A4', 'G4'],
    explanation: 'Trong C Trưởng hoàn toàn không có phím đen! Nốt F#4 bị chệch lên nửa cung so với F4 chuẩn của tông.',
  },
  {
    keyLabel: 'A Thứ (A B C D E F G)',
    notes: [57, 59, 60, 62, 64, 65, 68],
    impostorIndex: 6,
    labels: ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G#4'],
    explanation: 'Âm giai A Thứ tự nhiên kết bằng G4 bình thường. G#4 tạo màu căng Harmonic Minor, nằm ngoài bộ 7 nốt tự nhiên.',
  },
  {
    keyLabel: 'Eb Trưởng (Eb F G Ab Bb C D)',
    notes: [63, 65, 67, 68, 69, 70, 67],
    impostorIndex: 4,
    labels: ['Eb4', 'F4', 'G4', 'Ab4', 'A4', 'Bb4', 'G4'],
    explanation: 'Eb Trưởng giáng Bb, Eb và Ab nên không có nốt A bình (A4) giữa Ab4 và Bb4.',
  },
  {
    keyLabel: 'G Trưởng (G A B C D E F#)',
    notes: [67, 69, 71, 72, 74, 76, 77],
    impostorIndex: 6,
    labels: ['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'],
    explanation: 'G Trưởng bắt buộc nâng Fa lên F# làm nốt dẫn bậc 7. F5 bình nghe bị xệch lạc tông.',
  },
  {
    keyLabel: 'C Ngũ cung Trưởng (C D E G A)',
    notes: [60, 62, 64, 65, 67, 69, 64],
    impostorIndex: 3,
    labels: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'E4'],
    explanation: 'Âm giai Ngũ cung 5 nốt cố ý loại bỏ F4 và B4 để không bao giờ bị cọ nghịch tai.',
  },
];

const VIET_TONE_IMPOSTOR_ROUNDS = [
  {
    phrase: 'Chiều nay phố lên đèn sáng',
    syllables: ['Chiều (`)', 'nay', 'phố (´)', 'lên', 'đèn (`)', 'sáng (´)'],
    wrongMidis: [60, 64, 67, 64, 71, 72],
    fixedMidis: [60, 64, 67, 64, 62, 72],
    impostorIndex: 4,
    explanation: 'Chữ "đèn" mang thanh Huyền phải hạ xuống thấp (D4), nhưng bản lỗi lại kéo vọt lên B4 nghe như "đén/đến"!',
  },
  {
    phrase: 'Giọt nước mắt rơi lặng thầm',
    syllables: ['Giọt (.)', 'nước (´)', 'mắt (´)', 'rơi', 'lặng (.)', 'thầm (`)'],
    wrongMidis: [64, 60, 67, 65, 62, 60],
    fixedMidis: [62, 67, 69, 65, 62, 60],
    impostorIndex: 1,
    explanation: 'Chữ "nước" mang thanh Sắc phải cao hơn chữ "Giọt" phía trước (C4 tụt xuống nghe thành "giọt nược mắt").',
  },
  {
    phrase: 'Đêm trôi chậm giữa tiếng gió',
    syllables: ['Đêm', 'trôi', 'chậm (.)', 'giữa (~)', 'tiếng (´)', 'gió (´)'],
    wrongMidis: [64, 65, 72, 69, 71, 72],
    fixedMidis: [64, 65, 60, 69, 71, 72],
    impostorIndex: 2,
    explanation: 'Chữ "chậm" có dấu Nặng phải hạ êm xuống thấp (C4), bị đẩy lên C5 khiến người nghe tưởng chữ "chấm".',
  },
  {
    phrase: 'Mưa buồn rơi mãi ngoài hiên',
    syllables: ['Mưa', 'buồn (`)', 'rơi', 'mãi (~)', 'ngoài (`)', 'hiên'],
    wrongMidis: [67, 72, 64, 69, 62, 64],
    fixedMidis: [67, 62, 64, 69, 62, 64],
    impostorIndex: 1,
    explanation: 'Chữ "buồn" dấu Huyền không thể nhảy vọt cao hơn chữ "Mưa" (C5 nghe biến dạng thành "Mưa buốn").',
  },
  {
    phrase: 'Em giữ lại chút kỷ niệm',
    syllables: ['Em', 'giữ (~)', 'lại (.)', 'chút (´)', 'kỷ (̉)', 'niệm (.)'],
    wrongMidis: [64, 69, 62, 67, 64, 74],
    fixedMidis: [64, 69, 62, 67, 64, 60],
    impostorIndex: 5,
    explanation: 'Chữ "niệm" mang dấu Nặng kết câu phải hạ thấp hơn "kỷ" (từ E4 xuống C4), nhảy lên D5 sẽ bị cưỡng âm thành "kỷ niếm"!',
  },
];

const CHORD_POOLS = {
  triads: [
    { symbol: 'C', label: 'C Trưởng (C – E – G)', hint: 'Công thức 0 – 4 – 7 từ C', pitchClasses: [0, 4, 7], guideMidis: [60, 64, 67], preferFlats: false },
    { symbol: 'Am', label: 'Am Thứ (A – C – E)', hint: 'Công thức 0 – 3 – 7 từ A', pitchClasses: [9, 0, 4], guideMidis: [57, 60, 64], preferFlats: false },
    { symbol: 'Fm', label: 'Fm Thứ (F – Ab – C)', hint: 'Công thức 0 – 3 – 7 từ F (3 nấc gặp Ab)', pitchClasses: [5, 8, 0], guideMidis: [53, 56, 60], preferFlats: true },
    { symbol: 'G', label: 'G Trưởng (G – B – D)', hint: 'Công thức 0 – 4 – 7 từ G', pitchClasses: [7, 11, 2], guideMidis: [55, 59, 62], preferFlats: false },
    { symbol: 'Dm', label: 'Dm Thứ (D – F – A)', hint: 'Công thức 0 – 3 – 7 từ D', pitchClasses: [2, 5, 9], guideMidis: [62, 65, 69], preferFlats: false },
    { symbol: 'Eb', label: 'Eb Trưởng (Eb – G – Bb)', hint: 'Công thức 0 – 4 – 7 từ Eb', pitchClasses: [3, 7, 10], guideMidis: [63, 67, 70], preferFlats: true },
    { symbol: 'Bdim', label: 'B Giảm (B – D – F)', hint: 'Công thức 0 – 3 – 6 từ B', pitchClasses: [11, 2, 5], guideMidis: [59, 62, 65], preferFlats: false },
  ],
  inversions: [
    { symbol: 'C/E', label: 'C Đảo 1 · Bass E (E – G – C)', hint: 'Bấm đủ C, E, G nhưng chọn nốt thấp nhất là E', pitchClasses: [0, 4, 7], requiredBassPc: 4, guideMidis: [52, 55, 60], preferFlats: false },
    { symbol: 'F/C', label: 'F Đảo 2 · Bass C (C – F – A)', hint: 'Giữ nốt C ở dưới đáy cùng F và A ở trên', pitchClasses: [5, 9, 0], requiredBassPc: 0, guideMidis: [60, 65, 69], preferFlats: false },
    { symbol: 'G/B', label: 'G Đảo 1 · Bass B (B – D – G)', hint: 'Đặt nốt B thấp nhất, rồi D và G bên trên', pitchClasses: [7, 11, 2], requiredBassPc: 11, guideMidis: [59, 62, 67], preferFlats: false },
    { symbol: 'Am/C', label: 'Am Đảo 1 · Bass C (C – E – A)', hint: 'Thế đảo của Am với nốt đáy là C', pitchClasses: [9, 0, 4], requiredBassPc: 0, guideMidis: [60, 64, 69], preferFlats: false },
    { symbol: 'C/G', label: 'C Đảo 2 · Bass G (G – C – E)', hint: 'Thế đảo 2 của C với G làm nốt trầm', pitchClasses: [0, 4, 7], requiredBassPc: 7, guideMidis: [55, 60, 64], preferFlats: false },
  ],
  modern7: [
    { symbol: 'Fm7', label: 'Fm7 (F – Ab – C – Eb)', hint: 'Công thức 0 – 3 – 7 – 10 từ F', pitchClasses: [5, 8, 0, 3], guideMidis: [53, 56, 60, 63], preferFlats: true },
    { symbol: 'Bb7', label: 'Bb7 (Bb – D – F – Ab)', hint: 'Công thức 0 – 4 – 7 – 10 từ Bb', pitchClasses: [10, 2, 5, 8], guideMidis: [58, 62, 65, 68], preferFlats: true },
    { symbol: 'Ebmaj7', label: 'Ebmaj7 (Eb – G – Bb – D)', hint: 'Công thức 0 – 4 – 7 – 11 từ Eb', pitchClasses: [3, 7, 10, 2], guideMidis: [51, 55, 58, 62], preferFlats: true },
    { symbol: 'Cm7', label: 'Cm7 (C – Eb – G – Bb)', hint: 'Công thức 0 – 3 – 7 – 10 từ C', pitchClasses: [0, 3, 7, 10], guideMidis: [48, 51, 55, 58], preferFlats: true },
    { symbol: 'Gsus4', label: 'Gsus4 (G – C – D)', hint: 'Công thức treo 0 – 5 – 7 từ G', pitchClasses: [7, 0, 2], guideMidis: [55, 60, 62], preferFlats: false },
    { symbol: 'Cadd9', label: 'Cadd9 (C – E – G – D)', hint: 'Hợp âm C thêm nốt bậc 2/9 (D)', pitchClasses: [0, 4, 7, 2], guideMidis: [60, 64, 67, 74], preferFlats: false },
  ],
};

const PUZZLE_SETS = {
  roman: [
    {
      title: 'Hoàn thiện vòng Pop I – V – vi – [ ? ] ở tông C Trưởng',
      prompt: 'Ba ô đầu đang là: C (I) – G (V) – Am (vi). Ô 4 cần hợp âm Trưởng bậc IV để nâng đỡ trước khi quay lại C.',
      keyPc: 0,
      scaleType: 'major',
      bpm: 80,
      givenBars: [
        { symbol: 'C', roman: 'I', midis: [48, 60, 64, 67], spec: { custom: false, degree: 0, extension: 'triad' } },
        { symbol: 'G', roman: 'V', midis: [55, 59, 62, 67], spec: { custom: false, degree: 4, extension: 'triad' } },
        { symbol: 'Am', roman: 'vi', midis: [57, 60, 64, 69], spec: { custom: false, degree: 5, extension: 'triad' } },
      ],
      candidates: [
        { id: 'f', symbol: 'F', roman: 'IV', midis: [53, 60, 65, 69], spec: { custom: false, degree: 3, extension: 'triad' }, desc: 'Bậc IV Trưởng · Mở sáng và nâng vòng lặp cực mượt' },
        { id: 'dm', symbol: 'Dm', roman: 'ii', midis: [50, 57, 62, 65], spec: { custom: false, degree: 1, extension: 'triad' }, desc: 'Bậc ii Thứ · Trầm hơn' },
        { id: 'em', symbol: 'Em', roman: 'iii', midis: [52, 59, 64, 67], spec: { custom: false, degree: 2, extension: 'triad' }, desc: 'Bậc iii Thứ · Hơi nhẹ quá khi kết vòng' },
      ],
      answerId: 'f',
      explanation: 'Trong C Trưởng, bậc IV chính là F Trưởng [F – A – C], khép trọn bộ tứ quốc dân C – G – Am – F (I – V – vi – IV)!',
    },
    {
      title: 'Dịch cùng công thức I – V – vi – IV sang tông Eb Trưởng',
      prompt: 'Đổi sang tông Eb: Eb (I) – Bb (V) – Cm (vi) – [ ? ]. Tìm hợp âm bậc IV của Eb Trưởng!',
      keyPc: 3,
      scaleType: 'major',
      bpm: 78,
      givenBars: [
        { symbol: 'Eb', roman: 'I', midis: [51, 58, 63, 67], spec: { custom: false, degree: 0, extension: 'triad' } },
        { symbol: 'Bb', roman: 'V', midis: [58, 62, 65, 70], spec: { custom: false, degree: 4, extension: 'triad' } },
        { symbol: 'Cm', roman: 'vi', midis: [48, 58, 63, 67], spec: { custom: false, degree: 5, extension: 'triad' } },
      ],
      candidates: [
        { id: 'ab', symbol: 'Ab', roman: 'IV', midis: [56, 60, 63, 68], spec: { custom: false, degree: 3, extension: 'triad' }, desc: 'Bậc IV của Eb là Ab (đếm từ Eb lên 5 bán cung)' },
        { id: 'fm', symbol: 'Fm', roman: 'ii', midis: [53, 56, 60, 63], spec: { custom: false, degree: 1, extension: 'triad' }, desc: 'Bậc ii của Eb là Fm' },
        { id: 'gm', symbol: 'Gm', roman: 'iii', midis: [55, 58, 62, 67], spec: { custom: false, degree: 2, extension: 'triad' }, desc: 'Bậc iii của Eb là Gm' },
      ],
      answerId: 'ab',
      explanation: 'Âm giai Eb gồm [Eb – F – G – Ab – Bb – C – D], nên bậc 4 (IV) chính xác là Ab Trưởng!',
    },
  ],
  tension: [
    {
      title: 'Hút căng về Chủ âm: C – Am – F – [ ? ]',
      prompt: 'Đoạn kết ô 4 muốn tạo cảm giác HÚT MẠNH và căng thẳng buộc người nghe chờ vỡ òa về C ở ô đầu.',
      keyPc: 0,
      scaleType: 'major',
      bpm: 80,
      givenBars: [
        { symbol: 'Cmaj7', roman: 'Imaj7', midis: [48, 59, 64, 67], spec: { custom: false, degree: 0, extension: 'maj7' } },
        { symbol: 'Am7', roman: 'vi7', midis: [57, 60, 64, 67], spec: { custom: false, degree: 5, extension: 'm7' } },
        { symbol: 'Fmaj7', roman: 'IVmaj7', midis: [53, 60, 64, 69], spec: { custom: false, degree: 3, extension: 'maj7' } },
      ],
      candidates: [
        { id: 'g7', symbol: 'G7', roman: 'V7', midis: [55, 59, 62, 65], spec: { custom: false, degree: 4, extension: '7' }, desc: 'Bậc V7 Át · Chứa hai nốt hút mạnh nhất về C!' },
        { id: 'em7', symbol: 'Em7', roman: 'iii7', midis: [52, 59, 62, 67], spec: { custom: false, degree: 2, extension: 'm7' }, desc: 'Bậc iii7 · Mơ màng nhưng lực hút yếu' },
        { id: 'c', symbol: 'C', roman: 'I', midis: [48, 60, 64, 67], spec: { custom: false, degree: 0, extension: 'triad' }, desc: 'Đứng yên tại I · Chưa tạo kịch tính chuyển đoạn' },
      ],
      answerId: 'g7',
      explanation: 'G7 (V7) chứa quãng tam cung [B – F] luôn muốn thu gọn về [C – E] của hợp âm Chủ âm C!',
    },
    {
      title: 'Mở đường mượt kiểu Jazz/R&B: Cmaj7 – [ ? ] – G7 -> về C',
      prompt: 'Đứng giữa Cmaj7 và G7 (V7), bậc Hạ át nào hay được chọn nhất để tạo bộ ba ii7 – V7 – I huyền thoại?',
      keyPc: 0,
      scaleType: 'major',
      bpm: 82,
      givenBars: [
        { symbol: 'Cmaj7', roman: 'Imaj7', midis: [48, 59, 64, 67], spec: { custom: false, degree: 0, extension: 'maj7' } },
        { symbol: 'Am7', roman: 'vi7', midis: [57, 60, 64, 67], spec: { custom: false, degree: 5, extension: 'm7' } },
        { symbol: 'G7', roman: 'V7', midis: [55, 59, 62, 65], spec: { custom: false, degree: 4, extension: '7' } },
      ],
      candidates: [
        { id: 'dm7', symbol: 'Dm7', roman: 'ii7', midis: [50, 57, 60, 65], spec: { custom: false, degree: 1, extension: 'm7' }, desc: 'Bậc ii7 · Mảnh ghép chuẩn của bộ ii7 – V7 – I' },
        { id: 'bm7b5', symbol: 'Bm7b5', roman: 'viiø7', midis: [59, 62, 65, 69], spec: { custom: false, degree: 6, extension: 'm7' }, desc: 'Nửa giảm · Hơi gắt cho Pop dịu' },
        { id: 'c6', symbol: 'C', roman: 'I', midis: [48, 60, 64, 67], spec: { custom: false, degree: 0, extension: 'triad' }, desc: 'Quay vòng quá sớm' },
      ],
      answerId: 'dm7',
      explanation: 'Dm7 (ii7) là bước đệm mượt nhất đi sang G7 (V7) trước khi giải tỏa về Cmaj7 (Imaj7)!',
    },
  ],
  classic4: [
    {
      title: 'Giải mã vòng Neo-Soul Eb: Fm7 – Bb7 – Ebmaj7 – [ ? ]',
      prompt: 'Sau Ebmaj7 (Imaj7) sang trọng, chọn hợp âm thứ song song nào để mở tiếp vòng lặp "Hoài niệm, sâu lắng"?',
      keyPc: 3,
      scaleType: 'major',
      bpm: 78,
      givenBars: [
        { symbol: 'Fm7', roman: 'ii7', midis: [53, 56, 60, 63], spec: { custom: false, degree: 1, extension: 'm7' } },
        { symbol: 'Bb7', roman: 'V7', midis: [58, 62, 65, 68], spec: { custom: false, degree: 4, extension: '7' } },
        { symbol: 'Ebmaj7', roman: 'Imaj7', midis: [51, 55, 58, 62], spec: { custom: false, degree: 0, extension: 'maj7' } },
      ],
      candidates: [
        { id: 'cm7', symbol: 'Cm7', roman: 'vi7', midis: [48, 55, 58, 63], spec: { custom: false, degree: 5, extension: 'm7' }, desc: 'Bậc vi7 (Tông song song) · Hoài niệm và nối cực êm về Fm7!' },
        { id: 'eb', symbol: 'Eb', roman: 'I', midis: [51, 58, 63, 67], spec: { custom: false, degree: 0, extension: 'triad' }, desc: 'Lặp lại bậc I làm vòng bị đứng yên' },
        { id: 'gm7', symbol: 'Gm7', roman: 'iii7', midis: [55, 58, 62, 65], spec: { custom: false, degree: 2, extension: 'm7' }, desc: 'Bậc iii7 · Chuyển sang Fm7 kém tự nhiên hơn Cm7' },
      ],
      answerId: 'cm7',
      explanation: 'Cm7 (vi7) nối với Fm7 (ii7) bằng bước quãng 4 lên (C → F) rất đẹp, hoàn thiện vòng Neo-Soul Fm7 – Bb7 – Ebmaj7 – Cm7.',
    },
    {
      title: 'Ballad Á Đông / V-Pop: F – G – Em – [ ? ]',
      prompt: 'Từ IV (F) → V (G) → iii (Em), hợp âm nào ở ô 4 là điểm rơi cảm xúc sâu lắng nhất của các bản Hit Ballad?',
      keyPc: 0,
      scaleType: 'major',
      bpm: 74,
      givenBars: [
        { symbol: 'Fmaj7', roman: 'IVmaj7', midis: [53, 60, 64, 69], spec: { custom: false, degree: 3, extension: 'maj7' } },
        { symbol: 'G', roman: 'V', midis: [55, 59, 62, 67], spec: { custom: false, degree: 4, extension: 'triad' } },
        { symbol: 'Em7', roman: 'iii7', midis: [52, 59, 62, 67], spec: { custom: false, degree: 2, extension: 'm7' } },
      ],
      candidates: [
        { id: 'am7', symbol: 'Am7', roman: 'vi7', midis: [57, 60, 64, 67], spec: { custom: false, degree: 5, extension: 'm7' }, desc: 'Bậc vi7 (Am7) · Điểm rơi sâu lắng hoàn hảo của IV–V–iii–vi' },
        { id: 'dm', symbol: 'Dm', roman: 'ii', midis: [50, 57, 62, 65], spec: { custom: false, degree: 1, extension: 'triad' }, desc: 'Bậc ii · Rời rạc sau Em7' },
        { id: 'g', symbol: 'G', roman: 'V', midis: [55, 59, 62, 67], spec: { custom: false, degree: 4, extension: 'triad' }, desc: 'Quay ngược lại V khiến câu bị lặp' },
      ],
      answerId: 'am7',
      explanation: 'Vòng IV – V – iii – vi (Fmaj7 – G – Em7 – Am7) là "vòng Ballad Á Đông" gây nghiện bậc nhất trong V-Pop & K-Pop!',
    },
  ],
};

const CALL_RESPONSE_PRESETS = {
  'neosoul-eb': {
    id: 'neosoul-eb',
    name: 'Neo-Soul Eb Trưởng: Fm7 – Bb7 – Ebmaj7 – Cm7',
    keyPc: 3,
    scaleType: 'major',
    preferFlats: true,
    bpm: 78,
    // 11 nốt theo thứ tự từ cao xuống thấp thuộc thang Eb Major [Bb4..D5..Eb5..G5?] -> Eb4..Ab5
    pitchRows: [77, 75, 74, 72, 70, 68, 67, 65, 63, 62, 60], // F5, Eb5, D5, C5, Bb4, Ab4, G4, F4, Eb4, D4, C4
    chords: [
      { symbol: 'Fm7', roman: 'ii7', pcs: new Set([5, 8, 0, 3]), midis: [53, 56, 60, 63], spec: { custom: false, degree: 1, extension: 'm7' } },
      { symbol: 'Bb7', roman: 'V7', pcs: new Set([10, 2, 5, 8]), midis: [58, 62, 65, 68], spec: { custom: false, degree: 4, extension: '7' } },
      { symbol: 'Ebmaj7', roman: 'Imaj7', pcs: new Set([3, 7, 10, 2]), midis: [51, 55, 58, 62], spec: { custom: false, degree: 0, extension: 'maj7' } },
      { symbol: 'Cm7', roman: 'vi7', pcs: new Set([0, 3, 7, 10]), midis: [48, 51, 55, 58], spec: { custom: false, degree: 5, extension: 'm7' } },
    ],
    // Steps 0..15 (Ô 1 & Ô 2 khóa cứng làm Câu Hỏi)
    questionNotes: [
      { step: 0, midi: 68 },  // Ab4 (Fm7)
      { step: 2, midi: 67 },  // G4
      { step: 4, midi: 72 },  // C5 (Fm7)
      { step: 6, midi: 70 },  // Bb4
      { step: 8, midi: 68 },  // Ab4 (Bb7)
      { step: 10, midi: 65 }, // F4 (Bb7)
      { step: 12, midi: 70 }, // Bb4 -> hỏi lên lửng
    ],
    sampleResponse: [
      { step: 16, midi: 67 }, // G4 (Ebmaj7 chord tone)
      { step: 18, midi: 70 }, // Bb4
      { step: 20, midi: 74 }, // D5 (Ebmaj7 chord tone)
      { step: 22, midi: 72 }, // C5
      { step: 24, midi: 70 }, // Bb4 (Cm7)
      { step: 26, midi: 67 }, // G4 (Cm7)
      { step: 28, midi: 63 }, // Eb4 -> kết gọn
    ],
  },
  'pop-c': {
    id: 'pop-c',
    name: 'Pop Ballad C Trưởng: C – G – Am – F',
    keyPc: 0,
    scaleType: 'major',
    preferFlats: false,
    bpm: 82,
    pitchRows: [76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59], // E5..B3
    chords: [
      { symbol: 'C', roman: 'I', pcs: new Set([0, 4, 7]), midis: [48, 60, 64, 67], spec: { custom: false, degree: 0, extension: 'triad' } },
      { symbol: 'G', roman: 'V', pcs: new Set([7, 11, 2]), midis: [55, 59, 62, 67], spec: { custom: false, degree: 4, extension: 'triad' } },
      { symbol: 'Am', roman: 'vi', pcs: new Set([9, 0, 4]), midis: [57, 60, 64, 69], spec: { custom: false, degree: 5, extension: 'triad' } },
      { symbol: 'F', roman: 'IV', pcs: new Set([5, 9, 0]), midis: [53, 57, 60, 65], spec: { custom: false, degree: 3, extension: 'triad' } },
    ],
    questionNotes: [
      { step: 0, midi: 64 },  // E4 (C)
      { step: 2, midi: 67 },  // G4
      { step: 4, midi: 72 },  // C5
      { step: 6, midi: 71 },  // B4
      { step: 8, midi: 71 },  // B4 (G)
      { step: 10, midi: 69 }, // A4
      { step: 12, midi: 67 }, // G4 (G)
    ],
    sampleResponse: [
      { step: 16, midi: 69 }, // A4 (Am)
      { step: 18, midi: 72 }, // C5
      { step: 20, midi: 76 }, // E5 (Am chord tone)
      { step: 22, midi: 74 }, // D5
      { step: 24, midi: 72 }, // C5 (F)
      { step: 26, midi: 69 }, // A4
      { step: 28, midi: 67 }, // G4
    ],
  },
  'vpop-c': {
    id: 'vpop-c',
    name: 'Ballad Á Đông C Trưởng: Fmaj7 – G – Em7 – Am7',
    keyPc: 0,
    scaleType: 'major',
    preferFlats: false,
    bpm: 76,
    pitchRows: [76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59],
    chords: [
      { symbol: 'Fmaj7', roman: 'IVmaj7', pcs: new Set([5, 9, 0, 4]), midis: [53, 57, 60, 64], spec: { custom: false, degree: 3, extension: 'maj7' } },
      { symbol: 'G', roman: 'V', pcs: new Set([7, 11, 2]), midis: [55, 59, 62, 67], spec: { custom: false, degree: 4, extension: 'triad' } },
      { symbol: 'Em7', roman: 'iii7', pcs: new Set([4, 7, 11, 2]), midis: [52, 59, 62, 67], spec: { custom: false, degree: 2, extension: 'm7' } },
      { symbol: 'Am7', roman: 'vi7', pcs: new Set([9, 0, 4, 7]), midis: [57, 60, 64, 67], spec: { custom: false, degree: 5, extension: 'm7' } },
    ],
    questionNotes: [
      { step: 0, midi: 69 },  // A4
      { step: 2, midi: 72 },  // C5
      { step: 4, midi: 76 },  // E5 (Fmaj7 7th!)
      { step: 6, midi: 74 },  // D5
      { step: 8, midi: 74 },  // D5 (G)
      { step: 10, midi: 71 }, // B4
      { step: 12, midi: 67 }, // G4
    ],
    sampleResponse: [
      { step: 16, midi: 67 }, // G4 (Em7)
      { step: 18, midi: 71 }, // B4
      { step: 20, midi: 74 }, // D5
      { step: 22, midi: 72 }, // C5
      { step: 24, midi: 72 }, // C5 (Am7)
      { step: 26, midi: 69 }, // A4
      { step: 28, midi: 64 }, // E4
    ],
  },
};

export class TheoryExerciseRunner {
  constructor(
    containerEl,
    {
      lesson,
      audioEngine,
      midiController,
      onComplete,
      onOpenWaitMode,
      onOpenFallingHook,
      onExportToStudio,
      onBackToLesson,
      onNextLesson,
      showToast,
    }
  ) {
    this.container = containerEl;
    this.lesson = lesson;
    this.ex = lesson.exercise;
    this.audio = audioEngine;
    this.midi = midiController;
    this.cb = {
      onComplete: onComplete || (() => {}),
      onOpenWaitMode: onOpenWaitMode || (() => {}),
      onOpenFallingHook: onOpenFallingHook || (() => {}),
      onExportToStudio: onExportToStudio || (() => {}),
      onBackToLesson: onBackToLesson || (() => {}),
      onNextLesson: onNextLesson || (() => {}),
      showToast: showToast || (() => {}),
    };

    this._destroyed = false;
    this._timers = [];
    this._rafId = null;
    this._windowKeyHandler = null;
    this._keyElByMidi = new Map();
    this._prevChordLatch = null;

    this.state = { finished: false, scorePct: 0 };
    this._initExerciseState();
    this.render();
  }

  usesKeyboard() {
    const t = this.ex?.type;
    return t === 'note-finder' || t === 'scale-runner' || t === 'chord-builder' || t === 'call-response-lab';
  }

  _clearTimers() {
    this._timers.forEach((id) => clearTimeout(id));
    this._timers = [];
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _unbindWindowKey() {
    if (this._windowKeyHandler) {
      window.removeEventListener('keydown', this._windowKeyHandler);
      this._windowKeyHandler = null;
    }
  }

  destroy() {
    this._destroyed = true;
    this._clearTimers();
    this._unbindWindowKey();
    if (this._prevChordLatch !== null && this.midi) {
      this.midi.setChordLatch(this._prevChordLatch);
      this._prevChordLatch = null;
    }
  }

  onResize() {
    if (this.ex?.type === 'groove-tapper') {
      this._drawGrooveCanvas();
    }
  }

  onMidiOctaveChange() {
    if (!this.usesKeyboard()) return;
    if (this.ex?.type === 'note-finder' || this.ex?.type === 'scale-runner' || this.ex?.type === 'chord-builder') {
      this.render();
    }
  }

  _initExerciseState() {
    const type = this.ex.type;
    const cfg = this.ex.config || {};

    if (type === 'note-finder') {
      const rounds = cfg.rounds || 10;
      const items = this._generateNoteFinderQuestions(cfg.mode || 'notes', rounds);
      this.state = {
        finished: false,
        scorePct: 0,
        items,
        idx: 0,
        correct: 0,
        wrong: 0,
        streak: 0,
        feedback: null,
        locked: false,
      };
    } else if (type === 'interval-ear') {
      const rounds = cfg.rounds || 8;
      const items = [];
      let prevId = null;
      for (let i = 0; i < rounds; i++) {
        const pool = INTERVAL_BANK.filter((iv) => iv.id !== prevId);
        const pick = pool[Math.floor(Math.random() * pool.length)];
        prevId = pick.id;
        const root = 55 + Math.floor(Math.random() * 11);
        items.push({ root, targetMidi: root + pick.semis, interval: pick });
      }
      this.state = {
        finished: false,
        scorePct: 0,
        items,
        idx: 0,
        correct: 0,
        wrong: 0,
        answered: false,
        selectedId: null,
      };
    } else if (type === 'groove-tapper') {
      const pat = GROOVE_PATTERNS[cfg.patternId] || GROOVE_PATTERNS['quarter-44'];
      this.state = {
        finished: false,
        scorePct: 0,
        pattern: pat,
        bpm: cfg.bpm || 84,
        phase: 'idle', // 'idle' | 'countin' | 'running' | 'done'
        countInNum: 4,
        startPerfMs: 0,
        playheadBeat: 0,
        loopNum: 0,
        totalLoops: 2,
        targetSlots: [], // { beatAbs, matched, rating, diffMs }
        extraWrongTaps: 0,
        lastMsg: 'Nhấn Bắt đầu → Nghe đếm ngược 4 phách → Gõ Space hoặc nút GÕ NHỊP',
      };
    } else if (type === 'scale-runner') {
      const ids = cfg.presetScales || ['c-major', 'a-minor'];
      const scales = ids.map((id) => SCALE_PRESETS[id] || SCALE_PRESETS['c-major']);
      this.state = {
        finished: false,
        scorePct: 0,
        scales,
        scaleIdx: 0,
        seqMidis: [],
        stepPos: 0,
        correctSteps: 0,
        wrongSteps: 0,
        feedback: null,
      };
      this._buildScaleRunnerSeq();
    } else if (type === 'impostor-note') {
      const rounds = cfg.mode === 'viet-tone' ? VIET_TONE_IMPOSTOR_ROUNDS : SCALE_IMPOSTOR_ROUNDS;
      this.state = {
        finished: false,
        scorePct: 0,
        mode: cfg.mode || 'scale',
        rounds,
        idx: 0,
        correct: 0,
        wrong: 0,
        answered: false,
        pickedIdx: -1,
        playingStep: -1,
      };
    } else if (type === 'chord-builder') {
      const pool = CHORD_POOLS[cfg.poolId || 'triads'] || CHORD_POOLS.triads;
      // Tự bật Chord Latch trên chuột PC khi chưa cắm đàn MIDI thật
      if (this.midi && !this.midi.getDeviceStatus().connected && !this.midi.chordLatchEnabled) {
        this._prevChordLatch = false;
        this.midi.setChordLatch(true);
      }
      this.state = {
        finished: false,
        scorePct: 0,
        pool,
        idx: 0,
        correct: 0,
        attempts: 0,
        mode: 'practice', // 'practice' | 'challenge'
        showHintKeys: false,
        locked: false,
        feedback: null,
      };
    } else if (type === 'progression-puzzle') {
      const items = PUZZLE_SETS[cfg.setId || 'classic4'] || PUZZLE_SETS.classic4;
      this.state = {
        finished: false,
        scorePct: 0,
        items,
        idx: 0,
        correct: 0,
        wrong: 0,
        answered: false,
        pickedId: null,
      };
    } else if (type === 'call-response-lab') {
      const presetKey = cfg.presetId && CALL_RESPONSE_PRESETS[cfg.presetId] ? cfg.presetId : 'neosoul-eb';
      this.state = {
        finished: false,
        scorePct: 0,
        presetKey,
        preset: CALL_RESPONSE_PRESETS[presetKey],
        responseNotes: [], // { step: 16..31, midi }
        playStep: -1,
        isPlaying: false,
        midiCursorStep: 16,
      };
    }
  }

  _generateNoteFinderQuestions(mode, count) {
    const baseMidi = this.midi ? this.midi.baseMidi : 48;
    const minM = Math.max(baseMidi + 12, 60); // quãng giữa QWERTY dễ bấm nhất
    const maxM = Math.min(baseMidi + 23, 76);
    const out = [];
    let prevM = -1;

    for (let i = 0; i < count; i++) {
      let target = minM + Math.floor(Math.random() * (maxM - minM + 1));
      if (target === prevM) target = minM + ((target - minM + 3) % (maxM - minM + 1));
      prevM = target;

      if (mode === 'steps') {
        const deltas = [1, 2, 3, 4, -1, -2];
        const d = deltas[i % deltas.length];
        const anchor = clamp(target - d, baseMidi + 4, baseMidi + 30);
        const actualTarget = anchor + d;
        const anchorName = midiToNoteName(anchor, d < 0);
        const dirText = d > 0 ? `CAO hơn ${anchorName}` : `THẤP hơn ${anchorName}`;
        const absD = Math.abs(d);
        const stepLabel =
          absD === 1
            ? '1 nửa cung'
            : absD === 2
              ? '1 cung (2 nửa cung)'
              : `${absD} nửa cung`;
        out.push({
          prompt: `Bấm phím ${dirText} đúng ${stepLabel}`,
          targetMidi: actualTarget,
          anchorMidi: anchor,
          targetLabel: midiToNoteName(actualTarget, absD % 2 === 1),
        });
      } else {
        const useFlats = i % 3 === 1;
        const name = midiToNoteName(target, useFlats);
        out.push({
          prompt: `Tìm và bấm đúng phím nốt ${name}`,
          targetMidi: target,
          anchorMidi: null,
          targetLabel: name,
        });
      }
    }
    return out;
  }

  _buildScaleRunnerSeq() {
    const sc = this.state.scales[this.state.scaleIdx];
    const baseMidi = this.midi ? this.midi.baseMidi : 48;
    let root = sc.rootMidi;
    while (root < baseMidi) root += 12;
    while (root + 12 > baseMidi + 35) root -= 12;
    const up = sc.intervals.map((iv) => root + iv);
    const down = [...up].reverse().slice(1);
    this.state.seqMidis = [...up, ...down];
    this.state.stepPos = 0;
  }

  _finishExercise(scorePct) {
    const pct = clamp(Math.round(scorePct), 0, 100);
    this.state.finished = true;
    this.state.scorePct = pct;
    const res = this.cb.onComplete(pct);
    this._syncBannerAndFinish(res);
    this.render();
  }

  _syncBannerAndFinish(res) {
    if (res && res.newlyCompleted) {
      this.cb.showToast(`Xuất sắc! Bạn đã hoàn thành ${this.lesson.code} với ${res.accuracyPct}%!`);
    }
  }

  _renderFinishPanelHtml() {
    const pct = this.state.scorePct;
    const passed = pct >= 80;
    return `
      <div class="ex-finish-card ${passed ? 'is-pass' : 'is-retry'}">
        <div class="ex-finish-head">
          <span class="ex-finish-badge">${passed ? '✓ ĐÃ HOÀN THÀNH BÀI HỌC' : 'CHƯA ĐẠT MỐC 80%'}</span>
          <strong class="ex-finish-score mono-val">${pct}%</strong>
        </div>
        <p class="ex-finish-msg">
          ${
            passed
              ? 'Kiến thức đã được lưu vào tiến độ Học viện! Bạn có thể làm lại để phá kỷ lục hoặc bước tiếp sang bài kế tiếp.'
              : 'Mỗi lần sai giúp đôi tai và ngón tay nhớ lâu hơn. Bấm Làm lại ngay để vượt mốc 80% nhận tick xanh nhé!'
          }
        </p>
        <div class="ex-finish-actions">
          <button type="button" id="ex-btn-retry" class="btn btn-cyan-solid btn-xs">↺ Làm lại bài tập</button>
          <button type="button" id="ex-btn-back-lesson" class="btn btn-ghost btn-xs">← Đọc lại lý thuyết</button>
          <button type="button" id="ex-btn-next-lesson" class="btn btn-indigo-solid btn-xs">Bài học tiếp theo →</button>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // Xử lý Input chung từ Đàn MIDI USB, QWERTY, Multi-Touch & Chuột
  // ==========================================================================
  handleNoteOn(midi, velocity = 0.85) {
    if (this._destroyed || this.state.finished) return;
    const rounded = Math.round(midi);
    const t = this.ex.type;

    if (t === 'note-finder') {
      if (this.state.locked) return;
      const cur = this.state.items[this.state.idx];
      if (!cur) return;
      this.audio.trainerNoteOn(rounded, velocity, 'grand').catch(() => {});
      if (rounded === cur.targetMidi) {
        this.state.correct += 1;
        this.state.streak += 1;
        this.state.feedback = { ok: true, text: `Chuẩn xác! Chính là ${cur.targetLabel}` };
        this.state.locked = true;
        this._updateNoteFinderHudOnly();
        const tid = setTimeout(() => {
          if (this._destroyed) return;
          this.state.locked = false;
          this.state.idx += 1;
          this.state.feedback = null;
          if (this.state.idx >= this.state.items.length) {
            const totalTries = this.state.correct + this.state.wrong;
            const pct = totalTries > 0 ? Math.round((this.state.correct / totalTries) * 100) : 100;
            this._finishExercise(pct);
          } else {
            this.render();
          }
        }, 550);
        this._timers.push(tid);
      } else {
        this.state.wrong += 1;
        this.state.streak = 0;
        this.audio.playTrainerWrong().catch(() => {});
        const pressedName = midiToNoteName(rounded, false);
        this.state.feedback = { ok: false, text: `Chưa đúng (${pressedName}). Mục tiêu là ${cur.targetLabel}!` };
        this._updateNoteFinderHudOnly();
      }
      return;
    }

    if (t === 'groove-tapper') {
      this.audio.playTrainerClick(true).catch(() => {});
      this._handleGrooveTap();
      return;
    }

    if (t === 'scale-runner') {
      const targetMidi = this.state.seqMidis[this.state.stepPos];
      if (!Number.isFinite(targetMidi)) return;
      this.audio.trainerNoteOn(rounded, velocity, 'grand').catch(() => {});
      if (rounded === targetMidi) {
        this.state.correctSteps += 1;
        this.state.stepPos += 1;
        this.state.feedback = { ok: true, text: `Đúng ${midiToNoteName(rounded, this.state.scales[this.state.scaleIdx].preferFlats)}!` };
        if (this.state.stepPos >= this.state.seqMidis.length) {
          if (this.state.scaleIdx + 1 < this.state.scales.length) {
            this.state.scaleIdx += 1;
            this._buildScaleRunnerSeq();
            this.cb.showToast(`Tuyệt vời! Chuyển sang ${this.state.scales[this.state.scaleIdx].name}`);
            this.render();
          } else {
            const tot = this.state.correctSteps + this.state.wrongSteps;
            const pct = tot > 0 ? Math.round((this.state.correctSteps / tot) * 100) : 100;
            this._finishExercise(pct);
          }
          return;
        }
        this._syncScaleRunnerTargetUI();
      } else {
        this.state.wrongSteps += 1;
        this.audio.playTrainerWrong().catch(() => {});
        this.state.feedback = { ok: false, text: `Bấm ${midiToNoteName(rounded, false)} — Cần nốt ${midiToNoteName(targetMidi, this.state.scales[this.state.scaleIdx].preferFlats)}` };
        this._syncScaleRunnerTargetUI();
      }
      return;
    }

    if (t === 'chord-builder') {
      this.audio.trainerNoteOn(rounded, velocity, 'grand').catch(() => {});
      return;
    }

    if (t === 'call-response-lab') {
      this.audio.trainerNoteOn(rounded, velocity, 'grand').catch(() => {});
      // Nếu là phím MIDI thật hoặc bàn phím PC -> ghi nhanh vào Ô 3-4 theo con trỏ bước
      this._recordNoteIntoCallResponse(rounded);
    }
  }

  handleNoteOff(midi) {
    if (this._destroyed) return;
    this.audio.trainerNoteOff(midi);
  }

  handleActiveChange(snap) {
    if (this._destroyed || !this.usesKeyboard()) return;
    const activeSet = new Set(snap?.activeMidis || []);
    const latchSet = new Set(snap?.latchedMidis || []);

    this._keyElByMidi.forEach((el, midi) => {
      el.classList.toggle('is-active', activeSet.has(midi));
      el.classList.toggle('is-latched', latchSet.has(midi));
    });

    if (this.ex.type === 'chord-builder' && !this.state.finished && !this.state.locked) {
      this._evaluateChordBuilder(snap?.activeMidis || []);
    }
  }

  // ==========================================================================
  // Render tổng thể & gắn sự kiện bàn phím Hybrid dùng chung
  // ==========================================================================
  render() {
    if (!this.container || this._destroyed) return;
    this._clearTimers();
    this._unbindWindowKey();

    let innerHtml = '';
    const t = this.ex.type;
    if (this.state.finished) {
      innerHtml = this._renderFinishPanelHtml();
    } else if (t === 'note-finder') {
      innerHtml = this._renderNoteFinderHtml();
    } else if (t === 'interval-ear') {
      innerHtml = this._renderIntervalEarHtml();
    } else if (t === 'groove-tapper') {
      innerHtml = this._renderGrooveTapperHtml();
    } else if (t === 'scale-runner') {
      innerHtml = this._renderScaleRunnerHtml();
    } else if (t === 'impostor-note') {
      innerHtml = this._renderImpostorNoteHtml();
    } else if (t === 'chord-builder') {
      innerHtml = this._renderChordBuilderHtml();
    } else if (t === 'progression-puzzle') {
      innerHtml = this._renderProgressionPuzzleHtml();
    } else if (t === 'call-response-lab') {
      innerHtml = this._renderCallResponseLabHtml();
    }

    this.container.innerHTML = `
      <div class="ex-shell">
        <div class="ex-header">
          <div>
            <span class="ex-kicker">${escapeHtml(this.lesson.code)} · BÀI TẬP THỰC HÀNH (MỐC ĐẠT ≥ 80%)</span>
            <h2 class="ex-title">${escapeHtml(this.ex.title)}</h2>
            <p class="ex-desc">${escapeHtml(this.ex.desc)}</p>
          </div>
          <button type="button" id="ex-btn-top-back" class="btn btn-ghost btn-xs">← Đọc lại bài học</button>
        </div>
        ${innerHtml}
      </div>
    `;

    this._bindCommonEvents();
    this._bindSpecificEvents();
  }

  _renderHybridKeyboardHtml(options = {}) {
    const baseMidi = this.midi ? this.midi.baseMidi : 48;
    const totalSemis = 36;
    const keys = [];
    let whiteCount = 0;

    for (let i = 0; i < totalSemis; i++) {
      const midi = baseMidi + i;
      const pc = ((midi % 12) + 12) % 12;
      const isBlack = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
      const kbd = getQwertyLabelForMidi(midi, baseMidi);
      const noteLabel = pc === 0 ? midiToNoteName(midi, false) : midiToNoteName(midi, false).replace(/\d+$/, '');
      if (!isBlack) {
        keys.push({ midi, pc, isBlack: false, whiteIndex: whiteCount, kbd, noteLabel });
        whiteCount += 1;
      } else {
        keys.push({ midi, pc, isBlack: true, leftWhiteAnchor: whiteCount, kbd, noteLabel });
      }
    }

    const whiteW = 1 / whiteCount;
    const blackW = whiteW * 0.62;
    const scaleSet = options.scaleSet || null;
    const scaleRootPc = Number.isFinite(options.scaleRootPc) ? options.scaleRootPc : -1;
    const targetMidis = options.targetMidis || null;
    const anchorMidi = Number.isFinite(options.anchorMidi) ? options.anchorMidi : -1;

    const getExtraCls = (midi, pc) => {
      let c = '';
      if (scaleSet && scaleSet.has(pc)) c += ' in-scale';
      if (pc === scaleRootPc && scaleSet) c += ' scale-root';
      if (targetMidis && targetMidis.has(midi)) c += ' is-target';
      if (midi === anchorMidi) c += ' is-anchor';
      return c;
    };

    const whiteHtml = keys
      .filter((k) => !k.isBlack)
      .map(
        (k) => `
          <button type="button" class="h-key white${getExtraCls(k.midi, k.pc)}" data-midi="${k.midi}" data-pc="${k.pc}" aria-label="${midiToNoteName(k.midi, false)}">
            ${k.kbd ? `<span class="h-key-kbd desktop-only">${k.kbd}</span>` : ''}
            <span class="h-key-lbl${k.pc === 0 ? ' is-c' : ''}">${k.noteLabel}</span>
          </button>
        `
      )
      .join('');

    const blackHtml = keys
      .filter((k) => k.isBlack)
      .map((k) => {
        const leftPct = ((k.leftWhiteAnchor - 0.31) * whiteW * 100).toFixed(4);
        const widthPct = (blackW * 100).toFixed(4);
        return `
          <button type="button" class="h-key black${getExtraCls(k.midi, k.pc)}" data-midi="${k.midi}" data-pc="${k.pc}" style="left: ${leftPct}%; width: ${widthPct}%" aria-label="${midiToNoteName(k.midi, false)}"></button>
        `;
      })
      .join('');

    return `
      <div class="hybrid-kb-shell ex-kb-shell">
        <div class="mobile-kb-nav mobile-only" aria-label="Chuyển quãng trên Mobile">
          <div class="mobile-kb-oct-pills">
            <button type="button" class="btn-mini-pill" data-ex-kb-jump="0">Quãng thấp</button>
            <button type="button" class="btn-mini-pill active" data-ex-kb-jump="0.38">Quãng giữa</button>
            <button type="button" class="btn-mini-pill" data-ex-kb-jump="1">Quãng cao</button>
          </div>
          <input type="range" id="ex-mobile-kb-scroll" class="studio-range" min="0" max="100" value="38" aria-label="Cuộn ngang phím Piano" />
        </div>
        <div class="hybrid-kb-viewport" id="ex-kb-viewport">
          <div class="hybrid-piano-scroll-inner">
            <div id="ex-hybrid-keyboard" class="hybrid-piano-keyboard" role="application" aria-label="Đàn Piano thực hành">
              <div class="hybrid-white-row">${whiteHtml}</div>
              <div class="hybrid-black-row">${blackHtml}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _bindCommonEvents() {
    this.container.querySelector('#ex-btn-top-back')?.addEventListener('click', () => this.cb.onBackToLesson());
    this.container.querySelector('#ex-btn-retry')?.addEventListener('click', () => {
      this._initExerciseState();
      this.render();
    });
    this.container.querySelector('#ex-btn-back-lesson')?.addEventListener('click', () => this.cb.onBackToLesson());
    this.container.querySelector('#ex-btn-next-lesson')?.addEventListener('click', () => this.cb.onNextLesson());

    const kb = this.container.querySelector('#ex-hybrid-keyboard');
    this._keyElByMidi.clear();
    if (kb) {
      kb.querySelectorAll('.h-key[data-midi]').forEach((el) => {
        const m = Number(el.dataset.midi);
        if (Number.isFinite(m)) this._keyElByMidi.set(m, el);
      });
      kb.addEventListener('pointerdown', (e) => {
        const keyEl = e.target.closest('.h-key[data-midi]');
        if (!keyEl || !this.midi) return;
        if (e.cancelable) e.preventDefault();
        this.audio.unlockSync();
        try { keyEl.setPointerCapture(e.pointerId); } catch (_) {}
        this.midi.pointerNoteOn(e.pointerId, Number(keyEl.dataset.midi), 0.86);
      });
      const rel = (e) => {
        if (this.midi) this.midi.pointerNoteOff(e.pointerId);
      };
      kb.addEventListener('pointerup', rel);
      kb.addEventListener('pointercancel', rel);
      kb.addEventListener('lostpointercapture', rel);
    }

    const vp = this.container.querySelector('#ex-kb-viewport');
    const scroller = this.container.querySelector('#ex-mobile-kb-scroll');
    if (vp && scroller) {
      scroller.addEventListener('input', (e) => {
        const ratio = Number(e.target.value) / 100;
        const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth);
        vp.scrollLeft = Math.round(maxScroll * ratio);
      });
      this.container.querySelectorAll('[data-ex-kb-jump]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ratio = Number(btn.dataset.exKbJump) || 0;
          const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth);
          vp.scrollLeft = Math.round(maxScroll * ratio);
          scroller.value = String(Math.round(ratio * 100));
          this.container.querySelectorAll('[data-ex-kb-jump]').forEach((b) =>
            b.classList.toggle('active', b === btn)
          );
        });
      });
      if (window.innerWidth <= 768) {
        requestAnimationFrame(() => {
          const maxScroll = Math.max(0, vp.scrollWidth - vp.clientWidth);
          vp.scrollLeft = Math.round(maxScroll * 0.36);
          scroller.value = '36';
        });
      }
    }
  }

  _bindSpecificEvents() {
    const t = this.ex.type;
    if (this.state.finished) return;

    if (t === 'note-finder') this._bindNoteFinderEvents();
    else if (t === 'interval-ear') this._bindIntervalEarEvents();
    else if (t === 'groove-tapper') this._bindGrooveTapperEvents();
    else if (t === 'scale-runner') this._bindScaleRunnerEvents();
    else if (t === 'impostor-note') this._bindImpostorNoteEvents();
    else if (t === 'chord-builder') this._bindChordBuilderEvents();
    else if (t === 'progression-puzzle') this._bindProgressionPuzzleEvents();
    else if (t === 'call-response-lab') this._bindCallResponseEvents();
  }

  // ==========================================================================
  // 1. NOTE FINDER (Chặng 1.1 & 1.2)
  // ==========================================================================
  _renderNoteFinderHtml() {
    const s = this.state;
    const cur = s.items[s.idx];
    const tries = s.correct + s.wrong;
    const acc = tries > 0 ? Math.round((s.correct / tries) * 100) : 100;

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Câu <strong class="mono-val">${s.idx + 1}/${s.items.length}</strong></span>
          <span class="ex-stat-pill">Chuỗi đúng: <strong id="nf-streak" class="mono-val accent-emerald">${s.streak}</strong></span>
          <span class="ex-stat-pill">Độ chuẩn: <strong id="nf-acc" class="mono-val accent-amber">${acc}%</strong></span>
        </div>

        <div class="ex-prompt-box">
          <strong class="ex-prompt-big" id="nf-prompt">${escapeHtml(cur.prompt)}</strong>
          ${
            cur.anchorMidi !== null
              ? `<button type="button" id="btn-nf-play-anchor" class="btn btn-amber-outline btn-xs">🔊 Nghe nốt mốc (${midiToNoteName(cur.anchorMidi, false)})</button>`
              : ''
          }
        </div>

        <div id="nf-feedback" class="ex-feedback ${s.feedback ? (s.feedback.ok ? 'ok' : 'err') : 'idle'}">
          ${s.feedback ? escapeHtml(s.feedback.text) : 'Chạm phím trên đàn ảo, gõ QWERTY (Z–M / Q–U) hoặc bấm đàn MIDI thật.'}
        </div>

        ${this._renderHybridKeyboardHtml({ anchorMidi: cur.anchorMidi ?? -1 })}
      </div>
    `;
  }

  _updateNoteFinderHudOnly() {
    const s = this.state;
    const tries = s.correct + s.wrong;
    const acc = tries > 0 ? Math.round((s.correct / tries) * 100) : 100;
    const streakEl = this.container.querySelector('#nf-streak');
    const accEl = this.container.querySelector('#nf-acc');
    const fbEl = this.container.querySelector('#nf-feedback');
    if (streakEl) streakEl.textContent = String(s.streak);
    if (accEl) accEl.textContent = `${acc}%`;
    if (fbEl && s.feedback) {
      fbEl.className = `ex-feedback ${s.feedback.ok ? 'ok' : 'err'}`;
      fbEl.textContent = s.feedback.text;
    }
  }

  _bindNoteFinderEvents() {
    this.container.querySelector('#btn-nf-play-anchor')?.addEventListener('click', () => {
      const cur = this.state.items[this.state.idx];
      if (cur && cur.anchorMidi !== null) {
        this.audio.playTrainerPiano(cur.anchorMidi, 0.7, 0.82).catch(() => {});
      }
    });
  }

  // ==========================================================================
  // 2. INTERVAL EAR TRAINER (Chặng 1.3)
  // ==========================================================================
  _renderIntervalEarHtml() {
    const s = this.state;
    const cur = s.items[s.idx];
    const tries = s.correct + s.wrong;
    const acc = tries > 0 ? Math.round((s.correct / tries) * 100) : 100;

    const optsHtml = INTERVAL_BANK.map((iv) => {
      let cls = '';
      if (s.answered) {
        if (iv.id === cur.interval.id) cls = ' is-correct';
        else if (iv.id === s.selectedId) cls = ' is-wrong';
      }
      return `
        <button type="button" class="ear-opt-btn${cls}" data-ex-iv="${iv.id}" ${s.answered ? 'disabled' : ''}>
          <strong class="ear-opt-title">${escapeHtml(iv.label)}</strong>
          <span class="ear-opt-hint">${escapeHtml(iv.hint)}</span>
        </button>
      `;
    }).join('');

    const miniReveal = s.answered
      ? this._renderStaticMiniPianoHtml(cur.root - 2, cur.targetMidi + 2, [cur.root, cur.targetMidi], false)
      : '';

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Câu <strong class="mono-val">${s.idx + 1}/${s.items.length}</strong></span>
          <span class="ex-stat-pill">Đúng: <strong class="mono-val accent-emerald">${s.correct}</strong></span>
          <span class="ex-stat-pill">Độ chuẩn: <strong class="mono-val accent-amber">${acc}%</strong></span>
        </div>

        <div class="ex-play-row">
          <button type="button" id="btn-iv-slow" class="btn btn-amber-solid btn-xs">🔊 Nghe chậm</button>
          <button type="button" id="btn-iv-fast" class="btn btn-cyan-outline btn-xs">⚡ Nghe nhanh</button>
          <button type="button" id="btn-iv-harm" class="btn btn-indigo-outline btn-xs">🎹 Nghe chập (cùng lúc)</button>
          ${s.answered ? `<button type="button" id="btn-iv-next" class="btn btn-emerald-solid btn-xs">${s.idx + 1 >= s.items.length ? 'Xem kết quả →' : 'Câu tiếp theo →'}</button>` : ''}
        </div>

        <div class="ex-feedback ${s.answered ? (s.selectedId === cur.interval.id ? 'ok' : 'err') : 'idle'}">
          ${
            s.answered
              ? `<strong>${s.selectedId === cur.interval.id ? '✓ Chính xác!' : '✗ Chưa đúng — Đáp án:'}</strong> ${escapeHtml(cur.interval.label)} (${midiToNoteName(cur.root, false)} → ${midiToNoteName(cur.targetMidi, false)}) · ${escapeHtml(cur.interval.hint)}`
              : 'Bấm nghe rồi chọn đúng tên Quãng và sắc thái tương ứng bên dưới.'
          }
        </div>

        ${miniReveal}

        <div class="ear-options-grid">${optsHtml}</div>
      </div>
    `;
  }

  _playIntervalItem(mode = 'slow') {
    const cur = this.state.items[this.state.idx];
    if (!cur) return;
    this._clearTimers();
    this.audio.unlockSync();
    if (mode === 'harmonic') {
      this.audio.playTrainerChordPreview([cur.root, cur.targetMidi], 1.0, 0.8, 'grand').catch(() => {});
      return;
    }
    const gap = mode === 'fast' ? 240 : 520;
    this.audio.playTrainerPiano(cur.root, 0.5, 0.82).catch(() => {});
    const tid = setTimeout(() => {
      if (!this._destroyed) {
        this.audio.playTrainerPiano(cur.targetMidi, 0.78, 0.84).catch(() => {});
      }
    }, gap);
    this._timers.push(tid);
  }

  _bindIntervalEarEvents() {
    this.container.querySelector('#btn-iv-slow')?.addEventListener('click', () => this._playIntervalItem('slow'));
    this.container.querySelector('#btn-iv-fast')?.addEventListener('click', () => this._playIntervalItem('fast'));
    this.container.querySelector('#btn-iv-harm')?.addEventListener('click', () => this._playIntervalItem('harmonic'));
    this.container.querySelector('#btn-iv-next')?.addEventListener('click', () => {
      this.state.idx += 1;
      if (this.state.idx >= this.state.items.length) {
        const tot = this.state.correct + this.state.wrong;
        this._finishExercise(tot > 0 ? Math.round((this.state.correct / tot) * 100) : 100);
      } else {
        this.state.answered = false;
        this.state.selectedId = null;
        this.render();
        this._playIntervalItem('slow');
      }
    });

    this.container.querySelectorAll('[data-ex-iv]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.state.answered) return;
        const pick = btn.dataset.exIv;
        const cur = this.state.items[this.state.idx];
        const ok = pick === cur.interval.id;
        this.state.answered = true;
        this.state.selectedId = pick;
        if (ok) this.state.correct += 1;
        else {
          this.state.wrong += 1;
          this.audio.playTrainerWrong().catch(() => {});
        }
        this.render();
      });
    });
  }

  // ==========================================================================
  // 3. GROOVE TAPPER (Chặng 2.1, 2.2, 2.3 — Canvas dpr + Count-in + ms Delta)
  // ==========================================================================
  _renderGrooveTapperHtml() {
    const s = this.state;
    const isRunning = s.phase === 'countin' || s.phase === 'running';
    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Mẫu: <strong>${escapeHtml(s.pattern.title)}</strong></span>
          <span class="ex-stat-pill">Tốc độ: <strong class="mono-val">${s.bpm} BPM</strong></span>
          ${s.pattern.swingPct > 0 ? `<span class="ex-stat-pill accent-amber">Swing: <strong class="mono-val">${s.pattern.swingPct}%</strong></span>` : ''}
          <span class="ex-stat-pill">Chuẩn: <strong id="groove-acc" class="mono-val accent-emerald">—</strong></span>
        </div>

        <p class="ex-sub-hint">${escapeHtml(s.pattern.subtitle)}</p>

        <div class="groove-canvas-wrap">
          <canvas id="ex-groove-canvas" aria-label="Thanh nhịp Metronome trực quan"></canvas>
          <div id="groove-countin-badge" class="groove-countin-badge${s.phase === 'countin' ? '' : ' hidden'}">${s.countInNum}</div>
        </div>

        <div id="groove-feedback" class="ex-feedback idle">${escapeHtml(s.lastMsg)}</div>

        <div class="groove-controls-row">
          <button type="button" id="btn-groove-start" class="btn btn-amber-solid btn-xs">${isRunning ? '↺ Bắt đầu lại' : '▶ Bắt đầu Đếm nhịp (4-3-2-1)'}</button>
          <button type="button" id="btn-groove-tap" class="btn-groove-tap" ${s.phase === 'running' ? '' : 'disabled'}>
            🥁 GÕ NHỊP (SPACE)
          </button>
        </div>
      </div>
    `;
  }

  _bindGrooveTapperEvents() {
    this.container.querySelector('#btn-groove-start')?.addEventListener('click', () => {
      this._startGrooveSession();
    });

    const tapBtn = this.container.querySelector('#btn-groove-tap');
    tapBtn?.addEventListener('pointerdown', (e) => {
      if (e.cancelable) e.preventDefault();
      this.audio.unlockSync();
      this.audio.playTrainerClick(true).catch(() => {});
      this._handleGrooveTap();
    });

    this._windowKeyHandler = (e) => {
      if (this._destroyed || e.repeat) return;
      if (e.code === 'Space') {
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        if (this.state.phase === 'running') {
          this.audio.unlockSync();
          this.audio.playTrainerClick(true).catch(() => {});
          this._handleGrooveTap();
        } else if (this.state.phase === 'idle') {
          this._startGrooveSession();
        }
      }
    };
    window.addEventListener('keydown', this._windowKeyHandler);

    requestAnimationFrame(() => this._drawGrooveCanvas());
  }

  _startGrooveSession() {
    this._clearTimers();
    this.audio.unlockSync();
    const s = this.state;
    const beatMs = 60000 / s.bpm;

    s.targetSlots = [];
    for (let lp = 0; lp < s.totalLoops; lp++) {
      s.pattern.targets.forEach((tg) => {
        s.targetSlots.push({
          beatAbs: lp * 4 + tg.beat,
          barBeat: tg.beat,
          label: tg.label,
          matched: false,
          score: 0,
          diffMs: null,
          rating: null,
        });
      });
    }
    s.extraWrongTaps = 0;
    s.phase = 'countin';
    s.countInNum = 1;
    s.playheadBeat = 0;
    s.lastMsg = 'Nghe đếm ngược 4 phách chuẩn bị...';

    const countEl = this.container.querySelector('#groove-countin-badge');
    const tapBtn = this.container.querySelector('#btn-groove-tap');
    const startBtn = this.container.querySelector('#btn-groove-start');
    if (startBtn) startBtn.textContent = '↺ Bắt đầu lại';
    if (tapBtn) tapBtn.disabled = true;

    for (let b = 0; b < 4; b++) {
      const tid = setTimeout(() => {
        if (this._destroyed) return;
        s.countInNum = b + 1;
        this.audio.playTrainerClick(b === 0).catch(() => {});
        if (countEl) {
          countEl.textContent = String(b + 1);
          countEl.classList.remove('hidden');
        }
      }, b * beatMs);
      this._timers.push(tid);
    }

    const startTid = setTimeout(() => {
      if (this._destroyed) return;
      s.phase = 'running';
      s.startPerfMs = performance.now();
      if (countEl) countEl.classList.add('hidden');
      if (tapBtn) tapBtn.disabled = false;
      this._setGrooveFeedback('idle', 'Gõ đều ngay khi vạch sáng đi qua điểm mục tiêu!');

      // Phát tiếng click metronome cho 8 phách thực hành
      const totalBeats = s.totalLoops * 4;
      for (let b = 0; b < totalBeats; b++) {
        const mTid = setTimeout(() => {
          if (this._destroyed || s.phase !== 'running') return;
          this.audio.playTrainerClick(b % 4 === 0).catch(() => {});
        }, b * beatMs);
        this._timers.push(mTid);
      }

      const endTid = setTimeout(() => {
        if (this._destroyed) return;
        this._finishGrooveSession();
      }, totalBeats * beatMs + 340);
      this._timers.push(endTid);

      this._runGrooveLoop();
    }, 4 * beatMs);
    this._timers.push(startTid);
  }

  _runGrooveLoop() {
    const step = () => {
      this._rafId = null;
      if (this._destroyed || this.state.phase !== 'running') return;
      const elapsedSec = (performance.now() - this.state.startPerfMs) / 1000;
      const beatAbs = elapsedSec * (this.state.bpm / 60);
      this.state.loopNum = Math.min(this.state.totalLoops - 1, Math.floor(beatAbs / 4));
      this.state.playheadBeat = beatAbs % 4;
      this._drawGrooveCanvas();
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  _handleGrooveTap() {
    const s = this.state;
    if (s.phase !== 'running') return;
    const beatMs = 60000 / s.bpm;
    const curElapsedMs = performance.now() - s.startPerfMs;

    let bestSlot = null;
    let bestAbs = Infinity;
    let bestDiff = 0;
    s.targetSlots.forEach((slot) => {
      if (slot.matched) return;
      const diff = curElapsedMs - slot.beatAbs * beatMs;
      const absD = Math.abs(diff);
      if (absD < bestAbs) {
        bestAbs = absD;
        bestSlot = slot;
        bestDiff = diff;
      }
    });

    if (!bestSlot || bestAbs > 210) {
      s.extraWrongTaps += 1;
      this._setGrooveFeedback('err', 'Lệch nhịp quá xa — chờ đúng điểm mục tiêu!');
      this._updateGrooveAcc();
      return;
    }

    bestSlot.matched = true;
    bestSlot.diffMs = Math.round(bestDiff);
    if (bestAbs <= 55) {
      bestSlot.score = 100;
      bestSlot.rating = 'ok';
      this._setGrooveFeedback('ok', `Chuẩn xác (${bestSlot.diffMs >= 0 ? '+' : ''}${bestSlot.diffMs}ms)!`);
    } else if (bestAbs <= 110) {
      bestSlot.score = 84;
      bestSlot.rating = 'good';
      this._setGrooveFeedback('ok', `Khá tốt (${bestSlot.diffMs >= 0 ? '+' : ''}${bestSlot.diffMs}ms)`);
    } else {
      bestSlot.score = 45;
      bestSlot.rating = 'late';
      this._setGrooveFeedback('err', `${bestDiff < 0 ? 'Hơi sớm' : 'Hơi trễ'} (${bestSlot.diffMs >= 0 ? '+' : ''}${bestSlot.diffMs}ms)`);
    }
    this._updateGrooveAcc();
    this._drawGrooveCanvas();
  }

  _updateGrooveAcc() {
    const s = this.state;
    const matched = s.targetSlots.filter((x) => x.matched);
    const totalDenom = Math.max(1, matched.length + s.extraWrongTaps);
    const sumScore = matched.reduce((a, x) => a + x.score, 0);
    const accEl = this.container.querySelector('#groove-acc');
    if (accEl) accEl.textContent = `${Math.round(sumScore / totalDenom)}%`;
  }

  _setGrooveFeedback(cls, text) {
    const fb = this.container.querySelector('#groove-feedback');
    if (!fb) return;
    fb.className = `ex-feedback ${cls}`;
    fb.textContent = text;
  }

  _finishGrooveSession() {
    this._clearTimers();
    const s = this.state;
    s.phase = 'done';
    const totalSum = s.targetSlots.reduce((a, x) => a + (x.matched ? x.score : 0), 0);
    const denom = Math.max(1, s.targetSlots.length + s.extraWrongTaps);
    const pct = Math.round(totalSum / denom);
    this._finishExercise(pct);
  }

  _drawGrooveCanvas() {
    const canvas = this.container.querySelector('#ex-groove-canvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const w = Math.max(280, Math.floor((wrap ? wrap.clientWidth : 560) || 560));
    const h = 112;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0B0C13';
    ctx.fillRect(0, 0, w, h);

    const padX = 28;
    const trackW = w - padX * 2;
    const midY = 58;

    // Đường trục 1 ô nhịp 4/4 (16 ô)
    for (let step16 = 0; step16 <= 16; step16++) {
      const x = padX + (step16 / 16) * trackW;
      const isBeat = step16 % 4 === 0;
      ctx.strokeStyle = isBeat ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = isBeat ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, isBeat ? 22 : 34);
      ctx.lineTo(x, isBeat ? h - 22 : h - 32);
      ctx.stroke();

      if (isBeat && step16 < 16) {
        ctx.fillStyle = '#E4E4E7';
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`Phách ${step16 / 4 + 1}`, x + trackW / 8, 16);
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX, midY);
    ctx.lineTo(padX + trackW, midY);
    ctx.stroke();

    const s = this.state;
    const activeLoop = s.loopNum || 0;
    const slots = s.targetSlots.length
      ? s.targetSlots.filter((x) => Math.floor(x.beatAbs / 4) === activeLoop)
      : s.pattern.targets.map((tg) => ({ barBeat: tg.beat, label: tg.label, matched: false, rating: null }));

    slots.forEach((slot) => {
      const cx = padX + (slot.barBeat / 4) * trackW;
      ctx.beginPath();
      ctx.arc(cx, midY, 10, 0, Math.PI * 2);
      if (slot.matched) {
        ctx.fillStyle = slot.rating === 'ok' ? '#34D399' : slot.rating === 'good' ? '#FBBF24' : '#FB7185';
      } else {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
      }
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = slot.matched ? '#FFFFFF' : '#F59E0B';
      ctx.stroke();

      ctx.fillStyle = '#F4F4F5';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(slot.label, cx, midY + 24);
    });

    if (s.phase === 'running') {
      const px = padX + (clamp(s.playheadBeat, 0, 4) / 4) * trackW;
      ctx.strokeStyle = '#34D399';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(px, 14);
      ctx.lineTo(px, h - 14);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ==========================================================================
  // 4. SCALE RUNNER (Chặng 3.1 & 3.3)
  // ==========================================================================
  _renderScaleRunnerHtml() {
    const s = this.state;
    const sc = s.scales[s.scaleIdx];
    const targetMidi = s.seqMidis[s.stepPos];
    const tot = s.correctSteps + s.wrongSteps;
    const acc = tot > 0 ? Math.round((s.correctSteps / tot) * 100) : 100;

    const guideSet = new Set(getScalePitchClasses(sc.keyPc, sc.scaleType === 'pentatonic_major' ? 'major' : sc.scaleType));
    const scaleGuide = getScaleGuideInfo(sc.keyPc, sc.scaleType);

    const chipsHtml = s.seqMidis
      .map(
        (m, i) => `
      <span class="sr-step-chip${i < s.stepPos ? ' is-done' : i === s.stepPos ? ' is-cur' : ''} mono-val">
        ${midiToNoteName(m, sc.preferFlats)}
      </span>
    `
      )
      .join('');

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Bài <strong class="mono-val">${s.scaleIdx + 1}/${s.scales.length}:</strong> ${escapeHtml(sc.name)}</span>
          <span class="ex-stat-pill">Tiến độ: <strong id="sr-prog" class="mono-val">${s.stepPos}/${s.seqMidis.length}</strong></span>
          <span class="ex-stat-pill">Độ chuẩn: <strong id="sr-acc" class="mono-val accent-emerald">${acc}%</strong></span>
          <button type="button" id="btn-sr-play-demo" class="btn btn-amber-outline btn-xs">🔊 Nghe chạy ngón mẫu</button>
        </div>

        <div id="sr-chips-row" class="sr-chips-row">${chipsHtml}</div>

        <div id="sr-feedback" class="ex-feedback ${s.feedback ? (s.feedback.ok ? 'ok' : 'err') : 'idle'}">
          ${s.feedback ? escapeHtml(s.feedback.text) : `Bấm nốt tiếp theo: ${midiToNoteName(targetMidi, sc.preferFlats)} (chấm sáng gợi ý âm giai)`}
        </div>

        ${this._renderHybridKeyboardHtml({
          scaleSet: scaleGuide.scaleSet || guideSet,
          scaleRootPc: sc.keyPc,
          targetMidis: new Set([targetMidi]),
        })}
      </div>
    `;
  }

  _syncScaleRunnerTargetUI() {
    const s = this.state;
    const sc = s.scales[s.scaleIdx];
    const targetMidi = s.seqMidis[s.stepPos];
    const tot = s.correctSteps + s.wrongSteps;
    const acc = tot > 0 ? Math.round((s.correctSteps / tot) * 100) : 100;

    const progEl = this.container.querySelector('#sr-prog');
    const accEl = this.container.querySelector('#sr-acc');
    const fbEl = this.container.querySelector('#sr-feedback');
    if (progEl) progEl.textContent = `${s.stepPos}/${s.seqMidis.length}`;
    if (accEl) accEl.textContent = `${acc}%`;
    if (fbEl && s.feedback) {
      fbEl.className = `ex-feedback ${s.feedback.ok ? 'ok' : 'err'}`;
      fbEl.textContent = s.feedback.text;
    }

    this.container.querySelectorAll('.sr-step-chip').forEach((chip, i) => {
      chip.classList.toggle('is-done', i < s.stepPos);
      chip.classList.toggle('is-cur', i === s.stepPos);
    });

    this._keyElByMidi.forEach((el, midi) => {
      el.classList.toggle('is-target', midi === targetMidi);
    });
    void sc;
  }

  _bindScaleRunnerEvents() {
    this.container.querySelector('#btn-sr-play-demo')?.addEventListener('click', () => {
      this._clearTimers();
      this.audio.unlockSync();
      this.state.seqMidis.forEach((m, i) => {
        const tid = setTimeout(() => {
          if (!this._destroyed) {
            this.audio.playTrainerPiano(m, 0.35, 0.78).catch(() => {});
          }
        }, i * 260);
        this._timers.push(tid);
      });
    });
  }

  // ==========================================================================
  // 5. IMPOSTOR NOTE (Chặng 3.2 Săn nốt lạc tông & Chặng 6.2 Dấu thanh Tiếng Việt)
  // ==========================================================================
  _renderImpostorNoteHtml() {
    const s = this.state;
    const cur = s.rounds[s.idx];
    const isViet = s.mode === 'viet-tone';
    const tries = s.correct + s.wrong;
    const acc = tries > 0 ? Math.round((s.correct / tries) * 100) : 100;

    const itemsList = isViet ? cur.syllables : cur.labels;
    const blocksHtml = itemsList
      .map((lbl, i) => {
        let cls = '';
        if (s.answered) {
          if (i === cur.impostorIndex) cls = ' is-impostor';
          else if (i === s.pickedIdx) cls = ' is-wrong';
        }
        return `
          <button type="button" class="imp-block-btn${cls}${s.playingStep === i ? ' is-playing' : ''}" data-imp-idx="${i}" ${s.answered ? 'disabled' : ''}>
            <span class="imp-step-num mono-val">#${i + 1}</span>
            <strong class="imp-step-lbl">${escapeHtml(lbl)}</strong>
          </button>
        `;
      })
      .join('');

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Câu <strong class="mono-val">${s.idx + 1}/${s.rounds.length}</strong></span>
          <span class="ex-stat-pill">${isViet ? 'Câu lời:' : 'Tông chuẩn:'} <strong>${escapeHtml(isViet ? cur.phrase : cur.keyLabel)}</strong></span>
          <span class="ex-stat-pill">Độ chuẩn: <strong class="mono-val accent-emerald">${acc}%</strong></span>
        </div>

        <div class="ex-play-row">
          <button type="button" id="btn-imp-play" class="btn btn-amber-solid btn-xs">
            🔊 ${isViet ? 'Nghe câu hát (Có tiếng bị cưỡng âm)' : 'Nghe câu nhạc'}
          </button>
          ${
            s.answered && isViet
              ? `<button type="button" id="btn-imp-play-fixed" class="btn btn-emerald-solid btn-xs">✨ Nghe bản ĐÃ SỬA thuận dấu</button>`
              : ''
          }
          ${s.answered ? `<button type="button" id="btn-imp-next" class="btn btn-indigo-solid btn-xs">${s.idx + 1 >= s.rounds.length ? 'Xem kết quả →' : 'Câu tiếp theo →'}</button>` : ''}
        </div>

        <div class="imp-blocks-grid">${blocksHtml}</div>

        <div class="ex-feedback ${s.answered ? (s.pickedIdx === cur.impostorIndex ? 'ok' : 'err') : 'idle'}">
          ${
            s.answered
              ? `<strong>${s.pickedIdx === cur.impostorIndex ? '✓ Chính xác!' : '✗ Chưa đúng:'}</strong> ${escapeHtml(cur.explanation)}`
              : isViet
                ? 'Hãy bấm nghe giai điệu rồi chọn CHỮ đang có cao độ đi ngược dấu thanh tiếng Việt.'
                : 'Hãy nghe kỹ câu giai điệu và bấm chọn NỐT LẠC ra khỏi âm giai.'
          }
        </div>
      </div>
    `;
  }

  _playImpostorSequence(fixed = false) {
    this._clearTimers();
    this.audio.unlockSync();
    const cur = this.state.rounds[this.state.idx];
    const seq = fixed && cur.fixedMidis ? cur.fixedMidis : (cur.notes || cur.wrongMidis);
    seq.forEach((m, i) => {
      const tid = setTimeout(() => {
        if (this._destroyed) return;
        this.state.playingStep = i;
        this.container.querySelectorAll('.imp-block-btn').forEach((b, idx) =>
          b.classList.toggle('is-playing', idx === i)
        );
        this.audio.playTrainerPiano(m, 0.42, 0.84).catch(() => {});
      }, i * 380);
      this._timers.push(tid);
    });
    const endTid = setTimeout(() => {
      if (this._destroyed) return;
      this.state.playingStep = -1;
      this.container.querySelectorAll('.imp-block-btn').forEach((b) => b.classList.remove('is-playing'));
    }, seq.length * 380 + 120);
    this._timers.push(endTid);
  }

  _bindImpostorNoteEvents() {
    this.container.querySelector('#btn-imp-play')?.addEventListener('click', () => this._playImpostorSequence(false));
    this.container.querySelector('#btn-imp-play-fixed')?.addEventListener('click', () => this._playImpostorSequence(true));
    this.container.querySelector('#btn-imp-next')?.addEventListener('click', () => {
      this.state.idx += 1;
      if (this.state.idx >= this.state.rounds.length) {
        const tot = this.state.correct + this.state.wrong;
        this._finishExercise(tot > 0 ? Math.round((this.state.correct / tot) * 100) : 100);
      } else {
        this.state.answered = false;
        this.state.pickedIdx = -1;
        this.render();
        this._playImpostorSequence(false);
      }
    });

    this.container.querySelectorAll('[data-imp-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.state.answered) return;
        const idx = Number(btn.dataset.impIdx);
        const cur = this.state.rounds[this.state.idx];
        const ok = idx === cur.impostorIndex;
        this.state.answered = true;
        this.state.pickedIdx = idx;
        if (ok) this.state.correct += 1;
        else {
          this.state.wrong += 1;
          this.audio.playTrainerWrong().catch(() => {});
        }
        this.render();
      });
    });
  }

  // ==========================================================================
  // 6. CHORD BUILDER (Chặng 4.1, 4.2, 4.3 — Auto Chord Latch & Live Detector)
  // ==========================================================================
  _renderChordBuilderHtml() {
    const s = this.state;
    const cur = s.pool[s.idx];
    const activeMidis = this.midi ? this.midi.getActiveMidis() : [];
    const detected = detectChordFromMidis(activeMidis, cur.preferFlats);
    const detectedText = detected
      ? `${detected.symbol || detected.noteNames.join(' + ')} (${detected.noteNames.join(' · ')})`
      : 'Chưa bấm nốt nào';

    const showHint = s.mode === 'practice' && s.showHintKeys;
    const targetSet = showHint ? new Set(cur.guideMidis) : null;

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Hợp âm <strong class="mono-val">${s.idx + 1}/${s.pool.length}</strong></span>
          <div class="seg-group" role="group" aria-label="Chế độ dựng hợp âm">
            <button type="button" class="seg-btn${s.mode === 'practice' ? ' active' : ''}" data-cb-mode="practice">Tập luyện (Có gợi ý)</button>
            <button type="button" class="seg-btn${s.mode === 'challenge' ? ' active' : ''}" data-cb-mode="challenge">Thử thách (Không đèn)</button>
          </div>
          ${
            s.mode === 'practice'
              ? `<button type="button" id="btn-cb-hint" class="btn btn-amber-outline btn-xs">${s.showHintKeys ? 'Ẩn đèn phím' : '💡 Gợi ý phím'}</button>`
              : ''
          }
          <button type="button" id="btn-cb-hear" class="btn btn-cyan-outline btn-xs">🔊 Nghe mẫu</button>
          <button type="button" id="btn-cb-clear" class="btn btn-ghost btn-xs">Nhả phím đang giữ</button>
        </div>

        <div class="ex-prompt-box">
          <div class="cb-target-col">
            <span class="cw-prompt-lbl">HÃY BẤM HỢP ÂM:</span>
            <strong class="cb-target-symbol">${escapeHtml(cur.symbol)}</strong>
            <span class="cb-target-sub">${s.mode === 'practice' ? escapeHtml(cur.hint) : 'Tự tính quãng nửa cung và bấm đủ các nốt!'}</span>
          </div>
          <div class="cb-live-col">
            <span class="cw-prompt-lbl">ĐANG NHẬN DIỆN TRÊN ĐÀN:</span>
            <span id="cb-live-readout" class="cb-live-readout mono-val">${escapeHtml(detectedText)}</span>
          </div>
        </div>

        <div id="cb-feedback" class="ex-feedback ${s.feedback ? (s.feedback.ok ? 'ok' : 'err') : 'idle'}">
          ${s.feedback ? escapeHtml(s.feedback.text) : 'Khi dùng chuột PC, hệ thống đã tự bật "Giữ phím ghép hợp âm" để bạn bấm từng nốt tạo hợp âm.'}
        </div>

        ${this._renderHybridKeyboardHtml({ targetMidis: targetSet })}
      </div>
    `;
  }

  _evaluateChordBuilder(activeMidis) {
    const s = this.state;
    const cur = s.pool[s.idx];
    const detected = detectChordFromMidis(activeMidis, cur.preferFlats);
    const liveEl = this.container.querySelector('#cb-live-readout');
    if (liveEl) {
      liveEl.textContent = detected
        ? `${detected.symbol || detected.noteNames.join(' + ')} (${detected.noteNames.join(' · ')})`
        : 'Chưa bấm nốt nào';
    }

    const match = doesActiveMatchChord(activeMidis, cur);
    if (!match.matched) return;

    // Nếu là bài Thế đảo (4.2) -> kiểm tra thêm nốt đáy (Bass) bắt buộc!
    if (Number.isFinite(cur.requiredBassPc)) {
      const sorted = [...activeMidis].sort((a, b) => a - b);
      const lowestPc = ((sorted[0] % 12) + 12) % 12;
      if (lowestPc !== cur.requiredBassPc) {
        const fb = this.container.querySelector('#cb-feedback');
        if (fb) {
          fb.className = 'ex-feedback err';
          fb.textContent = `Đủ nốt rồi nhưng nốt trầm nhất chưa đúng ${pcToNoteName(cur.requiredBassPc, cur.preferFlats)}! Hãy nhả ra và bấm nốt bass yêu cầu dưới đáy.`;
        }
        return;
      }
    }

    s.locked = true;
    s.correct += 1;
    s.attempts += 1;
    const fb = this.container.querySelector('#cb-feedback');
    if (fb) {
      fb.className = 'ex-feedback ok';
      fb.textContent = `✓ Chuẩn xác! ${cur.label}`;
    }
    this.audio.playTrainerChordPreview(cur.guideMidis, 0.75, 0.78, 'grand').catch(() => {});

    const tid = setTimeout(() => {
      if (this._destroyed) return;
      if (this.midi) this.midi.clearLatchedNotes();
      s.locked = false;
      s.idx += 1;
      s.showHintKeys = false;
      s.feedback = null;
      if (s.idx >= s.pool.length) {
        this._finishExercise(Math.round((s.correct / Math.max(1, s.pool.length)) * 100));
      } else {
        this.render();
      }
    }, 850);
    this._timers.push(tid);
  }

  _bindChordBuilderEvents() {
    this.container.querySelectorAll('[data-cb-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.state.mode = btn.dataset.cbMode === 'challenge' ? 'challenge' : 'practice';
        this.render();
      });
    });
    this.container.querySelector('#btn-cb-hint')?.addEventListener('click', () => {
      this.state.showHintKeys = !this.state.showHintKeys;
      this.render();
    });
    this.container.querySelector('#btn-cb-hear')?.addEventListener('click', () => {
      const cur = this.state.pool[this.state.idx];
      this.audio.playTrainerChordPreview(cur.guideMidis, 0.9, 0.76, 'grand').catch(() => {});
    });
    this.container.querySelector('#btn-cb-clear')?.addEventListener('click', () => {
      if (this.midi) this.midi.clearLatchedNotes();
    });
  }

  // ==========================================================================
  // 7. PROGRESSION PUZZLE (Chặng 5.1, 5.2, 5.3 + Export sang Sáng tác Beat)
  // ==========================================================================
  _renderProgressionPuzzleHtml() {
    const s = this.state;
    const cur = s.items[s.idx];
    const pickedCand = cur.candidates.find((c) => c.id === s.pickedId) || null;
    const tries = s.correct + s.wrong;
    const acc = tries > 0 ? Math.round((s.correct / tries) * 100) : 100;

    const barsHtml = [0, 1, 2]
      .map((i) => {
        const b = cur.givenBars[i];
        return `
          <div class="pz-bar-card">
            <span class="pz-bar-idx">Ô ${i + 1} · ${escapeHtml(b.roman)}</span>
            <strong>${escapeHtml(b.symbol)}</strong>
          </div>
        `;
      })
      .join('');

    const bar4Html = `
      <div class="pz-bar-card is-slot${s.answered ? ' is-filled' : ''}">
        <span class="pz-bar-idx">Ô 4 · ${pickedCand ? escapeHtml(pickedCand.roman) : '?'}</span>
        <strong>${pickedCand ? escapeHtml(pickedCand.symbol) : '[ ? Chọn đáp án ]'}</strong>
      </div>
    `;

    const candidatesHtml = cur.candidates
      .map((c) => {
        let cls = '';
        if (s.answered) {
          if (c.id === cur.answerId) cls = ' is-correct';
          else if (c.id === s.pickedId) cls = ' is-wrong';
        }
        return `
          <div class="pz-cand-card${cls}">
            <div class="pz-cand-top">
              <span class="cw-roman mono-val">${escapeHtml(c.roman)}</span>
              <strong>${escapeHtml(c.symbol)}</strong>
            </div>
            <p class="pz-cand-desc">${escapeHtml(c.desc)}</p>
            <div class="pz-cand-btns">
              <button type="button" class="btn btn-amber-outline btn-xs" data-pz-audition="${c.id}">▶ Nghe ghép 4 ô</button>
              <button type="button" class="btn btn-cyan-solid btn-xs" data-pz-pick="${c.id}" ${s.answered ? 'disabled' : ''}>Chọn hợp âm này</button>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <span class="ex-stat-pill">Bài <strong class="mono-val">${s.idx + 1}/${s.items.length}</strong></span>
          <span class="ex-stat-pill">Độ chuẩn: <strong class="mono-val accent-emerald">${acc}%</strong></span>
          <button type="button" id="btn-pz-play3" class="btn btn-amber-solid btn-xs">🔊 Nghe 3 ô đầu</button>
          <button type="button" id="btn-pz-waitmode" class="btn btn-indigo-outline btn-xs">🎹 Tập đệm bằng Wait Mode</button>
          <button type="button" id="btn-pz-export-beat" class="btn btn-emerald-solid btn-xs">🚀 Đẩy vòng hợp âm này sang Sáng tác Beat →</button>
        </div>

        <h3 class="pz-title">${escapeHtml(cur.title)}</h3>
        <p class="ex-sub-hint">${escapeHtml(cur.prompt)}</p>

        <div class="pz-bars-row">${barsHtml}${bar4Html}</div>

        <div class="pz-cands-grid">${candidatesHtml}</div>

        <div class="ex-feedback ${s.answered ? (s.pickedId === cur.answerId ? 'ok' : 'err') : 'idle'}">
          ${
            s.answered
              ? `<strong>${s.pickedId === cur.answerId ? '✓ Chính xác!' : '✗ Đáp án đúng:'}</strong> ${escapeHtml(cur.explanation)}`
              : 'Bấm "▶ Nghe ghép 4 ô" trên từng thẻ để thử cảm xúc, sau đó bấm "Chọn hợp âm này".'
          }
        </div>

        ${
          s.answered
            ? `<div class="ex-play-row"><button type="button" id="btn-pz-next" class="btn btn-indigo-solid btn-xs">${s.idx + 1 >= s.items.length ? 'Hoàn thành & Lưu điểm →' : 'Câu tiếp theo →'}</button></div>`
            : ''
        }
      </div>
    `;
  }

  _playPuzzleBars(barMidisList) {
    this._clearTimers();
    this.audio.unlockSync();
    barMidisList.forEach((midis, i) => {
      const tid = setTimeout(() => {
        if (!this._destroyed) {
          this.audio.playTrainerChordPreview(midis, 0.9, 0.78, 'rhodes').catch(() => {});
        }
      }, i * 820);
      this._timers.push(tid);
    });
  }

  _buildPuzzleExportSpecs() {
    const cur = this.state.items[this.state.idx];
    const correctCand = cur.candidates.find((c) => c.id === cur.answerId) || cur.candidates[0];
    return [...cur.givenBars.map((b) => ({ ...b.spec })), { ...correctCand.spec }];
  }

  _bindProgressionPuzzleEvents() {
    const cur = this.state.items[this.state.idx];

    this.container.querySelector('#btn-pz-play3')?.addEventListener('click', () => {
      this._playPuzzleBars(cur.givenBars.map((b) => b.midis));
    });

    this.container.querySelectorAll('[data-pz-audition]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cand = cur.candidates.find((c) => c.id === btn.dataset.pzAudition);
        if (!cand) return;
        this._playPuzzleBars([...cur.givenBars.map((b) => b.midis), cand.midis]);
      });
    });

    this.container.querySelectorAll('[data-pz-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.state.answered) return;
        const pickId = btn.dataset.pzPick;
        const ok = pickId === cur.answerId;
        this.state.answered = true;
        this.state.pickedId = pickId;
        if (ok) this.state.correct += 1;
        else {
          this.state.wrong += 1;
          this.audio.playTrainerWrong().catch(() => {});
        }
        const cand = cur.candidates.find((c) => c.id === pickId);
        if (cand) {
          this._playPuzzleBars([...cur.givenBars.map((b) => b.midis), cand.midis]);
        }
        this.render();
      });
    });

    this.container.querySelector('#btn-pz-next')?.addEventListener('click', () => {
      this.state.idx += 1;
      if (this.state.idx >= this.state.items.length) {
        const tot = this.state.correct + this.state.wrong;
        this._finishExercise(tot > 0 ? Math.round((this.state.correct / tot) * 100) : 100);
      } else {
        this.state.answered = false;
        this.state.pickedId = null;
        this.render();
      }
    });

    this.container.querySelector('#btn-pz-waitmode')?.addEventListener('click', () => {
      this.cb.onOpenWaitMode({
        keyPc: cur.keyPc,
        scaleType: cur.scaleType,
        bpm: cur.bpm,
        chords: this._buildPuzzleExportSpecs(),
      });
    });

    this.container.querySelector('#btn-pz-export-beat')?.addEventListener('click', () => {
      this.cb.onExportToStudio({
        keyPc: cur.keyPc,
        scaleType: cur.scaleType,
        bpm: cur.bpm,
        chords: this._buildPuzzleExportSpecs(),
        melodyNotes: null,
        label: cur.title,
      });
    });
  }

  // ==========================================================================
  // 8. CALL & RESPONSE LAB (Chặng 6.1 & Dự án Tốt nghiệp Chặng 6.3)
  // ==========================================================================
  _renderCallResponseLabHtml() {
    const s = this.state;
    const p = s.preset;
    const presetOpts = Object.values(CALL_RESPONSE_PRESETS)
      .map((item) => `<option value="${item.id}"${item.id === s.presetKey ? ' selected' : ''}>${escapeHtml(item.name)}</option>`)
      .join('');

    const qMap = new Map();
    p.questionNotes.forEach((n) => qMap.set(`${n.step}:${n.midi}`, true));
    const rMap = new Map();
    s.responseNotes.forEach((n) => rMap.set(`${n.step}:${n.midi}`, true));

    const barHeadersHtml = p.chords
      .map(
        (ch, bIdx) => `
      <div class="cr-bar-head ${bIdx < 2 ? 'is-question' : 'is-response'}">
        <span>Ô ${bIdx + 1}: <strong>${escapeHtml(ch.symbol)}</strong> (${escapeHtml(ch.roman)})</span>
        <span class="cr-role-tag">${bIdx < 2 ? '🔒 Hỏi (Mẫu)' : '✏️ Đáp (Của bạn)'}</span>
      </div>
    `
      )
      .join('');

    const rowsHtml = p.pitchRows
      .map((midi) => {
        const noteLbl = midiToNoteName(midi, p.preferFlats);
        const cells = [];
        for (let step = 0; step < 32; step++) {
          const barIdx = Math.floor(step / 8);
          const isQuestionZone = step < 16;
          const pc = ((midi % 12) + 12) % 12;
          const isChordTone = p.chords[barIdx].pcs.has(pc);
          const hasNote = isQuestionZone ? qMap.has(`${step}:${midi}`) : rMap.has(`${step}:${midi}`);

          let cls = isQuestionZone ? 'is-q-zone' : 'is-r-zone';
          if (isChordTone) cls += ' is-chord-tone';
          if (hasNote) cls += isQuestionZone ? ' has-q-note' : ' has-r-note';
          if (step % 8 === 0) cls += ' is-bar-start';
          if (s.playStep === step) cls += ' is-playhead';

          cells.push(
            `<button type="button" class="cr-cell ${cls}" data-cr-step="${step}" data-cr-midi="${midi}" aria-label="${noteLbl} bước ${step + 1}" ${isQuestionZone ? 'disabled' : ''}></button>`
          );
        }
        return `
          <div class="cr-grid-row">
            <div class="cr-pitch-lbl mono-val">${noteLbl}</div>
            <div class="cr-cells-strip">${cells.join('')}</div>
          </div>
        `;
      })
      .join('');

    const respCount = s.responseNotes.length;
    const quickKeysHtml = [...p.pitchRows]
      .reverse()
      .map((midi) => `<button type="button" class="cr-quick-key mono-val" data-cr-quick-midi="${midi}">${midiToNoteName(midi, p.preferFlats)}</button>`)
      .join('');

    return `
      <div class="ex-stage-card">
        <div class="ex-metrics-row">
          <label class="inline-field">
            <span class="inline-label">Vòng hợp âm</span>
            <select id="cr-preset-select" class="studio-select compact" aria-label="Chọn vòng hợp âm Hỏi Đáp">${presetOpts}</select>
          </label>
          <span class="ex-stat-pill">Nốt câu Đáp (Ô 3–4): <strong id="cr-count-val" class="mono-val accent-amber">${respCount} nốt</strong></span>
          <button type="button" id="btn-cr-play" class="btn btn-amber-solid btn-xs">${s.isPlaying ? '⏹ Dừng' : '▶ Nghe trọn vẹn 4 ô'}</button>
          <button type="button" id="btn-cr-sample" class="btn btn-indigo-outline btn-xs">✨ Gợi ý câu Đáp mẫu</button>
          <button type="button" id="btn-cr-clear" class="btn btn-rose-outline btn-xs">Xóa câu Đáp</button>
        </div>

        <p class="ex-sub-hint">
          Ô 1–2 là <strong>Câu Hỏi</strong> khóa sẵn. Hãy chạm trực tiếp vào các ô ở <strong>Ô 3–4</strong> (hoặc bấm đàn MIDI / phím nhanh bên dưới) để viết <strong>Câu Đáp</strong>. Các ô có chấm vàng nhạt là <strong>Nốt trụ hợp âm (Chord Tones)</strong>!
        </p>

        <div class="cr-grid-scroll">
          <div class="cr-grid-inner">
            <div class="cr-bars-header-row">
              <div class="cr-corner-hdr mono-val">CAO ĐỘ</div>
              <div class="cr-bars-head-cells">${barHeadersHtml}</div>
            </div>
            <div id="cr-rows-body" class="cr-rows-body">${rowsHtml}</div>
          </div>
        </div>

        <div class="cr-quick-bar">
          <span class="cr-quick-lbl">Ghi nốt nhanh vào Ô 3–4 (bước ${s.midiCursorStep - 15}/16):</span>
          <div class="cr-quick-keys">${quickKeysHtml}</div>
        </div>

        <div class="ex-play-row">
          <button type="button" id="btn-cr-grade" class="btn btn-emerald-solid btn-xs">✅ Chấm điểm &amp; Lưu Hoàn thành</button>
          ${
            this.ex.config?.showFallingHookBtn
              ? `<button type="button" id="btn-cr-falling-hook" class="btn btn-cyan-outline btn-xs">🎯 Tập chơi câu Hook mẫu (Nốt Rơi) →</button>`
              : ''
          }
          <button type="button" id="btn-cr-export-studio" class="btn btn-amber-solid btn-xs">🚀 Chuyển thành Dự án mới bên Sáng tác Beat →</button>
        </div>
      </div>
    `;
  }

  _recordNoteIntoCallResponse(midi) {
    const s = this.state;
    const p = s.preset;
    // Snap vào nốt gần nhất trong pitchRows của Scale hiện tại
    let nearest = p.pitchRows[0];
    let bestD = Infinity;
    p.pitchRows.forEach((rm) => {
      const d = Math.abs(rm - midi);
      if (d < bestD) {
        bestD = d;
        nearest = rm;
      }
    });
    const step = clamp(s.midiCursorStep, 16, 31);
    s.responseNotes = s.responseNotes.filter((n) => n.step !== step);
    s.responseNotes.push({ step, midi: nearest });
    s.midiCursorStep = step + 2 > 31 ? 16 : step + 2;
    this.render();
  }

  _playCallResponsePreview() {
    const s = this.state;
    if (s.isPlaying) {
      this._clearTimers();
      s.isPlaying = false;
      s.playStep = -1;
      this.render();
      return;
    }

    this._clearTimers();
    this.audio.unlockSync();
    s.isPlaying = true;
    const p = s.preset;
    const eighthMs = (60000 / p.bpm) * 0.5;

    // 4 hợp âm ở bước 0, 8, 16, 24
    p.chords.forEach((ch, bIdx) => {
      const tid = setTimeout(() => {
        if (!this._destroyed && s.isPlaying) {
          this.audio.playTrainerChordPreview(ch.midis, (eighthMs * 7.5) / 1000, 0.65, 'rhodes').catch(() => {});
        }
      }, bIdx * 8 * eighthMs);
      this._timers.push(tid);
    });

    const allNotes = new Map();
    p.questionNotes.forEach((n) => allNotes.set(n.step, n.midi));
    s.responseNotes.forEach((n) => allNotes.set(n.step, n.midi));

    for (let step = 0; step < 32; step++) {
      const tid = setTimeout(() => {
        if (this._destroyed || !s.isPlaying) return;
        s.playStep = step;
        this.container.querySelectorAll('.cr-cell.is-playhead').forEach((el) => el.classList.remove('is-playhead'));
        this.container.querySelectorAll(`.cr-cell[data-cr-step="${step}"]`).forEach((el) => el.classList.add('is-playhead'));
        if (allNotes.has(step)) {
          this.audio.playTrainerPiano(allNotes.get(step), 0.45, 0.85).catch(() => {});
        }
      }, step * eighthMs);
      this._timers.push(tid);
    }

    const endTid = setTimeout(() => {
      if (this._destroyed) return;
      s.isPlaying = false;
      s.playStep = -1;
      this.render();
    }, 32 * eighthMs + 220);
    this._timers.push(endTid);

    const playBtn = this.container.querySelector('#btn-cr-play');
    if (playBtn) playBtn.textContent = '⏹ Dừng';
  }

  _bindCallResponseEvents() {
    this.container.querySelector('#cr-preset-select')?.addEventListener('change', (e) => {
      const k = e.target.value;
      if (CALL_RESPONSE_PRESETS[k]) {
        this._clearTimers();
        this.state.presetKey = k;
        this.state.preset = CALL_RESPONSE_PRESETS[k];
        this.state.responseNotes = [];
        this.state.isPlaying = false;
        this.state.playStep = -1;
        this.render();
      }
    });

    this.container.querySelector('#btn-cr-play')?.addEventListener('click', () => this._playCallResponsePreview());

    this.container.querySelector('#btn-cr-sample')?.addEventListener('click', () => {
      this.state.responseNotes = this.state.preset.sampleResponse.map((n) => ({ ...n }));
      this.render();
      this.cb.showToast('Đã nạp câu Đáp gợi ý chuẩn Chord Tone!');
    });

    this.container.querySelector('#btn-cr-clear')?.addEventListener('click', () => {
      this.state.responseNotes = [];
      this.state.midiCursorStep = 16;
      this.render();
    });

    this.container.querySelector('#cr-rows-body')?.addEventListener('click', (e) => {
      const cell = e.target.closest('.cr-cell[data-cr-step]');
      if (!cell || cell.disabled) return;
      const step = Number(cell.dataset.crStep);
      const midi = Number(cell.dataset.crMidi);
      const existing = this.state.responseNotes.find((n) => n.step === step && n.midi === midi);
      if (existing) {
        this.state.responseNotes = this.state.responseNotes.filter((n) => !(n.step === step && n.midi === midi));
      } else {
        // Mỗi bước đơn âm sạch sẽ cho giai điệu
        this.state.responseNotes = this.state.responseNotes.filter((n) => n.step !== step);
        this.state.responseNotes.push({ step, midi });
        this.audio.playTrainerPiano(midi, 0.45, 0.85).catch(() => {});
      }
      this.render();
    });

    this.container.querySelectorAll('[data-cr-quick-midi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const midi = Number(btn.dataset.crQuickMidi);
        this.audio.playTrainerPiano(midi, 0.45, 0.85).catch(() => {});
        this._recordNoteIntoCallResponse(midi);
      });
    });

    this.container.querySelector('#btn-cr-grade')?.addEventListener('click', () => {
      const rNotes = this.state.responseNotes;
      if (rNotes.length < 4) {
        this.cb.showToast('Hãy viết ít nhất 4 nốt cho câu Đáp (Ô 3–4) trước khi chấm điểm nhé!', true);
        return;
      }
      const p = this.state.preset;
      let chordToneHits = 0;
      rNotes.forEach((n) => {
        const b = Math.min(3, Math.floor(n.step / 8));
        const pc = ((n.midi % 12) + 12) % 12;
        if (p.chords[b].pcs.has(pc)) chordToneHits += 1;
      });
      const ratio = chordToneHits / rNotes.length;
      const pct = Math.min(100, Math.round(78 + ratio * 22));
      this._finishExercise(pct);
    });

    this.container.querySelector('#btn-cr-falling-hook')?.addEventListener('click', () => {
      this.cb.onOpenFallingHook('hook-vpop-eb');
    });

    this.container.querySelector('#btn-cr-export-studio')?.addEventListener('click', () => {
      const p = this.state.preset;
      const merged = [
        ...p.questionNotes,
        ...(this.state.responseNotes.length > 0 ? this.state.responseNotes : p.sampleResponse),
      ];
      const melodyNotes = merged
        .sort((a, b) => a.step - b.step)
        .map((n, i) => ({
          id: `n_acad_${Date.now().toString(36)}_${i}`,
          midi: n.midi,
          startBeat: Number((n.step * 0.5).toFixed(4)),
          durationBeats: 0.5,
          velocity: 0.82,
        }));

      this.cb.onExportToStudio({
        keyPc: p.keyPc,
        scaleType: p.scaleType,
        bpm: p.bpm,
        chords: p.chords.map((c) => ({ ...c.spec })),
        melodyNotes,
        label: p.name,
      });
    });
  }

  _renderStaticMiniPianoHtml(minM, maxM, highlightMidis = [], preferFlats = false) {
    const start = Math.max(48, Math.min(60, minM));
    const end = Math.min(83, Math.max(start + 12, maxM));
    const hlSet = new Set(highlightMidis);
    const whites = [];
    const blacks = [];
    let whiteIdx = 0;

    for (let m = start; m <= end; m++) {
      const pc = ((m % 12) + 12) % 12;
      const isBlack = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
      if (!isBlack) {
        whites.push({ midi: m, idx: whiteIdx, lbl: midiToNoteName(m, preferFlats) });
        whiteIdx += 1;
      } else {
        blacks.push({ midi: m, leftWhiteAnchor: whiteIdx });
      }
    }
    const wRatio = 1 / Math.max(1, whites.length);
    const wHtml = whites
      .map(
        (w) => `<div class="ex-mini-w${hlSet.has(w.midi) ? ' is-lit' : ''}"><span>${escapeHtml(w.lbl)}</span></div>`
      )
      .join('');
    const bHtml = blacks
      .map((b) => {
        const leftPct = ((b.leftWhiteAnchor - 0.31) * wRatio * 100).toFixed(3);
        const widthPct = (wRatio * 0.62 * 100).toFixed(3);
        return `<div class="ex-mini-b${hlSet.has(b.midi) ? ' is-lit' : ''}" style="left:${leftPct}%;width:${widthPct}%"></div>`;
      })
      .join('');

    return `
      <div class="ex-mini-piano" aria-hidden="true">
        <div class="ex-mini-whites">${wHtml}</div>
        <div class="ex-mini-blacks">${bHtml}</div>
      </div>
    `;
  }
}
