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
  { id: 'triad', label: '1-3-5 (Gốc)', suffix: '' },
  { id: 'maj7',  label: 'maj7 (1-3-5-7)', suffix: 'maj7' },
  { id: 'm7',    label: 'm7 (1-b3-5-b7)', suffix: 'm7' },
  { id: '7',     label: '7 (1-3-5-b7)', suffix: '7' },
  { id: 'add9',  label: 'add9', suffix: 'add9' },
  { id: 'sus2',  label: 'sus2', suffix: 'sus2' },
  { id: 'sus4',  label: 'sus4', suffix: 'sus4' },
];

// Đầy đủ 7 hợp âm Trưởng cơ bản (C D E F G A B) và 7 hợp âm Thứ cơ bản (Cm Dm Em Fm Gm Am Bm)
export const BASIC_MAJOR_CHORDS = [
  { rootPc: 0,  quality: 'maj', name: 'C',  viName: 'Đô Trưởng' },
  { rootPc: 2,  quality: 'maj', name: 'D',  viName: 'Rê Trưởng' },
  { rootPc: 4,  quality: 'maj', name: 'E',  viName: 'Mi Trưởng' },
  { rootPc: 5,  quality: 'maj', name: 'F',  viName: 'Fa Trưởng' },
  { rootPc: 7,  quality: 'maj', name: 'G',  viName: 'Sol Trưởng' },
  { rootPc: 9,  quality: 'maj', name: 'A',  viName: 'La Trưởng' },
  { rootPc: 11, quality: 'maj', name: 'B',  viName: 'Si Trưởng' },
];

export const BASIC_MINOR_CHORDS = [
  { rootPc: 0,  quality: 'min', name: 'Cm', viName: 'Đô Thứ' },
  { rootPc: 2,  quality: 'min', name: 'Dm', viName: 'Rê Thứ' },
  { rootPc: 4,  quality: 'min', name: 'Em', viName: 'Mi Thứ' },
  { rootPc: 5,  quality: 'min', name: 'Fm', viName: 'Fa Thứ' },
  { rootPc: 7,  quality: 'min', name: 'Gm', viName: 'Sol Thứ' },
  { rootPc: 9,  quality: 'min', name: 'Am', viName: 'La Thứ' },
  { rootPc: 11, quality: 'min', name: 'Bm', viName: 'Si Thứ' },
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
 * Tính các khoảng bán cung (intervals) và tên hiển thị cho một hợp âm (hỗ trợ cả bậc Diatonic lẫn hợp âm Trưởng/Thứ tự do)
 */
export function resolveChord(chordSpec, keyPc, scaleType) {
  const scale = SCALES[scaleType] || SCALES.major;
  const preferFlats = shouldPreferFlats(keyPc, scaleType);
  const ext = chordSpec.extension || 'triad';
  const isCustom = Boolean(chordSpec && chordSpec.custom && typeof chordSpec.rootPc === 'number');

  let degree = Math.max(0, Math.min(6, chordSpec.degree ?? 0));
  let rootPc;
  let baseQuality;
  let baseRoman;

  if (isCustom) {
    rootPc = ((chordSpec.rootPc % 12) + 12) % 12;
    baseQuality =
      chordSpec.quality === 'min' ? 'min' : chordSpec.quality === 'dim' ? 'dim' : 'maj';
    const scaleIdx = scale.intervals.findIndex((iv) => (keyPc + iv) % 12 === rootPc);
    if (scaleIdx >= 0) {
      degree = scaleIdx;
      const rawRom = scale.romans[scaleIdx].replace('°', '');
      baseRoman = baseQuality === 'min' ? rawRom.toLowerCase() : rawRom.toUpperCase();
    } else {
      const semiFromKey = ((rootPc - keyPc) % 12 + 12) % 12;
      const chromaticMaj = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
      const r = chromaticMaj[semiFromKey] || 'I';
      baseRoman = baseQuality === 'min' ? r.toLowerCase() : r;
    }
  } else {
    rootPc = (keyPc + scale.intervals[degree]) % 12;
    baseQuality = scale.diatonicQualities[degree];
    baseRoman = scale.romans[degree];
  }

  const naturalNames = { 0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B' };
  const rootName = isCustom && naturalNames[rootPc]
    ? naturalNames[rootPc]
    : pcToNoteName(rootPc, preferFlats);

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
    custom: isCustom,
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
      // Thay đổi nhẹ độ cao trung tâm theo vai trò từng ô nhịp (A -> A' -> B -> Turnaround)
      // để vòng hợp âm có nhịp dâng/lắng tự nhiên thay vì bó mãi ở 1 vùng cao độ
      const barPhase = i % 4;
      const dynamicCenter = barPhase === 0 ? 61 : barPhase === 1 ? 62 : barPhase === 2 ? 64 : 60;
      let score = intrinsicVoicingCost(cand, dynamicCenter);
      if (prevVoicing) {
        score += transitionCost(prevVoicing, cand) * 1.05;
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
    // Công thức thế gốc 1-3-5 / 1-3-5-7 và công thức 1-5-8 chuẩn nhạc lý
    const rootBaseMidi = (resolved.rootPc >= 7 ? 48 : 60) + resolved.rootPc;
    const rootOrderedMidis = resolved.intervals.map((iv) => rootBaseMidi + iv);
    const fifthInterval = resolved.intervals[2] ?? 7;
    const bass158Midis = [bassMidi, bassMidi + fifthInterval, bassMidi + 12];
    prevVoicing = bestVoicing;

    result.push({
      ...resolved,
      barIndex: i,
      bassMidi,
      upperMidis: bestVoicing,
      rootOrderedMidis,
      bass158Midis,
      allMidis: [bassMidi, ...bestVoicing],
      voicingLabels: bestVoicing.map((m) => midiToNoteName(m, preferFlats)),
      rootOrderedLabels: rootOrderedMidis.map((m) => midiToNoteName(m, preferFlats)),
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
    id: 'pop-piano-warm',
    vibe: 'Pop Hiện Đại',
    name: 'Pop Piano Trầm Ấm',
    desc: 'Iadd9 – V – vim7 – IVmaj7',
    keyPc: 0, // C
    scaleType: 'major',
    bpm: 98,
    bars: 4,
    style: 'pop_groove',
    timbre: 'modern_piano',
    drums: 'pop',
    humanize: 42,
    chords: [
      { degree: 0, extension: 'add9' },
      { degree: 4, extension: 'triad' },
      { degree: 5, extension: 'm7' },
      { degree: 3, extension: 'maj7' },
    ],
  },
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
export function buildBarChordEvents(
  voicedChord,
  barIndex,
  style = 'rnb',
  nextVoicedChord = null,
  totalBars = 4
) {
  const barStart = barIndex * 4;
  const bass = voicedChord.bassMidi;
  const upper = voicedChord.upperMidis; // sorted ascending, 3 or 4 notes
  const n = upper.length;
  const v0 = upper[0];
  const v1 = upper[Math.min(1, n - 1)];
  const v2 = upper[Math.min(2, n - 1)];
  const vTop = upper[n - 1];
  const vOct = vTop + 12 <= 82 ? vTop + 12 : v0 + 12 <= 80 ? v0 + 12 : vTop;
  const events = [];

  const phase = barIndex % 4;
  const isOddBar = phase % 2 === 1;
  const isTurnaround = barIndex === totalBars - 1 || phase === 3;
  const isLiftBar = phase === 2;

  // Tính nốt dẫn Bass (Passing Bass) nối mượt sang hợp âm kế tiếp
  const computePassingBass = () => {
    const nextBass = nextVoicedChord && Number.isFinite(nextVoicedChord.bassMidi)
      ? nextVoicedChord.bassMidi
      : bass;
    let leadBass;
    if (nextBass !== bass) {
      const stepDir = nextBass > bass ? -1 : 1;
      leadBass = nextBass + stepDir;
      if (Math.abs(nextBass - bass) <= 2) {
        leadBass = nextBass + 7 <= 56 ? nextBass + 7 : nextBass - 5;
      }
    } else {
      leadBass = bass + 7 <= 56 ? bass + 7 : bass - 5;
    }
    while (leadBass < 34) leadBass += 12;
    while (leadBass > 56) leadBass -= 12;
    return leadBass;
  };
  const passingBass = computePassingBass();
  const warmHighBass = bass + 12 <= 58 ? bass + 12 : bass;

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

  // Chuẩn hóa công thức nốt gốc 1-3-5 / 1-3-5-7 và 1-5-8
  const rootSeq =
    Array.isArray(voicedChord.rootOrderedMidis) && voicedChord.rootOrderedMidis.length > 0
      ? voicedChord.rootOrderedMidis
      : upper;
  const r1 = rootSeq[0];
  const r3 = rootSeq[Math.min(1, rootSeq.length - 1)];
  const r5 = rootSeq[Math.min(2, rootSeq.length - 1)];
  const r7 = rootSeq.length >= 4 ? rootSeq[3] : r1 + 12;

  const arp158 =
    Array.isArray(voicedChord.bass158Midis) && voicedChord.bass158Midis.length === 3
      ? voicedChord.bass158Midis
      : [bass, bass + 7, bass + 12];
  const b1 = arp158[0];
  const b5 = arp158[1];
  const b8 = arp158[2];

  if (style === 'block') {
    // Block Chord: Bấm các nốt hợp âm cùng lúc — chắc nhịp, cao trào hoặc đệm hát đơn giản
    if (isTurnaround) {
      pushTaggedChord(0.0, tagWithBass(upper), 0.90, 0.80, 0, false);
      pushTaggedChord(1.0, tagWithBass(upper), 0.88, 0.72, 0, false);
      pushTaggedChord(2.0, tagWithBass(upper), 0.88, 0.78, 0, false);
      pushEvent(passingBass, 3.0, 0.48, 0.68, 'bass');
      pushTaggedChord(3.0, tagUpper(upper), 0.46, 0.72, 0, false);
      pushEvent(passingBass, 3.5, 0.45, 0.70, 'bass');
      pushTaggedChord(3.5, tagUpper([...upper, vOct]), 0.45, 0.76, 0, false);
    } else if (isOddBar) {
      pushTaggedChord(0.0, tagWithBass(upper), 1.35, 0.78, 0, false);
      pushTaggedChord(1.5, tagWithBass(upper), 0.46, 0.64, 0, false);
      pushTaggedChord(2.0, tagWithBass(upper), 0.90, 0.76, 0, false);
      pushTaggedChord(3.0, tagWithBass(upper), 0.88, 0.70, 0, false);
    } else if (isLiftBar) {
      const liftChord = [...upper, vOct];
      pushTaggedChord(0.0, tagWithBass(liftChord), 0.90, 0.82, 0, false);
      pushTaggedChord(1.0, tagWithBass(liftChord), 0.90, 0.74, 0, false);
      pushTaggedChord(2.0, tagWithBass(liftChord), 0.90, 0.80, 0, false);
      pushTaggedChord(3.0, tagWithBass(liftChord), 0.90, 0.76, 0, false);
    } else {
      pushTaggedChord(0.0, tagWithBass(upper), 0.92, 0.80, 0, false);
      pushTaggedChord(1.0, tagWithBass(upper), 0.90, 0.70, 0, false);
      pushTaggedChord(2.0, tagWithBass(upper), 0.90, 0.76, 0, false);
      pushTaggedChord(3.0, tagWithBass(upper), 0.90, 0.70, 0, false);
    }
  } else if (style === 'broken_1357') {
    // Broken Chord / Arpeggio: Chơi lần lượt đúng thứ tự 1-3-5 (hợp âm 3) & 1-3-5-7 (hợp âm 7)
    if (isTurnaround) {
      pushEvent(b1,  0.0, 2.80, 0.72, 'bass');
      pushEvent(r1,  0.0, 0.85, 0.66, 'chord');
      pushEvent(r3,  0.5, 0.75, 0.62, 'chord');
      pushEvent(r5,  1.0, 0.70, 0.66, 'chord');
      pushEvent(r7,  1.5, 0.68, 0.64, 'chord');
      pushEvent(r1 + 12 <= 82 ? r1 + 12 : r7, 2.0, 0.60, 0.64, 'chord');
      pushEvent(r5,  2.5, 0.55, 0.56, 'chord');
      pushEvent(passingBass, 3.0, 0.92, 0.64, 'bass');
      pushEvent(r3,  3.0, 0.50, 0.58, 'chord');
      pushEvent(r7,  3.5, 0.45, 0.54, 'chord');
    } else if (isOddBar) {
      // Ô lẻ: rải 1-3-5-7 đi lên rồi xuống êm mượt
      pushEvent(b1,  0.0, 3.70, 0.72, 'bass');
      pushEvent(r1,  0.0, 0.85, 0.65, 'chord');
      pushEvent(r3,  0.5, 0.80, 0.60, 'chord');
      pushEvent(r5,  1.0, 0.78, 0.64, 'chord');
      pushEvent(r7,  1.5, 0.75, 0.62, 'chord');
      pushEvent(warmHighBass, 2.0, 1.75, 0.54, 'bass');
      pushEvent(r5,  2.0, 0.70, 0.60, 'chord');
      pushEvent(r3,  2.5, 0.65, 0.56, 'chord');
      pushEvent(r5,  3.0, 0.55, 0.58, 'chord');
      pushEvent(r7,  3.5, 0.46, 0.52, 'chord');
    } else {
      // Ô chẵn: mẫu rải lặp 1-3-5-7 / 1-3-5-8 rõ ràng cho Ballad & Pop
      pushEvent(b1,  0.0, 2.20, 0.74, 'bass');
      pushEvent(r1,  0.0, 0.90, 0.66, 'chord');
      pushEvent(r3,  0.5, 0.85, 0.60, 'chord');
      pushEvent(r5,  1.0, 0.80, 0.64, 'chord');
      pushEvent(r7,  1.5, 0.75, 0.60, 'chord');
      pushEvent(b1,  2.0, 1.80, 0.68, 'bass');
      pushEvent(r1,  2.0, 0.82, 0.64, 'chord');
      pushEvent(r3,  2.5, 0.75, 0.58, 'chord');
      pushEvent(r5,  3.0, 0.65, 0.62, 'chord');
      pushEvent(r7,  3.5, 0.46, 0.54, 'chord');
    }
  } else if (style === 'pattern_158') {
    // Kiểu đệm 1-5-8 kinh điển (tay trái rải rộng 1 -> 5 -> 8, tay phải thả hòa âm)
    if (isTurnaround) {
      pushEvent(b1,  0.0, 1.45, 0.78, 'bass');
      pushEvent(b5,  0.5, 1.15, 0.68, 'bass');
      pushEvent(b8,  1.0, 1.10, 0.72, 'bass');
      pushTaggedChord(1.5, tagUpper([v1, vTop]), 0.65, 0.58, 0.02, false);
      pushEvent(b1,  2.0, 1.00, 0.74, 'bass');
      pushEvent(b5,  2.5, 0.70, 0.64, 'bass');
      pushEvent(passingBass, 3.0, 0.92, 0.68, 'bass');
      pushTaggedChord(3.0, tagUpper([v0, v2, vTop]), 0.85, 0.62, 0.02, false);
    } else if (isOddBar) {
      pushEvent(b1,  0.0, 1.80, 0.76, 'bass');
      pushEvent(b5,  0.5, 1.30, 0.66, 'bass');
      pushEvent(b8,  1.0, 1.15, 0.70, 'bass');
      pushTaggedChord(1.5, tagUpper(upper), 0.75, 0.60, 0.02, true);
      pushEvent(b5,  2.0, 1.45, 0.64, 'bass');
      pushEvent(b8,  2.5, 1.10, 0.66, 'bass');
      pushTaggedChord(3.0, tagUpper([v1, vOct]), 0.82, 0.58, 0.02, false);
    } else {
      pushEvent(b1,  0.0, 1.90, 0.78, 'bass');
      pushEvent(b5,  0.5, 1.40, 0.68, 'bass');
      pushEvent(b8,  1.0, 1.25, 0.72, 'bass');
      pushEvent(b5,  1.5, 0.80, 0.60, 'bass');
      pushEvent(b1,  2.0, 1.70, 0.74, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 1.45, 0.66, 0.024, false);
      pushEvent(b5,  2.5, 1.10, 0.62, 'bass');
      pushEvent(b8,  3.0, 0.85, 0.66, 'bass');
      pushEvent(vOct, 3.5, 0.45, 0.52, 'chord');
    }
  } else if (style === 'bass_chord') {
    // Bass + Chord: Tay trái chơi nốt trầm, tay phải đánh hợp âm đệm hát nền tảng
    if (isTurnaround) {
      pushEvent(b1, 0.0, 1.85, 0.78, 'bass');
      pushTaggedChord(0.0, tagUpper(upper), 0.85, 0.70, 0.008, false);
      pushTaggedChord(1.0, tagUpper(upper), 0.72, 0.62, 0.006, false);
      pushEvent(b5 <= 56 ? b5 : b1, 2.0, 0.90, 0.70, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 0.80, 0.68, 0.008, false);
      pushEvent(passingBass, 3.0, 0.92, 0.70, 'bass');
      pushTaggedChord(3.0, tagUpper(upper), 0.45, 0.64, 0.006, false);
      pushTaggedChord(3.5, tagUpper([v1, vTop]), 0.45, 0.62, 0.008, false);
    } else if (isOddBar) {
      pushEvent(b1, 0.0, 1.90, 0.78, 'bass');
      pushTaggedChord(0.5, tagUpper(upper), 0.48, 0.62, 0.008, false);
      pushTaggedChord(1.5, tagUpper(upper), 0.48, 0.64, 0.008, false);
      pushEvent(b1, 2.0, 1.75, 0.74, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 0.82, 0.68, 0.008, false);
      pushTaggedChord(3.0, tagUpper(upper), 0.75, 0.64, 0.006, false);
    } else {
      pushEvent(b1, 0.0, 1.90, 0.80, 'bass');
      pushTaggedChord(0.0, tagUpper(upper), 0.88, 0.72, 0.008, false);
      pushTaggedChord(1.0, tagUpper(upper), 0.78, 0.62, 0.006, false);
      pushEvent(b5 <= 56 ? b5 : b1, 2.0, 1.75, 0.72, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 0.86, 0.70, 0.008, false);
      pushTaggedChord(3.0, tagUpper(upper), 0.78, 0.64, 0.006, false);
    }
  } else if (style === 'ballad') {
    // Rải Ballad biến thể A / A' / B / Turnaround có nốt luyến & passing bass cuối câu
    if (isTurnaround) {
      pushEvent(bass, 0.0, 2.75, 0.74, 'bass');
      pushEvent(v0,   0.0, 1.80, 0.62, 'chord');
      pushEvent(v1,   0.5, 1.60, 0.56, 'chord');
      pushEvent(v2,   1.0, 1.50, 0.60, 'chord');
      pushEvent(vTop, 1.5, 1.25, 0.58, 'chord');
      pushEvent(vOct, 2.0, 0.90, 0.55, 'chord');
      pushEvent(v2,   2.5, 0.65, 0.50, 'chord');
      pushEvent(passingBass, 3.0, 0.92, 0.58, 'bass');
      pushTaggedChord(3.0, tagUpper([v1, vTop]), 0.85, 0.54, 0.03, false);
    } else if (isOddBar) {
      // Ô lẻ: đảo chiều rải xuống nhẹ ở nửa sau tạo câu đáp dịu dàng
      pushEvent(bass, 0.0, 3.45, 0.72, 'bass');
      pushEvent(v0,   0.0, 1.95, 0.60, 'chord');
      pushEvent(v2,   0.5, 1.75, 0.56, 'chord');
      pushEvent(vTop, 1.0, 1.55, 0.60, 'chord');
      pushEvent(v1,   1.5, 1.35, 0.52, 'chord');
      pushEvent(warmHighBass, 2.0, 1.60, 0.50, 'bass');
      pushEvent(v2,   2.0, 1.55, 0.56, 'chord');
      pushEvent(vTop, 2.5, 1.15, 0.52, 'chord');
      pushEvent(vOct, 3.0, 0.78, 0.54, 'chord');
      pushEvent(v1,   3.5, 0.45, 0.44, 'chord');
    } else if (isLiftBar) {
      // Ô 3: mở rộng quãng + nhịp lướt tinh tế tạo cao trào nửa sau vòng hợp âm
      pushEvent(bass, 0.0, 3.70, 0.76, 'bass');
      pushEvent(v0,   0.0, 2.10, 0.64, 'chord');
      pushEvent(v1,   0.5, 1.90, 0.58, 'chord');
      pushEvent(vTop, 1.0, 1.50, 0.62, 'chord');
      pushEvent(vOct, 1.75, 1.25, 0.56, 'chord');
      pushEvent(warmHighBass, 2.0, 1.70, 0.54, 'bass');
      pushEvent(v1,   2.25, 1.35, 0.60, 'chord');
      pushEvent(v2,   2.75, 1.05, 0.54, 'chord');
      pushEvent(vTop, 3.25, 0.72, 0.56, 'chord');
      pushEvent(vOct, 3.5, 0.48, 0.48, 'chord');
    } else {
      pushEvent(bass, 0.0, 3.85, 0.74, 'bass');
      pushEvent(v0,   0.0, 2.20, 0.62, 'chord');
      pushEvent(v1,   0.5, 2.00, 0.56, 'chord');
      pushEvent(v2,   1.0, 1.90, 0.60, 'chord');
      pushEvent(vTop, 1.5, 1.80, 0.54, 'chord');
      pushEvent(warmHighBass, 2.0, 1.80, 0.52, 'bass');
      pushEvent(v1,   2.0, 1.70, 0.58, 'chord');
      pushEvent(v2,   2.5, 1.40, 0.52, 'chord');
      pushEvent(vTop, 3.0, 0.95, 0.56, 'chord');
      pushEvent(v0,   3.5, 0.55, 0.46, 'chord');
    }
  } else if (style === 'rnb') {
    // Lơi nhịp R&B / Neo-Soul có câu hỏi-đáp, ghost chords & passing bass dẫn ô
    if (isTurnaround) {
      pushTaggedChord(0.0, tagWithBass(upper), 1.40, 0.74, 0.030, false);
      pushTaggedChord(1.75, tagUpper(upper.slice(-2)), 0.42, 0.48, 0.015, true);
      pushTaggedChord(2.5, tagWithBass(upper), 0.88, 0.68, 0.024, false);
      pushEvent(passingBass, 3.5, 0.46, 0.58, 'bass');
      pushTaggedChord(3.5, tagUpper([v1, vOct]), 0.44, 0.52, 0.02, false);
    } else if (isOddBar) {
      pushTaggedChord(0.0, tagWithBass(upper), 1.65, 0.72, 0.036, false);
      pushEvent(vOct, 1.5, 0.38, 0.44, 'chord');
      pushTaggedChord(2.25, tagUpper(upper), 0.75, 0.60, 0.022, true);
      pushEvent(warmHighBass, 2.5, 0.95, 0.54, 'bass');
      pushTaggedChord(3.25, tagUpper([v1, v2]), 0.55, 0.46, 0.014, false);
    } else if (isLiftBar) {
      pushTaggedChord(0.0, tagWithBass([...upper, vOct]), 1.50, 0.76, 0.028, false);
      pushTaggedChord(1.5, tagUpper(upper.slice(-2)), 0.40, 0.48, 0.012, false);
      pushTaggedChord(2.5, tagWithBass(upper), 1.05, 0.70, 0.024, false);
      pushEvent(vOct, 3.5, 0.45, 0.50, 'chord');
    } else {
      pushTaggedChord(0.0, tagWithBass(upper), 1.45, 0.74, 0.032, false);
      pushTaggedChord(1.75, tagUpper(upper), 0.45, 0.50, 0.015, false);
      pushTaggedChord(2.5, tagWithBass(upper), 1.15, 0.68, 0.025, false);
      pushEvent(vTop, 3.5, 0.45, 0.48, 'chord');
      if (n >= 2) {
        pushEvent(upper[n - 2], 3.53, 0.42, 0.42, 'chord');
      }
    }
  } else if (style === 'pop') {
    // Đệm Pop Hiện Đại: nhấn mạnh, rải nhịp phụ & bước dẫn bass
    if (isTurnaround) {
      pushTaggedChord(0.0, tagWithBass(upper), 0.88, 0.78, 0.010, false);
      pushTaggedChord(1.0, tagUpper(upper), 0.62, 0.62, 0.008, false);
      pushTaggedChord(2.0, tagWithBass(upper), 0.75, 0.74, 0.010, false);
      pushEvent(passingBass, 3.0, 0.46, 0.60, 'bass');
      pushTaggedChord(3.0, tagUpper([v1, vTop]), 0.42, 0.64, 0.008, false);
      pushEvent(passingBass, 3.5, 0.44, 0.64, 'bass');
      pushTaggedChord(3.5, tagUpper([v2, vOct]), 0.44, 0.60, 0.010, false);
    } else if (isOddBar) {
      pushTaggedChord(0.0, tagWithBass(upper), 0.92, 0.76, 0.012, false);
      pushTaggedChord(1.0, tagUpper([v0, v1]), 0.48, 0.54, 0.008, false);
      pushTaggedChord(1.5, tagUpper([v2, vTop]), 0.68, 0.62, 0.010, false);
      pushEvent(bass, 2.5, 0.95, 0.70, 'bass');
      pushTaggedChord(2.5, tagUpper(upper), 0.75, 0.68, 0.010, false);
      pushEvent(vOct, 3.5, 0.42, 0.50, 'chord');
    } else if (isLiftBar) {
      pushTaggedChord(0.0, tagWithBass([...upper, vOct]), 0.85, 0.80, 0.012, false);
      pushTaggedChord(1.0, tagUpper(upper), 0.60, 0.62, 0.008, false);
      pushTaggedChord(1.5, tagUpper(upper.slice(-2)), 0.45, 0.54, 0.008, false);
      pushTaggedChord(2.0, tagWithBass(upper), 0.75, 0.74, 0.010, false);
      pushTaggedChord(3.0, tagUpper([...upper.slice(-2), vOct]), 0.56, 0.66, 0.010, false);
      pushTaggedChord(3.5, tagUpper([v1, v2]), 0.42, 0.52, 0.008, false);
    } else {
      pushTaggedChord(0.0, tagWithBass(upper), 0.85, 0.78, 0.01, false);
      pushTaggedChord(1.0, tagUpper(upper), 0.65, 0.60, 0.008, false);
      pushTaggedChord(1.5, tagUpper(upper.slice(-2)), 0.42, 0.52, 0.008, false);
      pushTaggedChord(2.0, tagWithBass(upper), 0.78, 0.72, 0.01, false);
      pushTaggedChord(3.0, tagUpper(upper), 0.58, 0.64, 0.008, false);
      pushTaggedChord(3.5, tagWithBass(upper.slice(0, 2)), 0.42, 0.50, 0.008, false);
    }
  } else if (style === 'pop_groove') {
    // Pop Trầm Ấm / Pulse (rất hợp Piano Pop Trầm Ấm: bass ấm nâng đỡ + rải nốt trên tạo chiều sâu)
    if (isTurnaround) {
      pushEvent(bass, 0.0, 2.35, 0.76, 'bass');
      pushTaggedChord(0.0, tagUpper(upper), 0.90, 0.72, 0.018, false);
      pushEvent(vTop, 1.0, 0.50, 0.56, 'chord');
      pushEvent(v2,   1.5, 0.45, 0.52, 'chord');
      pushEvent(warmHighBass, 2.0, 0.88, 0.62, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 0.82, 0.68, 0.016, false);
      pushEvent(passingBass, 3.0, 0.92, 0.66, 'bass');
      pushEvent(vOct, 3.0, 0.48, 0.58, 'chord');
      pushEvent(vTop, 3.5, 0.46, 0.52, 'chord');
    } else if (isOddBar) {
      pushEvent(bass, 0.0, 2.25, 0.74, 'bass');
      pushTaggedChord(0.0, tagUpper(upper), 1.30, 0.70, 0.022, false);
      pushEvent(vOct, 1.5, 0.48, 0.52, 'chord');
      pushEvent(bass, 2.0, 1.85, 0.68, 'bass');
      pushTaggedChord(2.5, tagUpper([v0, v1, v2]), 0.85, 0.62, 0.018, false);
      pushEvent(vTop, 3.5, 0.46, 0.50, 'chord');
    } else if (isLiftBar) {
      pushEvent(bass, 0.0, 1.85, 0.78, 'bass');
      pushTaggedChord(0.0, tagUpper([...upper, vOct]), 0.85, 0.74, 0.016, false);
      pushEvent(v1,   1.0, 0.46, 0.54, 'chord');
      pushEvent(vTop, 1.5, 0.46, 0.58, 'chord');
      pushEvent(bass, 2.0, 1.85, 0.72, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 0.82, 0.68, 0.014, false);
      pushEvent(v2,   3.0, 0.45, 0.56, 'chord');
      pushEvent(vOct, 3.5, 0.45, 0.54, 'chord');
    } else {
      pushEvent(bass, 0.0, 2.35, 0.76, 'bass');
      pushTaggedChord(0.0, tagUpper(upper), 0.92, 0.72, 0.020, false);
      pushEvent(v1,   1.0, 0.45, 0.52, 'chord');
      pushEvent(v2,   1.5, 0.45, 0.56, 'chord');
      pushEvent(bass, 2.0, 1.85, 0.70, 'bass');
      pushTaggedChord(2.0, tagUpper(upper), 0.88, 0.66, 0.016, false);
      pushEvent(vTop, 3.0, 0.48, 0.54, 'chord');
      pushEvent(v1,   3.5, 0.44, 0.46, 'chord');
    }
  } else if (style === 'lofi') {
    // Chill / Lo-Fi Rải Chậm sâu lắng
    const topShimmer = isOddBar ? vOct : vTop;
    pushEvent(bass, 0.0, isTurnaround ? 2.9 : 3.7, 0.70, 'bass');
    pushTaggedChord(0.0, tagUpper(upper), 1.65, 0.64, 0.048, false);
    pushEvent(topShimmer, 1.75, 0.65, 0.46, 'chord');
    if (isTurnaround) {
      pushEvent(passingBass, 3.0, 0.92, 0.56, 'bass');
      pushTaggedChord(3.0, tagUpper([v1, vTop]), 0.85, 0.52, 0.032, true);
    } else {
      pushTaggedChord(isOddBar ? 2.5 : 2.75, tagUpper(upper), 1.15, 0.56, 0.036, isOddBar);
    }
  } else if (style === 'strum') {
    // Quạt chả Acoustic: biến thể accent giữa các ô + passing bass cuối vòng
    pushTaggedChord(0.0, tagWithBass(upper), 0.92, 0.80, 0.022, false);
    pushTaggedChord(1.0, tagWithBass([v0, v1]), 0.42, 0.60, 0.016, false);
    pushTaggedChord(1.5, tagUpper(isLiftBar ? [...upper, vOct] : upper), 0.48, 0.56, 0.018, true);
    if (isTurnaround) {
      pushTaggedChord(2.5, tagWithBass(upper), 0.48, 0.64, 0.018, true);
      pushEvent(passingBass, 3.0, 0.48, 0.66, 'bass');
      pushTaggedChord(3.0, tagUpper(upper), 0.45, 0.72, 0.020, false);
      pushTaggedChord(3.5, tagUpper([v1, vTop]), 0.42, 0.54, 0.016, true);
    } else if (isOddBar) {
      pushTaggedChord(2.5, tagUpper(upper), 0.48, 0.60, 0.018, true);
      pushTaggedChord(3.0, tagWithBass(upper), 0.52, 0.74, 0.020, false);
      pushTaggedChord(3.5, tagUpper([v2, vOct]), 0.42, 0.52, 0.016, true);
    } else {
      pushTaggedChord(2.5, tagWithBass(upper), 0.52, 0.64, 0.018, true);
      pushTaggedChord(3.0, tagWithBass(upper), 0.48, 0.74, 0.020, false);
      pushTaggedChord(3.5, tagUpper(upper), 0.42, 0.52, 0.016, true);
    }
  } else {
    pushTaggedChord(0.0, tagWithBass(upper), 3.8, 0.72, 0.02, false);
  }

  return events;
}
