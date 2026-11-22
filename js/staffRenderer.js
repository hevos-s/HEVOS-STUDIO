// ============================================================================
// staffRenderer.js — Bộ vẽ Khuông nhạc Vector SVG chuẩn xác (100% Path/Shape,
// KHÔNG dùng ký tự Unicode nhạc để đảm bảo nét căng trên Windows/iOS/Android)
// ============================================================================

import { CLEF_META, KEY_SIGNATURES, LETTERS, createNoteObj, diatonicIndex, diatonicToLetterOctave } from './trainerData.js?v=29';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(el);
  return el;
}

export function stepToY(step, yBottom, lineGap) {
  return yBottom - step * (lineGap / 2);
}

/**
 * Vẽ 5 dòng kẻ khuông nhạc sắc nét
 */
function drawStaffLines(parent, x1, x2, yBottom, lineGap, color = '#4B5262') {
  for (let line = 0; line < 5; line++) {
    const y = yBottom - line * lineGap;
    svgEl('line', {
      x1,
      y1: y,
      x2,
      y2: y,
      stroke: color,
      'stroke-width': 1.35,
    }, parent);
  }
}

/**
 * Vẽ Khóa Sol (Treble G-Clef) bằng đường dẫn Vector SVG chuẩn tỷ lệ quanh dòng 2 (G4)
 */
export function drawTrebleClef(parent, x, yBottom, lineGap, color = '#D1D5DB') {
  const yG = yBottom - lineGap; // Dòng 2 = G4
  const s = lineGap / 14;
  const g = svgEl('g', {
    transform: `translate(${x}, ${yG}) scale(${s})`,
    fill: 'none',
    stroke: color,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }, parent);

  // Thân xoắn Khóa Sol chuẩn (tâm xoắn tại (0, 0) = Dòng 2 G4)
  svgEl('path', {
    d: 'M -1.5,1.5 C -1.5,-5.5 6.5,-8.5 10.5,-3 C 14,2 9,12 -1,12.5 C -10.5,13 -14.5,3.5 -10,-6 C -5,-16 9,-24 9.5,-36 C 9.8,-44 4,-49 1,-45.5 C -2.5,-41 -2,-28 -1.2,-12 L 1.2,23 C 1.8,30.5 -2.5,35 -7.5,33.5 C -11,32.5 -12,28 -9,26',
    'stroke-width': 3.0,
  }, g);

  // Chấm tròn đầu móc dưới
  svgEl('circle', {
    cx: -8.5,
    cy: 27,
    r: 2.5,
    fill: color,
    stroke: 'none',
  }, g);
}

/**
 * Vẽ Khóa Fa (Bass F-Clef) bằng SVG Vector chuẩn quanh dòng 4 (F3)
 */
export function drawBassClef(parent, x, yBottom, lineGap, color = '#D1D5DB') {
  const yF = yBottom - 3 * lineGap; // Dòng 4 = F3
  const s = lineGap / 14;
  const g = svgEl('g', {
    transform: `translate(${x}, ${yF}) scale(${s})`,
  }, parent);

  // Chấm tròn khởi đầu trên dòng 4 (F3)
  svgEl('circle', { cx: -7, cy: 0, r: 4.1, fill: color }, g);

  // Đường cong lớn ôm dòng 5 kéo xuống dòng 1
  svgEl('path', {
    d: 'M -9,0 C -9,-12 7,-16 11,-4 C 15,8 4,21 -11,30',
    fill: 'none',
    stroke: color,
    'stroke-width': 3.6,
    'stroke-linecap': 'round',
  }, g);

  // Hai dấu chấm kẹp hai bên dòng 4 (khe 3 & khe 4)
  svgEl('circle', { cx: 18, cy: -6.5, r: 2.5, fill: color }, g);
  svgEl('circle', { cx: 18, cy: 6.5, r: 2.5, fill: color }, g);
}

/**
 * Vẽ Khóa Đô (Alto C-Clef) bằng SVG Vector chuẩn kẹp vào dòng 3 (C4)
 */
export function drawAltoClef(parent, x, yBottom, lineGap, color = '#D1D5DB') {
  const yTop = yBottom - 4 * lineGap;
  const yMid = yBottom - 2 * lineGap; // Dòng 3 = C4
  const h = 4 * lineGap;

  const g = svgEl('g', { transform: `translate(${x - 12}, 0)` }, parent);

  // Hai vạch đứng đặc trưng bên trái
  svgEl('rect', { x: 0, y: yTop, width: 4.5, height: h, fill: color, rx: 0.5 }, g);
  svgEl('rect', { x: 7.5, y: yTop, width: 1.8, height: h, fill: color }, g);

  // Cặp móc đối xứng chụm vào đúng Dòng 3 (C4)
  const r = lineGap * 1.15;
  svgEl('path', {
    d: `M 10.5,${yMid} C 13,${yMid - r * 0.8} 19,${yTop} 24,${yTop + 2} C 28,${yTop + 4} 28,${yMid - 4} 22,${yMid - 1.5}`,
    fill: 'none',
    stroke: color,
    'stroke-width': 2.7,
    'stroke-linecap': 'round',
  }, g);
  svgEl('path', {
    d: `M 10.5,${yMid} C 13,${yMid + r * 0.8} 19,${yBottom} 24,${yBottom - 2} C 28,${yBottom - 4} 28,${yMid + 4} 22,${yMid + 1.5}`,
    fill: 'none',
    stroke: color,
    'stroke-width': 2.7,
    'stroke-linecap': 'round',
  }, g);
}

export function drawClef(parent, clef, x, yBottom, lineGap, color = '#D1D5DB') {
  if (clef === 'bass') drawBassClef(parent, x, yBottom, lineGap, color);
  else if (clef === 'alto') drawAltoClef(parent, x, yBottom, lineGap, color);
  else drawTrebleClef(parent, x, yBottom, lineGap, color);
}

/**
 * Vẽ dấu hóa Thăng (# = 1) hoặc Giáng (b = -1) bằng đường dẫn vector sắc nét
 */
export function drawAccidental(parent, type, x, y, lineGap, color = '#E5E7EB') {
  if (!type) return;
  const s = lineGap / 14;
  const g = svgEl('g', {
    transform: `translate(${x}, ${y}) scale(${s})`,
  }, parent);

  if (type === 1) {
    // Dấu thăng ♯ (2 nét dọc + 2 nét ngang hơi nghiêng)
    svgEl('line', { x1: -2.6, y1: -9.5, x2: -2.6, y2: 9.5, stroke: color, 'stroke-width': 1.7, 'stroke-linecap': 'round' }, g);
    svgEl('line', { x1: 2.6, y1: -10.5, x2: 2.6, y2: 8.5, stroke: color, 'stroke-width': 1.7, 'stroke-linecap': 'round' }, g);
    svgEl('line', { x1: -5.8, y1: -2.2, x2: 5.8, y2: -4.4, stroke: color, 'stroke-width': 2.7, 'stroke-linecap': 'round' }, g);
    svgEl('line', { x1: -5.8, y1: 4.4, x2: 5.8, y2: 2.2, stroke: color, 'stroke-width': 2.7, 'stroke-linecap': 'round' }, g);
  } else if (type === -1) {
    // Dấu giáng ♭
    svgEl('path', {
      d: 'M -3.5,-13 L -3.5,6.5 C 2.5,5.5 5.5,1 4.2,-2.2 C 3,-4.8 -1,-3.8 -3.5,-0.5',
      fill: 'none',
      stroke: color,
      'stroke-width': 2.1,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }, g);
  }
}

/**
 * Vẽ hóa biểu đầu khuông nhạc (0, 1#, 2#, 4#, 1b, 2b, 4b) theo từng Khóa
 * Trả về tọa độ X ngay sau hóa biểu để đặt vạch chuẩn hợp lý
 */
export function drawKeySignature(parent, clef, keySigId, startX, yBottom, lineGap, color = '#D1D5DB') {
  const sig = KEY_SIGNATURES[keySigId];
  if (!sig || !sig.count) return startX;

  const clefMeta = CLEF_META[clef] || CLEF_META.treble;
  const steps = sig.type === 1 ? clefMeta.sharpSteps : clefMeta.flatSteps;
  const spacing = 12;

  for (let i = 0; i < sig.count; i++) {
    const step = steps[i];
    const x = startX + i * spacing;
    const y = stepToY(step, yBottom, lineGap);
    drawAccidental(parent, sig.type, x, y, lineGap, color);
  }
  return startX + sig.count * spacing + 6;
}

const STATE_COLORS = {
  neutral: { fill: '#F3F4F6', stroke: '#F3F4F6', ledger: '#9CA3AF' },
  correct: { fill: '#10B981', stroke: '#34D399', ledger: '#10B981' },
  wrong:   { fill: '#EF4444', stroke: '#FCA5A5', ledger: '#EF4444' },
  missed:  { fill: '#EF4444', stroke: '#FCA5A5', ledger: '#EF4444' },
  active:  { fill: '#3B82F6', stroke: '#93C5FD', ledger: '#60A5FA' },
};

/**
 * Vẽ 1 nốt nhạc hoàn chỉnh tại vị trí (x, step): dòng kẻ phụ, dấu hóa, đầu nốt bầu dục, đuôi nốt
 */
export function createNoteSvgNode(noteObj, x, yBottom, lineGap, state = 'neutral') {
  const colors = STATE_COLORS[state] || STATE_COLORS.neutral;
  const g = svgEl('g', {
    class: `staff-note state-${state}`,
    'data-note-state': state,
  });

  const step = noteObj.staffStep;
  const y = stepToY(step, yBottom, lineGap);
  const rx = lineGap * 0.56;
  const ry = lineGap * 0.40;
  const ledgerHalfW = rx + 6;

  // Dòng kẻ phụ tự động bên dưới (step <= -2) và bên trên (step >= 10)
  if (step <= -2) {
    for (let s = -2; s >= step; s -= 2) {
      const ly = stepToY(s, yBottom, lineGap);
      svgEl('line', {
        class: 'note-ledger',
        x1: x - ledgerHalfW,
        y1: ly,
        x2: x + ledgerHalfW,
        y2: ly,
        stroke: colors.ledger,
        'stroke-width': 1.5,
      }, g);
    }
  } else if (step >= 10) {
    for (let s = 10; s <= step; s += 2) {
      const ly = stepToY(s, yBottom, lineGap);
      svgEl('line', {
        class: 'note-ledger',
        x1: x - ledgerHalfW,
        y1: ly,
        x2: x + ledgerHalfW,
        y2: ly,
        stroke: colors.ledger,
        'stroke-width': 1.5,
      }, g);
    }
  }

  // Dấu hóa bên cạnh nốt (nếu có)
  if (noteObj.accidental) {
    drawAccidental(g, noteObj.accidental, x - rx - 9, y, lineGap, colors.fill);
  }

  // Đầu nốt bầu dục nghiêng -20 độ chuẩn ký âm
  svgEl('ellipse', {
    class: 'note-head',
    cx: x,
    cy: y,
    rx,
    ry,
    transform: `rotate(-20 ${x} ${y})`,
    fill: colors.fill,
  }, g);

  // Đuôi nốt (step < 4 quay lên bên phải; step >= 4 quay xuống bên trái)
  const stemLen = lineGap * 3.1;
  const stemUp = step < 4;
  const stemX = stemUp ? x + rx - 0.9 : x - rx + 0.9;
  const stemY1 = y + (stemUp ? -1 : 1);
  const stemY2 = stemUp ? y - stemLen : y + stemLen;

  svgEl('line', {
    class: 'note-stem',
    x1: stemX,
    y1: stemY1,
    x2: stemX,
    y2: stemY2,
    stroke: colors.stroke,
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
  }, g);

  return g;
}

/**
 * Render khuông nhạc cho Chế độ 1 (Luyện từng nốt) & Chế độ 3 (Ôn tập nốt sai)
 */
export function renderSingleNoteStaff(containerEl, noteObj, { state = 'neutral', revealLabel = '' } = {}) {
  if (!containerEl || !noteObj) return;
  const W = 440;
  const H = 200;
  const lineGap = 15;
  const yBottom = 132; // Line 1 = 132, Line 5 = 72 -> chừa đủ chỗ cho 3-4 dòng kẻ phụ trên & dưới

  containerEl.innerHTML = '';
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'staff-svg',
    role: 'img',
    'aria-label': `Khuông nhạc ${CLEF_META[noteObj.clef]?.label || ''}`,
  }, containerEl);

  // Vạch đứng đầu khuông
  svgEl('line', {
    x1: 30,
    y1: yBottom - 4 * lineGap,
    x2: 30,
    y2: yBottom,
    stroke: '#6B7280',
    'stroke-width': 2.2,
  }, svg);

  drawStaffLines(svg, 30, W - 30, yBottom, lineGap);
  drawClef(svg, noteObj.clef, 64, yBottom, lineGap, '#E5E7EB');

  // Nhãn khóa nhỏ góc trên trái
  const clefBadge = svgEl('text', {
    x: 32,
    y: 22,
    fill: '#6B7280',
    'font-family': 'JetBrains Mono, Consolas, monospace',
    'font-size': 11,
    'font-weight': 700,
  }, svg);
  clefBadge.textContent = CLEF_META[noteObj.clef]?.label.toUpperCase() || '';

  const noteX = 246;
  const noteNode = createNoteSvgNode(noteObj, noteX, yBottom, lineGap, state);
  svg.appendChild(noteNode);

  // Hiện tên nốt đáp án bên cạnh khi trả lời sai/đúng (nếu truyền revealLabel)
  if (revealLabel) {
    const labelY = Math.max(24, Math.min(H - 14, stepToY(noteObj.staffStep, yBottom, lineGap)));
    const text = svgEl('text', {
      x: noteX + 28,
      y: labelY + 4,
      fill: state === 'wrong' ? '#FCA5A5' : '#34D399',
      'font-family': 'JetBrains Mono, Consolas, monospace',
      'font-size': 13,
      'font-weight': 700,
    }, svg);
    text.textContent = revealLabel;
  }
}

/**
 * Render khuông nhạc tương tác cho Chế độ 4 (Tra cứu nốt)
 */
export function renderReferenceStaff(containerEl, { clef = 'treble', accidentalFilter = 0, activeNoteKey = null, onSelectNote = null } = {}) {
  if (!containerEl) return;
  const ranges = {
    treble: ['C', 4, 'A', 5],
    bass:   ['E', 2, 'C', 4],
    alto:   ['D', 3, 'B', 4],
  };
  const [sLet, sOct, eLet, eOct] = ranges[clef] || ranges.treble;
  const startIdx = diatonicIndex(sLet, sOct);
  const endIdx = diatonicIndex(eLet, eOct);

  const notes = [];
  for (let d = startIdx; d <= endIdx; d++) {
    const { letter, octave } = diatonicToLetterOctave(d);
    let acc = accidentalFilter;
    // Bỏ qua thăng/giáng không tự nhiên nếu đang lọc, hoặc giữ nguyên tự nhiên
    if (acc === 1 && (letter === 'E' || letter === 'B')) acc = 0;
    if (acc === -1 && (letter === 'C' || letter === 'F')) acc = 0;
    notes.push(createNoteObj({ clef, letter, octave, explicitAccidental: acc }));
  }

  const W = 740;
  const H = 210;
  const lineGap = 15;
  const yBottom = 136;

  containerEl.innerHTML = '';
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'staff-svg ref-staff-svg',
  }, containerEl);

  svgEl('line', {
    x1: 22,
    y1: yBottom - 4 * lineGap,
    x2: 22,
    y2: yBottom,
    stroke: '#6B7280',
    'stroke-width': 2.2,
  }, svg);

  drawStaffLines(svg, 22, W - 20, yBottom, lineGap);
  drawClef(svg, clef, 52, yBottom, lineGap, '#E5E7EB');

  const leftPad = 108;
  const rightPad = 36;
  const span = W - leftPad - rightPad;
  const stepX = span / Math.max(1, notes.length - 1);

  notes.forEach((n, idx) => {
    const nx = leftPad + idx * stepX;
    const ny = stepToY(n.staffStep, yBottom, lineGap);
    const isActive = n.key === activeNoteKey;

    const itemG = svgEl('g', { class: 'ref-note-hit', style: 'cursor: pointer;' }, svg);
    // Vùng chạm tàng hình rộng rãi
    svgEl('rect', {
      x: nx - stepX * 0.45,
      y: 16,
      width: stepX * 0.9,
      height: H - 32,
      fill: isActive ? 'rgba(59, 130, 246, 0.10)' : 'transparent',
      rx: 3,
    }, itemG);

    const node = createNoteSvgNode(n, nx, yBottom, lineGap, isActive ? 'active' : 'neutral');
    itemG.appendChild(node);

    // Tên nốt nhỏ phía dưới mỗi cột
    const cap = svgEl('text', {
      x: nx,
      y: H - 12,
      'text-anchor': 'middle',
      fill: isActive ? '#93C5FD' : '#6B7280',
      'font-family': 'JetBrains Mono, Consolas, monospace',
      'font-size': 10.5,
      'font-weight': isActive ? 700 : 600,
    }, itemG);
    cap.textContent = n.displayName.replace('#', '♯').replace('b', '♭');

    itemG.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (onSelectNote) onSelectNote(n);
    });
  });

  return notes;
}

/**
 * Khuông nhạc cuộn 60fps bằng SVG Transform cho Chế độ 2 (Luyện nốt chạy)
 */
export class ScrollingStaffView {
  constructor(containerEl, { clef = 'treble', keySigId = '0' } = {}) {
    this.containerEl = containerEl;
    this.clef = clef;
    this.keySigId = keySigId;

    this.W = 760;
    this.H = 200;
    this.lineGap = 15;
    this.yBottom = 132;

    this.containerEl.innerHTML = '';
    this.svg = svgEl('svg', {
      viewBox: `0 0 ${this.W} ${this.H}`,
      class: 'staff-svg scroll-staff-svg',
    }, this.containerEl);

    // 1. Nền dải khuông cố định
    drawStaffLines(this.svg, 18, this.W - 14, this.yBottom, this.lineGap);

    // Vạch đầu khuông & Khóa nhạc
    svgEl('line', {
      x1: 18,
      y1: this.yBottom - 4 * this.lineGap,
      x2: 18,
      y2: this.yBottom,
      stroke: '#6B7280',
      'stroke-width': 2.2,
    }, this.svg);

    drawClef(this.svg, this.clef, 48, this.yBottom, this.lineGap, '#E5E7EB');

    // Hóa biểu cố định ngay sau Khóa nhạc
    const afterSigX = drawKeySignature(
      this.svg,
      this.clef,
      this.keySigId,
      86,
      this.yBottom,
      this.lineGap,
      '#CBD5E1'
    );

    // Đặt Vạch chuẩn màu xanh lá ngay sau hóa biểu (tối thiểu x = 195 để dễ nhìn)
    this.targetX = Math.max(195, afterSigX + 52);
    this.spawnX = this.W + 30;
    this.despawnX = this.targetX - 90;

    // Vùng nhận nốt nhẹ quanh vạch chuẩn
    svgEl('rect', {
      x: this.targetX - 36,
      y: 16,
      width: 96,
      height: this.H - 32,
      fill: 'rgba(16, 185, 129, 0.06)',
    }, this.svg);

    // Vạch dọc chuẩn màu xanh lá rõ nét
    svgEl('line', {
      x1: this.targetX,
      y1: 14,
      x2: this.targetX,
      y2: this.H - 14,
      stroke: '#10B981',
      'stroke-width': 2.4,
    }, this.svg);

    svgEl('polygon', {
      points: `${this.targetX - 6},14 ${this.targetX + 6},14 ${this.targetX},23`,
      fill: '#10B981',
    }, this.svg);

    // Clip layer cho các nốt đang trôi để không đè lên vùng khóa nhạc bên trái
    const defs = svgEl('defs', {}, this.svg);
    const clip = svgEl('clipPath', { id: 'scroll-notes-clip' }, defs);
    svgEl('rect', {
      x: Math.max(110, afterSigX + 4),
      y: 0,
      width: this.W,
      height: this.H,
    }, clip);

    this.notesLayer = svgEl('g', { 'clip-path': 'url(#scroll-notes-clip)' }, this.svg);
  }

  addNoteNode(item) {
    // Vẽ nốt tại tọa độ local x=0, rồi dịch ngang bằng transform="translate(x, 0)" ở 60fps
    const node = createNoteSvgNode(item.note, 0, this.yBottom, this.lineGap, 'neutral');
    node.setAttribute('transform', `translate(${item.x.toFixed(1)}, 0)`);
    this.notesLayer.appendChild(node);
    item.el = node;
  }

  updateNoteX(item) {
    if (item.el) {
      item.el.setAttribute('transform', `translate(${item.x.toFixed(1)}, 0)`);
    }
  }

  setNoteState(item, state) {
    if (!item.el) return;
    const colors = STATE_COLORS[state] || STATE_COLORS.neutral;
    item.el.setAttribute('data-note-state', state);
    const head = item.el.querySelector('.note-head');
    const stem = item.el.querySelector('.note-stem');
    if (head) head.setAttribute('fill', colors.fill);
    if (stem) stem.setAttribute('stroke', colors.stroke);
    item.el.querySelectorAll('.note-ledger').forEach((l) => l.setAttribute('stroke', colors.ledger));
  }

  removeNoteNode(item) {
    if (item.el && item.el.parentNode) {
      item.el.parentNode.removeChild(item.el);
    }
    item.el = null;
  }
}
