# PROJECT_NOTES — HEVOS STUDIO

Sổ tay kỹ thuật và bản đồ kiến trúc cho nền tảng âm nhạc **HEVOS STUDIO**.

---

## 1. Thông tin Dự án & Triển khai
- **Tên dự án**: HEVOS STUDIO (Sáng tác Beat · Phòng thu Vocal · Dựng bài & Master · Học nhạc lý · Tính năng & Ý tưởng)
- **Tác giả / Sáng lập**: Lê Trọng Hiếu (**HEVOS**) — [Facebook @hevos05](https://www.facebook.com/hevos05) · [Instagram @_hevos](https://www.instagram.com/_hevos/)
- **Kho lưu trữ Git**: `https://github.com/hevos-s/HEVOS-STUDIO.git` (nhánh `main`)
- **Môi trường triển khai**: GitHub Pages tĩnh tại đường dẫn con `/HEVOS-STUDIO/`

---

## 2. Quy tắc Kiến trúc Bắt buộc (Không được vi phạm)
1. **100% Web Tĩnh Không Build**:
   - Thuần HTML5, CSS3 và JavaScript ES6+ Modules (`<script type="module">`).
   - Tuyệt đối không dùng React, Vite, Webpack, TypeScript build hay Node packages (`package.json` / `node_modules`).
2. **Đường dẫn Tương đối**:
   - Mọi đường dẫn CSS, JS, asset phải viết dạng tương đối (`./style.css?v=34`, `./js/app.js?v=34`, `./theory.js?v=34`) để hoạt động ổn định trên subpath `/HEVOS-STUDIO/` của GitHub Pages.
3. **Cache-Busting Đồng Nhất**:
   - Toàn bộ query string `?v=...` trên `index.html` và tất cả import giữa các file trong `js/` phải đồng nhất cùng một phiên bản (`?v=34`) nhằm tránh trình duyệt tải thành 2 module instance khác nhau (đặc biệt với singleton `audioEngine`).
4. **Bảo toàn ID & Luồng Tính năng**:
   - Giữ nguyên toàn bộ `id`, `data-*` attributes, modal (`#chord-modal`, `#projects-modal`, `#toast-container`) và luồng hoạt động của 6 phân khu:
     - `hub` (**Tổng quan**): Không gian 3D tương tác nhạc, Editorial Showcase & Creator Spotlight (Facebook `@hevos05` · Instagram `@_hevos`).
     - `studio` (**Sáng tác Beat**): Hợp âm thông minh, Piano Roll 60fps, Ngân nga -> MIDI, Mixer 4 kênh, xuất `.mid` đa track, xuất audio & gửi Beat `OfflineAudioContext` sang Dựng bài.
     - `vocal` (**Phòng thu Vocal**): Nhập beat ngoài MP3/WAV/M4A/OGG hoặc render beat từ Studio, thu 2 lớp giọng (Lead + Backing/Ad-lib) với Mic Preamp di động, Auto-Tune TD-PSOLA, 6 Preset & Kệ FX thời gian thực, xuất `.wav` bằng `OfflineAudioContext` & gửi từng kênh sang Dựng bài.
     - `arrangement` (**Dựng bài & Master**): Kho Clip đa nguồn, lưới Playlist đa kênh (kéo, Trim 2 đầu, Fade-In/Out, Dao cắt Split, Nhân bản), bộ trộn Track M/S/Vol/Pan, Mastering Rack (4 Preset · Master EQ 3 dải · Mid/Side Stereo Width · Glue Compressor · Limiter Maximizer `-0.3 dBFS`), đồng hồ Stereo L/R & xuất bản Master `.wav` 16/24-bit qua `OfflineAudioContext`.
     - `trainer` (**Học nhạc lý**): Lộ trình Sáng tác 6 chặng · 18 bài (sơ đồ SVG nội tuyến + 6 dạng bài tập thực hành) và Phòng tập Tự do 88 phím chuẩn (`A0–C8`) hỗ trợ Web MIDI.
     - `vision` (**Tính năng & Ý tưởng**): Tuyên ngôn & Triết lý kiến tạo HEVOS STUDIO, sơ đồ quy trình khép kín 4 bước, giải mã 4 trụ cột tính năng (`Ý tưởng & Bài toán thực tế` + `Hệ thống Công năng nổi bật` kèm nút dẫn thẳng sang từng tab) và 3 giá trị công nghệ cốt lõi (duy trì nền 3D tĩnh `0fps`).
5. **Thư viện CDN Ngoài**:
   - `Tone.js` (`14.8.49`) qua CDN jsDelivr (UMD global `window.Tone`).
   - `Three.js` (`0.160.0`) qua CDN jsDelivr (`three.module.js`, import trực tiếp trong `js/ambientScene.js`).

---

## 3. Danh sách Mô-đun & Tệp tin

| Tệp tin | Vai trò |
| :--- | :--- |
| `index.html` | Khung HTML5 chính, canvas 3D `#bg-3d-canvas`, thanh điều hướng 6 phân khu, Editorial Hub, trang Tính năng & Ý tưởng `#vision-root` & 4 không gian làm việc |
| `style.css` | Hệ thống giao diện tối tương phản cao (`rgba(13, 14, 22, 0.88)`), chỉ giữ `backdrop-filter: blur(12px)` ở Navbar/Mobile Bottom Bar, thanh VU dùng GPU `transform: scaleX()` + Mobile (`@media (max-width: 768px)`) thanh đáy cuộn ngang 6 tab & Piano Roll `min-height: 320px; height: 48vh` |
| `PROJECT_NOTES.md` | Sổ tay kiến trúc & thông số kỹ thuật dự án |
| `js/ambientScene.js` | Không gian âm thanh 3D Three.js chuẩn Retina 60fps (`pixelRatio <= 2`, `antialias: true`), Harmonics Orb & 3 vòng quỹ đạo tần số, cảm ứng `Tone.Analyser` + Vocal/Arrangement Studio, tự tạm dừng khi ẩn tab (`visibilitychange`) |
| `js/app.js` | Điều phối trung tâm, trạng thái ứng dụng, đồng bộ Desktop/Mobile, điều hướng 6 phân khu, cầu nối gửi Beat/Vocal sang Dựng bài, ngắt vòng lặp ở tab ẩn & `visibilitychange`, nối Audio -> 3D Scene |
| `js/arrangementStudio.js` | Phân khu `Dựng bài & Master`: Kho Clip, Playlist đa kênh (di chuyển, Trim, Fade-In/Out, Split, Duplicate), chuỗi Mastering `buildMasteringChain` (EQ 3 dải · Stereo Width · Glue Comp · Limiter `-0.3dBFS`) & xuất `.wav` 16/24-bit bằng `OfflineAudioContext` |
| `js/audioEngine.js` | Bộ máy âm thanh `Tone.js` (`maxPolyphony: 64`, chống trùng timestamp `+0.0005s`, bảo vệ `NaN`, mạch chuẩn âm lượng `-14 LUFS`: `Gain +10 dB -> Compressor(-16dB/3.5:1) -> Limiter -0.8dBFS -> WaveShaper Ceiling -0.8dBFS`, `lookAhead = 0.15`, `renderBeatOffline` đồng mức `-14 LUFS` & xuất loop audio) |
| `js/autoTune.js` | Bộ máy Auto-Tune khóa tông TD-PSOLA liên tục & đồng cực: Khử lệch DC -> Zero-Phase Butterworth `75–850Hz` -> FFT-YIN (`2048/256`) + Parabol -> Tách Pitch Trend & Vibrato + Exponential Glide (`±2.5` bán cung) -> Pitch Marks đồng cực toàn cục -> Overlap-Add chuẩn hóa `weightSum[i]` trên cửa sổ Hann `max(2*T0, 2*T1)` (khớp 1:1 cho cả nguyên âm & phụ âm) -> Warm Comp & Soft Limiter `0.92` |
| `js/midiExport.js` | Bộ mã hóa nhị phân Standard MIDI File Format 1 (`.mid`, PPQ = 480, tối đa 4 track) |
| `js/midiController.js` | Bộ điều khiển nhập liệu hợp nhất: Web MIDI Plug & Play đa cổng (`requestMIDIAccess`, mặc định nghe đồng thời tất cả cổng Input + dropdown chọn cổng, phân giải `status & 0xf0` đủ 16 kênh `Note On`/`0x80`/`vel=0`/CC 64 Sustain, mở khóa AudioContext ngay khi nhận `Note On`), bàn phím PC QWERTY (`Z–M`, `Q–U`), cảm ứng đa điểm & Chord Latch |
| `js/earTraining.js` | Ngân hàng câu hỏi & quản lý thống kê Luyện cảm âm (Hợp âm 3 cấp độ + Đảo bass, Quãng nhạc M2–P8, Bậc hòa âm I–vi theo tông mẫu) |
| `js/musicTheory.js` | Bộ nhận diện hợp âm thời gian thực (`detectChordFromMidis`), gợi ý âm giai Scale Guide (Trưởng, Thứ, Ngũ cung), lưu tiến độ Học viện (`hevos_theory_progress_v1`), vòng hợp âm Wait Mode & kho Giai điệu Nốt Rơi |
| `js/curriculumData.js` | Giáo trình Học viện Nhạc lý Thực chiến **6 Chặng · 18 Bài học đầy đủ** bằng tiếng Việt (mỗi bài ≥ 2–3 mục kèm ≥ 2 sơ đồ SVG nội tuyến `section.diagram`: Mặt phím · Lưới nhịp · Dẫn bè · Luồng hòa âm · Đường cong dấu thanh · Cấu trúc bài hát) & hệ thống Ví dụ Âm thanh Sống Tone.js |
| `js/theoryDiagrams.js` | Bộ kết xuất **6 loại Sơ đồ SVG Tương tác Nội tuyến** (`piano-strip` bấm phím trực tiếp trên hình, `rhythm-grid` + Swing, `voice-leading`, `harmony-flow`, `tone-contour` Thuận dấu/Cưỡng âm/Prosody, `song-structure` năng lượng 5 lớp) đồng bộ phát tiếng Tone.js |
| `js/theoryExercises.js` | Bộ máy **6 dạng Bài tập Thực hành Tương tác** (Note Finder, Interval Ear, Groove Tapper Canvas 4/4+Swing, Scale Runner, Scale & Viet-Tone Impostor, Chord Builder Auto-Latch, Progression Puzzle & Call-Response Lab đẩy thẳng sang Beat) |
| `js/musicTrainer.js` | Phân khu Học nhạc lý với 2 không gian chính: **Lộ trình Sáng tác 6 Chặng** (đọc bài + mục lục + audio demo + bài tập) và **Phòng tập Tự do** (Đàn Piano Hybrid, Nhận diện hợp âm sống, Wait Mode, Synthesia, Cảm âm & Đọc khuông nhạc) |
| `js/pianoRoll.js` | Bảng vẽ & chỉnh sửa giai điệu MIDI 60fps trên HTML5 Canvas |
| `js/pitchToMidi.js` | Thu âm Micro qua Native `AudioContext` + Preamp di động + YIN chuyển giọng ngân nga thành MIDI + đóng gói WAV 16-bit |
| `js/staffRenderer.js` | Bộ vẽ khuông nhạc Vector SVG sắc nét (Khóa Sol, Fa, Đô, hóa biểu, nốt nhạc) |
| `js/stepSequencer.js` | Bộ gõ lưới 16 bước (6 hàng nhạc cụ K-Pop Trap / US-UK Stage / EDM / Boombap / House / Alt-Rock, Accent velocity, Audition pad, Randomize/Clear) đồng bộ Live Tone.Part, Offline WAV/MP3 & xuất MIDI |
| `js/stemAnalyzer.js` | Bộ tách 4 Stems cục bộ theo phân hoạch 100% loại trừ lẫn nhau (2D Median-Filter HPSS + Mid/Side Spectral Subtraction: Vocals / Nhạc cụ & Hòa âm / Bass / Trống), bộ dò BPM & dòng thời gian Hợp âm tự động kèm Mixer M/S/Vol, chế độ nghe nhanh Karaoke/Acapella & tải bản Mix hiện tại |
| `js/theory.js` | Bộ máy nhạc lý thuần JS (âm giai, hợp âm, Smart Voice Leading, bảng Preset vòng hợp âm) |
| `js/trainerData.js` | Giáo trình luyện đọc nốt, ký âm, bộ sinh bài tập & lưu thống kê `localStorage` |
| `js/vocalStudio.js` | Phòng thu Vocal độc lập chạy Native `AudioContext` riêng, 2 kênh giọng, FX rack, xuất mixdown `.wav` và xuất tín hiệu `getAudioLevel()` cho 3D Scene |

---

## 4. Ghi chú Kỹ thuật Quan trọng
- **iOS Safari Microphone**: Phải gọi `navigator.mediaDevices.getUserMedia(...)` trực tiếp trong chuỗi đồng bộ của sự kiện chạm (`pointerdown`/`click`), không `await` bất kỳ thứ gì trước đó, và tạo Native `AudioContext` sau khi nhận stream.
- **Tách biệt Audio Context**: `VocalStudio` dùng `this.playCtx` (Native `AudioContext` độc lập) với `this._visualBus` + `this._visualAnalyser` để không đụng độ `Tone.Transport` của `Sáng tác Beat`.
- **CSS Fixed Bottom Bar trên Mobile**: Tuyệt đối không đặt `backdrop-filter` hoặc `transform` trực tiếp lên `.global-app-bar` vì sẽ biến nó thành containing block giữ chặt `#section-switcher.global-nav` (`position: fixed; bottom: 0`). Thay vào đó đặt `backdrop-filter` lên pseudo-element `.global-app-bar::before`.
- **Tối ưu Âm thanh PC Desktop (`window.innerWidth > 768`) vs Mobile**: Trên Desktop cấu hình riêng `Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.25 }))`, giới hạn `dpr <= 1.5` trên `> 1024px`, dựng lười (`lazy`) các Vocal FX chains, và hỗ trợ động mọi sample rate `44.1 / 48 / 96 kHz` kèm đồng pha Stereo L/R trong `autoTune.js` (`Mobile <= 768px` giữ nguyên cấu hình nhẹ ban đầu).
- **Cơ chế Nền 3D Động/Tĩnh Theo Ngữ Cảnh (`ambientScene.js`)**: Tab `Tổng quan` chạy vòng lặp 60fps (`data-scene-mode="active-60fps"`), còn toàn bộ 5 tab làm việc & đọc nội dung (`Sáng tác Beat`, `Phòng thu Vocal`, `Dựng bài & Master`, `Học nhạc lý`, `Tính năng & Ý tưởng`) đóng băng hoàn toàn 0fps (`cancelAnimationFrame`, `data-scene-mode="static-0fps"`, `data-raf-running="false"`) với 1 khung hình nền tĩnh dịu nhẹ (chỉ vẽ lại 1 lần khi `resize`).
- **Chuẩn hóa Nhịp & Đồng hồ Phần cứng (`audioEngine.js`)**: `_nextSafeTime()` dùng `ctx.immediate()` (thời gian phần cứng AudioContext) thay vì `ctx.now()` (tránh dồn sự kiện vào chu kỳ wake-up `75–125ms` của worker gây lệch nhịp lúc nhanh lúc chậm); đặt `transport.PPQ = 480`, `transport.bpm.setValueAtTime(bpm, 0)` khi dừng, và lập lịch theo đơn vị Ticks `"${tk}i"` chính xác tới sub-millisecond.
- **Piano Roll Toàn màn hình (`pianoRoll.js`, `app.js`)**: `#btn-pr-fullscreen` mở rộng `#melody-workspace-view.piano-roll-fullscreen` (`100vw x 100dvh`, `z-index: 9999`), hiện thanh điều khiển nhanh `#pr-fullscreen-transport` (`Phát`/`Dừng`, `Ngân nga MIDI`), ẩn bottom nav Mobile, căn giữa quãng nốt hiện có và thu nhỏ bằng nút hoặc `Esc`.
- **Gửi Vocal sang Dựng bài từ Phòng thu (`vocalStudio.js`, `arrangementStudio.js`, `app.js`)**: `#vs-btn-send-vocal-arr` kết xuất `OfflineAudioContext` cho Track 1 (`Vocal Chính · Phòng thu`, `suggestedTrackIndex: 2`) và Track 2 (`Hát Bè · Phòng thu`, `suggestedTrackIndex: 3`) giữ nguyên Auto-Tune, FX, Volume/Pan/Sync Offset, tự đặt lên track trống qua `autoPlaceIfEmpty` kèm toast có nút `Mở Dựng bài →`.
- **Tự động Nhận diện Tông Auto-Tune (`autoTune.js`, `vocalStudio.js`)**: `#vs-btn-auto-key` (bật mặc định) sử dụng `detectKeyFromAudioBuffer` (Radix-2 FFT Chromagram + Krumhansl-Schmuckler 24 tông) khi nạp Beat ngoài MP3/WAV, và `detectKeyFromVocalFrames` / `detectKeyFromPcm` (bù độ lệch tổng thể + soft-binning + trọng số kết câu) khi thu mộc không Beat để tự động khóa đúng tông giọng thật của người dùng.
- **Đệm Hợp âm Biến thể & Piano Pop Trầm Ấm (`theory.js`, `audioEngine.js`)**: `buildBarChordEvents` tạo biến thể câu nhạc 4 giai đoạn (`A`, `A'`, `B`, `Turnaround`) kèm bước dẫn `passingBass` sang hợp âm tiếp theo và đa dạng độ cao voicing theo ô nhịp; bổ sung kiểu đệm `pop_groove` (`Pop Trầm Ấm / Pulse`) & `lofi`, chất tiếng `modern_piano` (`Piano Pop Trầm Ấm` EQ ấm `230Hz` + LPF `1650Hz`), và tách riêng `_getBassSynth()` cho các nốt `role === 'bass'` khi phát Live.
- **Đầy đủ 7 Hợp âm Trưởng/Thứ Cơ bản & Công thức Đệm Kinh điển (`theory.js`, `audioEngine.js`, `index.html`, `app.js`)**: `BASIC_MAJOR_CHORDS` (`C D E F G A B`), `BASIC_MINOR_CHORDS` (`Cm Dm Em Fm Gm Am Bm`) trong `#chord-modal` + `resolveChord` hỗ trợ hợp âm tự do; `rootOrderedMidis` (`1-3-5` / `1-3-5-7`) & `bass158Midis` (`1-5-8`) phục vụ 4 phong cách mới: `block` (`Block Chord`), `broken_1357` (`Broken Chord / Arpeggio 1-3-5 · 1-3-5-7`), `pattern_158` (`Rải 1-5-8`), và `bass_chord` (`Bass + Chord`).
- **Xuất Audio 2 Định dạng `.WAV` & `.MP3` (`audioEncode.js`, `app.js`, `vocalStudio.js`, `lamejs` CDN)**: Bộ chọn `WAV` / `MP3` tích hợp trên cả `Sáng tác Beat` (Desktop & Mobile) lẫn `Phòng thu Vocal` (`Xuất Bản Mix`, `Xuất Riêng Giọng`, tải track lẻ), kết xuất `OfflineAudioContext` và nén MP3 `192 kbps` bằng `lamejs` (tự động nội suy về `48/44.1 kHz` nếu đầu vào > `48 kHz`).
- **Âm thanh Sân Khấu US-UK & K-Pop / G-Dragon (`theory.js`, `audioEngine.js`, `midiExport.js`, `vocalStudio.js`)**: Bổ sung 2 nhạc cụ Synth sân khấu (`dark_brass` Dark Brass K-Pop, `stage_pluck` Stage Pluck / Lead), 3 kiểu đệm cá tính (`yg_bounce` YG Stage Bounce, `usuk_stage` US-UK Stage Pop, `alt_punk` GD Alt-Pop Bounce), 3 bộ trống hiện đại có **Clap 2 lớp + Crash Cymbal + Hi-hat roll 1/16–1/32 + Fill chuyển ô** (`kpop_trap`, `stage_pop`, `alt_hiphop`) và 5 Preset thuộc 2 nhóm Vibe mới (**K-Pop / G-Dragon** & **US-UK Stage Pop**).
- **Khắc phục Lỗi & Tối ưu Mobile Toàn Diện (`audioEngine.js`, `app.js`, `ambientScene.js`, `vocalStudio.js`, `arrangementStudio.js`, `style.css`, `index.html`)**: Mở khóa Web Audio đồng bộ qua `unlockSync()` + `touchend`/`click`/`keydown` có timeout 900ms chống treo deadlock `ensureReady()`, tự gắn lại listener khi `visibilitychange` phục hồi trạng thái `interrupted` trên iOS; tải Three.js lazy không chặn khởi chạy app; chờ `ctx.resume()` trước khi lên lịch phát ở Phòng thu Vocal & Dựng bài kèm `webkitOfflineAudioContext`; đặt `touch-action: none` cho Canvas và loại bỏ bẫy cuộn kép trong Studio Mobile.
- **Phòng Luyện Đàn Piano Tương Tác Đa Chế Độ & Web MIDI (`midiController.js`, `musicTheory.js`, `musicTrainer.js`, `audioEngine.js`, `app.js`, `index.html`, `style.css`)**: Hỗ trợ hoàn hảo 100% không cần phần cứng (chuột + `Giữ phím ghép hợp âm` Chord Latch, cảm ứng đa điểm trên Mobile có thanh chuyển quãng, bàn phím máy tính 2 quãng tám `Z–M`/`Q–U`) và tự động Plug & Play khi cắm đàn Piano/MIDI USB (`Velocity`, `CC 64 Sustain Pedal`), tích hợp nhận diện hợp âm sống thời gian thực, **Luyện Đệm Hợp Âm (`Wait Mode` / Metronome)**, **Nốt Rơi Synthesia `<canvas>`** nạp trực tiếp được dữ liệu từ `Sáng tác Beat`, và cho phép chơi/ghi nốt MIDI trực tiếp vào Piano Roll (`#btn-midi-record-arm`).
- **Bộ 3 Tính năng Roadmap Hoàn thiện (`earTraining.js`, `stepSequencer.js`, `stemAnalyzer.js`)**:
  - **Luyện Cảm Âm Hợp Âm (`Học nhạc lý`)**: Nhận diện chất hợp âm (`maj`, `min`, `sus4`, `7`, `maj7`, `m7`, `dim`, hợp âm đảo 3 cấp độ), Quãng nhạc (`M2–P8`) & Bậc hòa âm (`I–vi`), phát Block/Rải, thống kê chuỗi đúng & kỷ lục.
  - **Bộ gõ Step Sequencer 16 bước (`Sáng tác Beat`)**: Lưới 6×16 tương tác trực tiếp (`Kick 808`, `Snare`, `Clap`, `Hi-Hat`, `Open Hat`, `Rim / Crash`) với chế độ Accent, 6 preset nhịp, Audition chạm từng ô & tô sáng cột nhịp theo thời gian thực; đồng bộ 1:1 qua `custom_seq` cho Phát Live, Offline WAV/MP3 & xuất MIDI `.mid`.
  - **Tách Stems & Phân tích Hợp âm Tự động (`Dựng bài & Master`)**: Nạp MP3/WAV hoặc lấy Beat từ Studio, tự động dò Tông (`detectKeyFromAudioBuffer`), dò BPM (`detectBpmFromAudioBuffer`), vẽ Dòng thời gian Hợp âm (`analyzeChordsFromAudioBuffer`) và tách 4 Stems DSP cục bộ theo phân hoạch 2D-HPSS + Mid/Side không dẫm tiếng (`vocals`, `instrumental`, `bass`, `drums`) kèm Mixer nghe thử (`Volume 0%` triệt để, preset nhanh `Xóa Vocal (Karaoke)` / `Chỉ Giọng hát`), tải từng Stem hoặc tải bản Mix, chuyển thẳng 4 lớp lên Playlist hoặc nạp hợp âm sang Beat / Phòng Đàn.
- **Học viện Nhạc lý Thực chiến 6 Chặng & Phòng Tập 88 Phím Chuẩn (`curriculumData.js`, `theoryDiagrams.js`, `theoryExercises.js`, `musicTrainer.js`, `midiController.js`, `audioEngine.js`)**: Phân khu `Học nhạc lý` gồm **Lộ trình Sáng tác** 6 chặng · 18 bài (giữ phím minh họa gọn 1–2 quãng tám + 36 sơ đồ SVG nội tuyến + 6 dạng bài tập thực hành) và **Phòng tập Tự do** nâng cấp trọn bộ **88 phím Piano chuẩn (`A0–C8`)** kèm **88-Key Navigator Minimap** kéo/bấm trượt nhanh, nút nhảy quãng tám, chế độ thu gọn 88 phím trên 1 màn hình Desktop, đồng bộ 1:1 cho Nốt Rơi Synthesia `<canvas>`, thanh **Live MIDI Monitor**, nghe đồng thời đa cổng USB-MIDI tự mở khóa `AudioContext`, và chuẩn hóa âm lượng `-14 LUFS` chống méo ở `-0.8 dBFS`.
