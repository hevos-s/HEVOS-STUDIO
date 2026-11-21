// ============================================================================
// audioEncode.js — Bộ mã hóa AudioBuffer sang .WAV (16-bit PCM) & .MP3 (192 kbps)
// Sử dụng thuần JS trên trình duyệt + lamejs CDN (không cần build server)
// ============================================================================

const LAMEJS_CDN_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
const MP3_SUPPORTED_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

const yieldUi = () => new Promise((resolve) => setTimeout(resolve, 0));

let lameLoadPromise = null;

/**
 * Đảm bảo thư viện lamejs đã sẵn sàng trên window.lamejs (nạp lười qua CDN nếu chưa có)
 */
export async function ensureLamejsLoaded() {
  if (typeof window !== 'undefined' && window.lamejs && window.lamejs.Mp3Encoder) {
    return window.lamejs;
  }
  if (lameLoadPromise) return lameLoadPromise;

  lameLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hevos-lamejs]');
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.lamejs && window.lamejs.Mp3Encoder) resolve(window.lamejs);
        else reject(new Error('Không thể khởi tạo bộ mã hóa MP3 (lamejs).'));
      });
      existing.addEventListener('error', () =>
        reject(new Error('Không thể tải bộ mã hóa MP3 từ CDN.'))
      );
      return;
    }

    const script = document.createElement('script');
    script.src = LAMEJS_CDN_URL;
    script.async = true;
    script.dataset.hevosLamejs = '1';
    script.onload = () => {
      if (window.lamejs && window.lamejs.Mp3Encoder) {
        resolve(window.lamejs);
      } else {
        reject(new Error('Bộ mã hóa MP3 không hợp lệ sau khi tải.'));
      }
    };
    script.onerror = () => {
      lameLoadPromise = null;
      reject(new Error('Không thể tải thư viện nén MP3 (kiểm tra kết nối mạng hoặc thử xuất WAV).'));
    };
    document.head.appendChild(script);
  });

  return lameLoadPromise;
}

/**
 * Nội suy tuyến tính kênh PCM khi cần đưa tần số lấy mẫu (vd 96kHz) về dải MPEG chuẩn (48kHz / 44.1kHz)
 */
function resampleLinear(input, srcRate, dstRate) {
  if (srcRate === dstRate || input.length === 0) return input;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  const maxIdx = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = i0 < maxIdx ? i0 + 1 : maxIdx;
    const frac = pos - i0;
    out[i] = input[i0] + (input[i1] - input[i0]) * frac;
  }
  return out;
}

function floatToInt16Pcm(floatArr) {
  const len = floatArr.length;
  const int16 = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    let s = floatArr[i];
    if (!Number.isFinite(s)) s = 0;
    else if (s > 1) s = 1;
    else if (s < -1) s = -1;
    int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return int16;
}

function pickMp3SampleRate(srcRate) {
  const r = Math.round(Number(srcRate) || 44100);
  if (MP3_SUPPORTED_RATES.includes(r)) return r;
  return r >= 46000 ? 48000 : 44100;
}

/**
 * Đóng gói AudioBuffer (Mono hoặc Stereo) thành Blob chuẩn RIFF/WAVE 16-bit PCM
 */
export function encodeAudioBufferToWavBlob(audioBuffer) {
  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels || 1));
  const sampleRate = Math.round(audioBuffer.sampleRate || 44100);
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const ch0 = audioBuffer.getChannelData(0);
  const ch1 = numChannels > 1 ? audioBuffer.getChannelData(1) : null;
  let offset = 44;

  for (let i = 0; i < numFrames; i++) {
    let s0 = ch0[i];
    if (!Number.isFinite(s0)) s0 = 0;
    else if (s0 > 1) s0 = 1;
    else if (s0 < -1) s0 = -1;
    view.setInt16(offset, s0 < 0 ? s0 * 0x8000 : s0 * 0x7fff, true);
    offset += 2;

    if (ch1) {
      let s1 = ch1[i];
      if (!Number.isFinite(s1)) s1 = 0;
      else if (s1 > 1) s1 = 1;
      else if (s1 < -1) s1 = -1;
      view.setInt16(offset, s1 < 0 ? s1 * 0x8000 : s1 * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Nén AudioBuffer (Mono hoặc Stereo) thành file MP3 chuẩn MPEG-1 Layer 3 (mặc định 192 kbps)
 */
export async function encodeAudioBufferToMp3Blob(
  audioBuffer,
  { kbps = 192, onProgress = null } = {}
) {
  const lamejs = await ensureLamejsLoaded();
  const numChannels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels || 1));
  const srcRate = Math.round(audioBuffer.sampleRate || 44100);
  const targetRate = pickMp3SampleRate(srcRate);

  const rawLeft = resampleLinear(audioBuffer.getChannelData(0), srcRate, targetRate);
  const left16 = floatToInt16Pcm(rawLeft);
  const right16 =
    numChannels > 1
      ? floatToInt16Pcm(resampleLinear(audioBuffer.getChannelData(1), srcRate, targetRate))
      : null;

  const encoder = new lamejs.Mp3Encoder(numChannels, targetRate, kbps);
  const blockSize = 1152;
  const totalSamples = left16.length;
  const mp3Chunks = [];
  let blockCount = 0;

  for (let i = 0; i < totalSamples; i += blockSize) {
    const lChunk = left16.subarray(i, i + blockSize);
    const buf = right16
      ? encoder.encodeBuffer(lChunk, right16.subarray(i, i + blockSize))
      : encoder.encodeBuffer(lChunk);
    if (buf && buf.length > 0) {
      mp3Chunks.push(buf);
    }
    blockCount++;
    if (blockCount % 48 === 0) {
      if (onProgress) onProgress(Math.min(96, Math.round((i / totalSamples) * 96)));
      await yieldUi();
    }
  }

  const endBuf = encoder.flush();
  if (endBuf && endBuf.length > 0) {
    mp3Chunks.push(endBuf);
  }
  if (onProgress) onProgress(100);

  return new Blob(mp3Chunks, { type: 'audio/mpeg' });
}

/**
 * Mã hóa AudioBuffer theo định dạng người dùng chọn ('wav' hoặc 'mp3')
 */
export async function encodeAudioBufferByFormat(audioBuffer, format = 'wav', options = {}) {
  const fmt = String(format).toLowerCase() === 'mp3' ? 'mp3' : 'wav';
  if (fmt === 'mp3') {
    const blob = await encodeAudioBufferToMp3Blob(audioBuffer, options);
    return { blob, ext: 'mp3', mime: 'audio/mpeg' };
  }
  const blob = encodeAudioBufferToWavBlob(audioBuffer);
  if (options.onProgress) options.onProgress(100);
  return { blob, ext: 'wav', mime: 'audio/wav' };
}
