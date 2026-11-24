// ============================================================================
// theoryDiagrams.js — 6 Bộ kết xuất Sơ đồ SVG Tương tác Nội tuyến & Phát âm Tone.js
// Thiết kế Monochrome tối sang trọng · Điểm nhấn Amber (#F59E0B) / Emerald (#10B981)
// Dùng cho Giáo trình 6 Chặng · 18 Bài Học (js/curriculumData.js)
// ============================================================================

import { midiToNoteName } from './theory.js?v=42';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeNum(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function clampVal(val, min, max) {
  return Math.max(min, Math.min(max, safeNum(val, min)));
}

const TYPE_META = {
  'piano-strip': { badge: 'MẶT PHÍM TƯƠNG TÁC', hint: 'Bấm trực tiếp phím trên hình hoặc ▶ Nghe minh họa' },
  'rhythm-grid': { badge: 'LƯỚI Ô NHỊP DAW', hint: 'Bấm ▶ Nghe minh họa để xem con trỏ nhịp chạy đồng bộ' },
  'voice-leading': { badge: 'DẪN BÈ VOICE LEADING', hint: 'Bấm từng cột hợp âm hoặc ▶ Nghe minh họa đối chiếu' },
  'harmony-flow': { badge: 'SƠ ĐỒ CHỨC NĂNG HÒA ÂM', hint: 'Bấm từng ô hợp âm để nghe màu hoặc ▶ Nghe cả vòng' },
  'tone-contour': { badge: 'ĐƯỜNG CONG DẤU THANH', hint: 'Bấm nghe từng câu để phân biệt Thuận dấu vs Cưỡng âm' },
  'song-structure': { badge: 'CẤU TRÚC & LỚP NHẠC CỤ', hint: 'Bấm từng đoạn hoặc ▶ Nghe toàn bài theo đường năng lượng' },
};

const COLOR_MAP = {
  amber: { fill: '#F59E0B', stroke: '#FCD34D', text: '#FDE68A', bg: 'rgba(245,158,11,0.18)' },
  emerald: { fill: '#10B981', stroke: '#6EE7B7', text: '#A7F3D0', bg: 'rgba(16,185,129,0.18)' },
  cyan: { fill: '#38BDF8', stroke: '#7DD3FC', text: '#BAE6FD', bg: 'rgba(56,189,248,0.18)' },
  rose: { fill: '#FB7185', stroke: '#FDA4AF', text: '#FECDD3', bg: 'rgba(251,113,133,0.18)' },
  muted: { fill: '#71717A', stroke: '#A1A1AA', text: '#A1A1AA', bg: 'rgba(113,113,122,0.18)' },
};

function defaultLegendForDiagram(d) {
  if (Array.isArray(d.legend) && d.legend.length > 0) return d.legend;
  switch (d.type) {
    case 'piano-strip':
      return [
        { color: 'amber', label: 'Nốt gốc / Tâm điểm' },
        { color: 'emerald', label: 'Nốt đích / Trong công thức' },
        ...(Array.isArray(d.excludedMidis) && d.excludedMidis.length ? [{ color: 'rose', label: 'Nốt bỏ đi (tránh chọi)' }] : []),
      ];
    case 'rhythm-grid':
      return [
        { color: 'emerald', label: 'Phách mạnh / Nốt chuẩn' },
        { color: 'amber', label: d.compareMode ? 'Lơi Swing / Đảo phách' : 'Nốt chấm dôi (+50%)' },
        { color: 'muted', label: 'Dấu lặng (Khoảng thở)' },
      ];
    case 'voice-leading':
      return [
        { color: 'emerald', label: 'Giữ nguyên nốt chung (=0)' },
        { color: 'amber', label: 'Dịch chuyển ngắn (1–2 phím)' },
        { color: 'rose', label: 'Nhảy cóc quãng xa' },
      ];
    case 'harmony-flow':
      return [
        { color: 'emerald', label: 'Tonic (Về nhà) / Thứ' },
        { color: 'cyan', label: 'Pre-dominant (Mở đường)' },
        { color: 'amber', label: 'Dominant / Hút căng thẳng' },
      ];
    case 'tone-contour':
      return [
        { color: 'emerald', label: 'Thuận dấu tự nhiên / Khớp phách' },
        { color: 'rose', label: 'Cưỡng âm / Lệch trọng âm' },
      ];
    case 'song-structure':
      return [
        { color: 'emerald', label: 'Đoạn êm / Kể chuyện' },
        { color: 'amber', label: 'Pre-Chorus / Bridge chuyển mạch' },
        { color: 'rose', label: 'Chorus bùng nổ năng lượng' },
      ];
    default:
      return [];
  }
}

// ============================================================================
// 1. PIANO-STRIP RENDERER
// ============================================================================
function renderPianoStripSvg(d, uid) {
  const startMidi = clampVal(d.startMidi ?? 60, 36, 84);
  const endMidi = clampVal(d.endMidi ?? 72, startMidi + 4, 96);
  const preferFlats = Boolean(d.preferFlats);
  const rootSet = new Set(d.rootMidis || []);
  const targetSet = new Set(d.targetMidis || []);
  const secondarySet = new Set(d.secondaryMidis || []);
  const excludedSet = new Set(d.excludedMidis || []);
  const keyLabels = d.keyLabels || {};
  const clusters = Array.isArray(d.clusters) ? d.clusters : [];
  const arrows = Array.isArray(d.arrows) ? d.arrows : [];

  const whites = [];
  const blacks = [];
  let wIdx = 0;

  for (let m = startMidi; m <= endMidi; m++) {
    const pc = ((m % 12) + 12) % 12;
    const isBlack = pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
    const defName = keyLabels[m] || midiToNoteName(m, preferFlats);
    const shortName = defName.replace(/[0-9]/g, '');
    if (!isBlack) {
      whites.push({ midi: m, wIdx, label: keyLabels[m] ? String(keyLabels[m]) : shortName, full: defName });
      wIdx += 1;
    } else {
      blacks.push({ midi: m, anchor: wIdx, label: keyLabels[m] ? String(keyLabels[m]) : shortName, full: defName });
    }
  }

  const wCount = Math.max(1, whites.length);
  const padX = 18;
  const W_KEY = wCount > 13 ? 34 : 44;
  const B_W = Math.round(W_KEY * 0.62);
  const KB_W = wCount * W_KEY;
  const svgW = Math.max(480, KB_W + padX * 2);
  const leftOffset = (svgW - KB_W) / 2;

  const maxLane = arrows.reduce((mx, a) => Math.max(mx, safeNum(a.lane, 0)), -1);
  const topY = arrows.length > 0 ? 22 + (maxLane + 1) * 28 : 18;
  const KB_H = 126;
  const B_H = Math.round(KB_H * 0.60);
  const botPad = clusters.length > 0 ? 44 : 18;
  const svgH = topY + KB_H + botPad;

  const keyCenterX = new Map();
  whites.forEach((w) => {
    keyCenterX.set(w.midi, leftOffset + w.wIdx * W_KEY + (W_KEY - 2) / 2);
  });
  blacks.forEach((b) => {
    keyCenterX.set(b.midi, leftOffset + b.anchor * W_KEY - 1);
  });

  // White keys SVG (drawn first)
  const whiteKeysSvg = whites
    .map((w) => {
      const x = leftOffset + w.wIdx * W_KEY;
      const isRoot = rootSet.has(w.midi);
      const isTarget = targetSet.has(w.midi);
      const isSec = secondarySet.has(w.midi);
      const isEx = excludedSet.has(w.midi);
      const cls = [
        'td-pk td-pk-w',
        isRoot ? 'is-root' : '',
        isTarget ? 'is-target' : '',
        isSec ? 'is-secondary' : '',
        isEx ? 'is-excluded' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const cx = x + (W_KEY - 2) / 2;
      const showOct = w.midi % 12 === 0 || w.midi === startMidi;
      const lbl = showOct && !keyLabels[w.midi] ? w.full : w.label;
      return `
        <g class="${cls}" data-svg-midi="${w.midi}" data-diagram-uid="${uid}" tabindex="0" role="button" aria-label="Phím ${escapeHtml(w.full)}">
          <rect x="${x.toFixed(1)}" y="${topY}" width="${(W_KEY - 2).toFixed(1)}" height="${KB_H}" rx="4" class="td-pk-rect"/>
          <text x="${cx.toFixed(1)}" y="${topY + KB_H - 11}" text-anchor="middle" class="td-pk-txt">${escapeHtml(lbl)}</text>
          ${isEx ? `<text x="${cx.toFixed(1)}" y="${topY + KB_H - 27}" text-anchor="middle" class="td-pk-ex">×</text>` : ''}
        </g>
      `;
    })
    .join('');

  // Black keys SVG (drawn on top so pointer events never bleed underneath)
  const blackKeysSvg = blacks
    .map((b) => {
      const bx = leftOffset + b.anchor * W_KEY - B_W / 2 - 1;
      const isRoot = rootSet.has(b.midi);
      const isTarget = targetSet.has(b.midi);
      const isSec = secondarySet.has(b.midi);
      const isEx = excludedSet.has(b.midi);
      const cls = [
        'td-pk td-pk-b',
        isRoot ? 'is-root' : '',
        isTarget ? 'is-target' : '',
        isSec ? 'is-secondary' : '',
        isEx ? 'is-excluded' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const cx = bx + B_W / 2;
      const lines = String(b.label).split('/');
      const textSvg =
        lines.length > 1
          ? `<text x="${cx.toFixed(1)}" y="${topY + B_H - 20}" text-anchor="middle" class="td-pk-b-txt">${escapeHtml(lines[0])}</text>
             <text x="${cx.toFixed(1)}" y="${topY + B_H - 9}" text-anchor="middle" class="td-pk-b-txt">${escapeHtml(lines[1])}</text>`
          : `<text x="${cx.toFixed(1)}" y="${topY + B_H - 11}" text-anchor="middle" class="td-pk-b-txt">${escapeHtml(b.label)}</text>`;
      return `
        <g class="${cls}" data-svg-midi="${b.midi}" data-diagram-uid="${uid}" tabindex="0" role="button" aria-label="Phím ${escapeHtml(b.full)}">
          <rect x="${bx.toFixed(1)}" y="${topY}" width="${B_W}" height="${B_H}" rx="3.5" class="td-pk-rect"/>
          ${textSvg}
          ${isEx ? `<text x="${cx.toFixed(1)}" y="${topY + 15}" text-anchor="middle" class="td-pk-ex">×</text>` : ''}
        </g>
      `;
    })
    .join('');

  // Clusters brackets below keys
  const clustersSvg = clusters
    .map((cl) => {
      const x1 = safeNum(keyCenterX.get(cl.startMidi), leftOffset) - W_KEY * 0.38;
      const x2 = safeNum(keyCenterX.get(cl.endMidi), leftOffset + KB_W) + W_KEY * 0.38;
      const col = COLOR_MAP[cl.accent || 'amber'] || COLOR_MAP.amber;
      const yB = topY + KB_H + 8;
      const midX = (x1 + x2) / 2;
      const pillW = Math.max(88, Math.min(x2 - x1 + 24, String(cl.label || '').length * 6.8 + 20));
      return `
        <g class="td-cluster-mark">
          <path d="M ${x1.toFixed(1)} ${yB - 2} L ${x1.toFixed(1)} ${yB + 5} L ${x2.toFixed(1)} ${yB + 5} L ${x2.toFixed(1)} ${yB - 2}" fill="none" stroke="${col.stroke}" stroke-width="1.6"/>
          <rect x="${(midX - pillW / 2).toFixed(1)}" y="${yB + 10}" width="${pillW.toFixed(1)}" height="20" rx="10" fill="${col.bg}" stroke="${col.stroke}" stroke-width="1"/>
          <text x="${midX.toFixed(1)}" y="${yB + 23.5}" text-anchor="middle" fill="${col.text}" font-size="10.5" font-weight="700" font-family="var(--font-sans, sans-serif)">${escapeHtml(cl.label)}</text>
        </g>
      `;
    })
    .join('');

  // Curved arrows above keyboard
  const arrowsSvg = arrows
    .map((ar, idx) => {
      const x1 = keyCenterX.get(ar.fromMidi);
      const x2 = keyCenterX.get(ar.toMidi);
      if (!Number.isFinite(x1) || !Number.isFinite(x2)) return '';
      const lane = safeNum(ar.lane, 0);
      const col = COLOR_MAP[ar.color || 'emerald'] || COLOR_MAP.emerald;
      const markerId = `${uid}-arr-${idx}`;
      const yAnchor = topY - 4;
      const peakOffset = 18 + lane * 26;
      const arcRise = peakOffset * 2;
      const ctrlY = yAnchor - arcRise;
      const midX = (x1 + x2) / 2;
      const peakY = yAnchor - peakOffset;
      const lbl = String(ar.label || '');
      const pillW = Math.max(36, lbl.length * 6.5 + 14);
      return `
        <defs>
          <marker id="${markerId}" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
            <path d="M0,0.8 L6,3.5 L0,6.2 Z" fill="${col.stroke}"/>
          </marker>
        </defs>
        <g class="td-interval-arrow">
          <path d="M ${x1.toFixed(1)} ${yAnchor.toFixed(1)} Q ${midX.toFixed(1)} ${ctrlY.toFixed(1)} ${x2.toFixed(1)} ${(yAnchor - 2).toFixed(1)}"
            fill="none" stroke="${col.stroke}" stroke-width="1.8" marker-end="url(#${markerId})" stroke-linecap="round"/>
          <rect x="${(midX - pillW / 2).toFixed(1)}" y="${(peakY - 12).toFixed(1)}" width="${pillW.toFixed(1)}" height="18" rx="9" fill="#0F111A" stroke="${col.stroke}" stroke-width="1.1"/>
          <text x="${midX.toFixed(1)}" y="${(peakY + 0.5).toFixed(1)}" text-anchor="middle" fill="${col.text}" font-size="10" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(lbl)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg class="td-svg td-svg-piano" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
      <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
      ${arrowsSvg}
      ${whiteKeysSvg}
      ${blackKeysSvg}
      ${clustersSvg}
    </svg>
  `;
}

// ============================================================================
// 2. RHYTHM-GRID RENDERER
// ============================================================================
function renderRhythmGridSvg(d, uid) {
  const totalSteps = clampVal(d.totalSteps || 16, 4, 32);
  const stepsPerBeat = clampVal(d.stepsPerBeat || 4, 1, 8);
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const labelColW = 128;
  const rightPad = 16;
  const gridW = 604;
  const svgW = labelColW + gridW + rightPad;
  const headerH = 38;
  const rowH = d.compareMode ? 52 : 44;
  const rowGap = d.compareMode ? 12 : 8;
  const svgH = headerH + rows.length * rowH + Math.max(0, rows.length - 1) * rowGap + 18;
  const stepW = gridW / totalSteps;
  const beatHeaders = Array.isArray(d.beatHeaders) ? d.beatHeaders : null;

  // Background beat columns & step lines
  let colsSvg = '';
  for (let s = 0; s < totalSteps; s++) {
    const x = labelColW + s * stepW;
    const isBeatStart = s % stepsPerBeat === 0;
    const beatGroup = Math.floor(s / stepsPerBeat);
    if (beatGroup % 2 === 1 && isBeatStart) {
      colsSvg += `<rect x="${x.toFixed(1)}" y="${headerH - 4}" width="${(stepW * stepsPerBeat).toFixed(1)}" height="${svgH - headerH - 8}" fill="rgba(255,255,255,0.025)"/>`;
    }
    colsSvg += `<line x1="${x.toFixed(1)}" y1="${headerH - 4}" x2="${x.toFixed(1)}" y2="${svgH - 12}" stroke="${isBeatStart ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)'}" stroke-width="${isBeatStart ? '1.3' : '0.8'}"/>`;
  }
  colsSvg += `<line x1="${(labelColW + gridW).toFixed(1)}" y1="${headerH - 4}" x2="${(labelColW + gridW).toFixed(1)}" y2="${svgH - 12}" stroke="rgba(255,255,255,0.22)" stroke-width="1.3"/>`;

  // Beat header labels
  let headersSvg = '';
  const numBeats = Math.ceil(totalSteps / stepsPerBeat);
  for (let b = 0; b < numBeats; b++) {
    const bx = labelColW + b * stepsPerBeat * stepW + (stepsPerBeat * stepW) / 2;
    const label = beatHeaders && beatHeaders[b] ? beatHeaders[b] : `Phách ${b + 1}`;
    const isBackbeat = d.highlightBackbeats && (b === 1 || b === 3);
    headersSvg += `
      <rect x="${(labelColW + b * stepsPerBeat * stepW + 2).toFixed(1)}" y="6" width="${(stepsPerBeat * stepW - 4).toFixed(1)}" height="22" rx="6" fill="${isBackbeat ? 'rgba(245,158,11,0.16)' : 'rgba(255,255,255,0.04)'}" stroke="${isBackbeat ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.09)'}"/>
      <text x="${bx.toFixed(1)}" y="20.5" text-anchor="middle" fill="${isBackbeat ? '#FDE68A' : '#D4D4D8'}" font-size="10.5" font-weight="700" font-family="var(--font-mono, monospace)">${escapeHtml(label)}</text>
    `;
  }

  // Rows and blocks
  const rowsSvg = rows
    .map((row, rIdx) => {
      const ry = headerH + rIdx * (rowH + rowGap);
      const blocksSvg = (row.blocks || [])
        .map((blk, bIdx) => {
          const shift = safeNum(blk.shiftSteps, 0);
          const bx = labelColW + (safeNum(blk.step, 0) + shift) * stepW + 2;
          const bw = Math.max(16, safeNum(blk.span, 1) * stepW - 4);
          const kind = blk.kind || 'note';
          const isRest = kind === 'rest';
          const isDotted = kind === 'dotted';
          const isSync = kind === 'sync' || kind === 'swing' || kind === 'accent';
          const fill = isRest
            ? 'rgba(113,113,122,0.10)'
            : isSync || isDotted
              ? 'rgba(245,158,11,0.22)'
              : 'rgba(16,185,129,0.22)';
          const stroke = isRest
            ? 'rgba(161,161,170,0.42)'
            : isSync || isDotted
              ? '#FBBF24'
              : '#34D399';
          const textColor = isRest ? '#A1A1AA' : isSync || isDotted ? '#FDE68A' : '#A7F3D0';
          const cx = bx + bw / 2;
          const cy = ry + rowH / 2;
          const shiftGuide =
            shift > 0
              ? `<line x1="${(labelColW + safeNum(blk.step, 0) * stepW).toFixed(1)}" y1="${cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${cy.toFixed(1)}" stroke="#FBBF24" stroke-width="1.4" stroke-dasharray="2 2"/>
                 <circle cx="${(labelColW + safeNum(blk.step, 0) * stepW).toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="#FBBF24"/>`
              : '';
          return `
            ${shiftGuide}
            <g class="td-rg-block" data-td-rblock="${uid}-${rIdx}-${bIdx}">
              <rect x="${bx.toFixed(1)}" y="${(ry + 5).toFixed(1)}" width="${bw.toFixed(1)}" height="${rowH - 10}" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="1.4" ${isRest ? 'stroke-dasharray="4 3"' : ''}/>
              <text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" fill="${textColor}" font-size="${bw < 34 ? '8.8' : '10'}" font-weight="700" font-family="var(--font-mono, monospace)">${escapeHtml(blk.label)}</text>
            </g>
          `;
        })
        .join('');

      return `
        <g class="td-rg-row">
          <rect x="8" y="${(ry + 3).toFixed(1)}" width="${labelColW - 14}" height="${rowH - 6}" rx="8" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.09)"/>
          <text x="16" y="${(ry + (row.sublabel ? 19 : rowH / 2 + 4)).toFixed(1)}" fill="#F4F4F5" font-size="11" font-weight="700">${escapeHtml(row.label)}</text>
          ${row.sublabel ? `<text x="16" y="${(ry + 35).toFixed(1)}" fill="#94A3B8" font-size="9.5" font-family="var(--font-mono, monospace)">${escapeHtml(row.sublabel)}</text>` : ''}
          ${blocksSvg}
        </g>
      `;
    })
    .join('');

  return `
    <svg class="td-svg td-svg-rhythm" viewBox="0 0 ${svgW} ${svgH}" data-grid-x="${labelColW}" data-grid-w="${gridW}" data-total-steps="${totalSteps}" role="img" aria-label="${escapeHtml(d.title)}">
      <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
      ${colsSvg}
      ${headersSvg}
      ${rowsSvg}
      <line class="td-rg-playhead" x1="${labelColW}" y1="${headerH - 4}" x2="${labelColW}" y2="${svgH - 12}" stroke="#34D399" stroke-width="2.4" opacity="0"/>
    </svg>
  `;
}

// ============================================================================
// 3. VOICE-LEADING RENDERER
// ============================================================================
function renderVoiceLeadingSvg(d, uid) {
  const leftPanel = d.leftPanel || { title: 'Nhảy cóc thế gốc', chords: [] };
  const rightPanel = d.rightPanel || { title: 'Thế đảo Dẫn bè mượt', chords: [] };
  const minMidi = safeNum(d.minMidi, 48);
  const maxMidi = safeNum(d.maxMidi, 76);
  const svgW = 760;
  const svgH = 258;

  const renderPanel = (panel, panelIdx, px, pw) => {
    const chords = Array.isArray(panel.chords) ? panel.chords : [];
    const topY = 58;
    const botY = 236;
    const colStart = px + 34;
    const colSpan = chords.length > 1 ? (pw - 68) / (chords.length - 1) : 0;
    const yForMidi = (m) => {
      const ratio = (clampVal(m, minMidi, maxMidi) - minMidi) / Math.max(1, maxMidi - minMidi);
      return botY - ratio * (botY - topY);
    };

    // Subtle pitch grid lines
    const gridLines = [minMidi, Math.round((minMidi + maxMidi) / 2), maxMidi]
      .map((gm) => {
        const gy = yForMidi(gm);
        return `
          <line x1="${px + 12}" y1="${gy.toFixed(1)}" x2="${px + pw - 10}" y2="${gy.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
          <text x="${px + 10}" y="${(gy + 3).toFixed(1)}" fill="#64748B" font-size="8.5" font-family="var(--font-mono, monospace)">${escapeHtml(midiToNoteName(gm, Boolean(d.preferFlats)))}</text>
        `;
      })
      .join('');

    // Connecting lines between adjacent chords (pair sorted voices)
    let linesSvg = '';
    for (let c = 0; c < chords.length - 1; c++) {
      const cur = [...(chords[c].midis || [])].sort((a, b) => a - b);
      const nxt = [...(chords[c + 1].midis || [])].sort((a, b) => a - b);
      const x1 = colStart + c * colSpan;
      const x2 = colStart + (c + 1) * colSpan;
      const pairs = Math.min(cur.length, nxt.length);
      for (let v = 0; v < pairs; v++) {
        const diff = Math.abs(nxt[v] - cur[v]);
        const y1 = yForMidi(cur[v]);
        const y2 = yForMidi(nxt[v]);
        let stroke = '#34D399';
        let dash = '';
        let w = 2.4;
        if (diff === 0) {
          stroke = '#34D399';
        } else if (diff <= 2) {
          stroke = '#FBBF24';
          w = 2.1;
        } else {
          stroke = '#FB7185';
          dash = 'stroke-dasharray="4 3"';
          w = 1.6;
        }
        linesSvg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}" ${dash} opacity="0.88"/>`;
      }
    }

    // Chord columns & notes
    const colsSvg = chords
      .map((ch, cIdx) => {
        const cx = colStart + cIdx * colSpan;
        const notes = [...(ch.midis || [])].sort((a, b) => a - b);
        const circlesSvg = notes
          .map((m) => {
            const cy = yForMidi(m);
            const nm = midiToNoteName(m, Boolean(d.preferFlats)).replace(/[0-9]/g, '');
            return `
              <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="10.5" fill="#141824" stroke="${panelIdx === 1 ? '#34D399' : '#FB7185'}" stroke-width="1.6"/>
              <text x="${cx.toFixed(1)}" y="${(cy + 3.2).toFixed(1)}" text-anchor="middle" fill="#FAFAFA" font-size="8.5" font-weight="700" font-family="var(--font-mono, monospace)">${escapeHtml(nm)}</text>
            `;
          })
          .join('');
        return `
          <g class="td-interactive-node td-vl-col" data-td-vl-play="${uid}" data-panel-idx="${panelIdx}" data-chord-idx="${cIdx}" tabindex="0" role="button" aria-label="Nghe hợp âm ${escapeHtml(ch.symbol)}">
            <rect x="${(cx - 26).toFixed(1)}" y="34" width="52" height="206" rx="8" fill="transparent" class="td-vl-col-bg"/>
            <text x="${cx.toFixed(1)}" y="48" text-anchor="middle" fill="#FDE68A" font-size="11.5" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(ch.symbol)}</text>
            ${circlesSvg}
          </g>
        `;
      })
      .join('');

    const isGood = panelIdx === 1;
    return `
      <rect x="${px}" y="8" width="${pw}" height="${svgH - 16}" rx="12" fill="rgba(255,255,255,0.025)" stroke="${isGood ? 'rgba(52,211,153,0.42)' : 'rgba(251,113,133,0.35)'}"/>
      <text x="${px + 14}" y="26" fill="${isGood ? '#6EE7B7' : '#FDA4AF'}" font-size="11.5" font-weight="800">${escapeHtml(panel.title)}</text>
      ${panel.badge ? `<text x="${px + pw - 12}" y="26" text-anchor="end" fill="#94A3B8" font-size="9.5" font-family="var(--font-mono, monospace)">${escapeHtml(panel.badge)}</text>` : ''}
      ${gridLines}
      ${linesSvg}
      ${colsSvg}
    `;
  };

  return `
    <svg class="td-svg td-svg-vl" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
      <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
      ${renderPanel(leftPanel, 0, 10, 362)}
      ${renderPanel(rightPanel, 1, 388, 362)}
    </svg>
  `;
}

// ============================================================================
// 4. HARMONY-FLOW RENDERER
// ============================================================================
function renderHarmonyFlowSvg(d, uid) {
  const layout = d.layout || 'functional';

  if (layout === 'degrees') {
    const nodes = Array.isArray(d.nodes) ? d.nodes : [];
    const svgW = 760;
    const svgH = 198;
    const cardW = 94;
    const gap = 10;
    const totalW = nodes.length * cardW + Math.max(0, nodes.length - 1) * gap;
    const startX = (svgW - totalW) / 2;
    const cardsSvg = nodes
      .map((nd, idx) => {
        const x = startX + idx * (cardW + gap);
        const col =
          nd.quality === 'dim'
            ? COLOR_MAP.rose
            : nd.quality === 'minor'
              ? COLOR_MAP.emerald
              : COLOR_MAP.amber;
        return `
          <g class="td-interactive-node td-hf-node" data-td-node-play="${uid}" data-node-idx="${idx}" tabindex="0" role="button" aria-label="Nghe bậc ${escapeHtml(nd.roman)} ${escapeHtml(nd.chord)}">
            <rect x="${x.toFixed(1)}" y="46" width="${cardW}" height="106" rx="10" fill="${col.bg}" stroke="${col.stroke}" stroke-width="1.5"/>
            <text x="${(x + cardW / 2).toFixed(1)}" y="74" text-anchor="middle" fill="${col.text}" font-size="18" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(nd.roman)}</text>
            <text x="${(x + cardW / 2).toFixed(1)}" y="99" text-anchor="middle" fill="#FFFFFF" font-size="14" font-weight="800">${escapeHtml(nd.chord)}</text>
            <text x="${(x + cardW / 2).toFixed(1)}" y="119" text-anchor="middle" fill="#CBD5E1" font-size="9.5">${escapeHtml(nd.role || '')}</text>
            ${nd.altChord ? `<text x="${(x + cardW / 2).toFixed(1)}" y="137" text-anchor="middle" fill="#94A3B8" font-size="9" font-family="var(--font-mono, monospace)">${escapeHtml(nd.altChord)}</text>` : ''}
          </g>
        `;
      })
      .join('');

    return `
      <svg class="td-svg td-svg-hf" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
        <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
        <text x="20" y="26" fill="#E4E4E7" font-size="11.5" font-weight="700">${escapeHtml(d.scaleHeading || '7 Bậc Diatonic')}</text>
        <path d="M ${(startX + cardW * 0.5).toFixed(1)} 158 Q ${(svgW / 2).toFixed(1)} 188 ${(startX + cardW * 4.5 + gap * 4).toFixed(1)} 158" fill="none" stroke="rgba(251,191,36,0.55)" stroke-width="1.5" stroke-dasharray="4 3"/>
        <text x="${(svgW / 2).toFixed(1)}" y="186" text-anchor="middle" fill="#FDE68A" font-size="9.5" font-weight="700">${escapeHtml(d.footLabel || 'Lực hút Chủ âm (I) ↔ Hạ át (IV) ↔ Át (V / V7)')}</text>
        ${cardsSvg}
      </svg>
    `;
  }

  if (layout === 'progressions') {
    const tracks = Array.isArray(d.tracks) ? d.tracks : [];
    const svgW = 760;
    const rowH = 58;
    const svgH = 20 + tracks.length * (rowH + 8);
    let nodeSeq = 0;

    const rowsSvg = tracks
      .map((tr, rIdx) => {
        const y = 12 + rIdx * (rowH + 8);
        const chords = Array.isArray(tr.chords) ? tr.chords : [];
        const labelW = 196;
        const slotW = (svgW - labelW - 28) / Math.max(1, chords.length);
        const chordsSvg = chords
          .map((ch, cIdx) => {
            const idx = nodeSeq++;
            const cx = labelW + cIdx * slotW;
            const col = COLOR_MAP[ch.color || (cIdx === 0 ? 'emerald' : cIdx === chords.length - 1 ? 'amber' : 'cyan')] || COLOR_MAP.cyan;
            const arrow =
              cIdx < chords.length - 1
                ? `<path d="M ${(cx + slotW - 14).toFixed(1)} ${(y + 29).toFixed(1)} L ${(cx + slotW - 3).toFixed(1)} ${(y + 29).toFixed(1)}" stroke="rgba(255,255,255,0.35)" stroke-width="1.5"/>`
                : '';
            return `
              <g class="td-interactive-node td-hf-node" data-td-node-play="${uid}" data-node-idx="${idx}" tabindex="0" role="button" aria-label="Nghe ${escapeHtml(ch.chord)}">
                <rect x="${cx.toFixed(1)}" y="${y + 7}" width="${(slotW - 16).toFixed(1)}" height="${rowH - 14}" rx="8" fill="${col.bg}" stroke="${col.stroke}" stroke-width="1.3"/>
                <text x="${(cx + (slotW - 16) / 2).toFixed(1)}" y="${y + 24}" text-anchor="middle" fill="${col.text}" font-size="10" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(ch.roman)}</text>
                <text x="${(cx + (slotW - 16) / 2).toFixed(1)}" y="${y + 41}" text-anchor="middle" fill="#FFFFFF" font-size="12" font-weight="800">${escapeHtml(ch.chord)}</text>
              </g>
              ${arrow}
            `;
          })
          .join('');
        return `
          <rect x="10" y="${y}" width="${svgW - 20}" height="${rowH}" rx="10" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)"/>
          <text x="22" y="${y + 24}" fill="#FAFAFA" font-size="11.5" font-weight="800">${escapeHtml(tr.name)}</text>
          <text x="22" y="${y + 41}" fill="#94A3B8" font-size="9.5">${escapeHtml(tr.mood || '')}</text>
          ${chordsSvg}
        `;
      })
      .join('');

    return `
      <svg class="td-svg td-svg-hf" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
        <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
        ${rowsSvg}
      </svg>
    `;
  }

  // Default: layout === 'functional'
  const stages = Array.isArray(d.stages) ? d.stages : [];
  const branches = Array.isArray(d.branches) ? d.branches : [];
  const svgW = 760;
  const svgH = branches.length > 0 ? 256 : 196;
  const boxW = 204;
  const boxH = 88;
  const gap = 42;
  const startX = (svgW - (stages.length * boxW + Math.max(0, stages.length - 1) * gap)) / 2;

  const stageBoxes = stages
    .map((st, idx) => {
      const x = startX + idx * (boxW + gap);
      const col = COLOR_MAP[st.color || (idx === 0 ? 'emerald' : idx === 1 ? 'cyan' : 'amber')] || COLOR_MAP.amber;
      const arrow =
        idx < stages.length - 1
          ? `<path d="M ${(x + boxW + 4).toFixed(1)} 72 L ${(x + boxW + gap - 6).toFixed(1)} 72" stroke="#94A3B8" stroke-width="2" marker-end="url(#${uid}-hf-arr)"/>`
          : '';
      return `
        ${arrow}
        <g class="td-interactive-node td-hf-node" data-td-node-play="${uid}" data-node-idx="${idx}" tabindex="0" role="button" aria-label="Nghe ${escapeHtml(st.chordsLabel)}">
          <rect x="${x.toFixed(1)}" y="26" width="${boxW}" height="${boxH}" rx="12" fill="${col.bg}" stroke="${col.stroke}" stroke-width="1.6"/>
          <text x="${(x + boxW / 2).toFixed(1)}" y="47" text-anchor="middle" fill="${col.text}" font-size="10.5" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(st.kicker)}</text>
          <text x="${(x + boxW / 2).toFixed(1)}" y="71" text-anchor="middle" fill="#FFFFFF" font-size="15.5" font-weight="800">${escapeHtml(st.chordsLabel)}</text>
          <text x="${(x + boxW / 2).toFixed(1)}" y="91" text-anchor="middle" fill="#D4D4D8" font-size="10.5">${escapeHtml(st.desc)}</text>
          <text x="${(x + boxW / 2).toFixed(1)}" y="106" text-anchor="middle" fill="${col.text}" font-size="9.5" font-weight="700">${escapeHtml(st.tensionLabel || '')}</text>
        </g>
      `;
    })
    .join('');

  const returnArc =
    stages.length >= 3
      ? `<path d="M ${(startX + 2.5 * boxW + 2 * gap).toFixed(1)} 118 Q ${(svgW / 2).toFixed(1)} 164 ${(startX + 0.5 * boxW).toFixed(1)} 120" fill="none" stroke="#FBBF24" stroke-width="2" marker-end="url(#${uid}-hf-amber)"/>
         <rect x="${(svgW / 2 - 115).toFixed(1)}" y="135" width="230" height="20" rx="10" fill="#0F111A" stroke="#FBBF24" stroke-width="1"/>
         <text x="${(svgW / 2).toFixed(1)}" y="148.5" text-anchor="middle" fill="#FDE68A" font-size="10" font-weight="700">${escapeHtml(d.returnLabel || 'Giải tỏa mạnh về Chủ âm I (Về nhà)')}</text>`
      : '';

  const branchW = branches.length > 0 ? Math.min(340, (svgW - 44 - (branches.length - 1) * 16) / branches.length) : 0;
  const branchStartX = (svgW - (branches.length * branchW + Math.max(0, branches.length - 1) * 16)) / 2;
  const branchesSvg = branches
    .map((br, bIdx) => {
      const idx = stages.length + bIdx;
      const bx = branchStartX + bIdx * (branchW + 16);
      const col = COLOR_MAP[br.color || 'rose'] || COLOR_MAP.rose;
      return `
        <g class="td-interactive-node td-hf-node" data-td-node-play="${uid}" data-node-idx="${idx}" tabindex="0" role="button" aria-label="Nghe ${escapeHtml(br.formula)}">
          <rect x="${bx.toFixed(1)}" y="174" width="${branchW.toFixed(1)}" height="66" rx="10" fill="${col.bg}" stroke="${col.stroke}" stroke-width="1.4" stroke-dasharray="4 3"/>
          <text x="${(bx + 14).toFixed(1)}" y="195" fill="${col.text}" font-size="10.5" font-weight="800">${escapeHtml(br.title)}</text>
          <text x="${(bx + 14).toFixed(1)}" y="214" fill="#FFFFFF" font-size="13" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(br.formula)}</text>
          <text x="${(bx + 14).toFixed(1)}" y="231" fill="#CBD5E1" font-size="10">${escapeHtml(br.effect)}</text>
        </g>
      `;
    })
    .join('');

  return `
    <svg class="td-svg td-svg-hf" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
      <defs>
        <marker id="${uid}-hf-arr" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
          <path d="M0,0.8 L6,3.5 L0,6.2 Z" fill="#94A3B8"/>
        </marker>
        <marker id="${uid}-hf-amber" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
          <path d="M0,0.8 L6,3.5 L0,6.2 Z" fill="#FBBF24"/>
        </marker>
      </defs>
      <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
      ${stageBoxes}
      ${returnArc}
      ${branchesSvg}
    </svg>
  `;
}

// ============================================================================
// 5. TONE-CONTOUR RENDERER (Dấu thanh Tiếng Việt & Prosody)
// ============================================================================
function renderToneContourSvg(d, uid) {
  const panels = Array.isArray(d.panels) ? d.panels.slice(0, 2) : [];
  const svgW = 760;
  const svgH = 262;
  const minMidi = safeNum(d.minMidi, 58);
  const maxMidi = safeNum(d.maxMidi, 74);

  const renderPanel = (panel, pIdx, px, pw) => {
    const syllables = Array.isArray(panel.syllables) ? panel.syllables : [];
    const isBad = panel.status === 'bad';
    const topY = 50;
    const botY = 186;
    const padInner = 24;
    const spanX = syllables.length > 1 ? (pw - padInner * 2 - 48) / (syllables.length - 1) : 0;
    const yForMidi = (m) => {
      const r = (clampVal(m, minMidi, maxMidi) - minMidi) / Math.max(1, maxMidi - minMidi);
      return botY - r * (botY - topY);
    };

    // Pitch reference rows
    const refLines = [minMidi, Math.round((minMidi + maxMidi) / 2), maxMidi]
      .map((m) => {
        const y = yForMidi(m);
        return `
          <line x1="${px + 12}" y1="${y.toFixed(1)}" x2="${px + pw - 12}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
          <text x="${px + 10}" y="${(y + 3).toFixed(1)}" fill="#64748B" font-size="8" font-family="var(--font-mono, monospace)">${escapeHtml(midiToNoteName(m, false))}</text>
        `;
      })
      .join('');

    // Contour line points
    const pts = syllables.map((s, i) => ({
      x: px + padInner + 24 + i * spanX,
      y: yForMidi(s.midi),
    }));
    const polyPath =
      pts.length > 1
        ? `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`
        : '';

    const notesSvg = syllables
      .map((s, i) => {
        const cx = pts[i].x;
        const cy = pts[i].y;
        const barW = Math.min(46, Math.max(30, spanX * 0.68 || 38));
        const warn = Boolean(s.warn);
        const barFill = warn ? 'rgba(251,113,133,0.34)' : isBad ? 'rgba(56,189,248,0.22)' : 'rgba(16,185,129,0.28)';
        const barStroke = warn ? '#FB7185' : isBad ? '#7DD3FC' : '#34D399';
        const luyếnCurve = Number.isFinite(s.slideToMidi)
          ? `<path d="M ${(cx + 6).toFixed(1)} ${cy.toFixed(1)} Q ${(cx + 18).toFixed(1)} ${((cy + yForMidi(s.slideToMidi)) / 2).toFixed(1)} ${(cx + 22).toFixed(1)} ${yForMidi(s.slideToMidi).toFixed(1)}" fill="none" stroke="#FBBF24" stroke-width="2" stroke-dasharray="2 2"/>
             <circle cx="${(cx + 22).toFixed(1)}" cy="${yForMidi(s.slideToMidi).toFixed(1)}" r="3.5" fill="#FBBF24"/>`
          : '';
        return `
          <g class="td-tc-syllable" data-td-syll="${uid}-${pIdx}-${i}">
            <rect x="${(cx - barW / 2).toFixed(1)}" y="${(cy - 9).toFixed(1)}" width="${barW.toFixed(1)}" height="18" rx="6" fill="${barFill}" stroke="${barStroke}" stroke-width="1.6"/>
            <text x="${cx.toFixed(1)}" y="${(cy + 3.5).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="800" font-family="var(--font-mono, monospace)">${escapeHtml(midiToNoteName(s.midi, false))}</text>
            ${luyếnCurve}
            <text x="${cx.toFixed(1)}" y="216" text-anchor="middle" fill="${warn ? '#FDA4AF' : '#FAFAFA'}" font-size="11.5" font-weight="800">${escapeHtml(s.text)}</text>
            <text x="${cx.toFixed(1)}" y="232" text-anchor="middle" fill="${warn ? '#FB7185' : '#94A3B8'}" font-size="9" font-family="var(--font-mono, monospace)">${escapeHtml(s.toneLabel || '')}</text>
          </g>
        `;
      })
      .join('');

    const warnBanner =
      panel.warnText
        ? `<rect x="${px + 14}" y="238" width="${pw - 28}" height="16" rx="5" fill="rgba(251,113,133,0.16)"/>
           <text x="${px + pw / 2}" y="249" text-anchor="middle" fill="#FDA4AF" font-size="9.5" font-weight="700">${escapeHtml(panel.warnText)}</text>`
        : `<text x="${px + pw / 2}" y="249" text-anchor="middle" fill="#6EE7B7" font-size="9.5" font-weight="700">${escapeHtml(panel.goodText || 'Đường nét nương theo dấu tự nhiên · tròn chữ')}</text>`;

    return `
      <g class="td-interactive-node td-tc-panel" data-td-panel-play="${uid}" data-panel-idx="${pIdx}" tabindex="0" role="button" aria-label="Nghe khung ${escapeHtml(panel.title)}">
        <rect x="${px}" y="8" width="${pw}" height="${svgH - 14}" rx="12" fill="rgba(255,255,255,0.025)" stroke="${isBad ? 'rgba(251,113,133,0.45)' : 'rgba(52,211,153,0.45)'}"/>
        <text x="${px + 14}" y="26" fill="${isBad ? '#FDA4AF' : '#6EE7B7'}" font-size="11.5" font-weight="800">${escapeHtml(panel.title)}</text>
        <text x="${px + pw - 12}" y="26" text-anchor="end" fill="#94A3B8" font-size="9.5" font-family="var(--font-mono, monospace)">▶ Bấm nghe</text>
        ${refLines}
        ${polyPath ? `<path d="${polyPath}" fill="none" stroke="${isBad ? 'rgba(251,113,133,0.55)' : 'rgba(52,211,153,0.65)'}" stroke-width="2" stroke-linecap="round"/>` : ''}
        ${notesSvg}
        ${warnBanner}
      </g>
    `;
  };

  return `
    <svg class="td-svg td-svg-tc" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
      <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
      ${panels[0] ? renderPanel(panels[0], 0, 10, 362) : ''}
      ${panels[1] ? renderPanel(panels[1], 1, 388, 362) : ''}
    </svg>
  `;
}

// ============================================================================
// 6. SONG-STRUCTURE RENDERER
// ============================================================================
function renderSongStructureSvg(d, uid) {
  const sections = Array.isArray(d.sections) ? d.sections : [];
  const layerNames = ['Piano / Pad', 'Bass', 'Drums', 'Guitar / Strings', 'Vocal Layers'];
  const layerKeys = ['piano', 'bass', 'drums', 'strings', 'vocal'];
  const svgW = 760;
  const svgH = 286;
  const trackLabelW = 104;
  const chartX = trackLabelW;
  const chartW = svgW - chartX - 14;
  const secW = sections.length > 0 ? chartW / sections.length : chartW;

  const curveTop = 58;
  const curveBot = 136;
  const yForEnergy = (pct) => curveBot - (clampVal(pct, 0, 100) / 100) * (curveBot - curveTop);

  // Build smooth SVG energy curve path
  const pts = sections.map((s, idx) => ({
    x: chartX + idx * secW + secW / 2,
    y: yForEnergy(s.energyPct),
    pct: clampVal(s.energyPct, 0, 100),
  }));

  let curvePath = '';
  let fillPath = '';
  if (pts.length >= 2) {
    curvePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      curvePath += ` C ${mx.toFixed(1)} ${pts[i].y.toFixed(1)}, ${mx.toFixed(1)} ${pts[i + 1].y.toFixed(1)}, ${pts[i + 1].x.toFixed(1)} ${pts[i + 1].y.toFixed(1)}`;
    }
    fillPath = `${curvePath} L ${pts[pts.length - 1].x.toFixed(1)} ${curveBot} L ${pts[0].x.toFixed(1)} ${curveBot} Z`;
  }

  // Layer track headers on left
  const trackHeadersSvg = layerKeys
    .map((key, lIdx) => {
      const ly = 152 + lIdx * 24;
      return `
        <rect x="10" y="${ly}" width="${trackLabelW - 16}" height="20" rx="5" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)"/>
        <text x="16" y="${ly + 13.5}" fill="#CBD5E1" font-size="9.5" font-weight="700">${escapeHtml(layerNames[lIdx])}</text>
      `;
    })
    .join('');

  // Columns per song section
  const sectionsSvg = sections
    .map((sec, sIdx) => {
      const sx = chartX + sIdx * secW;
      const cx = sx + secW / 2;
      const ePct = clampVal(sec.energyPct, 0, 100);
      const col = ePct >= 80 ? COLOR_MAP.rose : ePct >= 55 ? COLOR_MAP.amber : COLOR_MAP.emerald;
      const lyrs = sec.layers || {};

      const barsSvg = layerKeys
        .map((key, lIdx) => {
          const level = safeNum(lyrs[key], 0);
          const ly = 152 + lIdx * 24;
          if (level <= 0) {
            return `<rect x="${(sx + 3).toFixed(1)}" y="${ly + 2}" width="${(secW - 6).toFixed(1)}" height="16" rx="4" fill="rgba(255,255,255,0.015)" stroke="rgba(255,255,255,0.04)" stroke-dasharray="2 2"/>`;
          }
          const fill = level >= 2 ? col.bg : 'rgba(56,189,248,0.14)';
          const stroke = level >= 2 ? col.stroke : '#38BDF8';
          const lbl = level >= 2 ? 'Dày' : 'Mỏng';
          return `
            <rect x="${(sx + 3).toFixed(1)}" y="${ly + 2}" width="${(secW - 6).toFixed(1)}" height="16" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
            <text x="${cx.toFixed(1)}" y="${ly + 13}" text-anchor="middle" fill="#E4E4E7" font-size="8.2" font-family="var(--font-mono, monospace)">${lbl}</text>
          `;
        })
        .join('');

      return `
        <g class="td-interactive-node td-ss-col" data-td-sec-play="${uid}" data-sec-idx="${sIdx}" tabindex="0" role="button" aria-label="Nghe đoạn ${escapeHtml(sec.name)}">
          <rect x="${(sx + 1).toFixed(1)}" y="10" width="${(secW - 2).toFixed(1)}" height="${svgH - 18}" rx="8" fill="rgba(255,255,255,0.018)" stroke="rgba(255,255,255,0.07)" class="td-ss-col-bg"/>
          <text x="${cx.toFixed(1)}" y="24" text-anchor="middle" fill="${col.text}" font-size="9.5" font-weight="800">${escapeHtml(sec.name)}</text>
          <text x="${cx.toFixed(1)}" y="35" text-anchor="middle" fill="#94A3B8" font-size="8" font-family="var(--font-mono, monospace)">${escapeHtml(sec.bars || '')}</text>
          ${barsSvg}
        </g>
      `;
    })
    .join('');

  const dotsSvg = pts
    .map((p, i) => {
      const col = p.pct >= 80 ? '#FB7185' : p.pct >= 55 ? '#FBBF24' : '#34D399';
      return `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2" fill="#0C0E17" stroke="${col}" stroke-width="2.2"/>
        <text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" fill="#E4E4E7" font-size="8.5" font-weight="700" font-family="var(--font-mono, monospace)">${p.pct}%</text>
      `;
    })
    .join('');

  return `
    <svg class="td-svg td-svg-ss" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="${escapeHtml(d.title)}">
      <defs>
        <linearGradient id="${uid}-energy-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="#10B981" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${svgW}" height="${svgH}" rx="10" fill="#0C0E17"/>
      <text x="14" y="25" fill="#94A3B8" font-size="9.5" font-weight="700" font-family="var(--font-mono, monospace)">NĂNG LƯỢNG</text>
      ${trackHeadersSvg}
      ${sectionsSvg}
      ${fillPath ? `<path d="${fillPath}" fill="url(#${uid}-energy-grad)" pointer-events="none"/>` : ''}
      ${curvePath ? `<path d="${curvePath}" fill="none" stroke="#FBBF24" stroke-width="2.2" pointer-events="none"/>` : ''}
      ${dotsSvg}
    </svg>
  `;
}

// ============================================================================
// PUBLIC HTML BUILDER
// ============================================================================
export function renderTheoryDiagramHtml(diagram, diagramUid = 'td-default') {
  if (!diagram || typeof diagram !== 'object') return '';
  const type = diagram.type || 'piano-strip';
  const meta = TYPE_META[type] || TYPE_META['piano-strip'];
  const legend = defaultLegendForDiagram(diagram);

  let svgHtml = '';
  if (type === 'piano-strip') svgHtml = renderPianoStripSvg(diagram, diagramUid);
  else if (type === 'rhythm-grid') svgHtml = renderRhythmGridSvg(diagram, diagramUid);
  else if (type === 'voice-leading') svgHtml = renderVoiceLeadingSvg(diagram, diagramUid);
  else if (type === 'harmony-flow') svgHtml = renderHarmonyFlowSvg(diagram, diagramUid);
  else if (type === 'tone-contour') svgHtml = renderToneContourSvg(diagram, diagramUid);
  else if (type === 'song-structure') svgHtml = renderSongStructureSvg(diagram, diagramUid);
  else return '';

  const legendHtml = legend.length
    ? `<div class="td-legend">${legend
        .map((item) => `<span class="td-legend-item"><i class="td-dot td-dot-${escapeHtml(item.color || 'emerald')}"></i>${escapeHtml(item.label)}</span>`)
        .join('')}</div>`
    : '';

  const extraButtonsHtml =
    type === 'tone-contour' && Array.isArray(diagram.panels)
      ? diagram.panels
          .slice(0, 2)
          .map(
            (p, idx) =>
              `<button type="button" class="btn btn-ghost btn-xs td-panel-btn" data-td-panel-play="${diagramUid}" data-panel-idx="${idx}">▶ Câu ${idx + 1}</button>`
          )
          .join('')
      : '';

  return `
    <figure class="theory-diagram-card td-type-${escapeHtml(type)}" data-diagram-uid="${escapeHtml(diagramUid)}">
      <div class="td-card-head">
        <div class="td-head-info">
          <span class="td-type-tag mono-val">${escapeHtml(meta.badge)}</span>
          <strong class="td-title">${escapeHtml(diagram.title || '')}</strong>
          ${diagram.caption ? `<p class="td-caption">${escapeHtml(diagram.caption)}</p>` : ''}
        </div>
        <div class="td-head-actions">
          ${extraButtonsHtml}
          <button type="button" class="btn btn-emerald-solid btn-xs td-play-btn" data-td-play="${escapeHtml(diagramUid)}">▶ Nghe minh họa</button>
        </div>
      </div>
      ${legendHtml}
      <div class="td-svg-scroll">${svgHtml}</div>
      <figcaption class="td-status-bar mono-val" data-td-status="${escapeHtml(diagramUid)}">${escapeHtml(meta.hint)}</figcaption>
    </figure>
  `;
}

// ============================================================================
// INTERACTIVE PLAYBACK & SVG KEY CLICK HANDLERS
// ============================================================================
function buildSectionDiagramIndex(lesson) {
  const map = new Map();
  if (!lesson || !Array.isArray(lesson.sections)) return map;
  lesson.sections.forEach((sec, idx) => {
    if (sec && sec.diagram) {
      const uid = `td-${String(lesson.id).replace('.', '-')}-${idx}`;
      map.set(uid, sec.diagram);
    }
  });
  return map;
}

function playPianoStripDiagram(d, cardEl, statusEl, audioEngine, registerTimer) {
  const events = Array.isArray(d.playback) && d.playback.length > 0
    ? d.playback
    : [...(d.rootMidis || []), ...(d.targetMidis || [])].map((m) => ({
        midis: [m],
        label: midiToNoteName(m, Boolean(d.preferFlats)),
        durationSec: 0.45,
      }));

  let cursorMs = 0;
  events.forEach((ev) => {
    const durMs = Math.max(220, Math.round(safeNum(ev.durationSec, 0.55) * 1000));
    const at = cursorMs;
    cursorMs += durMs + safeNum(ev.gapMs, 80);

    registerTimer(
      setTimeout(() => {
        if (!cardEl.isConnected) return;
        cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
        const litMidis = ev.highlightMidis || ev.midis || [];
        litMidis.forEach((m) => {
          cardEl.querySelector(`[data-svg-midi="${m}"]`)?.classList.add('is-td-active');
        });
        if (statusEl) statusEl.textContent = `Đang phát: ${ev.label || ''}`;
        if ((ev.midis || []).length > 1) {
          audioEngine.playTrainerChordPreview(ev.midis, Math.max(0.26, (ev.durationSec || 0.55) * 0.9), 0.78, 'rhodes').catch(() => {});
        } else if ((ev.midis || []).length === 1) {
          audioEngine.playTrainerPiano(ev.midis[0], Math.max(0.24, (ev.durationSec || 0.45) * 0.9), 0.82).catch(() => {});
        }
      }, at)
    );
  });

  registerTimer(
    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
      if (statusEl) statusEl.textContent = 'Phát xong — bấm trực tiếp phím đàn trên hình hoặc nghe lại.';
    }, cursorMs + 160)
  );
}

function playRhythmGridDiagram(d, uid, cardEl, statusEl, audioEngine, registerTimer) {
  const rows = Array.isArray(d.rows) ? d.rows : [];
  const bpm = clampVal(d.bpm || 86, 55, 190);
  const stepsPerBeat = clampVal(d.stepsPerBeat || 4, 1, 8);
  const stepMs = 60000 / (bpm * stepsPerBeat);
  const svgEl = cardEl.querySelector('svg');
  const playhead = svgEl?.querySelector('.td-rg-playhead');
  const gridX = safeNum(svgEl?.dataset.gridX, 128);
  const gridW = safeNum(svgEl?.dataset.gridW, 604);
  const totalSteps = clampVal(svgEl?.dataset.totalSteps || d.totalSteps || 16, 4, 32);
  const stepW = gridW / totalSteps;

  const sequenceRows = d.compareMode ? rows : rows.length > 0 ? [rows[0]] : [];
  let cursorMs = 0;

  if (d.compareMode) {
    rows.forEach((row, rIdx) => {
      const blocks = row.blocks || [];
      const rowSteps = clampVal(d.totalSteps || 16, 4, 32);
      const swingPct = safeNum(row.swingPct, 0);
      for (let s = 0; s < rowSteps; s++) {
        const isOddSub = s % 2 === 1;
        const pairMs = stepMs * 2;
        const subDur = swingPct > 0 ? (isOddSub ? pairMs * (1 - swingPct / 100) : pairMs * (swingPct / 100)) : stepMs;
        const blkIdx = blocks.findIndex((b) => Math.round(b.step) === s);
        const blk = blkIdx >= 0 ? blocks[blkIdx] : null;
        const at = cursorMs;
        cursorMs += subDur;

        if (!blk && s % stepsPerBeat !== 0) continue;
        registerTimer(
          setTimeout(() => {
            if (!cardEl.isConnected) return;
            cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
            if (playhead) {
              const px = gridX + s * stepW;
              playhead.setAttribute('x1', px.toFixed(1));
              playhead.setAttribute('x2', px.toFixed(1));
              playhead.setAttribute('opacity', '0.95');
            }
            if (blk && blk.kind !== 'rest') {
              cardEl.querySelector(`[data-td-rblock="${uid}-${rIdx}-${blkIdx}"]`)?.classList.add('is-td-active');
              if (statusEl) statusEl.textContent = `${row.label}: ${blk.label}`;
              if (blk.chordMidis) {
                audioEngine.playTrainerChordPreview(blk.chordMidis, 0.34, 0.72, 'rhodes').catch(() => {});
              } else if (Number.isFinite(blk.noteMidi)) {
                audioEngine.playTrainerPiano(blk.noteMidi, 0.24, 0.80).catch(() => {});
              } else {
                audioEngine.playTrainerClick(blk.kind === 'accent' || blk.kind === 'sync').catch(() => {});
              }
            } else if (s % stepsPerBeat === 0) {
              audioEngine.playTrainerClick(s === 0).catch(() => {});
            }
          }, at)
        );
      }
      cursorMs += 360;
    });
  } else {
    // Play explicit playback array or walk all active blocks by step
    const events = Array.isArray(d.playback) && d.playback.length > 0
      ? d.playback
      : rows.flatMap((row, rIdx) =>
          (row.blocks || [])
            .filter((b) => b.kind !== 'rest')
            .map((b, bIdx) => ({
              rIdx,
              bIdx,
              step: safeNum(b.step, 0),
              span: safeNum(b.span, 2),
              label: `${row.label} · ${b.label}`,
              chordMidis: b.chordMidis,
              noteMidi: b.noteMidi,
              accent: b.kind === 'accent' || b.kind === 'dotted' || b.kind === 'sync',
            }))
        );

    if (Array.isArray(d.playback) && d.playback.length > 0) {
      events.forEach((ev) => {
        const at = cursorMs;
        cursorMs += Math.max(190, Math.round(safeNum(ev.durationSec, 0.4) * 1000));
        registerTimer(
          setTimeout(() => {
            if (!cardEl.isConnected) return;
            cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
            if (playhead && Number.isFinite(ev.step)) {
              const px = gridX + ev.step * stepW;
              playhead.setAttribute('x1', px.toFixed(1));
              playhead.setAttribute('x2', px.toFixed(1));
              playhead.setAttribute('opacity', '0.95');
            }
            if (Number.isFinite(ev.rIdx) && Number.isFinite(ev.bIdx)) {
              cardEl.querySelector(`[data-td-rblock="${uid}-${ev.rIdx}-${ev.bIdx}"]`)?.classList.add('is-td-active');
            }
            if (statusEl) statusEl.textContent = `Đang phát: ${ev.label || ''}`;
            if (ev.chordMidis) audioEngine.playTrainerChordPreview(ev.chordMidis, 0.38, 0.72, 'rhodes').catch(() => {});
            else if (Number.isFinite(ev.noteMidi)) audioEngine.playTrainerPiano(ev.noteMidi, 0.34, 0.82).catch(() => {});
            else audioEngine.playTrainerClick(Boolean(ev.accent)).catch(() => {});
          }, at)
        );
      });
    } else {
      sequenceRows.forEach(() => {
        events.forEach((ev) => {
          const at = cursorMs;
          cursorMs += Math.max(240, ev.span * stepMs);
          registerTimer(
            setTimeout(() => {
              if (!cardEl.isConnected) return;
              cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
              if (playhead) {
                const px = gridX + ev.step * stepW;
                playhead.setAttribute('x1', px.toFixed(1));
                playhead.setAttribute('x2', px.toFixed(1));
                playhead.setAttribute('opacity', '0.95');
              }
              cardEl.querySelector(`[data-td-rblock="${uid}-${ev.rIdx}-${ev.bIdx}"]`)?.classList.add('is-td-active');
              if (statusEl) statusEl.textContent = `Đang phát: ${ev.label}`;
              if (ev.chordMidis) audioEngine.playTrainerChordPreview(ev.chordMidis, 0.36, 0.72, 'rhodes').catch(() => {});
              else if (Number.isFinite(ev.noteMidi)) audioEngine.playTrainerPiano(ev.noteMidi, 0.32, 0.80).catch(() => {});
              else audioEngine.playTrainerClick(Boolean(ev.accent)).catch(() => {});
            }, at)
          );
        });
      });
    }
  }

  registerTimer(
    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
      if (playhead) playhead.setAttribute('opacity', '0');
      if (statusEl) statusEl.textContent = 'Phát xong — bấm ▶ Nghe minh họa để xem lại.';
    }, cursorMs + 180)
  );
}

function playVoiceLeadingDiagram(d, cardEl, statusEl, audioEngine, registerTimer) {
  const panels = [
    { idx: 0, p: d.leftPanel },
    { idx: 1, p: d.rightPanel },
  ];
  let cursorMs = 0;

  panels.forEach(({ idx, p }) => {
    if (!p || !Array.isArray(p.chords)) return;
    p.chords.forEach((ch, cIdx) => {
      const at = cursorMs;
      cursorMs += 760;
      registerTimer(
        setTimeout(() => {
          if (!cardEl.isConnected) return;
          cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
          cardEl.querySelector(`[data-panel-idx="${idx}"][data-chord-idx="${cIdx}"]`)?.classList.add('is-td-active');
          if (statusEl) statusEl.textContent = `${p.title}: ${ch.symbol}`;
          audioEngine.playTrainerChordPreview(ch.midis || [], 0.68, 0.76, 'rhodes').catch(() => {});
        }, at)
      );
    });
    cursorMs += 420;
  });

  registerTimer(
    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
      if (statusEl) statusEl.textContent = 'Phát xong — bấm từng hợp âm trên hình để đối chiếu thế bấm.';
    }, cursorMs + 160)
  );
}

function extractHarmonyPlayNodes(d) {
  if (d.layout === 'degrees') return (d.nodes || []).map((n, i) => ({ idx: i, midis: n.midis, label: `${n.roman} (${n.chord})` }));
  if (d.layout === 'progressions') {
    const out = [];
    let i = 0;
    (d.tracks || []).forEach((tr) => {
      (tr.chords || []).forEach((ch) => {
        out.push({ idx: i++, midis: ch.midis, label: `${tr.name}: ${ch.chord} (${ch.roman})`, gapAfterLast: false });
      });
    });
    return out;
  }
  const all = [...(d.stages || []), ...(d.branches || [])];
  return all.map((st, i) => ({
    idx: i,
    midis: st.midis,
    label: st.chordsLabel || st.formula || st.title || '',
  }));
}

function playHarmonyFlowDiagram(d, cardEl, statusEl, audioEngine, registerTimer) {
  const nodes = extractHarmonyPlayNodes(d);
  const seq = Array.isArray(d.playbackIdxs) && d.playbackIdxs.length
    ? d.playbackIdxs.map((idx) => nodes[idx]).filter(Boolean)
    : nodes;

  let cursorMs = 0;
  seq.forEach((nd) => {
    const at = cursorMs;
    cursorMs += 720;
    registerTimer(
      setTimeout(() => {
        if (!cardEl.isConnected) return;
        cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
        cardEl.querySelector(`[data-node-idx="${nd.idx}"]`)?.classList.add('is-td-active');
        if (statusEl) statusEl.textContent = `Đang phát: ${nd.label}`;
        audioEngine.playTrainerChordPreview(nd.midis || [], 0.64, 0.76, 'rhodes').catch(() => {});
      }, at)
    );
  });

  registerTimer(
    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
      if (statusEl) statusEl.textContent = 'Phát xong — bấm bất kỳ ô chức năng/hợp âm nào trên sơ đồ để nghe lại.';
    }, cursorMs + 160)
  );
}

function playToneContourDiagram(d, uid, cardEl, statusEl, audioEngine, registerTimer, onlyPanelIdx = null) {
  const panels = Array.isArray(d.panels) ? d.panels.slice(0, 2) : [];
  const targets = onlyPanelIdx !== null && panels[onlyPanelIdx]
    ? [{ pIdx: onlyPanelIdx, panel: panels[onlyPanelIdx] }]
    : panels.map((panel, pIdx) => ({ pIdx, panel }));

  let cursorMs = 0;
  targets.forEach(({ pIdx, panel }) => {
    (panel.syllables || []).forEach((syl, sIdx) => {
      const durMs = Math.max(280, Math.round(safeNum(syl.durationSec, 0.42) * 1000));
      const at = cursorMs;
      cursorMs += durMs + 60;
      registerTimer(
        setTimeout(() => {
          if (!cardEl.isConnected) return;
          cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
          cardEl.querySelector(`[data-td-syll="${uid}-${pIdx}-${sIdx}"]`)?.classList.add('is-td-active');
          if (statusEl) statusEl.textContent = `${panel.title}: "${syl.text}" (${syl.toneLabel || ''})`;
          audioEngine.playTrainerPiano(syl.midi, Math.max(0.24, (syl.durationSec || 0.42) * 0.9), 0.84).catch(() => {});
          if (Number.isFinite(syl.slideToMidi)) {
            registerTimer(
              setTimeout(() => {
                if (cardEl.isConnected) audioEngine.playTrainerPiano(syl.slideToMidi, 0.25, 0.72).catch(() => {});
              }, 160)
            );
          }
        }, at)
      );
    });
    cursorMs += 420;
  });

  registerTimer(
    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
      if (statusEl) statusEl.textContent = 'Phát xong — bấm Câu 1 hoặc Câu 2 để so sánh lại.';
    }, cursorMs + 160)
  );
}

function playSongStructureDiagram(d, cardEl, statusEl, audioEngine, registerTimer) {
  const sections = Array.isArray(d.sections) ? d.sections : [];
  let cursorMs = 0;
  sections.forEach((sec, sIdx) => {
    const at = cursorMs;
    cursorMs += 760;
    registerTimer(
      setTimeout(() => {
        if (!cardEl.isConnected) return;
        cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
        cardEl.querySelector(`[data-sec-idx="${sIdx}"]`)?.classList.add('is-td-active');
        if (statusEl) statusEl.textContent = `Đoạn ${sec.name} (${sec.energyPct}% năng lượng): ${sec.desc || sec.chordSymbol || ''}`;
        const vel = 0.45 + (clampVal(sec.energyPct, 10, 100) / 100) * 0.45;
        audioEngine.playTrainerChordPreview(sec.midis || [60, 64, 67], 0.68, vel, 'rhodes').catch(() => {});
      }, at)
    );
  });

  registerTimer(
    setTimeout(() => {
      if (!cardEl.isConnected) return;
      cardEl.querySelectorAll('.is-td-active').forEach((el) => el.classList.remove('is-td-active'));
      if (statusEl) statusEl.textContent = 'Phát xong — bấm từng khối đoạn nhạc để nghe sắc thái năng lượng.';
    }, cursorMs + 160)
  );
}

export function bindTheoryDiagrams(rootEl, lesson, { audioEngine, registerTimer, clearTimers }) {
  if (!rootEl || !lesson) return;
  const diagramMap = buildSectionDiagramIndex(lesson);
  if (diagramMap.size === 0) return;

  const stopAll = () => {
    if (clearTimers) clearTimers();
    rootEl.querySelectorAll('.is-demo-lit, .is-td-active, .is-td-key-hit').forEach((el) => {
      el.classList.remove('is-demo-lit', 'is-td-active', 'is-td-key-hit');
    });
    rootEl.querySelectorAll('.td-rg-playhead').forEach((el) => el.setAttribute('opacity', '0'));
  };

  // 1. Direct interactive SVG piano key click & keyboard enter
  rootEl.querySelectorAll('[data-svg-midi]').forEach((keyEl) => {
    const triggerKey = () => {
      const midi = Number(keyEl.dataset.svgMidi);
      const uid = keyEl.dataset.diagramUid;
      if (!Number.isFinite(midi)) return;
      audioEngine.unlockSync();
      audioEngine.playTrainerPiano(midi, 0.55, 0.85).catch(() => {});
      keyEl.classList.add('is-td-key-hit');
      const cardEl = rootEl.querySelector(`[data-diagram-uid="${uid}"]`);
      const st = cardEl?.querySelector(`[data-td-status="${uid}"]`);
      const d = diagramMap.get(uid);
      if (st) st.textContent = `Phím vừa bấm: ${midiToNoteName(midi, Boolean(d?.preferFlats))} (MIDI ${midi})`;
      registerTimer(setTimeout(() => keyEl.classList.remove('is-td-key-hit'), 320));
    };
    keyEl.addEventListener('click', triggerKey);
    keyEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerKey();
      }
    });
  });

  // 2. Voice-leading individual chord column click
  rootEl.querySelectorAll('[data-td-vl-play]').forEach((colEl) => {
    const triggerCol = () => {
      const uid = colEl.dataset.tdVlPlay;
      const pIdx = Number(colEl.dataset.panelIdx);
      const cIdx = Number(colEl.dataset.chordIdx);
      const d = diagramMap.get(uid);
      const panel = pIdx === 0 ? d?.leftPanel : d?.rightPanel;
      const ch = panel?.chords?.[cIdx];
      if (!ch) return;
      stopAll();
      audioEngine.unlockSync();
      colEl.classList.add('is-td-active');
      audioEngine.playTrainerChordPreview(ch.midis || [], 0.72, 0.78, 'rhodes').catch(() => {});
      const st = rootEl.querySelector(`[data-td-status="${uid}"]`);
      if (st) st.textContent = `${panel.title}: đang nghe hợp âm ${ch.symbol}`;
      registerTimer(setTimeout(() => colEl.classList.remove('is-td-active'), 700));
    };
    colEl.addEventListener('click', triggerCol);
    colEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerCol();
      }
    });
  });

  // 3. Harmony-flow individual node click
  rootEl.querySelectorAll('[data-td-node-play]').forEach((ndEl) => {
    const triggerNode = () => {
      const uid = ndEl.dataset.tdNodePlay;
      const nIdx = Number(ndEl.dataset.nodeIdx);
      const d = diagramMap.get(uid);
      const nodes = extractHarmonyPlayNodes(d || {});
      const nd = nodes[nIdx];
      if (!nd) return;
      stopAll();
      audioEngine.unlockSync();
      ndEl.classList.add('is-td-active');
      audioEngine.playTrainerChordPreview(nd.midis || [], 0.72, 0.78, 'rhodes').catch(() => {});
      const st = rootEl.querySelector(`[data-td-status="${uid}"]`);
      if (st) st.textContent = `Đang nghe: ${nd.label}`;
      registerTimer(setTimeout(() => ndEl.classList.remove('is-td-active'), 700));
    };
    ndEl.addEventListener('click', triggerNode);
    ndEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        triggerNode();
      }
    });
  });

  // 4. Tone-contour single panel audition
  rootEl.querySelectorAll('[data-td-panel-play]').forEach((pEl) => {
    const triggerPanel = () => {
      const uid = pEl.dataset.tdPanelPlay;
      const pIdx = Number(pEl.dataset.panelIdx);
      const d = diagramMap.get(uid);
      const cardEl = rootEl.querySelector(`[data-diagram-uid="${uid}"]`);
      const st = rootEl.querySelector(`[data-td-status="${uid}"]`);
      if (!d || !cardEl) return;
      stopAll();
      audioEngine.unlockSync();
      playToneContourDiagram(d, uid, cardEl, st, audioEngine, registerTimer, pIdx);
    };
    pEl.addEventListener('click', triggerPanel);
  });

  // 5. Song-structure individual section click
  rootEl.querySelectorAll('[data-td-sec-play]').forEach((sEl) => {
    const triggerSec = () => {
      const uid = sEl.dataset.tdSecPlay;
      const sIdx = Number(sEl.dataset.secIdx);
      const d = diagramMap.get(uid);
      const sec = d?.sections?.[sIdx];
      if (!sec) return;
      stopAll();
      audioEngine.unlockSync();
      sEl.classList.add('is-td-active');
      const vel = 0.45 + (clampVal(sec.energyPct, 10, 100) / 100) * 0.45;
      audioEngine.playTrainerChordPreview(sec.midis || [60, 64, 67], 0.72, vel, 'rhodes').catch(() => {});
      const st = rootEl.querySelector(`[data-td-status="${uid}"]`);
      if (st) st.textContent = `Đang nghe đoạn ${sec.name} (${sec.energyPct}%): ${sec.desc || sec.chordSymbol || ''}`;
      registerTimer(setTimeout(() => sEl.classList.remove('is-td-active'), 700));
    };
    sEl.addEventListener('click', triggerSec);
  });

  // 6. Primary "▶ Nghe minh họa" button on every diagram card
  rootEl.querySelectorAll('[data-td-play]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.tdPlay;
      const d = diagramMap.get(uid);
      const cardEl = rootEl.querySelector(`[data-diagram-uid="${uid}"]`);
      const st = rootEl.querySelector(`[data-td-status="${uid}"]`);
      if (!d || !cardEl) return;

      stopAll();
      audioEngine.unlockSync();

      if (d.type === 'piano-strip') playPianoStripDiagram(d, cardEl, st, audioEngine, registerTimer);
      else if (d.type === 'rhythm-grid') playRhythmGridDiagram(d, uid, cardEl, st, audioEngine, registerTimer);
      else if (d.type === 'voice-leading') playVoiceLeadingDiagram(d, cardEl, st, audioEngine, registerTimer);
      else if (d.type === 'harmony-flow') playHarmonyFlowDiagram(d, cardEl, st, audioEngine, registerTimer);
      else if (d.type === 'tone-contour') playToneContourDiagram(d, uid, cardEl, st, audioEngine, registerTimer, null);
      else if (d.type === 'song-structure') playSongStructureDiagram(d, cardEl, st, audioEngine, registerTimer);
    });
  });
}
