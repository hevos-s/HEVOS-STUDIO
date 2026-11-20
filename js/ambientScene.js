// ============================================================================
// ambientScene.js — Không gian Âm thanh 3D Retina 60fps & Tương tác Nhạc (Three.js)
// - Kết xuất gốc 60fps mượt mà (tự tạm dừng khi chuyển tab qua visibilitychange)
// - Độ phân giải cao Retina (pixelRatio <= 2) & khử răng cưa antialias: true
// - Tự động dịu ánh sáng & lùi nhẹ ra xa khi vào các phòng làm việc
// ============================================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

function createSoftGlowTexture(innerRgba, midRgba, outerRgba) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, innerRgba);
  grad.addColorStop(0.38, midRgba);
  grad.addColorStop(1, outerRgba);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function applySphereGradientColors(geometry, colorBot, colorMid, colorTop, radius) {
  const pos = geometry.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const py = pos.getY(i) / radius;
    const px = pos.getX(i) / radius;
    const t = THREE.MathUtils.clamp((py + 1) * 0.5 + px * 0.14, 0, 1);
    if (t < 0.52) {
      tmp.copy(colorBot).lerp(colorMid, t / 0.52);
    } else {
      tmp.copy(colorMid).lerp(colorTop, (t - 0.52) / 0.48);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export class AmbientAudioScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.hubScrollEl = options.hubScrollEl || null;
    this.supported = false;
    this.disposed = false;

    this.section = 'hub';
    this.isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    // Ngữ cảnh & trạng thái nội suy
    this.targetIntensity = 1.0;
    this.currentIntensity = 1.0;
    this.targetCamZ = this.isMobile ? 7.8 : 6.2;
    this.currentCamZ = this.targetCamZ;
    this.targetOrbScale = 1.0;
    this.currentOrbScale = 1.0;

    // Parallax chuột & cuộn trang
    this.pointer = { tx: 0, ty: 0, x: 0, y: 0 };
    this.scrollTarget = 0;
    this.scrollCurrent = 0;

    // Cảm ứng âm thanh (cấp phát mảng đệm đúng 1 lần, không cấp phát trong vòng lặp)
    this.analyser = null;
    this.connectedToneNode = null;
    this.externalEnergyProvider = null;
    this.audio = {
      energy: 0,
      bass: 0,
      mid: 0,
      high: 0,
      bins: new Float32Array(64),
    };

    this._rafId = null;
    this._lastFrameMs = 0;
    this._elapsed = 0;
    this._paused = false;
    this._dirtyRender = true;

    if (!this.canvas || typeof window === 'undefined') return;
    this._initThree();
  }

  _initThree() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
      this.renderer.toneMapping = THREE.NoToneMapping;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#08090F');
      this.scene.fog = new THREE.FogExp2('#08090F', 0.042);

      this.camera = new THREE.PerspectiveCamera(
        48,
        Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight),
        0.1,
        55
      );
      this.camera.position.set(0, 0, this.currentCamZ);

      this._applySize();
      this._buildAuras();
      this._buildSoundwaveOrb();
      this._buildOrbitRings();
      this._buildDepthAudioDust();

      this._bindEvents();
      this.supported = true;
      this._lastFrameMs = performance.now();
      this._renderOnce();
      this._startLoop();
    } catch (err) {
      console.warn('[HEVOS STUDIO 3D Fallback]', err);
      this.supported = false;
    }
  }

  _applySize() {
    if (!this.renderer || !this.camera) return;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.isMobile = w < 768;

    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _buildAuras() {
    this.auraGroup = new THREE.Group();
    this.scene.add(this.auraGroup);

    const makeAuraSprite = (c1, c2, scale, x, y, z, opacity) => {
      const tex = createSoftGlowTexture(c1, c2, 'rgba(8, 9, 15, 0)');
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, z);
      sprite.scale.set(scale, scale, 1);
      sprite.userData.baseOpacity = opacity;
      sprite.userData.baseScale = scale;
      this.auraGroup.add(sprite);
      return sprite;
    };

    // 2 lớp hào quang studio analog nhỏ gọn hậu cảnh (Indigo #311068 & Magenta-Amber)
    this.auraSprites = [
      makeAuraSprite('rgba(88, 28, 175, 0.72)', 'rgba(49, 16, 104, 0.28)', 9.6, -1.8, 0.9, -3.4, 0.68),
      makeAuraSprite('rgba(219, 39, 119, 0.56)', 'rgba(249, 115, 22, 0.20)', 8.4, 1.9, -0.8, -3.1, 0.56),
    ];
  }

  _buildSoundwaveOrb() {
    this.orbGroup = new THREE.Group();
    this.scene.add(this.orbGroup);

    // 1. Lõi cầu 24x24 tự phát sáng nhẹ (0 đèn chiếu bóng)
    const coreGeo = new THREE.SphereGeometry(1.30, 24, 24);
    applySphereGradientColors(
      coreGeo,
      new THREE.Color('#13072E'),
      new THREE.Color('#270C4D'),
      new THREE.Color('#3B1248'),
      1.30
    );
    this.coreMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.orbGroup.add(this.coreMesh);

    // 2. Lưới sóng âm 24x24 chuyển sắc Indigo -> Magenta -> Amber
    const wireGeo = new THREE.SphereGeometry(1.46, 24, 24);
    applySphereGradientColors(
      wireGeo,
      new THREE.Color('#6D28D9'),
      new THREE.Color('#EC4899'),
      new THREE.Color('#F97316'),
      1.46
    );
    this.wireMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.wireMesh = new THREE.Mesh(wireGeo, this.wireMat);
    this.orbGroup.add(this.wireMesh);
  }

  _buildOrbitRings() {
    this.orbitRings = [];
    const ringConfigs = [
      {
        radius: 2.34,
        color: '#EC4899',
        tiltX: 0.96,
        tiltY: 0.42,
        tiltZ: -0.25,
        speed: 0.22,
        band: 'bass',
        opacity: 0.64,
      },
      {
        radius: 3.04,
        color: '#F97316',
        tiltX: -0.78,
        tiltY: -0.56,
        tiltZ: 0.48,
        speed: -0.17,
        band: 'mid',
        opacity: 0.54,
      },
      {
        radius: 3.80,
        color: '#7C3AED',
        tiltX: 0.46,
        tiltY: -0.82,
        tiltZ: 0.72,
        speed: 0.12,
        band: 'high',
        opacity: 0.48,
      },
    ];

    const segs = 72;
    const dotCount = 18;
    const dotTex = createSoftGlowTexture(
      'rgba(255, 255, 255, 1)',
      'rgba(255, 255, 255, 0.45)',
      'rgba(255, 255, 255, 0)'
    );

    for (const cfg of ringConfigs) {
      const group = new THREE.Group();
      group.rotation.set(cfg.tiltX, cfg.tiltY, cfg.tiltZ);

      const linePos = new Float32Array(segs * 3);
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        linePos[i * 3] = Math.cos(a) * cfg.radius;
        linePos[i * 3 + 1] = Math.sin(a) * cfg.radius;
        linePos[i * 3 + 2] = 0;
      }

      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: cfg.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.LineLoop(lineGeo, lineMat);
      group.add(line);

      const dotPos = new Float32Array(dotCount * 3);
      for (let i = 0; i < dotCount; i++) {
        const a = (i / dotCount) * Math.PI * 2;
        dotPos[i * 3] = Math.cos(a) * cfg.radius;
        dotPos[i * 3 + 1] = Math.sin(a) * cfg.radius;
        dotPos[i * 3 + 2] = 0;
      }
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
      const dotMat = new THREE.PointsMaterial({
        size: 0.085,
        color: cfg.color,
        map: dotTex,
        transparent: true,
        opacity: cfg.opacity * 1.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(dotGeo, dotMat);
      group.add(points);

      this.orbGroup.add(group);
      this.orbitRings.push({ cfg, group, lineMat, dotMat });
    }
  }

  _buildDepthAudioDust() {
    // Tối đa 100 hạt bụi sáng (96 Desktop / 64 Mobile), dùng PointsMaterial nhẹ nhàng
    const count = this.isMobile ? 64 : 96;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const palette = [
      new THREE.Color('#7C3AED'),
      new THREE.Color('#BE185D'),
      new THREE.Color('#F97316'),
      new THREE.Color('#E9D5FF'),
    ];

    for (let i = 0; i < count; i++) {
      const z = THREE.MathUtils.lerp(-9.5, 3.8, Math.random());
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 13;
      positions[i * 3 + 2] = z;

      const c = palette[i % palette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const dotTex = createSoftGlowTexture(
      'rgba(255, 255, 255, 1)',
      'rgba(255, 240, 255, 0.48)',
      'rgba(255, 255, 255, 0)'
    );

    this.dustMat = new THREE.PointsMaterial({
      size: 0.14,
      map: dotTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.dustPoints = new THREE.Points(geo, this.dustMat);
    this.scene.add(this.dustPoints);
  }

  _bindEvents() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize, { passive: true });

    this._onPointerMove = (e) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      this.pointer.tx = (e.clientX / w - 0.5) * 2;
      this.pointer.ty = (e.clientY / h - 0.5) * 2;
    };
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });

    this._onScroll = () => this._updateScrollTarget();
    if (this.hubScrollEl) {
      this.hubScrollEl.addEventListener('scroll', this._onScroll, { passive: true });
    }
    window.addEventListener('scroll', this._onScroll, { passive: true });

    this._onVisibility = () => {
      this._paused = Boolean(document.hidden);
      if (this._paused) {
        this._stopLoop();
      } else {
        this._lastFrameMs = performance.now();
        this._startLoop();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  _updateScrollTarget() {
    if (this.section !== 'hub') {
      this.scrollTarget = 0;
      return;
    }
    if (this.hubScrollEl) {
      const maxScroll = Math.max(1, this.hubScrollEl.scrollHeight - this.hubScrollEl.clientHeight);
      this.scrollTarget = THREE.MathUtils.clamp(this.hubScrollEl.scrollTop / maxScroll, 0, 1);
    } else {
      const maxDoc = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      this.scrollTarget = THREE.MathUtils.clamp(window.scrollY / maxDoc, 0, 1);
    }
  }

  resize() {
    if (!this.supported || !this.renderer || !this.camera) return;
    this._applySize();
    this.setSection(this.section);
    this._renderOnce();
  }

  /**
   * Kết nối song song (read-only) đầu ra Tone.Destination qua Tone.Analyser('fft', 64),
   * tuyệt đối không gọi disconnect() làm ảnh hưởng đường tiếng của Sáng tác Beat.
   */
  connectTone(masterNode = null) {
    if (!this.supported || typeof window.Tone === 'undefined') return false;
    const Tone = window.Tone;
    if (!Tone.context || Tone.context.state !== 'running') return false;

    const targetNode =
      typeof Tone.getDestination === 'function' ? Tone.getDestination() : masterNode;
    if (!targetNode || typeof targetNode.connect !== 'function') return false;

    if (this.analyser && this.connectedToneNode === targetNode) {
      return true;
    }

    try {
      if (!this.analyser) {
        this.analyser = new Tone.Analyser('fft', 64);
      }
      if (this.connectedToneNode !== targetNode) {
        targetNode.connect(this.analyser);
        this.connectedToneNode = targetNode;
      }
      return true;
    } catch (err) {
      console.warn('[HEVOS STUDIO Analyser]', err);
      return false;
    }
  }

  setExternalEnergyProvider(fn) {
    this.externalEnergyProvider = typeof fn === 'function' ? fn : null;
  }

  setSection(section) {
    this.section = section || 'hub';
    const isHub = this.section === 'hub';
    this.targetIntensity = isHub ? 1.0 : 0.30;
    this.targetCamZ = isHub
      ? (this.isMobile ? 7.8 : 6.2)
      : (this.isMobile ? 10.8 : 9.6);
    this.targetOrbScale = isHub ? 1.0 : 0.84;
    this._updateScrollTarget();
    this._dirtyRender = true;
    this._startLoop();
  }

  wake() {
    if (!this.supported || this.disposed || this._paused) return;
    this._startLoop();
  }

  _sampleAudio(dt) {
    let rawBass = 0;
    let rawMid = 0;
    let rawHigh = 0;
    let hasToneSignal = false;

    if (this.analyser && window.Tone?.context?.state === 'running') {
      try {
        const vals = this.analyser.getValue();
        if (vals && vals.length >= 32) {
          const len = Math.min(64, vals.length);
          for (let i = 0; i < len; i++) {
            const db = Number.isFinite(vals[i]) ? vals[i] : -100;
            const norm = THREE.MathUtils.clamp((db + 92) / 72, 0, 1);
            this.audio.bins[i] = THREE.MathUtils.lerp(this.audio.bins[i], norm, 0.35);
            if (norm > 0.02) hasToneSignal = true;
          }
          for (let i = 0; i < 8; i++) rawBass += this.audio.bins[i];
          for (let i = 8; i < 24; i++) rawMid += this.audio.bins[i];
          for (let i = 24; i < 48; i++) rawHigh += this.audio.bins[i];
          rawBass /= 8;
          rawMid /= 16;
          rawHigh /= 24;
        }
      } catch (_) {}
    }

    let extLvl = 0;
    if (this.externalEnergyProvider) {
      try {
        extLvl = THREE.MathUtils.clamp(Number(this.externalEnergyProvider()) || 0, 0, 1);
      } catch (_) {}
    }

    if (extLvl > 0.01 && !hasToneSignal) {
      rawBass = Math.max(rawBass, extLvl * 0.88);
      rawMid = Math.max(rawMid, extLvl * 0.96);
      rawHigh = Math.max(rawHigh, extLvl * 0.68);
    }

    const combined = Math.max(rawBass * 0.45 + rawMid * 0.4 + rawHigh * 0.15, extLvl * 0.9);
    const atk = Math.min(1, dt * 14);
    const rel = Math.min(1, dt * 6);

    this.audio.bass = THREE.MathUtils.lerp(this.audio.bass, rawBass, rawBass > this.audio.bass ? atk : rel);
    this.audio.mid = THREE.MathUtils.lerp(this.audio.mid, rawMid, rawMid > this.audio.mid ? atk : rel);
    this.audio.high = THREE.MathUtils.lerp(this.audio.high, rawHigh, rawHigh > this.audio.high ? atk : rel);
    this.audio.energy = THREE.MathUtils.lerp(
      this.audio.energy,
      combined,
      combined > this.audio.energy ? atk : rel
    );
  }

  _updateSceneTransforms(t, dt) {
    const { energy, bass, mid, high } = this.audio;
    const intensity = this.currentIntensity;

    // Biến đổi ma trận GPU cho khối cầu (không duyệt đỉnh CPU)
    const breathe = 1 + Math.sin(t * 1.4) * 0.018;
    const baseScale = this.currentOrbScale * breathe;
    const sx = baseScale * (1 + bass * 0.13 + Math.sin(t * 2.1) * (0.012 + mid * 0.03));
    const sy = baseScale * (1 + mid * 0.11 + Math.cos(t * 1.8) * (0.012 + bass * 0.03));
    const sz = baseScale * (1 + high * 0.09 + Math.sin(t * 1.6) * 0.012);
    this.orbGroup.scale.set(sx, sy, sz);

    this.coreMat.opacity = THREE.MathUtils.clamp(0.42 + intensity * 0.52, 0.25, 0.96);
    this.wireMat.opacity = THREE.MathUtils.clamp((0.40 + energy * 0.42) * intensity, 0.14, 0.88);
    this.wireMesh.rotation.y -= dt * (0.08 + energy * 0.16);

    const scrollAngle = this.scrollCurrent * 0.85;
    this.orbGroup.rotation.y += dt * (0.14 + energy * 0.26);
    this.orbGroup.rotation.x = THREE.MathUtils.lerp(
      this.orbGroup.rotation.x,
      this.pointer.ty * 0.26 + scrollAngle * 0.24,
      0.08
    );
    this.orbGroup.rotation.z = THREE.MathUtils.lerp(
      this.orbGroup.rotation.z,
      -this.pointer.tx * 0.16 + Math.sin(t * 0.25) * 0.07,
      0.08
    );

    const scrollShiftX = this.section === 'hub' && !this.isMobile
      ? Math.sin(this.scrollCurrent * Math.PI * 2.2) * 1.0
      : 0;
    const scrollShiftY = this.section === 'hub' ? -this.scrollCurrent * 0.35 : 0;
    this.orbGroup.position.x = THREE.MathUtils.lerp(this.orbGroup.position.x, scrollShiftX, 0.08);
    this.orbGroup.position.y = THREE.MathUtils.lerp(this.orbGroup.position.y, scrollShiftY, 0.08);

    // 3 vòng quỹ đạo tần số biến đổi hoàn toàn trên GPU
    for (let rIdx = 0; rIdx < this.orbitRings.length; rIdx++) {
      const ring = this.orbitRings[rIdx];
      const bandLvl = ring.cfg.band === 'bass' ? bass : ring.cfg.band === 'mid' ? mid : high;

      ring.group.rotation.z += dt * (ring.cfg.speed + bandLvl * 0.4 * Math.sign(ring.cfg.speed));
      ring.group.rotation.x = ring.cfg.tiltX + Math.sin(t * 0.35 + rIdx) * 0.06 + this.pointer.ty * 0.08;
      ring.group.rotation.y = ring.cfg.tiltY + Math.cos(t * 0.28 + rIdx) * 0.06 + this.pointer.tx * 0.08;
      ring.group.scale.setScalar(1 + bandLvl * 0.07);

      ring.lineMat.opacity = THREE.MathUtils.clamp(
        (ring.cfg.opacity + bandLvl * 0.32) * intensity,
        0.12,
        0.92
      );
      ring.dotMat.opacity = THREE.MathUtils.clamp(
        (ring.cfg.opacity * 1.1 + bandLvl * 0.32) * intensity,
        0.15,
        0.98
      );
    }

    for (let i = 0; i < this.auraSprites.length; i++) {
      const sp = this.auraSprites[i];
      sp.material.opacity = sp.userData.baseOpacity * (0.28 + intensity * 0.74) * (1 + energy * 0.22);
      const s = sp.userData.baseScale * (1 + energy * 0.10);
      sp.scale.set(s, s, 1);
    }

    if (this.dustPoints && this.dustMat) {
      this.dustPoints.rotation.y = t * 0.018 + this.pointer.x * 0.05;
      this.dustPoints.rotation.x = this.pointer.y * 0.03;
      this.dustMat.opacity = THREE.MathUtils.clamp((0.35 + intensity * 0.55) * (1 + energy * 0.25), 0.18, 0.95);
    }
  }

  _stepFrame(dt) {
    this._elapsed += dt;

    if (!this.analyser && window.Tone?.context?.state === 'running') {
      this.connectTone(this.connectedToneNode);
    }

    this._sampleAudio(dt);

    const lerpStep = Math.min(1, dt * 6.5);
    this.currentIntensity = THREE.MathUtils.lerp(this.currentIntensity, this.targetIntensity, lerpStep);
    this.currentCamZ = THREE.MathUtils.lerp(this.currentCamZ, this.targetCamZ, lerpStep);
    this.currentOrbScale = THREE.MathUtils.lerp(this.currentOrbScale, this.targetOrbScale, lerpStep);

    this.pointer.x = THREE.MathUtils.lerp(this.pointer.x, this.pointer.tx, lerpStep);
    this.pointer.y = THREE.MathUtils.lerp(this.pointer.y, this.pointer.ty, lerpStep);
    this.scrollCurrent = THREE.MathUtils.lerp(this.scrollCurrent, this.scrollTarget, lerpStep);

    const targetCamX = this.pointer.x * (this.section === 'hub' ? 0.50 : 0.20);
    const targetCamY = -this.pointer.y * (this.section === 'hub' ? 0.34 : 0.15) - this.scrollCurrent * 0.42;
    const targetCamZ = this.currentCamZ - (this.section === 'hub' ? this.scrollCurrent * 0.68 : 0);

    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCamX, lerpStep);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCamY, lerpStep);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetCamZ, lerpStep);
    this.camera.lookAt(this.orbGroup.position.x * 0.35, this.orbGroup.position.y * 0.35, 0);

    this._updateSceneTransforms(this._elapsed, dt);
    this.renderer.render(this.scene, this.camera);
    this._dirtyRender = false;
  }

  _renderOnce() {
    if (!this.supported || !this.renderer || !this.scene || !this.camera) return;
    this._stepFrame(0.016);
  }

  _tick = (now) => {
    this._rafId = null;
    if (this.disposed || this._paused) return;

    const deltaMs = now - this._lastFrameMs;
    const dt = Math.min(0.05, Math.max(0.001, deltaMs / 1000));
    this._lastFrameMs = now;

    this._stepFrame(dt);
    this._rafId = requestAnimationFrame(this._tick);
  };

  _startLoop() {
    if (!this.supported || this.disposed || this._paused || this._rafId !== null) return;
    this._lastFrameMs = performance.now();
    this._rafId = requestAnimationFrame(this._tick);
  }

  _stopLoop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  dispose() {
    this.disposed = true;
    this._stopLoop();
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this._onPointerMove) window.removeEventListener('pointermove', this._onPointerMove);
    if (this._onScroll) {
      if (this.hubScrollEl) this.hubScrollEl.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('scroll', this._onScroll);
    }
    if (this._onVisibility) document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.renderer) {
      try {
        this.renderer.dispose();
      } catch (_) {}
    }
  }
}

export function createAmbientScene(canvas, options = {}) {
  return new AmbientAudioScene(canvas, options);
}
