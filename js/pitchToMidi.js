// ============================================================================
// pitchToMidi.js — Thu âm Micro đa nền tảng (Desktop/iOS/Android), đo cao độ
// trực tiếp & thuật toán McLeod Pitch Method (NSDF) chuyển giọng thành MIDI
// ============================================================================

import { freqToMidi, midiToNoteName, snapMidiToScale } from './theory.js?v=11';

const MIN_VOCAL_HZ = 75;    // ~D2 (hỗ trợ cả giọng nam trầm)
const MAX_VOCAL_HZ = 1050;  // ~C6
const MIN_MIDI_ROLL = 48;   // C3
const MAX_MIDI_ROLL = 84;   // C6

/**
 * Nhận diện thiết bị di động / màn hình cảm ứng để tối ưu Mic Gain mặc định
 */
export function isMobileTouchDevice() {
  if (typeof window === 'undefined' && typeof navigator === 'undefined') return false;
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const hasTouch =
    (typeof window !== 'undefined' && 'ontouchstart' in window) ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  return Boolean(hasTouch || /Android|iPhone|iPad|iPod|Mobi/i.test(ua));
}

/**
 * Độ nhạy Micro mặc định: 2.6x trên điện thoại (tránh phải hét to), 1.8x trên máy tính
 */
export function getDefaultMicGain() {
  return isMobileTouchDevice() ? 2.6 : 1.8;
}

/**
 * Tự động chuẩn hóa biên độ PCM (Auto-Normalize):
 * Đẩy đỉnh sóng lên targetPeak (~0.85 = -1.4 dBFS) sau khi thu, giới hạn maxGain (8.0x) để tránh kéo nhiễu nền.
 */
export function normalizePcm(pcmFloat32, targetPeak = 0.85, maxGain = 8.0) {
  if (!pcmFloat32 || pcmFloat32.length === 0) return new Float32Array(0);
  let peak = 0;
  for (let i = 0; i < pcmFloat32.length; i++) {
    const abs = Math.abs(pcmFloat32[i]);
    if (abs > peak) peak = abs;
  }
  const out = new Float32Array(pcmFloat32.length);
  // Nếu tín hiệu gần như im lặng tuyệt đối thì giữ nguyên, không khuếch đại nhiễu
  if (peak < 1e-4) {
    out.set(pcmFloat32);
    return out;
  }
  const gain = Math.min(maxGain, targetPeak / peak);
  for (let i = 0; i < pcmFloat32.length; i++) {
    const v = pcmFloat32[i] * gain;
    out[i] = v > 0.99 ? 0.99 : v < -0.99 ? -0.99 : v;
  }
  return out;
}

/**
 * Downsample tín hiệu PCM bằng bộ lọc trung bình khối (giảm nhiễu hơi gió & tăng tốc DSP)
 */
export function downsampleBuffer(input, factor) {
  if (factor <= 1) return input;
  const outLen = Math.floor(input.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let k = 0; k < factor; k++) {
      sum += input[base + k];
    }
    out[i] = sum / factor;
  }
  return out;
}

/**
 * Lọc thông dải giọng hát bậc 1 (HPF ~70 Hz khử ù/DC + LPF ~950 Hz giảm nhiễu gió & hài bậc cao gắt)
 */
export function bandpassVocalPcm(pcm, sr) {
  if (!pcm || pcm.length === 0) return pcm;
  const out = new Float32Array(pcm.length);

  // High-pass ~70Hz
  const dt = 1 / Math.max(8000, sr);
  const rcHpf = 1 / (2 * Math.PI * 70);
  const alphaHpf = rcHpf / (rcHpf + dt);
  let prevX = pcm[0];
  let prevY = 0;
  const hpf = new Float32Array(pcm.length);
  hpf[0] = 0;
  for (let i = 1; i < pcm.length; i++) {
    const x = pcm[i];
    prevY = alphaHpf * (prevY + x - prevX);
    hpf[i] = prevY;
    prevX = x;
  }

  // Low-pass ~950Hz
  const rcLpf = 1 / (2 * Math.PI * 950);
  const alphaLpf = dt / (rcLpf + dt);
  let lpfY = hpf[0];
  out[0] = lpfY;
  for (let i = 1; i < hpf.length; i++) {
    lpfY = lpfY + alphaLpf * (hpf[i] - lpfY);
    out[i] = lpfY;
  }

  return out;
}

/**
 * Tính RMS (độ lớn tín hiệu) của một khung sóng âm
 */
export function computeRms(frame) {
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSq += frame[i] * frame[i];
  }
  return Math.sqrt(sumSq / frame.length);
}

/**
 * Thuật toán YIN (Cumulative Mean Normalized Difference Function - CMNDF)
 * Chuẩn xác cao cho giọng hát mộc và micro điện thoại, tránh nhảy nhầm quãng tám (+12).
 * Trả về { freq, clarity } hoặc null nếu không rõ cao độ.
 */
export function detectPitchYIN(frame, sampleRate, yinThreshold = 0.16) {
  const halfW = Math.floor(frame.length / 2);
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_VOCAL_HZ));
  const maxLag = Math.min(halfW - 2, Math.ceil(sampleRate / MIN_VOCAL_HZ));
  if (maxLag <= minLag + 2) return null;

  // Khử thành phần DC trong khung
  let mean = 0;
  for (let i = 0; i < frame.length; i++) mean += frame[i];
  mean /= frame.length;

  const x = new Float32Array(frame.length);
  let energy = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] - mean;
    x[i] = v;
    energy += v * v;
  }
  if (energy < 1e-8) return null;

  const diff = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < halfW; j++) {
      const d = x[j] - x[j + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // CMNDF: d'(tau) = d(tau) / ((1/tau) * sum_{j=1..tau} d(j))
  const cmndf = new Float32Array(maxLag + 2);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 1e-12 ? diff[tau] / (runningSum / tau) : 1;
  }

  // Chọn cực tiểu cục bộ ĐẦU TIÊN nhỏ hơn yinThreshold
  let bestTau = -1;
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmndf[tau] < yinThreshold) {
      while (tau + 1 <= maxLag && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      bestTau = tau;
      break;
    }
  }

  // Fallback sang cực tiểu toàn cục nếu vẫn rất sạch (< 0.23)
  if (bestTau === -1) {
    let minVal = Infinity;
    let minIdx = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        minIdx = tau;
      }
    }
    if (minVal < 0.23) {
      bestTau = minIdx;
    } else {
      return null;
    }
  }

  const bestVal = cmndf[bestTau];

  // Nội suy parabol quanh cực tiểu để đạt độ chính xác dưới 1 mẫu
  let refinedTau = bestTau;
  if (bestTau > minLag && bestTau < maxLag) {
    const s0 = cmndf[bestTau - 1];
    const s1 = cmndf[bestTau];
    const s2 = cmndf[bestTau + 1];
    const denom = 2 * (s0 - 2 * s1 + s2);
    if (Math.abs(denom) > 1e-9) {
      const shift = Math.max(-0.5, Math.min(0.5, (s0 - s2) / denom));
      refinedTau = bestTau + shift;
    }
  }

  const freq = sampleRate / refinedTau;
  if (freq < MIN_VOCAL_HZ || freq > MAX_VOCAL_HZ) return null;

  return { freq, clarity: Math.max(0, Math.min(1, 1 - bestVal)) };
}

/**
 * Wrapper tương thích ngược gọi thẳng bộ bắt cao độ YIN
 */
export function detectPitchMPM(frame, sampleRate, clarityOrThreshold = 0.80) {
  const yinThreshold = clarityOrThreshold <= 0.5 ? clarityOrThreshold : 0.16;
  return detectPitchYIN(frame, sampleRate, yinThreshold);
}

function medianOf(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Đóng gói mảng sóng âm PCM Float32 (mono) thành file Blob chuẩn RIFF/WAVE 16-bit PCM.
 * Chạy thuần JS, không phụ thuộc MediaRecorder nên tương thích 100% iOS Safari & Android.
 */
export function encodePcmToWavBlob(pcmFloat32, sampleRate = 44100) {
  const sr = Math.max(8000, Math.round(sampleRate || 44100));
  const numSamples = pcmFloat32 ? pcmFloat32.length : 0;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);       // PCM fmt chunk size
  view.setUint16(20, 1, true);        // Format = 1 (PCM)
  view.setUint16(22, 1, true);        // Channels = 1 (Mono)
  view.setUint32(24, sr, true);       // SampleRate
  view.setUint32(28, sr * 2, true);   // ByteRate = sr * channels * 2
  view.setUint16(32, 2, true);        // BlockAlign = channels * 2
  view.setUint16(34, 16, true);       // BitsPerSample = 16
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, pcmFloat32[i]));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, Math.round(int16), true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function extractPcmAndRate(vocalSource) {
  if (!vocalSource) return { rawData: null, origSr: 44100 };
  if (vocalSource.pcmData instanceof Float32Array) {
    return { rawData: vocalSource.pcmData, origSr: vocalSource.sampleRate || 44100 };
  }
  if (typeof vocalSource.getChannelData === 'function' && vocalSource.length > 0) {
    return { rawData: vocalSource.getChannelData(0), origSr: vocalSource.sampleRate || 44100 };
  }
  return { rawData: null, origSr: 44100 };
}

/**
 * Chuyển đổi trực tiếp dữ liệu PCM / AudioBuffer thu từ micro thành mảng nốt MIDI sạch sẽ,
 * giữ nguyên đường nét cao độ (contour), quãng giọng tự nhiên và đồng bộ thời gian chính xác.
 */
export function transcribeAudioBufferToMidi(vocalSource, options) {
  const {
    bpm = 84,
    totalBars = 4,
    keyPc = 0,
    scaleType = 'major',
    voicedChords = [],
    scaleSnap = true,
    quantizeGrid = '1/16', // '1/16' | '1/8' | 'off'
    yinThreshold = 0.16,
    minNoteDurationSec = 0.085,
  } = options;

  const { rawData, origSr } = extractPcmAndRate(vocalSource);
  if (!rawData || rawData.length === 0) return [];

  // Downsample xuống ~11–12kHz để lọc tiếng xì hơi và tăng tốc phân tích
  const factor = origSr >= 40000 ? 4 : origSr >= 20000 ? 2 : 1;
  const downsampled = downsampleBuffer(rawData, factor);
  const sr = origSr / factor;

  // Lọc thông dải giọng hát trước khi ước lượng cao độ
  const pcm = bandpassVocalPcm(downsampled, sr);

  const windowSize = 512;
  const hopSize = 128; // ~10.6ms/khung tại 12kHz
  const hopSec = hopSize / sr;
  const rawFrames = [];

  for (let start = 0; start + windowSize <= pcm.length; start += hopSize) {
    const slice = pcm.subarray(start, start + windowSize);
    const rms = computeRms(slice);
    const timeSec = start / sr;
    rawFrames.push({ start, timeSec, rms, slice });
  }

  if (rawFrames.length === 0) return [];

  // Ngưỡng giọng nói theo phân vị thứ 95 (bỏ qua gai nổ mic) + Hysteresis Gate
  // Hạ ngưỡng RMS nhẹ nhàng để giọng ngân êm qua Preamp vẫn bắt MIDI chuẩn xác
  const sortedRms = rawFrames.map((f) => f.rms).sort((a, b) => a - b);
  const p95Index = Math.min(sortedRms.length - 1, Math.floor(sortedRms.length * 0.95));
  const voicePeakRms = sortedRms[p95Index];
  if (voicePeakRms < 0.007) return []; // Hoàn toàn im lặng / chỉ có tiếng nền rất nhỏ

  const onsetGate = Math.max(0.010, voicePeakRms * 0.13);
  const sustainGate = Math.max(0.006, voicePeakRms * 0.08);

  const frames = [];
  let inVoice = false;

  for (const rf of rawFrames) {
    if (!inVoice) {
      if (rf.rms >= onsetGate) {
        inVoice = true;
      } else {
        frames.push({ timeSec: rf.timeSec, midi: null, rms: rf.rms, clarity: 0 });
        continue;
      }
    } else if (rf.rms < sustainGate) {
      inVoice = false;
      frames.push({ timeSec: rf.timeSec, midi: null, rms: rf.rms, clarity: 0 });
      continue;
    }

    const res = detectPitchYIN(rf.slice, sr, yinThreshold);
    if (!res) {
      frames.push({ timeSec: rf.timeSec, midi: null, rms: rf.rms, clarity: 0 });
    } else {
      frames.push({
        timeSec: rf.timeSec,
        midi: freqToMidi(res.freq),
        rms: rf.rms,
        clarity: res.clarity,
      });
    }
  }

  if (frames.length === 0) return [];

  // Bước 1: Hiệu chỉnh các khung nhảy nhầm quãng tám đơn lẻ (±12 bán cung) theo trung vị vùng ±18 khung
  const octaveFixed = frames.map((f, idx) => {
    if (f.midi === null) return { ...f };
    const localPitches = [];
    for (let k = -18; k <= 18; k++) {
      const nb = frames[idx + k];
      if (nb && nb.midi !== null) localPitches.push(nb.midi);
    }
    if (localPitches.length >= 5) {
      const localMed = medianOf(localPitches);
      const diff = f.midi - localMed;
      if (Math.abs(diff - 12) <= 1.2) {
        return { ...f, midi: f.midi - 12 };
      }
      if (Math.abs(diff + 12) <= 1.2) {
        return { ...f, midi: f.midi + 12 };
      }
    }
    return { ...f };
  });

  // Bước 2: Bộ lọc trung vị 5 khung (làm êm vibrato, khử gai cao độ)
  const smoothed = octaveFixed.map((f, idx) => {
    if (f.midi === null) return { ...f };
    const neigh = [];
    for (let k = -2; k <= 2; k++) {
      const nb = octaveFixed[idx + k];
      if (nb && nb.midi !== null) neigh.push(nb.midi);
    }
    return { ...f, midi: neigh.length >= 2 ? medianOf(neigh) : f.midi };
  });

  // Bước 3: Hàn gắn khe đứt ngắn (<= 2 khung ~21ms) giữa hai đoạn cùng cao độ
  for (let i = 1; i < smoothed.length - 2; i++) {
    if (smoothed[i].midi === null) {
      const prev = smoothed[i - 1].midi;
      const next1 = smoothed[i + 1].midi;
      const next2 = smoothed[i + 2].midi;
      if (prev !== null && next1 !== null && Math.abs(prev - next1) <= 0.72) {
        smoothed[i].midi = (prev + next1) / 2;
      } else if (
        prev !== null &&
        next1 === null &&
        next2 !== null &&
        Math.abs(prev - next2) <= 0.72
      ) {
        smoothed[i].midi = (prev + next2) / 2;
        smoothed[i + 1].midi = (prev + next2) / 2;
      }
    }
  }

  // Bước 4: Tách nốt theo điểm neo cố định (Fixed Anchor — không bị trôi khi hát liền bậc C-D-E)
  const segments = [];
  let current = null;
  let pendingDeviant = null;

  const finalizeSegment = (seg) => {
    if (!seg) return;
    const durSec = seg.endTime - seg.startTime;
    if (durSec >= minNoteDurationSec && seg.pitches.length >= 4) {
      segments.push(seg);
    }
  };

  const startNewSegment = (f) => ({
    startTime: f.timeSec,
    lastStartTime: f.timeSec,
    endTime: f.timeSec + (windowSize * 0.5) / sr,
    pitches: [f.midi],
    rmsList: [f.rms],
    anchorMidi: f.midi,
    localPeakRms: f.rms,
    dipped: false,
  });

  const appendToSegment = (seg, f) => {
    seg.lastStartTime = f.timeSec;
    seg.endTime = f.timeSec + (windowSize * 0.5) / sr;
    seg.pitches.push(f.midi);
    seg.rmsList.push(f.rms);
    // Cập nhật điểm neo từ 10 khung ổn định đầu tiên để giữ vững cao độ gốc của nốt
    if (seg.pitches.length <= 10) {
      seg.anchorMidi = medianOf(seg.pitches);
    }
  };

  for (let i = 0; i < smoothed.length; i++) {
    const f = smoothed[i];
    if (f.midi === null) {
      if (current) {
        finalizeSegment(current);
        current = null;
      }
      pendingDeviant = null;
      continue;
    }

    if (!current) {
      current = startNewSegment(f);
      pendingDeviant = null;
      continue;
    }

    // Kiểm tra ngắt lặp chữ cùng cao độ ("na - na")
    const segDur = f.timeSec - current.startTime;
    if (f.rms > current.localPeakRms) {
      current.localPeakRms = f.rms;
    } else if (f.rms < current.localPeakRms * 0.36 && segDur > 0.11) {
      current.dipped = true;
    }
    const reArticulated =
      current.dipped && f.rms > current.localPeakRms * 0.62 && segDur > 0.14;

    if (reArticulated) {
      finalizeSegment(current);
      current = startNewSegment(f);
      pendingDeviant = null;
      continue;
    }

    const pitchDiff = Math.abs(f.midi - current.anchorMidi);
    if (pitchDiff <= 0.58) {
      if (pendingDeviant) {
        appendToSegment(current, pendingDeviant);
        pendingDeviant = null;
      }
      appendToSegment(current, f);
    } else {
      // Cần 2 khung lệch liên tiếp (> 0.58 bán cung) mới cắt sang nốt mới để tránh nhiễu 1 khung
      if (!pendingDeviant) {
        pendingDeviant = f;
      } else {
        finalizeSegment(current);
        current = startNewSegment(pendingDeviant);
        appendToSegment(current, f);
        pendingDeviant = null;
      }
    }
  }
  if (current) {
    if (pendingDeviant) appendToSegment(current, pendingDeviant);
    finalizeSegment(current);
  }

  if (segments.length === 0) return [];

  // Bước 5: Ép tông nhẹ nhàng (chordBias = 0.12), căn nhịp & giữ nguyên đường nét quãng giọng (Whole-Melody Contour)
  const totalBeats = totalBars * 4;
  const beatsPerSec = bpm / 60;
  const gridStep = quantizeGrid === '1/8' ? 0.5 : quantizeGrid === '1/16' ? 0.25 : 0;

  const rawNotes = [];
  for (const seg of segments) {
    // Loại bỏ khung luyến nhanh ở biên (|midi[i+1] - midi[i-1]| > 0.6) để lấy đúng cao độ vững
    const steady = [];
    for (let i = 0; i < seg.pitches.length; i++) {
      if (i > 0 && i < seg.pitches.length - 1) {
        if (Math.abs(seg.pitches[i + 1] - seg.pitches[i - 1]) > 0.6) continue;
      }
      steady.push(seg.pitches[i]);
    }
    const trimCount = seg.pitches.length >= 10 ? Math.floor(seg.pitches.length * 0.15) : 0;
    const fallbackCore =
      trimCount > 0 ? seg.pitches.slice(trimCount, seg.pitches.length - trimCount) : seg.pitches;
    const corePitches = steady.length >= 3 ? steady : fallbackCore;
    const medianMidi = medianOf(corePitches);

    let startBeat = seg.startTime * beatsPerSec;
    let durBeats = (seg.endTime - seg.startTime) * beatsPerSec;

    if (gridStep > 0) {
      startBeat = Math.round(startBeat / gridStep) * gridStep;
      durBeats = Math.max(gridStep, Math.round(durBeats / gridStep) * gridStep);
    } else {
      startBeat = Math.round(startBeat * 100) / 100;
      durBeats = Math.max(0.2, Math.round(durBeats * 100) / 100);
    }

    if (startBeat < 0) startBeat = 0;
    if (startBeat >= totalBeats) continue;
    if (startBeat + durBeats > totalBeats) {
      durBeats = Math.max(0.25, totalBeats - startBeat);
    }

    // Xác định hợp âm ở ô nhịp hiện tại (chordBias nhẹ = 0.12 để giữ nguyên nốt lướt đúng tông)
    const barIdx = Math.min(
      Math.max(0, Math.floor(startBeat / 4)),
      Math.max(0, voicedChords.length - 1)
    );
    const barChordPcs = voicedChords[barIdx]?.allPitchClasses || null;

    const finalMidi = scaleSnap
      ? snapMidiToScale(medianMidi, keyPc, scaleType, barChordPcs, 0.12)
      : Math.round(medianMidi);

    // Tính lực đánh velocity tự nhiên theo âm lượng giọng hát
    const avgRms = seg.rmsList.reduce((a, b) => a + b, 0) / seg.rmsList.length;
    const normVel = Math.max(
      0.58,
      Math.min(0.95, 0.55 + (avgRms / Math.max(0.08, voicePeakRms)) * 0.4)
    );

    rawNotes.push({
      id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      midi: finalMidi,
      startBeat,
      durationBeats: durBeats,
      velocity: Number(normVel.toFixed(2)),
    });
  }

  if (rawNotes.length === 0) return [];

  // Căn chỉnh quãng tám đồng bộ cho TOÀN BỘ giai điệu (tránh bẻ quãng từng nốt làm méo giai điệu giọng nam/nữ)
  let minMidi = Math.min(...rawNotes.map((n) => n.midi));
  let maxMidi = Math.max(...rawNotes.map((n) => n.midi));
  let octaveShift = 0;

  while (minMidi + octaveShift < MIN_MIDI_ROLL && maxMidi + octaveShift + 12 <= MAX_MIDI_ROLL) {
    octaveShift += 12;
  }
  while (maxMidi + octaveShift > MAX_MIDI_ROLL && minMidi + octaveShift - 12 >= MIN_MIDI_ROLL) {
    octaveShift -= 12;
  }

  for (const n of rawNotes) {
    n.midi = Math.max(MIN_MIDI_ROLL, Math.min(MAX_MIDI_ROLL, n.midi + octaveShift));
  }

  // Bước 6: Sắp xếp & dọn chồng chéo đơn âm để giai điệu sạch đẹp, không dính nốt
  rawNotes.sort((a, b) => a.startBeat - b.startBeat);
  const cleanNotes = [];
  for (const n of rawNotes) {
    const prev = cleanNotes[cleanNotes.length - 1];
    if (prev) {
      if (Math.abs(n.startBeat - prev.startBeat) < 0.05) {
        if (n.durationBeats > prev.durationBeats) {
          cleanNotes[cleanNotes.length - 1] = n;
        }
        continue;
      }
      if (prev.startBeat + prev.durationBeats > n.startBeat) {
        prev.durationBeats = Math.max(0.15, Number((n.startBeat - prev.startBeat).toFixed(3)));
      }
    }
    cleanNotes.push(n);
  }

  return cleanNotes;
}

/**
 * Bộ quản lý luồng Micro: dùng Native AudioContext riêng biệt, thu PCM thuần & đóng gói WAV Blob
 */
export class VocalCapture {
  constructor() {
    this.stream = null;
    this.audioCtx = null;
    this.sourceNode = null;
    this.preampHpf = null;
    this.preampPresence = null;
    this.preampGain = null;
    this.preampLimiter = null;
    this.monitorGain = null;
    this.analyser = null;
    this.processorNode = null;
    this.silentGain = null;

    this.isMonitoring = false;
    this.isCapturing = false;
    this.chunks = [];
    this.totalSamples = 0;
    this.sampleRate = 44100;

    this._meterRaf = null;
    this._liveBuf = new Float32Array(2048);
    this._byteBuf = null;
    this._onLiveStats = null;
    this._onPcmChunk = null;
  }

  /**
   * Khởi tạo & mở khóa Native AudioContext riêng ngay trong thao tác chạm nút của người dùng
   * (tránh đụng độ với standardized-audio-context của Tone.js trên iOS Safari).
   */
  prepareNativeContext() {
    const NativeAudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!NativeAudioCtx) return null;
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new NativeAudioCtx();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  _cleanupNodesAndStream() {
    this.isMonitoring = false;
    this.isCapturing = false;
    if (this._meterRaf) {
      cancelAnimationFrame(this._meterRaf);
      this._meterRaf = null;
    }
    try { if (this.processorNode) this.processorNode.disconnect(); } catch (_) {}
    try { if (this.analyser) this.analyser.disconnect(); } catch (_) {}
    try { if (this.monitorGain) this.monitorGain.disconnect(); } catch (_) {}
    try { if (this.preampLimiter) this.preampLimiter.disconnect(); } catch (_) {}
    try { if (this.preampGain) this.preampGain.disconnect(); } catch (_) {}
    try { if (this.preampPresence) this.preampPresence.disconnect(); } catch (_) {}
    try { if (this.preampHpf) this.preampHpf.disconnect(); } catch (_) {}
    try { if (this.sourceNode) this.sourceNode.disconnect(); } catch (_) {}
    try { if (this.silentGain) this.silentGain.disconnect(); } catch (_) {}
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.processorNode = null;
    this.analyser = null;
    this.monitorGain = null;
    this.preampLimiter = null;
    this.preampGain = null;
    this.preampPresence = null;
    this.preampHpf = null;
    this.sourceNode = null;
    this.silentGain = null;
    this._onPcmChunk = null;
    this.chunks = [];
    this.totalSamples = 0;
  }

  /**
   * Chỉnh trực tiếp độ nhạy Preamp Mic Gain (1.0x .. 5.0x) khi đang thu/theo dõi
   */
  setMicGain(gainVal) {
    if (!this.preampGain || !this.audioCtx) return;
    const clamped = Math.max(1.0, Math.min(5.0, Number(gainVal) || getDefaultMicGain()));
    try {
      this.preampGain.gain.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.015);
    } catch (_) {
      this.preampGain.gain.value = clamped;
    }
  }

  /**
   * Bật/tắt Nghe trực tiếp (Monitor) qua tai nghe
   */
  setMonitor(enabled) {
    if (!this.monitorGain || !this.audioCtx) return;
    const target = enabled ? 0.85 : 0;
    try {
      this.monitorGain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.015);
    } catch (_) {
      this.monitorGain.gain.value = target;
    }
  }

  /**
   * Mở micro bằng Native AudioContext thuần + Mạch Preamp phòng thu (HPF 85Hz -> Presence +2.5dB -> Mic Gain -> Soft Limiter):
   * - Gọi getUserMedia() ngay lập tức (không await trước đó để giữ user gesture iOS Safari)
   * - Tạo Native AudioContext SAU khi có stream để tránh chuyển chế độ sample-rate AVAudioSession
   * - Bỏ AudioWorklet Blob trên iOS/iPadOS để dùng ScriptProcessorNode ổn định 100%
   */
  async openMic({
    echoCancellation = false,
    micGain = getDefaultMicGain(),
    monitor = false,
    onLiveStats = null,
    onPcmChunk = null,
  } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Trình duyệt này không hỗ trợ thu âm Micro (cần kết nối HTTPS hoặc localhost).');
    }

    this._cleanupNodesAndStream();
    if (this.audioCtx) {
      try {
        if (this.audioCtx.state !== 'closed') {
          this.audioCtx.close().catch(() => {});
        }
      } catch (_) {}
      this.audioCtx = null;
    }
    this._onLiveStats = onLiveStats;
    this._onPcmChunk = onPcmChunk;

    try {
      // Thử xin micro ưu tiên thu mộc; nếu lỗi không phải thiếu quyền/thiết bị thì lùi về { audio: true }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: Boolean(echoCancellation),
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch (constraintErr) {
        const name = constraintErr && constraintErr.name ? constraintErr.name : '';
        if (
          name !== 'NotAllowedError' &&
          name !== 'PermissionDeniedError' &&
          name !== 'NotFoundError'
        ) {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
          throw constraintErr;
        }
      }

      // Tạo Native AudioContext SAU khi getUserMedia thành công (khớp sample rate PlayAndRecord trên iOS)
      const NativeAudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!NativeAudioCtx) {
        throw new Error('Trình duyệt không hỗ trợ Web AudioContext.');
      }
      const micAudioCtx = new NativeAudioCtx();
      this.audioCtx = micAudioCtx;

      if (micAudioCtx.state !== 'running') {
        await micAudioCtx.resume().catch(() => {});
      }

      this.sampleRate = micAudioCtx.sampleRate || 44100;
      this.sourceNode = micAudioCtx.createMediaStreamSource(this.stream);

      // Mạch Preamp đầu vào: lọc ù/gió 85Hz -> tôn độ rõ 3.2kHz -> khuếch đại Mic Gain -> Soft Limiter chống rè
      this.preampHpf = micAudioCtx.createBiquadFilter();
      this.preampHpf.type = 'highpass';
      this.preampHpf.frequency.value = 85;
      this.preampHpf.Q.value = 0.707;

      this.preampPresence = micAudioCtx.createBiquadFilter();
      this.preampPresence.type = 'peaking';
      this.preampPresence.frequency.value = 3200;
      this.preampPresence.Q.value = 1.0;
      this.preampPresence.gain.value = 2.5;

      this.preampGain = micAudioCtx.createGain();
      this.preampGain.gain.value = Math.max(1.0, Math.min(5.0, Number(micGain) || getDefaultMicGain()));

      this.preampLimiter = micAudioCtx.createDynamicsCompressor();
      this.preampLimiter.threshold.value = -6;
      this.preampLimiter.knee.value = 6;
      this.preampLimiter.ratio.value = 12;
      this.preampLimiter.attack.value = 0.003;
      this.preampLimiter.release.value = 0.1;

      this.sourceNode.connect(this.preampHpf);
      this.preampHpf.connect(this.preampPresence);
      this.preampPresence.connect(this.preampGain);
      this.preampGain.connect(this.preampLimiter);

      this.analyser = micAudioCtx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.25;
      this.preampLimiter.connect(this.analyser);

      // Kênh Monitor trực tiếp (mặc định TẮT để tránh hú loa khi không đeo tai nghe)
      this.monitorGain = micAudioCtx.createGain();
      this.monitorGain.gain.value = monitor ? 0.85 : 0;
      this.preampLimiter.connect(this.monitorGain);
      this.monitorGain.connect(micAudioCtx.destination);

      // Nối vào gain = 0 để không gây hú loa (feedback) nhưng vẫn kích hoạt xử lý PCM
      this.silentGain = micAudioCtx.createGain();
      this.silentGain.gain.value = 0;

      // Ghi PCM sau mạch Preamp qua Native AudioContext (không dùng MediaRecorder)
      await this._setupPcmNode(micAudioCtx, this.preampLimiter);

      this.isMonitoring = true;
      this._startMeterLoop();
    } catch (err) {
      this.close();
      throw err;
    }
  }

  async _setupPcmNode(micAudioCtx, inputNode = this.sourceNode) {
    const isIOS =
      /iP(ad|hone|od)/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Trên iOS/iPadOS dùng thẳng ScriptProcessorNode để tránh lỗi Blob AudioWorklet trên WebKit
    let workletOk = false;
    if (
      !isIOS &&
      micAudioCtx.audioWorklet &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined'
    ) {
      try {
        const workletCode = `
          class PcmRecorderProcessor extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs[0];
              if (input && input[0] && input[0].length > 0) {
                this.port.postMessage(new Float32Array(input[0]));
              }
              return true;
            }
          }
          registerProcessor('pcm-recorder-processor', PcmRecorderProcessor);
        `;
        if (!micAudioCtx._hevosWorkletLoaded) {
          const blob = new Blob([workletCode], { type: 'application/javascript' });
          const blobUrl = URL.createObjectURL(blob);
          await micAudioCtx.audioWorklet.addModule(blobUrl);
          URL.revokeObjectURL(blobUrl);
          micAudioCtx._hevosWorkletLoaded = true;
        }
        const node = new AudioWorkletNode(micAudioCtx, 'pcm-recorder-processor');
        node.port.onmessage = (ev) => {
          if (!this.isCapturing) return;
          const chunk = ev.data;
          this.chunks.push(chunk);
          this.totalSamples += chunk.length;
          if (this._onPcmChunk) this._onPcmChunk(chunk);
        };
        inputNode.connect(node);
        node.connect(this.silentGain);
        this.silentGain.connect(micAudioCtx.destination);
        this.processorNode = node;
        workletOk = true;
      } catch (_) {
        workletOk = false;
      }
    }

    if (!workletOk) {
      const sp = micAudioCtx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => {
        if (!this.isCapturing) return;
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        this.chunks.push(copy);
        this.totalSamples += copy.length;
        if (this._onPcmChunk) this._onPcmChunk(copy);
      };
      inputNode.connect(sp);
      sp.connect(this.silentGain);
      this.silentGain.connect(micAudioCtx.destination);
      this.processorNode = sp;
    }
  }

  /**
   * Bắt đầu lưu sóng âm vào bộ đệm (gọi đúng khoảnh khắc kết thúc Count-in)
   */
  beginCapture() {
    this.chunks = [];
    this.totalSamples = 0;
    this.isCapturing = true;
  }

  /**
   * Dừng ghi, cắt phần trễ đầu, chuẩn hóa biên độ Auto-Normalize (~0.85), đóng micro và trả về { pcmData, sampleRate, wavBlob }
   */
  finishCapture({ trimStartSec = 0, autoNormalize = true } = {}) {
    this.isCapturing = false;
    let result = null;

    if (this.totalSamples > 0) {
      const rawPcm = new Float32Array(this.totalSamples);
      let offset = 0;
      for (const chunk of this.chunks) {
        rawPcm.set(chunk, offset);
        offset += chunk.length;
      }
      const sampleRate = this.sampleRate || 44100;
      const trimSamples = Math.min(
        Math.max(0, Math.floor(trimStartSec * sampleRate)),
        Math.floor(rawPcm.length * 0.25)
      );
      let pcmData = trimSamples > 0 ? rawPcm.slice(trimSamples) : rawPcm;
      if (autoNormalize) {
        pcmData = normalizePcm(pcmData, 0.85, 8.0);
      }
      const wavBlob = encodePcmToWavBlob(pcmData, sampleRate);
      result = { pcmData, sampleRate, wavBlob };
    }

    this.close();
    return result;
  }

  _startMeterLoop() {
    let lastPitchTime = 0;
    const loop = (now) => {
      if (!this.isMonitoring || !this.analyser) return;

      if (typeof this.analyser.getFloatTimeDomainData === 'function') {
        this.analyser.getFloatTimeDomainData(this._liveBuf);
      } else {
        if (!this._byteBuf || this._byteBuf.length !== this._liveBuf.length) {
          this._byteBuf = new Uint8Array(this._liveBuf.length);
        }
        this.analyser.getByteTimeDomainData(this._byteBuf);
        for (let i = 0; i < this._byteBuf.length; i++) {
          this._liveBuf[i] = (this._byteBuf[i] - 128) / 128;
        }
      }

      let sumSq = 0;
      let peak = 0;
      for (let i = 0; i < this._liveBuf.length; i++) {
        const v = this._liveBuf[i];
        sumSq += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      const rms = Math.sqrt(sumSq / this._liveBuf.length);
      // Quy đổi biên độ dễ nhìn trên đồng hồ VU (0..1)
      const level = Math.min(1, Math.pow(rms * 5.2, 0.68));

      let liveNote = null;
      let liveFreq = null;

      // Chạy bắt cao độ trực tiếp mỗi ~50ms bằng YIN để tiết kiệm pin mobile mà vẫn mượt
      if (now - lastPitchTime > 48) {
        lastPitchTime = now;
        if (rms > 0.008) {
          const factor = this.sampleRate >= 40000 ? 4 : 2;
          const down = bandpassVocalPcm(downsampleBuffer(this._liveBuf, factor), this.sampleRate / factor);
          const det = detectPitchYIN(down, this.sampleRate / factor, 0.18);
          if (det) {
            liveFreq = det.freq;
            const m = freqToMidi(det.freq);
            if (m !== null) liveNote = midiToNoteName(Math.round(m));
          }
        }
        if (this._onLiveStats) {
          this._onLiveStats({ level, peak, rms, noteName: liveNote, freq: liveFreq });
        }
      } else if (this._onLiveStats) {
        this._onLiveStats({ level, peak, rms, noteName: undefined, freq: undefined });
      }

      this._meterRaf = requestAnimationFrame(loop);
    };
    this._meterRaf = requestAnimationFrame(loop);
  }

  close() {
    this._cleanupNodesAndStream();
    if (this.audioCtx) {
      try {
        if (this.audioCtx.state !== 'closed') {
          this.audioCtx.close().catch(() => {});
        }
      } catch (_) {}
      this.audioCtx = null;
    }
  }
}

/**
 * Vẽ sóng âm thu nhỏ (Waveform Preview) của đoạn giọng vừa ngân lên Canvas
 */
export function drawVocalWaveform(canvas, vocalSource) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(120, Math.floor(rect.width || canvas.clientWidth || 240));
  const h = Math.max(24, Math.floor(rect.height || canvas.clientHeight || 32));

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  // Đường trục giữa
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  const { rawData: data } = extractPcmAndRate(vocalSource);
  if (!data || data.length === 0) {
    ctx.restore();
    return;
  }
  const step = Math.max(1, Math.floor(data.length / w));
  let maxPeak = 0.05;
  for (let i = 0; i < data.length; i += Math.max(1, Math.floor(step / 4))) {
    const a = Math.abs(data[i]);
    if (a > maxPeak) maxPeak = a;
  }

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#A1A1AA');
  grad.addColorStop(0.5, '#FAFAFA');
  grad.addColorStop(1, '#D4D4D8');
  ctx.fillStyle = grad;

  for (let x = 0; x < w; x += 2) {
    const start = x * step;
    let peak = 0;
    for (let j = 0; j < step && start + j < data.length; j += Math.max(1, Math.floor(step / 16))) {
      const a = Math.abs(data[start + j]);
      if (a > peak) peak = a;
    }
    const barH = Math.max(2, (peak / maxPeak) * (h - 6));
    const y = (h - barH) / 2;
    ctx.fillRect(x, y, 1.5, barH);
  }
  ctx.restore();
}
