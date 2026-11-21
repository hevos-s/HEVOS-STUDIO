# PROJECT_NOTES — HEVOS STUDIO

Sổ tay kỹ thuật và bản đồ kiến trúc cho nền tảng âm nhạc **HEVOS STUDIO**.

---

## 1. Thông tin Dự án & Triển khai
- **Tên dự án**: HEVOS STUDIO (Sáng tác Beat · Phòng thu Vocal · Dựng bài & Master · Học nhạc lý)
- **Tác giả / Sáng lập**: Lê Trọng Hiếu (**HEVOS**) — [GitHub @hevos-s](https://github.com/hevos-s)
- **Kho lưu trữ Git**: `https://github.com/hevos-s/HEVOS-STUDIO.git` (nhánh `main`)
- **Môi trường triển khai**: GitHub Pages tĩnh tại đường dẫn con `/HEVOS-STUDIO/`

---

## 2. Quy tắc Kiến trúc Bắt buộc (Không được vi phạm)
1. **100% Web Tĩnh Không Build**:
   - Thuần HTML5, CSS3 và JavaScript ES6+ Modules (`<script type="module">`).
   - Tuyệt đối không dùng React, Vite, Webpack, TypeScript build hay Node packages (`package.json` / `node_modules`).
2. **Đường dẫn Tương đối**:
   - Mọi đường dẫn CSS, JS, asset phải viết dạng tương đối (`./style.css?v=19`, `./js/app.js?v=19`, `./theory.js?v=19`) để hoạt động ổn định trên subpath `/HEVOS-STUDIO/` của GitHub Pages.
3. **Cache-Busting Đồng Nhất**:
   - Toàn bộ query string `?v=...` trên `index.html` và tất cả import giữa các file trong `js/` phải đồng nhất cùng một phiên bản (`?v=19`) nhằm tránh trình duyệt tải thành 2 module instance khác nhau (đặc biệt với singleton `audioEngine`).
4. **Bảo toàn ID & Luồng Tính năng**:
   - Giữ nguyên toàn bộ `id`, `data-*` attributes, modal (`#chord-modal`, `#projects-modal`, `#toast-container`) và luồng hoạt động của 5 phân khu:
     - `hub` (**Tổng quan**): Không gian 3D tương tác nhạc, Editorial Showcase & Creator Spotlight.
     - `studio` (**Sáng tác Beat**): Hợp âm thông minh, Piano Roll 60fps, Ngân nga -> MIDI, Mixer 4 kênh, xuất `.mid` đa track, xuất audio & gửi Beat `OfflineAudioContext` sang Dựng bài.
     - `vocal` (**Phòng thu Vocal**): Nhập beat ngoài MP3/WAV/M4A/OGG hoặc render beat từ Studio, thu 2 lớp giọng (Lead + Backing/Ad-lib) với Mic Preamp di động, Auto-Tune TD-PSOLA, 6 Preset & Kệ FX thời gian thực, xuất `.wav` bằng `OfflineAudioContext` & gửi từng kênh sang Dựng bài.
     - `arrangement` (**Dựng bài & Master**): Kho Clip đa nguồn, lưới Playlist đa kênh (kéo, Trim 2 đầu, Fade-In/Out, Dao cắt Split, Nhân bản), bộ trộn Track M/S/Vol/Pan, Mastering Rack (4 Preset · Master EQ 3 dải · Mid/Side Stereo Width · Glue Compressor · Limiter Maximizer `-0.3 dBFS`), đồng hồ Stereo L/R & xuất bản Master `.wav` 16/24-bit qua `OfflineAudioContext`.
     - `trainer` (**Học nhạc lý**): Luyện từng nốt, nốt chạy theo BPM, ôn tập nốt sai, tra cứu khuông nhạc Khóa Sol / Fa / Đô & bàn phím 12 phím.
5. **Thư viện CDN Ngoài**:
   - `Tone.js` (`14.8.49`) qua CDN jsDelivr (UMD global `window.Tone`).
   - `Three.js` (`0.160.0`) qua CDN jsDelivr (`three.module.js`, import trực tiếp trong `js/ambientScene.js`).

---

## 3. Danh sách Mô-đun & Tệp tin

| Tệp tin | Vai trò |
| :--- | :--- |
| `index.html` | Khung HTML5 chính, canvas 3D `#bg-3d-canvas`, thanh điều hướng 5 phân khu, Editorial Hub & 4 không gian làm việc |
| `style.css` | Hệ thống giao diện tối tương phản cao (`rgba(13, 14, 22, 0.88)`), chỉ giữ `backdrop-filter: blur(12px)` ở Navbar/Mobile Bottom Bar, thanh VU dùng GPU `transform: scaleX()` + Mobile (`@media (max-width: 768px)`) 5 tab đáy & Piano Roll `min-height: 320px; height: 48vh` |
| `PROJECT_NOTES.md` | Sổ tay kiến trúc & thông số kỹ thuật dự án |
| `js/ambientScene.js` | Không gian âm thanh 3D Three.js chuẩn Retina 60fps (`pixelRatio <= 2`, `antialias: true`), Harmonics Orb & 3 vòng quỹ đạo tần số, cảm ứng `Tone.Analyser` + Vocal/Arrangement Studio, tự tạm dừng khi ẩn tab (`visibilitychange`) |
| `js/app.js` | Điều phối trung tâm, trạng thái ứng dụng, đồng bộ Desktop/Mobile, điều hướng 5 phân khu, cầu nối gửi Beat/Vocal sang Dựng bài, ngắt vòng lặp ở tab ẩn & `visibilitychange`, nối Audio -> 3D Scene |
| `js/arrangementStudio.js` | Phân khu `Dựng bài & Master`: Kho Clip, Playlist đa kênh (di chuyển, Trim, Fade-In/Out, Split, Duplicate), chuỗi Mastering `buildMasteringChain` (EQ 3 dải · Stereo Width · Glue Comp · Limiter `-0.3dBFS`) & xuất `.wav` 16/24-bit bằng `OfflineAudioContext` |
| `js/audioEngine.js` | Bộ máy âm thanh `Tone.js` (`maxPolyphony: 64`, chống trùng timestamp `+0.0005s`, bảo vệ `NaN`, mạch `Compressor -> Limiter -1dBFS`, `lookAhead = 0.15`, `renderBeatOffline` bằng `OfflineAudioContext` & xuất loop audio) |
| `js/autoTune.js` | Bộ máy Auto-Tune khóa tông TD-PSOLA liên tục & đồng cực: Khử lệch DC -> Zero-Phase Butterworth `75–850Hz` -> FFT-YIN (`2048/256`) + Parabol -> Tách Pitch Trend & Vibrato + Exponential Glide (`±2.5` bán cung) -> Pitch Marks đồng cực toàn cục -> Overlap-Add chuẩn hóa `weightSum[i]` trên cửa sổ Hann `max(2*T0, 2*T1)` (khớp 1:1 cho cả nguyên âm & phụ âm) -> Warm Comp & Soft Limiter `0.92` |
| `js/midiExport.js` | Bộ mã hóa nhị phân Standard MIDI File Format 1 (`.mid`, PPQ = 480, tối đa 4 track) |
| `js/musicTrainer.js` | Giao diện & logic luyện đọc nốt, nốt chạy theo BPM, chấm điểm & ôn tập nốt hay sai |
| `js/pianoRoll.js` | Bảng vẽ & chỉnh sửa giai điệu MIDI 60fps trên HTML5 Canvas |
| `js/pitchToMidi.js` | Thu âm Micro qua Native `AudioContext` + Preamp di động + YIN chuyển giọng ngân nga thành MIDI + đóng gói WAV 16-bit |
| `js/staffRenderer.js` | Bộ vẽ khuông nhạc Vector SVG sắc nét (Khóa Sol, Fa, Đô, hóa biểu, nốt nhạc) |
| `js/theory.js` | Bộ máy nhạc lý thuần JS (âm giai, hợp âm, Smart Voice Leading, bảng Preset vòng hợp âm) |
| `js/trainerData.js` | Giáo trình luyện đọc nốt, ký âm, bộ sinh bài tập & lưu thống kê `localStorage` |
| `js/vocalStudio.js` | Phòng thu Vocal độc lập chạy Native `AudioContext` riêng, 2 kênh giọng, FX rack, xuất mixdown `.wav` và xuất tín hiệu `getAudioLevel()` cho 3D Scene |

---

## 4. Ghi chú Kỹ thuật Quan trọng
- **iOS Safari Microphone**: Phải gọi `navigator.mediaDevices.getUserMedia(...)` trực tiếp trong chuỗi đồng bộ của sự kiện chạm (`pointerdown`/`click`), không `await` bất kỳ thứ gì trước đó, và tạo Native `AudioContext` sau khi nhận stream.
- **Tách biệt Audio Context**: `VocalStudio` dùng `this.playCtx` (Native `AudioContext` độc lập) với `this._visualBus` + `this._visualAnalyser` để không đụng độ `Tone.Transport` của `Sáng tác Beat`.
- **CSS Fixed Bottom Bar trên Mobile**: Tuyệt đối không đặt `backdrop-filter` hoặc `transform` trực tiếp lên `.global-app-bar` vì sẽ biến nó thành containing block giữ chặt `#section-switcher.global-nav` (`position: fixed; bottom: 0`). Thay vào đó đặt `backdrop-filter` lên pseudo-element `.global-app-bar::before`.
- **Tối ưu Âm thanh PC Desktop (`window.innerWidth > 768`) vs Mobile**: Trên Desktop cấu hình riêng `Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.25 }))`, giới hạn `dpr <= 1.5` trên `> 1024px`, dựng lười (`lazy`) các Vocal FX chains, và hỗ trợ động mọi sample rate `44.1 / 48 / 96 kHz` kèm đồng pha Stereo L/R trong `autoTune.js` (`Mobile <= 768px` giữ nguyên cấu hình nhẹ ban đầu).
- **Cơ chế Nền 3D Động/Tĩnh Theo Ngữ Cảnh (`ambientScene.js`)**: Tab `Tổng quan` chạy vòng lặp 60fps (`data-scene-mode="active-60fps"`), còn toàn bộ 4 tab làm việc (`Sáng tác Beat`, `Phòng thu Vocal`, `Dựng bài & Master`, `Học nhạc lý`) đóng băng hoàn toàn 0fps (`cancelAnimationFrame`, `data-scene-mode="static-0fps"`, `data-raf-running="false"`) với 1 khung hình nền tĩnh dịu nhẹ (chỉ vẽ lại 1 lần khi `resize`).
- **Chuẩn hóa Nhịp & Đồng hồ Phần cứng (`audioEngine.js`)**: `_nextSafeTime()` dùng `ctx.immediate()` (thời gian phần cứng AudioContext) thay vì `ctx.now()` (tránh dồn sự kiện vào chu kỳ wake-up `75–125ms` của worker gây lệch nhịp lúc nhanh lúc chậm); đặt `transport.PPQ = 480`, `transport.bpm.setValueAtTime(bpm, 0)` khi dừng, và lập lịch theo đơn vị Ticks `"${tk}i"` chính xác tới sub-millisecond.
