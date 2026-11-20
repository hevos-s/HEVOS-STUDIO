// ============================================================================
// theory.js — Bộ máy Nhạc lý thuần JS, Đảo thế bấm (Smart Voice Leading) & Preset
// ============================================================================

export const KEY_OPTIONS = [
  { pc: 0, label: 'C', preferFlats: false },
  { pc: 1, label: 'C# / Db', short: 'Db', preferFlats: true },
  { pc: 2, label: 'D', preferFlats: false },
  { pc: 3, label: 'Eb', preferFlats: true },
  { pc: 4, label: 'E', preferFlats: false },
  { pc: 5, label: 'F', preferFlats: true },
  { pc: 6, label: 'F# / Gb', short: 'F#', preferFlats: false },
  { pc: 7, label: 'G', preferFlats: false },
  { pc: 8, label: 'Ab', preferFlats: true },
  { pc: 9, label: 'A', preferFlats: false },
  { pc: 10, label: 'Bb', preferFlats: true },
  { pc: 11, label: 'B', preferFlats: false },
];

export const NOTE_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const SCALES = {
  major: {
    id: 'major',
    label: 'Trưởng (Major)',
    shortLabel: 'Trưởng',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    diatonicQualities: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
    romans: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  },
  minor: {
    id: 'minor',
    label: 'Thứ tự nhiên (Minor)',
    shortLabel: 'Thứ',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    diatonicQualities: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
    romans: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
  },
};

export const CHORD_EXTENSIONS = [
  { id: 'triad', label: 'Màu gốc', suffix: '' },
  { id: 'maj7',  label: 'maj7',    suffix: 'maj7' },
  { id: 'm7',    label: 'm7',      suffix: 'm7' },
  { id: '7',     label: '7',       suffix: '7' },
  { id: 'add9',  label: 'add9',    suffix: 'add9' },
  { id: 'sus2',  label: 'sus2',    suffix: 'sus2' },
  { id: 'sus4',  label: 'sus4',    suffix: 'sus4' },
];

export function shouldPreferFlats(keyPc, scaleType) {
  if (scaleType === 'minor') {
    // Minor keys with flats: D(2), G(7), C(0), F(5), Bb(10), Eb(3), Ab(8)
    return [0, 2, 3, 5, 7, 8, 10].includes(((keyPc % 12) + 12) % 12);
  }
  // Major keys with flats: F(5), Bb(10), Eb(3), Ab(8), Db(1)
  return [1, 3, 5, 8, 10].includes(((keyPc % 12) + 12) % 12);
}

export function pcToNoteName(pc, preferFlats = false) {
  const norm = ((pc % 12) + 12) % 12;
  return preferFlats ? NOTE_FLAT[norm] : NOTE_SHARP[norm];
}

export function midiToNoteName(midi, preferFlats = false) {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${pcToNoteName(pc, preferFlats)}${octave}`;
}

export function midiToToneNote(midi) {
  const rounded = Math.round(midi);
  const pc = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_SHARP[pc]}${octave}`;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq) {
  if (!freq || freq <= 0) return null;
  return 69 + 12 * Math.log2(freq / 440);
}

export function isBlackKey(midi) {
  const pc = ((midi % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

export function getScalePitchClasses(keyPc, scaleType) {
  const scale = SCALES[scaleType] || SCALES.major;
  return scale.intervals.map((iv) => (keyPc + iv) % 12);
}

export function getScaleSet(keyPc, scaleType) {
  return new Set(getScalePitchClasses(keyPc, scaleType));
}

export function isMidiInScale(midi, keyPc, scaleType) {
  const set = getScaleSet(keyPc, scaleType);
  return set.has(((Math.round(midi) % 12) + 12) % 12);
}

/**
 * Hút cao độ MIDI (số thực hoặc nguyên) về nốt hợp lệ gần nhất trong âm giai.
 * Nếu cung cấp chordPitchClasses, ưu tiên nhẹ các nốt nằm trong hợp âm hiện tại.
 */
export function snapMidiToScale(midiFloat, keyPc, scaleType, chordPitchClasses = null, chordBias = 0.28) {
  const scaleSet = getScaleSet(keyPc, scaleType);
  const center = Math.round(midiFloat);
  let bestMidi = center;
  let bestScore = Infinity;

  for (let candidate = center - 3; candidate <= center + 3; candidate++) {
    const pc = ((candidate % 12) + 12) % 12;
    if (!scaleSet.has(pc)) continue;
    let dist = Math.abs(candidate - midiFloat);
    if (chordPitchClasses && chordPitchClasses.has(pc)) {
      dist = Math.max(0, dist - chordBias);
    }
    if (dist < bestScore) {
      bestScore = dist;
      bestMidi = candidate;
    }
  }
  return bestMidi;
}

/**
 * Lấy danh sách bậc hợp âm Diatonic chuẩn trong tông hiện tại
 */
export function getDiatonicChords(keyPc, scaleType) {
  const scale = SCALES[scaleType] || SCALES.major;
  const preferFlats = shouldPreferFlats(keyPc, scaleType);

  return scale.intervals.map((iv, degree) => {
    const rootPc = (keyPc + iv) % 12;
    const quality = scale.diatonicQualities[degree];
    const rootName = pcToNoteName(rootPc, preferFlats);
    const qualitySuffix = quality === 'min' ? 'm' : quality === 'dim' ? 'dim' : '';
    return {
      degree,
      rootPc,
      quality,
      roman: scale.romans[degree],
      symbol: `${rootName}${qualitySuffix}`,
    };
  });
}

/**
 * Tính các khoảng bán cung (intervals) và tên hiển thị cho một hợp âm (degree + extension)
 */
export function resolveChord(chordSpec, keyPc, scaleType) {
  const scale = SCALES[scaleType] || SCALES.major;
  const preferFlats = shouldPreferFlats(keyPc, scaleType);
  const degree = Math.max(0, Math.min(6, chordSpec.degree ?? 0));
  const ext = chordSpec.extension || 'triad';

  const rootPc = (keyPc + scale.intervals[degree]) % 12;
  const baseQuality = scale.diatonicQualities[degree];
  const rootName = pcToNoteName(rootPc, preferFlats);
  const baseRoman = scale.romans[degree];

  let intervals;
  let symbol;
  let roman;

  switch (ext) {
    case 'maj7':
      intervals = [0, 4, 7, 11];
      symbol = `${rootName}maj7`;
      roman = `${baseRoman.replace('°', '').toUpperCase()}maj7`;
      break;

    case 'm7':
      if (baseQuality === 'dim') {
        intervals = [0, 3, 6, 10];
        symbol = `${rootName}m7b5`;
        roman = `${baseRoman.replace('°', '').toLowerCase()}ø7`;
      } else {
        intervals = [0, 3, 7, 10];
        symbol = `${rootName}m7`;
        roman = `${baseRoman.replace('°', '').toLowerCase()}7`;
      }
      break;

    case '7':
      intervals = [0, 4, 7, 10];
      symbol = `${rootName}7`;
      roman = `${baseRoman.replace('°', '').toUpperCase()}7`;
      break;

    case 'add9':
      if (baseQuality === 'min') {
        intervals = [0, 3, 7, 14];
        symbol = `${rootName}m(add9)`;
        roman = `${baseRoman}add9`;
      } else if (baseQuality === 'dim') {
        intervals = [0, 3, 6, 14];
        symbol = `${rootName}dim(add9)`;
        roman = `${baseRoman}add9`;
      } else {
        intervals = [0, 4, 7, 14];
        symbol = `${rootName}add9`;
        roman = `${baseRoman}add9`;
      }
      break;

    case 'sus2':
      intervals = [0, 2, 7];
      symbol = `${rootName}sus2`;
      roman = `${baseRoman.replace('°', '')}sus2`;
      break;

    case 'sus4':
      intervals = [0, 5, 7];
      symbol = `${rootName}sus4`;
      roman = `${baseRoman.replace('°', '')}sus4`;
      break;

    case 'triad':
    default:
      if (baseQuality === 'min') {
        intervals = [0, 3, 7];
        symbol = `${rootName}m`;
      } else if (baseQuality === 'dim') {
        intervals = [0, 3, 6];
        symbol = `${rootName}dim`;
      } else {
        intervals = [0, 4, 7];
        symbol = rootName;
      }
      roman = baseRoman;
      break;
  }

  const pitchClasses = intervals.map((iv) => (rootPc + iv) % 12);
  const allPitchClasses = new Set(pitchClasses);

  return {
    degree,
    extension: ext,
    rootPc,
    rootName,
    baseQuality,
    intervals,
    pitchClasses,
    allPitchClasses,
    symbol,
    roman,
  };
}

/**
 * Tính nốt Bass nền vững chãi trong vùng trầm ấm (E2=40 .. D#3=51)
 */
function computeBassMidi(rootPc) {
  // E2 (40) đến D#3 (51) tạo nền ấm và rõ trên cả loa điện thoại lẫn tai nghe
  const offsetFromE = ((rootPc - 4) + 12) % 12;
  return 40 + offsetFromE;
}

/**
 * Tạo các thế bấm ứng viên (inversions + drop-2) nằm trong quãng C3 (48) – E5 (76)
 */
function buildCandidateVoicings(resolvedChord) {
  const pcs = resolvedChord.pitchClasses;
  const n = pcs.length;
  const candidates = [];
  const MIN_MIDI = 48; // C3
  const MAX_MIDI = 76; // E5

  // 1. Các thế đảo xếp gọn (Close-position inversions) qua các quãng tám
  for (let oct = 3; oct <= 5; oct++) {
    const baseRoot = (oct + 1) * 12 + resolvedChord.rootPc;
    // Xây dựng thế gốc rồi đảo dần
    const rootVoicing = resolvedChord.intervals.map((iv) => baseRoot + iv);

    for (let inv = 0; inv < n; inv++) {
      const notes = [...rootVoicing];
      for (let k = 0; k < inv; k++) {
        notes[k] += 12;
      }
      notes.sort((a, b) => a - b);

      // Thử cả bản gốc và dịch xuống 1 quãng tám
      for (const shift of [0, -12]) {
        const shifted = notes.map((m) => m + shift);
        if (shifted[0] >= MIN_MIDI && shifted[shifted.length - 1] <= MAX_MIDI) {
          candidates.push(shifted);
        }
      }
    }
  }

  // 2. Drop-2 open voicings cho hợp âm 4 nốt (tạo chất Neo-Soul / Ballad cực thoáng tai)
  if (n === 4) {
    const baseCount = candidates.length;
    for (let i = 0; i < baseCount; i++) {
      const v = candidates[i];
      const drop2 = [v[2] - 12, v[0], v[1], v[3]].sort((a, b) => a - b);
      if (drop2[0] >= MIN_MIDI && drop2[drop2.length - 1] <= MAX_MIDI) {
        candidates.push(drop2);
      }
    }
  }

  // Loại bỏ thế bấm trùng lặp
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = c.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  // Fallback an toàn nếu rỗng
  if (unique.length === 0) {
    const fallback = resolvedChord.intervals.map((iv) => 60 + ((resolvedChord.rootPc + iv) % 12));
    fallback.sort((a, b) => a - b);
    unique.push(fallback);
  }

  return unique;
}

/**
 * Chấm điểm chất lượng nội tại của một thế bấm (trung tâm âm vực + độ thoáng quãng)
 */
function intrinsicVoicingCost(voicing, targetCenter = 63) {
  const mean = voicing.reduce((s, m) => s + m, 0) / voicing.length;
  let cost = Math.abs(mean - targetCenter) * 0.45;

  // Tránh va chạm bán cung (minor 2nd) quá thấp dưới G3 (55) gây đục tiếng
  for (let i = 0; i < voicing.length - 1; i++) {
    const gap = voicing[i + 1] - voicing[i];
    if (gap <= 1 && voicing[i] < 57) cost += 6;
    if (gap === 2 && voicing[i] < 52) cost += 2.5;
  }

  // Ưu tiên độ trải rộng vừa phải (7..15 bán cung)
  const spread = voicing[voicing.length - 1] - voicing[0];
  if (spread > 17) cost += (spread - 17) * 0.8;
  if (spread < 6) cost += 1.5;

  return cost;
}

/**
 * Tính khoảng cách chuyển giọng (voice-leading distance) giữa hai thế bấm liên tiếp
 */
function transitionCost(prevVoicing, nextVoicing) {
  // Dùng khoảng cách dịch chuyển trung bình tối thiểu giữa từng bè
  let totalDist = 0;
  const prevSet = new Set(prevVoicing);

  for (let i = 0; i < nextVoicing.length; i++) {
    const note = nextVoicing[i];
    if (prevSet.has(note)) {
      // Thưởng mạnh khi giữ nguyên nốt chung (common tone) ở đúng quãng tám
      totalDist -= 0.7;
      continue;
    }
    let minD = Infinity;
    for (let j = 0; j < prevVoicing.length; j++) {
      const d = Math.abs(note - prevVoicing[j]);
      if (d < minD) minD = d;
    }
    totalDist += minD;
  }

  // Phạt bước nhảy lớn ở nốt giai điệu trên cùng (top voice) để nghe mượt như tay nghệ sĩ
  const topJump = Math.abs(
    nextVoicing[nextVoicing.length - 1] - prevVoicing[prevVoicing.length - 1]
  );
  if (topJump > 5) totalDist += (topJump - 5) * 0.6;

  return totalDist;
}

/**
 * Thuật toán Smart Voice Leading cho cả vòng hợp âm (4 hoặc 8 ô nhịp)
 */
export function generateVoicedProgression(chords, keyPc, scaleType) {
  const resolvedList = chords.map((ch) => resolveChord(ch, keyPc, scaleType));
  const preferFlats = shouldPreferFlats(keyPc, scaleType);
  const result = [];
  let prevVoicing = null;

  for (let i = 0; i < resolvedList.length; i++) {
    const resolved = resolvedList[i];
    const candidates = buildCandidateVoicings(resolved);
    let bestVoicing = candidates[0];
    let bestScore = Infinity;

    for (const cand of candidates) {
      let score = intrinsicVoicingCost(cand, 63);
      if (prevVoicing) {
        score += transitionCost(prevVoicing, cand) * 1.25;
      }
      // Ở ô nhịp cuối, kéo nhẹ về gần ô nhịp đầu để vòng lặp (loop) quay đầu êm tai
      if (i === resolvedList.length - 1 && result.length > 0) {
        score += transitionCost(cand, result[0].upperMidis) * 0.35;
      }
      if (score < bestScore) {
        bestScore = score;
        bestVoicing = cand;
      }
    }

    const bassMidi = computeBassMidi(resolved.rootPc);
    prevVoicing = bestVoicing;

    result.push({
      ...resolved,
      barIndex: i,
      bassMidi,
      upperMidis: bestVoicing,
      allMidis: [bassMidi, ...bestVoicing],
      voicingLabels: bestVoicing.map((m) => midiToNoteName(m, preferFlats)),
    });
  }

  return result;
}

// ============================================================================
// Bộ Preset Vòng Hợp Âm theo Màu Nhạc (Curated Musical Vibes)
// ============================================================================

export const PROGRESSION_PRESETS = [
  // --- R&B / Neo-Soul ---
  {
    id: 'rnb-neosoul',
    vibe: 'R&B / Neo-Soul',
    name: 'Neo-Soul Lãng Mạn',
    desc: 'ii7 – V7 – Imaj7 – vim7',
    keyPc: 3, // Eb
    scaleType: 'major',
    bpm: 84,
    bars: 4,
    style: 'rnb',
    timbre: 'rhodes',
    drums: 'lofi',
    humanize: 55,
    chords: [
      { degree: 1, extension: 'm7' },
      { degree: 4, extension: '7' },
      { degree: 0, extension: 'maj7' },
      { degree: 5, extension: 'm7' },
    ],
  },
  {
    id: 'rnb-midnight',
    vibe: 'R&B / Neo-Soul',
    name: 'Đêm Muộn Chill',
    desc: 'IVmaj7 – iii7 – ii7 – Imaj7',
    keyPc: 5, // F
    scaleType: 'major',
    bpm: 78,
    bars: 4,
    style: 'rnb',
    timbre: 'rhodes',
    drums: 'lofi',
    humanize: 60,
    chords: [
      { degree: 3, extension: 'maj7' },
      { degree: 2, extension: 'm7' },
      { degree: 1, extension: 'm7' },
      { degree: 0, extension: 'maj7' },
    ],
  },
  {
    id: 'rnb-8bar',
    vibe: 'R&B / Neo-Soul',
    name: 'R&B Cuốn Hút (8 ô)',
    desc: 'Vòng 8 ô nhịp có chuyển đoạn',
    keyPc: 0, // C
    scaleType: 'major',
    bpm: 88,
    bars: 8,
    style: 'rnb',
    timbre: 'rhodes',
    drums: 'lofi',
    humanize: 55,
    chords: [
      { degree: 5, extension: 'm7' },
      { degree: 3, extension: 'maj7' },
      { degree: 0, extension: 'maj7' },
      { degree: 4, extension: 'sus4' },
      { degree: 5, extension: 'm7' },
      { degree: 1, extension: 'm7' },
      { degree: 3, extension: 'maj7' },
      { degree: 4, extension: '7' },
    ],
  },

  // --- Ballad V-Pop ---
  {
    id: 'vpop-quocdan',
    vibe: 'Ballad V-Pop',
    name: 'V-Pop Quốc Dân',
    desc: 'IVmaj7 – Vadd9 – iii7 – vim7',
    keyPc: 7, // G
    scaleType: 'major',
    bpm: 74,
    bars: 4,
    style: 'ballad',
    timbre: 'piano',
    drums: 'ballad',
    humanize: 50,
    chords: [
      { degree: 3, extension: 'maj7' },
      { degree: 4, extension: 'add9' },
      { degree: 2, extension: 'm7' },
      { degree: 5, extension: 'm7' },
    ],
  },
  {
    id: 'vpop-tusu',
    vibe: 'Ballad V-Pop',
    name: 'Tự Sự Sâu Lắng',
    desc: 'vim7 – IVadd9 – Iadd9 – Vsus4',
    keyPc: 0, // C
    scaleType: 'major',
    bpm: 70,
    bars: 4,
    style: 'ballad',
    timbre: 'piano',
    drums: 'ballad',
    humanize: 50,
    chords: [
      { degree: 5, extension: 'm7' },
      { degree: 3, extension: 'add9' },
      { degree: 0, extension: 'add9' },
      { degree: 4, extension: 'sus4' },
    ],
  },
  {
    id: 'vpop-canon8',
    vibe: 'Ballad V-Pop',
    name: 'Ballad Cao Trào (8 ô)',
    desc: 'Vòng Canon mở rộng đầy cảm xúc',
    keyPc: 2, // D
    scaleType: 'major',
    bpm: 72,
    bars: 8,
    style: 'ballad',
    timbre: 'piano',
    drums: 'ballad',
    humanize: 48,
    chords: [
      { degree: 0, extension: 'add9' },
      { degree: 4, extension: 'triad' },
      { degree: 5, extension: 'm7' },
      { degree: 2, extension: 'm7' },
      { degree: 3, extension: 'maj7' },
      { degree: 0, extension: 'add9' },
      { degree: 1, extension: 'm7' },
      { degree: 4, extension: '7' },
    ],
  },

  // --- Lo-Fi Chill ---
  {
    id: 'lofi-rain',
    vibe: 'Lo-Fi Chill',
    name: 'Đêm Mưa Lo-Fi',
    desc: 'im7 – VImaj7 – IIImaj7 – VIIadd9',
    keyPc: 9, // Am
    scaleType: 'minor',
    bpm: 76,
    bars: 4,
    style: 'rnb',
    timbre: 'pad',
    drums: 'lofi',
    humanize: 65,
    chords: [
      { degree: 0, extension: 'm7' },
      { degree: 5, extension: 'maj7' },
      { degree: 2, extension: 'maj7' },
      { degree: 6, extension: 'add9' },
    ],
  },
  {
    id: 'lofi-coffee',
    vibe: 'Lo-Fi Chill',
    name: 'Cà Phê Sáng',
    desc: 'Imaj7 – vim7 – ii7 – V7',
    keyPc: 0, // C
    scaleType: 'major',
    bpm: 80,
    bars: 4,
    style: 'ballad',
    timbre: 'rhodes',
    drums: 'lofi',
    humanize: 60,
    chords: [
      { degree: 0, extension: 'maj7' },
      { degree: 5, extension: 'm7' },
      { degree: 1, extension: 'm7' },
      { degree: 4, extension: '7' },
    ],
  },

  // --- Pop Hiện Đại ---
  {
    id: 'pop-modern',
    vibe: 'Pop Hiện Đại',
    name: 'Pop Sôi Động',
    desc: 'Iadd9 – V – vim7 – IVmaj7',
    keyPc: 0, // C
    scaleType: 'major',
    bpm: 112,
    bars: 4,
    style: 'pop',
    timbre: 'guitar',
    drums: 'pop',
    humanize: 35,
    chords: [
      { degree: 0, extension: 'add9' },
      { degree: 4, extension: 'triad' },
      { degree: 5, extension: 'm7' },
      { degree: 3, extension: 'maj7' },
    ],
  },
  {
    id: 'pop-acoustic',
    vibe: 'Pop Hiện Đại',
    name: 'Indie Acoustic Tươi',
    desc: 'IVmaj7 – Iadd9 – Vsus4 – vim7',
    keyPc: 9, // A
    scaleType: 'major',
    bpm: 104,
    bars: 4,
    style: 'strum',
    timbre: 'guitar',
    drums: 'pop',
    humanize: 40,
    chords: [
      { degree: 3, extension: 'maj7' },
      { degree: 0, extension: 'add9' },
      { degree: 4, extension: 'sus4' },
      { degree: 5, extension: 'm7' },
    ],
  },
  {
    id: 'pop-minor',
    vibe: 'Pop Hiện Đại',
    name: 'Synth Pop Đêm',
    desc: 'im7 – VImaj7 – III – VII',
    keyPc: 5, // Fm
    scaleType: 'minor',
    bpm: 116,
    bars: 4,
    style: 'pop',
    timbre: 'rhodes',
    drums: 'pop',
    humanize: 35,
    chords: [
      { degree: 0, extension: 'm7' },
      { degree: 5, extension: 'maj7' },
      { degree: 2, extension: 'triad' },
      { degree: 6, extension: 'triad' },
    ],
  },
];

/**
 * Tạo mảng sự kiện nốt (deterministic, theo đơn vị beat) cho 1 ô nhịp dựa vào kiểu đệm.
 * Gắn rõ role ('bass' | 'chord') để tách chuẩn Track 1 (Hợp âm tay phải) và Track 2 (Bass nền).
 * Dùng chung cho cả Tone.js playback VÀ bộ xuất MIDI (.mid)!
 */
export function buildBarChordEvents(voicedChord, barIndex, style = 'rnb') {
  const barStart = barIndex * 4;
  const bass = voicedChord.bassMidi;
  const upper = voicedChord.upperMidis; // sorted ascending, 3 or 4 notes
  const n = upper.length;
  const v0 = upper[0];
  const v1 = upper[Math.min(1, n - 1)];
  const v2 = upper[Math.min(2, n - 1)];
  const vTop = upper[n - 1];
  const events = [];

  const pushEvent = (midi, beatOffset, dur, vel, role) => {
    const durationBeat = Math.max(0.15, dur);
    events.push({
      midi,
      startBeat: barStart + beatOffset,
      durationBeat,
      durationBeats: durationBeat,
      velocity: Math.min(0.95, Math.max(0.15, vel)),
      role,
    });
  };

  const pushTaggedChord = (beatOffset, items, dur, vel, rollBeats = 0, reverseRoll = false) => {
    const ordered = reverseRoll ? [...items].reverse() : items;
    ordered.forEach((item, idx) => {
      pushEvent(
        item.midi,
        beatOffset + idx * rollBeats,
        dur - idx * rollBeats * 0.4,
        vel - idx * 0.02,
        item.role
      );
    });
  };

  const tagUpper = (list) => list.map((midi) => ({ midi, role: 'chord' }));
  const tagWithBass = (list) => [{ midi: bass, role: 'bass' }, ...tagUpper(list)];

  if (style === 'ballad') {
    // Rải Ballad mềm mại có sustain pedal cảm xúc
    pushEvent(bass, 0.0, 3.85, 0.74, 'bass');
    pushEvent(v0,   0.0, 2.20, 0.62, 'chord');
    pushEvent(v1,   0.5, 2.00, 0.56, 'chord');
    pushEvent(v2,   1.0, 1.90, 0.60, 'chord');
    pushEvent(vTop, 1.5, 1.80, 0.54, 'chord');
    // Nửa ô sau bồng bềnh nhẹ
    pushEvent(bass + 12 <= 58 ? bass + 12 : bass, 2.0, 1.80, 0.52, 'bass');
    pushEvent(v1,   2.0, 1.70, 0.58, 'chord');
    pushEvent(v2,   2.5, 1.40, 0.52, 'chord');
    pushEvent(vTop, 3.0, 0.95, 0.56, 'chord');
    pushEvent(v0,   3.5, 0.55, 0.46, 'chord');
  } else if (style === 'rnb') {
    // Lơi nhịp R&B / Neo-Soul: rải nhẹ đầu hợp âm + đảo phách êm tai
    pushTaggedChord(0.0, tagWithBass(upper), 1.45, 0.74, 0.032, false);
    // Phách nhấn đảo nhịp nhẹ (pickup 1.75)
    pushTaggedChord(1.75, tagUpper(upper), 0.45, 0.50, 0.015, false);
    // Hợp âm trả lời lơi nhịp ở 2.5
    pushTaggedChord(2.5, tagWithBass(upper), 1.15, 0.68, 0.025, false);
    // Chấm đuôi tinh tế ở 3.5
    pushEvent(vTop, 3.5, 0.45, 0.48, 'chord');
    if (n >= 2) {
      pushEvent(upper[n - 2], 3.53, 0.42, 0.42, 'chord');
    }
  } else if (style === 'pop') {
    // Đệm Pop Hiện Đại: chặt nhịp gọn gàng, năng lượng
    pushTaggedChord(0.0, tagWithBass(upper), 0.85, 0.78, 0.01, false);
    pushTaggedChord(1.0, tagUpper(upper), 0.65, 0.60, 0.008, false);
    pushTaggedChord(1.5, tagUpper(upper.slice(-2)), 0.42, 0.52, 0.008, false);
    pushTaggedChord(2.0, tagWithBass(upper), 0.78, 0.72, 0.01, false);
    pushTaggedChord(3.0, tagUpper(upper), 0.58, 0.64, 0.008, false);
    pushTaggedChord(3.5, tagWithBass(upper.slice(0, 2)), 0.42, 0.50, 0.008, false);
  } else if (style === 'strum') {
    // Quạt chả Acoustic: D - D U - U D U với độ rải dây đàn lên/xuống
    pushTaggedChord(0.0, tagWithBass(upper), 0.92, 0.80, 0.022, false); // Down
    pushTaggedChord(1.0, tagWithBass([v0, v1]), 0.42, 0.60, 0.016, false); // Down palm-muted feel
    pushTaggedChord(1.5, tagUpper(upper), 0.48, 0.55, 0.018, true); // Up
    pushTaggedChord(2.5, tagWithBass(upper), 0.52, 0.64, 0.018, true); // Up
    pushTaggedChord(3.0, tagWithBass(upper), 0.48, 0.74, 0.020, false); // Down
    pushTaggedChord(3.5, tagUpper(upper), 0.42, 0.52, 0.016, true); // Up
  } else {
    pushTaggedChord(0.0, tagWithBass(upper), 3.8, 0.72, 0.02, false);
  }

  return events;
}
