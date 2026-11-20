// ============================================================================
// pitchToMidi.js — Thu âm Micro đa nền tảng (Desktop/iOS/Android), đo cao độ
// trực tiếp & thuật toán McLeod Pitch Method (NSDF) chuyển giọng thành MIDI
// ============================================================================

import { freqToMidi, midiToNoteName, snapMidiToScale } from './theory.js';

const MIN_VOCAL_HZ = 85;    // ~F2
const MAX_VOCAL_HZ = 1100;  // ~C#6
const MIN_MIDI_ROLL = 48;   // C3
const MAX_MIDI_ROLL = 84;   // C6

/**
 * Downsample tín hiệu PCM bằng bộ lọc trung bình khối (giảm nhiễu hơi gió & tăng tốc DSP)
 */
function downsampleBuffer(input, factor) {
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
 * Tính RMS (độ lớn tín hiệu) của một khung sóng âm
 */
function computeRms(frame) {
  let sumSq = 0;
  for (let i = 0; i < frame.length; i++) {
    sumSq += frame[i] * frame[i];
  }
  return Math.sqrt(sumSq / frame.length);
}

/**
 * Thuật toán McLeod Pitch Method (MPM / NSDF) chuẩn xác cao cho giọng ngân nga
 * Trả về { freq, clarity } hoặc null nếu không rõ cao độ
 */
export function detectPitchMPM(frame, sampleRate, clarityThreshold = 0.80) {
  const W = frame.length;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_VOCAL_HZ));
  const maxLag = Math.min(Math.floor(W * 0.72), Math.ceil(sampleRate / MIN_VOCAL_HZ));
  if (maxLag <= minLag + 2) return null;

  // Khử thành phần DC offset
  let mean = 0;
  for (let i = 0; i < W; i++) mean += frame[i];
  mean /= W;

  const x = new Float32Array(W);
  let totalEnergy = 0;
  for (let i = 0; i < W; i++) {
    const v = frame[i] - mean;
    x[i] = v;
    totalEnergy += v * v;
  }
  if (totalEnergy < 1e-8) return null;

  // Tính NSDF[tau] = 2 * r(tau) / m(tau) bằng cập nhật m(tau) O(1)
  const nsdf = new Float32Array(maxLag + 1);
  let m = 2 * totalEnergy;

  // Cập nhật m đến trước minLag
  for (let tau = 1; tau < minLag; tau++) {
    m -= x[W - tau] * x[W - tau] + x[tau - 1] * x[tau - 1];
  }

  for (let tau = minLag; tau <= maxLag; tau++) {
    m -= x[W - tau] * x[W - tau] + x[tau - 1] * x[tau - 1];
    if (m <= 1e-9) {
      nsdf[tau] = 0;
      continue;
    }
    let acf = 0;
    const limit = W - tau;
    for (let j = 0; j < limit; j++) {
      acf += x[j] * x[j + tau];
    }
    nsdf[tau] = (2 * acf) / m;
  }

  // Tìm các đỉnh cục bộ trong từng vùng dương (Key Maxima) sau điểm cắt 0 đầu tiên
  const keyMaxima = [];
  let inPositive = false;
  let seenNegative = false;
  let peakTau = -1;
  let peakVal = -Infinity;

  // Kiểm tra xem tại minLag tín hiệu đã âm chưa
  if (nsdf[minLag] <= 0) {
    seenNegative = true;
  }

  for (let tau = minLag; tau <= maxLag; tau++) {
    const val = nsdf[tau];
    if (!seenNegative) {
      if (val <= 0) seenNegative = true;
      continue;
    }

    if (val > 0) {
      if (!inPositive) {
        inPositive = true;
        peakTau = tau;
        peakVal = val;
      } else if (val > peakVal) {
        peakVal = val;
        peakTau = tau;
      }
    } else if (inPositive) {
      keyMaxima.push({ tau: peakTau, val: peakVal });
      inPositive = false;
      peakTau = -1;
      peakVal = -Infinity;
    }
  }
  if (inPositive && peakTau > 0) {
    keyMaxima.push({ tau: peakTau, val: peakVal });
  }

  if (keyMaxima.length === 0) return null;

  let maxPeak = -Infinity;
  for (const km of keyMaxima) {
    if (km.val > maxPeak) maxPeak = km.val;
  }

  if (maxPeak < clarityThreshold) return null;

  // Chọn đỉnh ĐẦU TIÊN đạt >= 0.88 * maxPeak (chống bắt nhầm xuống quãng tám dưới)
  const threshold = 0.88 * maxPeak;
  let chosen = keyMaxima[0];
  for (const km of keyMaxima) {
    if (km.val >= threshold) {
      chosen = km;
      break;
    }
  }

  // Nội suy parabol để đạt độ chính xác cao độ dưới 1 mẫu
  let refinedTau = chosen.tau;
  if (chosen.tau > minLag && chosen.tau < maxLag) {
    const y0 = nsdf[chosen.tau - 1];
    const y1 = nsdf[chosen.tau];
    const y2 = nsdf[chosen.tau + 1];
    const denom = 2 * (y0 - 2 * y1 + y2);
    if (Math.abs(denom) > 1e-9) {
      const shift = Math.max(-0.5, Math.min(0.5, (y0 - y2) / denom));
      refinedTau = chosen.tau + shift;
    }
  }

  const freq = sampleRate / refinedTau;
  if (freq < MIN_VOCAL_HZ || freq > MAX_VOCAL_HZ) return null;

  return { freq, clarity: chosen.val };
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
 * Chuyển đổi trực tiếp dữ liệu AudioBuffer thu từ micro thành mảng nốt MIDI sạch sẽ
 */
export function transcribeAudioBufferToMidi(audioBuffer, options) {
  const {
    bpm = 84,
    totalBars = 4,
    keyPc = 0,
    scaleType = 'major',
    voicedChords = [],
    scaleSnap = true,
    quantizeGrid = '1/16', // '1/16' | '1/8' | 'off'
    rmsThreshold = 0.015,
    clarityThreshold = 0.81,
    minNoteDurationSec = 0.085,
  } = options;

  if (!audioBuffer || audioBuffer.length === 0) return [];

  const rawData = audioBuffer.getChannelData(0);
  const origSr = audioBuffer.sampleRate;

  // Bù trễ phần cứng micro (~38ms) để nốt MIDI vào đúng phách hơn
  const latencyCompSamples = Math.min(Math.floor(origSr * 0.038), Math.floor(rawData.length * 0.1));
  const trimmed = latencyCompSamples > 0 ? rawData.subarray(latencyCompSamples) : rawData;

  // Downsample xuống ~11–12kHz để lọc tiếng xì hơi và tăng tốc phân tích
  const factor = origSr >= 40000 ? 4 : origSr >= 20000 ? 2 : 1;
  const pcm = downsampleBuffer(trimmed, factor);
  const sr = origSr / factor;

  // Chuẩn hóa nhẹ ngưỡng RMS thích ứng nếu người dùng ngân nhỏ
  let peakAmp = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peakAmp) peakAmp = a;
  }
  if (peakAmp < 0.008) return []; // Hoàn toàn im lặng

  const adaptiveGate = Math.max(0.008, Math.min(rmsThreshold, peakAmp * 0.10));

  const windowSize = 512;
  const hopSize = 128; // ~10.6ms/khung tại 12kHz
  const hopSec = hopSize / sr;
  const frames = [];

  for (let start = 0; start + windowSize <= pcm.length; start += hopSize) {
    const slice = pcm.subarray(start, start + windowSize);
    const rms = computeRms(slice);
    const timeSec = (start + windowSize * 0.35) / sr;

    if (rms < adaptiveGate) {
      frames.push({ timeSec, midi: null, rms, clarity: 0 });
      continue;
    }

    const res = detectPitchMPM(slice, sr, clarityThreshold);
    if (!res) {
      frames.push({ timeSec, midi: null, rms, clarity: 0 });
    } else {
      frames.push({
        timeSec,
        midi: freqToMidi(res.freq),
        rms,
        clarity: res.clarity,
      });
    }
  }

  if (frames.length === 0) return [];

  // Bước 1: Bộ lọc trung vị (Median Filter 5 khung) loại bỏ gai nhảy cao độ đột ngột & làm êm vibrato
  const smoothed = frames.map((f, idx) => {
    if (f.midi === null) return { ...f };
    const neigh = [];
    for (let k = -2; k <= 2; k++) {
      const nb = frames[idx + k];
      if (nb && nb.midi !== null) neigh.push(nb.midi);
    }
    return { ...f, midi: neigh.length >= 2 ? medianOf(neigh) : f.midi };
  });

  // Bước 2: Hàn gắn các khe đứt siêu ngắn (1–2 khung ~20ms) giữa hai đoạn cùng cao độ
  for (let i = 1; i < smoothed.length - 2; i++) {
    if (smoothed[i].midi === null) {
      const prev = smoothed[i - 1].midi;
      const next1 = smoothed[i + 1].midi;
      const next2 = smoothed[i + 2].midi;
      if (prev !== null && next1 !== null && Math.abs(prev - next1) <= 0.85) {
        smoothed[i].midi = (prev + next1) / 2;
      } else if (
        prev !== null &&
        next1 === null &&
        next2 !== null &&
        Math.abs(prev - next2) <= 0.85
      ) {
        smoothed[i].midi = (prev + next2) / 2;
        smoothed[i + 1].midi = (prev + next2) / 2;
      }
    }
  }

  // Bước 3: Gom nhóm các khung thành từng đoạn nốt nhạc (hỗ trợ cả ngân rung vibrato lẫn hát lặp chữ)
  const segments = [];
  let current = null;

  const closeSegment = () => {
    if (!current) return;
    const durSec = current.endTime - current.startTime;
    if (durSec >= minNoteDurationSec && current.pitches.length >= 4) {
      segments.push(current);
    }
    current = null;
  };

  for (let i = 0; i < smoothed.length; i++) {
    const f = smoothed[i];
    if (f.midi === null) {
      closeSegment();
      continue;
    }

    if (!current) {
      current = {
        startTime: f.timeSec,
        endTime: f.timeSec + hopSec,
        pitches: [f.midi],
        rmsList: [f.rms],
        localPeakRms: f.rms,
        dipped: false,
      };
      continue;
    }

    // Lấy trung vị gần nhất để bám vibrato
    const recent = current.pitches.slice(-12);
    const refPitch = medianOf(recent);
    const pitchDiff = Math.abs(f.midi - refPitch);

    // Phát hiện hát lặp cùng 1 cao độ ("na - na"): âm lượng tụt sâu rồi bật mạnh trở lại
    const segDur = f.timeSec - current.startTime;
    if (f.rms > current.localPeakRms) {
      current.localPeakRms = f.rms;
    } else if (f.rms < current.localPeakRms * 0.36 && segDur > 0.11) {
      current.dipped = true;
    }
    const reArticulated =
      current.dipped && f.rms > current.localPeakRms * 0.62 && segDur > 0.14;

    if (pitchDiff <= 0.82 && !reArticulated) {
      current.endTime = f.timeSec + hopSec;
      current.pitches.push(f.midi);
      current.rmsList.push(f.rms);
    } else {
      closeSegment();
      current = {
        startTime: f.timeSec,
        endTime: f.timeSec + hopSec,
        pitches: [f.midi],
        rmsList: [f.rms],
        localPeakRms: f.rms,
        dipped: false,
      };
    }
  }
  closeSegment();

  // Bước 4: Ép tông (Scale Snap ưu tiên nốt hợp âm) + Căn lưới nhịp (Quantize)
  const totalBeats = totalBars * 4;
  const beatsPerSec = bpm / 60;
  const gridStep = quantizeGrid === '1/8' ? 0.5 : quantizeGrid === '1/16' ? 0.25 : 0;

  const rawNotes = [];
  for (const seg of segments) {
    // Bỏ 15% đầu và cuối đoạn dài để tránh luyến mở đầu làm lệch cao độ chính
    const trimCount = seg.pitches.length >= 10 ? Math.floor(seg.pitches.length * 0.15) : 0;
    const corePitches =
      trimCount > 0 ? seg.pitches.slice(trimCount, seg.pitches.length - trimCount) : seg.pitches;
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

    // Xác định hợp âm ở ô nhịp hiện tại để ưu tiên hòa âm
    const barIdx = Math.min(
      Math.max(0, Math.floor(startBeat / 4)),
      Math.max(0, voicedChords.length - 1)
    );
    const barChordPcs = voicedChords[barIdx]?.allPitchClasses || null;

    let finalMidi = scaleSnap
      ? snapMidiToScale(medianMidi, keyPc, scaleType, barChordPcs, 0.30)
      : Math.round(medianMidi);

    // Giữ nốt nằm trong quãng hiển thị Piano Roll (C3–C6)
    while (finalMidi < MIN_MIDI_ROLL) finalMidi += 12;
    while (finalMidi > MAX_MIDI_ROLL) finalMidi -= 12;

    // Tính lực đánh velocity tự nhiên theo âm lượng giọng hát
    const avgRms = seg.rmsList.reduce((a, b) => a + b, 0) / seg.rmsList.length;
    const normVel = Math.max(0.58, Math.min(0.95, 0.55 + (avgRms / Math.max(0.08, peakAmp)) * 0.4));

    rawNotes.push({
      id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      midi: finalMidi,
      startBeat,
      durationBeats: durBeats,
      velocity: Number(normVel.toFixed(2)),
    });
  }

  // Bước 5: Sắp xếp & dọn chồng chéo đơn âm để giai điệu sạch đẹp, không dính nốt
  rawNotes.sort((a, b) => a.startBeat - b.startBeat);
  const cleanNotes = [];
  for (const n of rawNotes) {
    const prev = cleanNotes[cleanNotes.length - 1];
    if (prev) {
      // Nếu cùng điểm bắt đầu do căn nhịp -> giữ nốt dài hơn
      if (Math.abs(n.startBeat - prev.startBeat) < 0.05) {
        if (n.durationBeats > prev.durationBeats) {
          cleanNotes[cleanNotes.length - 1] = n;
        }
        continue;
      }
      // Cắt đuôi nốt trước nếu trùm sang nốt sau
      if (prev.startBeat + prev.durationBeats > n.startBeat) {
        prev.durationBeats = Math.max(0.15, Number((n.startBeat - prev.startBeat).toFixed(3)));
      }
    }
    cleanNotes.push(n);
  }

  return cleanNotes;
}

/**
 * Bộ quản lý luồng Micro: đo âm lượng + tên nốt trực tiếp và ghi PCM chuẩn đa thiết bị
 */
export class VocalCapture {
  constructor() {
    this.stream = null;
    this.audioCtx = null;
    this.ownsContext = false;
    this.sourceNode = null;
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
    this._onLiveStats = null;
  }

  /**
   * Kiểm tra các MIME type ghi âm hỗ trợ (tiện tham khảo / tương thích trình duyệt)
   */
  static getSupportedAudioMime() {
    if (typeof MediaRecorder === 'undefined') return 'pcm-webaudio';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg;codecs=opus',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return 'pcm-webaudio';
  }

  /**
   * Mở micro, bật đồng hồ đo âm lượng & nhận diện nốt theo thời gian thực
   */
  async openMic({ echoCancellation = false, onLiveStats = null } = {}) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Trình duyệt này không hỗ trợ thu âm Micro (cần kết nối HTTPS hoặc localhost).');
    }

    this.close();
    this._onLiveStats = onLiveStats;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: Boolean(echoCancellation),
      },
    });

    // Tái sử dụng AudioContext của Tone nếu đang chạy (tránh xung đột trên iOS Safari)
    if (window.Tone && window.Tone.context && window.Tone.context.rawContext) {
      this.audioCtx = window.Tone.context.rawContext;
      this.ownsContext = false;
    } else {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.ownsContext = true;
    }

    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    this.sampleRate = this.audioCtx.sampleRate;
    this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.25;

    // Nối vào gain = 0 để không gây hú loa (feedback) nhưng vẫn kích hoạt xử lý PCM
    this.silentGain = this.audioCtx.createGain();
    this.silentGain.gain.value = 0;

    this.sourceNode.connect(this.analyser);

    // Ghi PCM thô trực tiếp qua Web Audio (ổn định 100% trên cả iOS Safari & Android/Desktop)
    await this._setupPcmNode();

    this.isMonitoring = true;
    this._startMeterLoop();
  }

  async _setupPcmNode() {
    // Ưu tiên AudioWorklet (inline Blob) nếu trình duyệt hỗ trợ, dự phòng ScriptProcessorNode
    let workletOk = false;
    if (this.audioCtx.audioWorklet && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
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
        if (!this.audioCtx._meloWorkletLoaded) {
          const blob = new Blob([workletCode], { type: 'application/javascript' });
          const blobUrl = URL.createObjectURL(blob);
          await this.audioCtx.audioWorklet.addModule(blobUrl);
          URL.revokeObjectURL(blobUrl);
          this.audioCtx._meloWorkletLoaded = true;
        }
        const node = new AudioWorkletNode(this.audioCtx, 'pcm-recorder-processor');
        node.port.onmessage = (ev) => {
          if (!this.isCapturing) return;
          const chunk = ev.data;
          this.chunks.push(chunk);
          this.totalSamples += chunk.length;
        };
        this.sourceNode.connect(node);
        node.connect(this.silentGain);
        this.silentGain.connect(this.audioCtx.destination);
        this.processorNode = node;
        workletOk = true;
      } catch (_) {
        workletOk = false;
      }
    }

    if (!workletOk) {
      const sp = this.audioCtx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => {
        if (!this.isCapturing) return;
        const input = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        this.chunks.push(copy);
        this.totalSamples += copy.length;
      };
      this.sourceNode.connect(sp);
      sp.connect(this.silentGain);
      this.silentGain.connect(this.audioCtx.destination);
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
   * Dừng ghi, đóng micro và trả về AudioBuffer chuẩn để phát lại & phân tích MIDI
   */
  finishCapture() {
    this.isCapturing = false;
    let audioBuffer = null;

    if (this.totalSamples > 0 && this.audioCtx) {
      audioBuffer = this.audioCtx.createBuffer(1, this.totalSamples, this.sampleRate);
      const dest = audioBuffer.getChannelData(0);
      let offset = 0;
      for (const chunk of this.chunks) {
        dest.set(chunk, offset);
        offset += chunk.length;
      }
    }

    this.close();
    return audioBuffer;
  }

  _startMeterLoop() {
    let lastPitchTime = 0;
    const loop = (now) => {
      if (!this.isMonitoring || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(this._liveBuf);
      const rms = computeRms(this._liveBuf);
      // Quy đổi biên độ dễ nhìn trên đồng hồ (0..1)
      const level = Math.min(1, Math.pow(rms * 6.5, 0.72));

      let liveNote = null;
      let liveFreq = null;

      // Chạy bắt cao độ trực tiếp mỗi ~50ms để tiết kiệm pin mobile mà vẫn mượt
      if (now - lastPitchTime > 48) {
        lastPitchTime = now;
        if (rms > 0.012) {
          const factor = this.sampleRate >= 40000 ? 4 : 2;
          const down = downsampleBuffer(this._liveBuf, factor);
          const det = detectPitchMPM(down, this.sampleRate / factor, 0.78);
          if (det) {
            liveFreq = det.freq;
            const m = freqToMidi(det.freq);
            if (m !== null) liveNote = midiToNoteName(Math.round(m));
          }
        }
        if (this._onLiveStats) {
          this._onLiveStats({ level, rms, noteName: liveNote, freq: liveFreq });
        }
      } else if (this._onLiveStats) {
        this._onLiveStats({ level, rms, noteName: undefined, freq: undefined });
      }

      this._meterRaf = requestAnimationFrame(loop);
    };
    this._meterRaf = requestAnimationFrame(loop);
  }

  close() {
    this.isMonitoring = false;
    this.isCapturing = false;
    if (this._meterRaf) {
      cancelAnimationFrame(this._meterRaf);
      this._meterRaf = null;
    }
    try { if (this.processorNode) this.processorNode.disconnect(); } catch (_) {}
    try { if (this.analyser) this.analyser.disconnect(); } catch (_) {}
    try { if (this.sourceNode) this.sourceNode.disconnect(); } catch (_) {}
    try { if (this.silentGain) this.silentGain.disconnect(); } catch (_) {}
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ownsContext && this.audioCtx) {
      try { this.audioCtx.close(); } catch (_) {}
    }
    this.processorNode = null;
    this.analyser = null;
    this.sourceNode = null;
    this.silentGain = null;
    this.chunks = [];
    this.totalSamples = 0;
  }
}

/**
 * Vẽ sóng âm thu nhỏ (Waveform Preview) của đoạn giọng vừa ngân lên Canvas
 */
export function drawVocalWaveform(canvas, audioBuffer) {
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
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (!audioBuffer || audioBuffer.length === 0) {
    ctx.restore();
    return;
  }

  const data = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));
  let maxPeak = 0.05;
  for (let i = 0; i < data.length; i += Math.max(1, Math.floor(step / 4))) {
    const a = Math.abs(data[i]);
    if (a > maxPeak) maxPeak = a;
  }

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#FB7185');
  grad.addColorStop(0.5, '#F43F5E');
  grad.addColorStop(1, '#FDA4AF');
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
