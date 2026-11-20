# PROJECT_NOTES — HEVOS STUDIO

Sổ tay kỹ thuật và bản đồ kiến trúc cho nền tảng âm nhạc **HEVOS STUDIO**.

---

## 1. Thông tin Dự án & Triển khai
- **Tên dự án**: HEVOS STUDIO (Sáng tác Beat · Phòng thu Vocal · Học nhạc lý)
- **Tác giả / Sáng lập**: Lê Trọng Hiếu (**HEVOS**) — [GitHub @hevos-s](https://github.com/hevos-s)
- **Kho lưu trữ Git**: `https://github.com/hevos-s/HEVOS-STUDIO.git` (nhánh `main`)
- **Môi trường triển khai**: GitHub Pages tĩnh tại đường dẫn con `/HEVOS-STUDIO/`

---

## 2. Quy tắc Kiến trúc Bắt buộc (Không được vi phạm)
1. **100% Web Tĩnh Không Build**:
   - Thuần HTML5, CSS3 và JavaScript ES6+ Modules (`<script type="module">`).
   - Tuyệt đối không dùng React, Vite, Webpack, TypeScript build hay Node packages (`package.json` / `node_modules`).
2. **Đường dẫn Tương đối**:
   - Mọi đường dẫn CSS, JS, asset phải viết dạng tương đối (`./style.css?v=13`, `./js/app.js?v=13`, `./theory.js?v=13`) để hoạt động ổn định trên subpath `/HEVOS-STUDIO/` của GitHub Pages.
3. **Cache-Busting Đồng Nhất**:
   - Toàn bộ query string `?v=...` trên `index.html` và tất cả import giữa các file trong `js/` phải đồng nhất cùng một phiên bản (`?v=13`) nhằm tránh trình duyệt tải thành 2 module instance khác nhau (đặc biệt với singleton `audioEngine`).
4. **Bảo toàn ID & Luồng Tính năng**:
   - Giữ nguyên toàn bộ `id`, `data-*` attributes, modal (`#chord-modal`, `#projects-modal`, `#toast-container`) và luồng hoạt động của 4 phân khu:
     - `hub` (**Tổng quan**): Không gian 3D tương tác nhạc, Editorial Showcase & Creator Spotlight.
     - `studio` (**Sáng tác Beat**): Hợp âm thông minh, Piano Roll 60fps, Ngân nga -> MIDI, Mixer 4 kênh, xuất `.mid` đa track & audio.
     - `vocal` (**Phòng thu Vocal**): Nhập beat ngoài MP3/WAV/M4A/OGG hoặc render beat từ Studio, thu 2 lớp giọng (Lead + Backing/Ad-lib) với Mic Preamp di động, Auto-Tune TD-PSOLA, 6 Preset & Kệ FX thời gian thực, xuất `.wav` bằng `OfflineAudioContext`.
     - `trainer` (**Học nhạc lý**): Luyện từng nốt, nốt chạy theo BPM, ôn tập nốt sai, tra cứu khuông nhạc Khóa Sol / Fa / Đô & bàn phím 12 phím.
5. **Thư viện CDN Ngoài**:
   - `Tone.js` (`14.8.49`) qua CDN jsDelivr (UMD global `window.Tone`).
   - `Three.js` (`0.160.0`) qua CDN jsDelivr (`three.module.js`, import trực tiếp trong `js/ambientScene.js`).

---

## 3. Danh sách Mô-đun & Tệp tin

| Tệp tin | Vai trò |
| :--- | :--- |
| `index.html` | Khung HTML5 chính, canvas 3D `#bg-3d-canvas`, thanh điều hướng 4 phân khu, Editorial Hub & 3 không gian làm việc |
| `style.css` | Hệ thống giao diện tối tương phản cao (`rgba(13, 14, 22, 0.88)`), chỉ giữ `backdrop-filter: blur(12px)` ở Navbar/Mobile Bottom Bar, thanh VU dùng GPU `transform: scaleX()` + Mobile (`@media (max-width: 768px)`) cuộn tự nhiên với Piano Roll `min-height: 320px; height: 48vh` |
| `PROJECT_NOTES.md` | Sổ tay kiến trúc & thông số kỹ thuật dự án |
| `js/ambientScene.js` | Không gian âm thanh 3D Three.js chuẩn Retina 60fps (`pixelRatio <= 2`, `antialias: true`), Harmonics Orb & 3 vòng quỹ đạo tần số, cảm ứng `Tone.Analyser` + Vocal Studio, tự tạm dừng khi ẩn tab (`visibilitychange`) |
| `js/app.js` | Điều phối trung tâm, trạng thái ứng dụng, đồng bộ Desktop/Mobile, điều hướng 4 phân khu, ngắt vòng lặp ở tab ẩn & `visibilitychange`, nối Audio -> 3D Scene |
| `js/audioEngine.js` | Bộ máy âm thanh `Tone.js` (4 tiếng đàn, 4 kiểu đệm, trống GM, giai điệu MIDI, đếm nhịp, mixer & xuất loop audio) |
| `js/autoTune.js` | Bộ xử lý Auto-Tune khóa tông thế hệ mới: Zero-Phase Butterworth Bandpass -> Exact FFT-YIN (`2048/256`) + Parabolic Interpolation -> Lọc trung vị 5 khung -> Khóa pha & nội suy sub-sample TD-PSOLA + Raised-Cosine Crossfade `15ms` + Soft Limiter `0.92` |
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
