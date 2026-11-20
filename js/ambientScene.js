// ============================================================================
// ambientScene.js — Không gian Âm thanh 3D Rực rỡ & Cảm ứng Nhạc (Three.js)
// - Khối cầu sóng âm 3D (Harmonic Soundwave Orb) biến dạng theo sóng sin & FFT
// - 3 Vòng quỹ đạo tần số nghiêng góc nghệ thuật + hàng trăm hạt bụi sáng có chiều sâu
// - Ánh sáng phòng thu analog: tím indigo (#311068), hồng magenta (#BE185D), cam hổ phách (#F97316)
// - Cảm ứng trực tiếp với Tone.Analyser (Sáng tác Beat/Học nhạc) & VocalStudio
// - Ngữ cảnh thông minh: rực rỡ ở Tổng quan, tự dịu & lùi xa ở 3 phòng làm việc
// - Parallax chuột & cuộn trang mượt mà (THREE.MathUtils.lerp), khóa pixelRatio <= 1.5
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
  grad.addColorStop(0.35, midRgba);
  grad.addColorStop(1, outerRgba);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function extractUniquePoints(geometry) {
  const pos = geometry.attributes.position;
  const seen = new Set();
  const unique = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(x, y, z);
    }
  }
  return new Float32Array(unique);
}

export class AmbientAudioScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.hubScrollEl = options.hubScrollEl || null;
    this.supported = false;
    this.disposed = false;

    this.section = 'hub';
    this.isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    // Ngữ cảnh & chuyển động nội suy
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

    // Cảm ứng âm thanh
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
    this._lastTime = 0;
    this._elapsed = 0;
    this._paused = false;

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
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.18;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#08090F');
      this.scene.fog = new THREE.FogExp2('#08090F', 0.044);

      this.camera = new THREE.PerspectiveCamera(
        48,
        Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight),
        0.1,
        60
      );
      this.camera.position.set(0, 0, this.currentCamZ);

      this._buildLightsAndAuras();
      this._buildSoundwaveOrb();
      this._buildOrbitRings();
      this._buildDepthAudioDust();

      this._bindEvents();
      this.supported = true;
      this._lastTime = performance.now();
      this._startLoop();
    } catch (err) {
      console.warn('[HEVOS STUDIO 3D Fallback]', err);
      this.supported = false;
    }
  }

  _buildLightsAndAuras() {
    this.ambientLight = new THREE.AmbientLight('#271E4A', 0.9);
    this.scene.add(this.ambientLight);

    // 3 nguồn sáng điểm phòng thu analog: Tím Indigo, Hồng Magenta, Cam Hổ Phách
    this.lightIndigo = new THREE.PointLight('#6D28D9', 5.2, 22, 1.6);
    this.lightIndigo.position.set(-3.8, 2.2, 2.8);
    this.scene.add(this.lightIndigo);

    this.lightMagenta = new THREE.PointLight('#BE185D', 5.8, 22, 1.6);
    this.lightMagenta.position.set(3.4, -1.8, 3.2);
    this.scene.add(this.lightMagenta);

    this.lightAmber = new THREE.PointLight('#F97316', 4.6, 20, 1.7);
    this.lightAmber.position.set(0.4, 3.2, 2.4);
    this.scene.add(this.lightAmber);

    // Hào quang chuyển sắc ở hậu cảnh (không dùng texture ảnh ngoài)
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

    this.auraSprites = [
      makeAuraSprite('rgba(91, 33, 182, 0.78)', 'rgba(49, 16, 104, 0.34)', 11.5, -2.1, 1.1, -3.4, 0.72),
      makeAuraSprite('rgba(236, 72, 153, 0.68)', 'rgba(190, 24, 93, 0.28)', 9.8, 2.2, -0.9, -2.9, 0.62),
      makeAuraSprite('rgba(249, 115, 22, 0.56)', 'rgba(249, 115, 22, 0.18)', 8.4, 0.3, 1.8, -3.8, 0.46),
    ];
  }

  _buildSoundwaveOrb() {
    this.orbGroup = new THREE.Group();
    this.scene.add(this.orbGroup);

    // 1. Lõi cầu ánh kim biến dạng mềm
    const coreGeo = new THREE.SphereGeometry(1.32, this.isMobile ? 28 : 42, this.isMobile ? 20 : 30);
    this.coreBasePos = new Float32Array(coreGeo.attributes.position.array);
    this.coreMat = new THREE.MeshStandardMaterial({
      color: '#17102E',
      emissive: '#311068',
      emissiveIntensity: 0.75,
      roughness: 0.26,
      metalness: 0.68,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, this.coreMat);
    this.orbGroup.add(this.coreMesh);

    // 2. Lưới sóng âm chuyển sắc rực rỡ (Geodesic Wireframe)
    const detail = this.isMobile ? 2 : 3;
    const wireGeo = new THREE.IcosahedronGeometry(1.5, detail);
    this.wireBasePos = new Float32Array(wireGeo.attributes.position.array);

    const vCount = wireGeo.attributes.position.count;
    const colors = new Float32Array(vCount * 3);
    const colIndigo = new THREE.Color('#6D28D9');
    const colMagenta = new THREE.Color('#EC4899');
    const colAmber = new THREE.Color('#F97316');
    const tmp = new THREE.Color();

    for (let i = 0; i < vCount; i++) {
      const py = this.wireBasePos[i * 3 + 1] / 1.5; // [-1 .. 1]
      const px = this.wireBasePos[i * 3] / 1.5;
      const t = THREE.MathUtils.clamp((py + 1) * 0.5 + px * 0.15, 0, 1);
      if (t < 0.52) {
        tmp.copy(colIndigo).lerp(colMagenta, t / 0.52);
      } else {
        tmp.copy(colMagenta).lerp(colAmber, (t - 0.52) / 0.48);
      }
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    wireGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.wireMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.wireMesh = new THREE.Mesh(wireGeo, this.wireMat);
    this.orbGroup.add(this.wireMesh);

    // 3. Lớp hạt năng lượng phát sáng bao quanh khối cầu
    const shellSourceGeo = new THREE.IcosahedronGeometry(1.62, this.isMobile ? 2 : 3);
    const uniqueShell = extractUniquePoints(shellSourceGeo);
    shellSourceGeo.dispose();

    this.shellBasePos = uniqueShell;
    const shellVertCount = uniqueShell.length / 3;
    const shellColors = new Float32Array(uniqueShell.length);
    for (let i = 0; i < shellVertCount; i++) {
      const py = uniqueShell[i * 3 + 1] / 1.62;
      const t = THREE.MathUtils.clamp((py + 1) * 0.5, 0, 1);
      if (t < 0.5) {
        tmp.copy(colIndigo).lerp(colMagenta, t * 2);
      } else {
        tmp.copy(colMagenta).lerp(colAmber, (t - 0.5) * 2);
      }
      shellColors[i * 3] = tmp.r;
      shellColors[i * 3 + 1] = tmp.g;
      shellColors[i * 3 + 2] = tmp.b;
    }

    const shellGeo = new THREE.BufferGeometry();
    shellGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uniqueShell), 3));
    shellGeo.setAttribute('color', new THREE.BufferAttribute(shellColors, 3));

    const dotTex = createSoftGlowTexture(
      'rgba(255, 255, 255, 1)',
      'rgba(255, 210, 240, 0.55)',
      'rgba(255, 255, 255, 0)'
    );
    this.shellMat = new THREE.PointsMaterial({
      size: this.isMobile ? 0.085 : 0.075,
      map: dotTex,
      vertexColors: true,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shellPoints = new THREE.Points(shellGeo, this.shellMat);
    this.orbGroup.add(this.shellPoints);
  }

  _buildOrbitRings() {
    this.orbitRings = [];
    const ringConfigs = [
      {
        radius: 2.38,
        color: '#EC4899',
        tiltX: 0.96,
        tiltY: 0.42,
        tiltZ: -0.25,
        speed: 0.24,
        band: 'bass',
        opacity: 0.68,
      },
      {
        radius: 3.12,
        color: '#F97316',
        tiltX: -0.78,
        tiltY: -0.56,
        tiltZ: 0.48,
        speed: -0.18,
        band: 'mid',
        opacity: 0.56,
      },
      {
        radius: 3.92,
        color: '#7C3AED',
        tiltX: 0.46,
        tiltY: -0.82,
        tiltZ: 0.72,
        speed: 0.13,
        band: 'high',
        opacity: 0.52,
      },
    ];

    const segs = this.isMobile ? 96 : 168;
    const dotTex = createSoftGlowTexture(
      'rgba(255, 255, 255, 1)',
      'rgba(255, 255, 255, 0.45)',
      'rgba(255, 255, 255, 0)'
    );

    for (const cfg of ringConfigs) {
      const group = new THREE.Group();
      group.rotation.set(cfg.tiltX, cfg.tiltY, cfg.tiltZ);

      const baseAngles = new Float32Array(segs);
      const linePos = new Float32Array(segs * 3);
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        baseAngles[i] = a;
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

      // Các hạt sáng dọc vòng quỹ đạo
      const dotCount = this.isMobile ? 24 : 42;
      const dotPos = new Float32Array(dotCount * 3);
      const dotAngles = new Float32Array(dotCount);
      for (let i = 0; i < dotCount; i++) {
        const a = (i / dotCount) * Math.PI * 2;
        dotAngles[i] = a;
        dotPos[i * 3] = Math.cos(a) * cfg.radius;
        dotPos[i * 3 + 1] = Math.sin(a) * cfg.radius;
        dotPos[i * 3 + 2] = 0;
      }
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
      const dotMat = new THREE.PointsMaterial({
        size: this.isMobile ? 0.08 : 0.072,
        color: cfg.color,
        map: dotTex,
        transparent: true,
        opacity: cfg.opacity * 1.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const points = new THREE.Points(dotGeo, dotMat);
      group.add(points);

      this.orbGroup.add(group);
      this.orbitRings.push({
        cfg,
        group,
        lineGeo,
        lineMat,
        baseAngles,
        dotGeo,
        dotMat,
        dotAngles,
      });
    }
  }

  _buildDepthAudioDust() {
    const count = this.isMobile ? 165 : 480;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);

    const palette = [
      new THREE.Color('#7C3AED'),
      new THREE.Color('#BE185D'),
      new THREE.Color('#F97316'),
      new THREE.Color('#E9D5FF'),
    ];

    for (let i = 0; i < count; i++) {
      // Trải rộng chiều sâu z từ -10.5 (xa mờ) đến +4.2 (gần sáng rõ)
      const z = THREE.MathUtils.lerp(-10.5, 4.2, Math.random());
      const spreadX = 11.5;
      const spreadY = 7.5;
      positions[i * 3] = (Math.random() - 0.5) * spreadX * 2;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spreadY * 2;
      positions[i * 3 + 2] = z;

      const c = palette[i % palette.length];
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      sizes[i] = 0.7 + Math.random() * 1.5;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.dustUniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
      uAudioEnergy: { value: 0 },
      uBrightness: { value: 1.0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uAudioEnergy;
        varying vec3 vColor;
        varying float vDepthAlpha;
        void main() {
          vColor = aColor;
          vec3 p = position;
          p.y += sin(uTime * 0.45 + aPhase) * (0.28 + uAudioEnergy * 0.25);
          p.x += cos(uTime * 0.34 + aPhase * 1.3) * 0.22;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          float dist = max(1.2, -mvPosition.z);
          // Xa mờ, gần sáng rõ
          vDepthAlpha = clamp(1.25 - (dist / 16.5), 0.14, 1.0);
          float pulse = 1.0 + uAudioEnergy * 0.48 * (0.6 + 0.4 * sin(uTime * 3.0 + aPhase));
          gl_PointSize = aSize * pulse * uPixelRatio * (52.0 / dist);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uBrightness;
        varying vec3 vColor;
        varying float vDepthAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          // Hạt xa tản mềm (bokeh), hạt gần tâm sáng sắc nét
          float softness = mix(1.4, 3.2, vDepthAlpha);
          float glow = pow(max(0.0, 1.0 - d * 2.0), softness);
          float alpha = glow * vDepthAlpha * uBrightness * 0.85;
          gl_FragColor = vec4(vColor * (0.85 + vDepthAlpha * 0.5), alpha);
        }
      `,
    });

    this.dustPoints = new THREE.Points(geo, mat);
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
      if (!this._paused) {
        this._lastTime = performance.now();
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
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.isMobile = w < 768;
    const pr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.dustUniforms) {
      this.dustUniforms.uPixelRatio.value = pr;
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.setSection(this.section);
  }

  /**
   * Kết nối nhẹ đầu ra Tone.js (read-only) qua Tone.Analyser('fft', 64)
   */
  connectTone(masterNode = null) {
    if (!this.supported || typeof window.Tone === 'undefined') return false;
    const Tone = window.Tone;
    if (!Tone.context || Tone.context.state !== 'running') return false;

    const targetNode = masterNode || (typeof Tone.getDestination === 'function' ? Tone.getDestination() : null);
    if (!targetNode || typeof targetNode.connect !== 'function') return false;

    if (this.analyser && this.connectedToneNode === targetNode) {
      return true;
    }

    try {
      if (this.analyser) {
        try {
          if (this.connectedToneNode) this.connectedToneNode.disconnect(this.analyser);
        } catch (_) {}
        try {
          this.analyser.dispose();
        } catch (_) {}
      }
      this.analyser = new Tone.Analyser('fft', 64);
      targetNode.connect(this.analyser);
      this.connectedToneNode = targetNode;
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

    // Kết hợp mức âm lượng thực từ VocalStudio (Native AudioContext)
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
      for (let i = 0; i < 64; i++) {
        const shape = 0.55 + 0.45 * Math.sin(this._elapsed * 5.2 + i * 0.38);
        this.audio.bins[i] = THREE.MathUtils.lerp(this.audio.bins[i], extLvl * shape, 0.28);
      }
    } else if (!hasToneSignal && extLvl <= 0.01) {
      for (let i = 0; i < 64; i++) {
        this.audio.bins[i] = THREE.MathUtils.lerp(this.audio.bins[i], 0, 0.12);
      }
    }

    const combined = Math.max(rawBass * 0.45 + rawMid * 0.4 + rawHigh * 0.15, extLvl * 0.9);
    const atk = Math.min(1, dt * 14);
    const rel = Math.min(1, dt * 5.5);

    this.audio.bass = THREE.MathUtils.lerp(this.audio.bass, rawBass, rawBass > this.audio.bass ? atk : rel);
    this.audio.mid = THREE.MathUtils.lerp(this.audio.mid, rawMid, rawMid > this.audio.mid ? atk : rel);
    this.audio.high = THREE.MathUtils.lerp(this.audio.high, rawHigh, rawHigh > this.audio.high ? atk : rel);
    this.audio.energy = THREE.MathUtils.lerp(
      this.audio.energy,
      combined,
      combined > this.audio.energy ? atk : rel
    );
  }

  _deformVertexArray(srcArr, dstAttr, radiusScale, t, bass, mid) {
    const arr = dstAttr.array;
    const count = srcArr.length / 3;
    const amp = 0.055 + bass * 0.17 + mid * 0.10;
    const freqTime = t * (1.25 + bass * 1.4);

    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const bx = srcArr[ix];
      const by = srcArr[ix + 1];
      const bz = srcArr[ix + 2];

      const wave1 = Math.sin(bx * 2.4 + freqTime) * Math.cos(by * 2.1 - freqTime * 0.85);
      const wave2 = Math.sin((bz + by) * 3.1 + freqTime * 1.35) * 0.55;
      const disp = 1 + (wave1 + wave2) * amp;
      const k = disp * radiusScale;

      arr[ix] = bx * k;
      arr[ix + 1] = by * k;
      arr[ix + 2] = bz * k;
    }
    dstAttr.needsUpdate = true;
  }

  _updateOrbAndRings(t, dt) {
    const { energy, bass, mid, high, bins } = this.audio;
    const intensity = this.currentIntensity;

    // Nhịp thở & biến dạng khối cầu sóng âm
    const pulseScale = this.currentOrbScale * (1 + bass * 0.11 + energy * 0.05);
    this.orbGroup.scale.setScalar(pulseScale);

    this._deformVertexArray(
      this.coreBasePos,
      this.coreMesh.geometry.attributes.position,
      1.0,
      t,
      bass,
      mid
    );
    this._deformVertexArray(
      this.wireBasePos,
      this.wireMesh.geometry.attributes.position,
      1.0,
      t,
      bass,
      mid
    );
    this._deformVertexArray(
      this.shellBasePos,
      this.shellPoints.geometry.attributes.position,
      1.0 + energy * 0.04,
      t * 1.06,
      bass,
      mid
    );

    this.coreMat.emissiveIntensity = (0.55 + energy * 0.95) * (0.45 + intensity * 0.65);
    this.wireMat.opacity = THREE.MathUtils.clamp((0.42 + energy * 0.45) * intensity, 0.14, 0.9);
    this.shellMat.opacity = THREE.MathUtils.clamp((0.76 + energy * 0.24) * intensity, 0.2, 0.98);

    // Xoay nhẹ toàn khối cầu + Parallax chuột & cuộn trang
    const scrollAngle = this.scrollCurrent * 0.85;
    this.orbGroup.rotation.y += dt * (0.14 + energy * 0.28);
    this.orbGroup.rotation.x = THREE.MathUtils.lerp(
      this.orbGroup.rotation.x,
      this.pointer.ty * 0.28 + scrollAngle * 0.25,
      0.06
    );
    this.orbGroup.rotation.z = THREE.MathUtils.lerp(
      this.orbGroup.rotation.z,
      -this.pointer.tx * 0.18 + Math.sin(t * 0.25) * 0.08,
      0.06
    );

    // Đẩy nhẹ orb qua các chương khi cuộn trang trên sảnh Tổng quan
    const scrollShiftX = this.section === 'hub' && !this.isMobile
      ? Math.sin(this.scrollCurrent * Math.PI * 2.2) * 1.05
      : 0;
    const scrollShiftY = this.section === 'hub'
      ? -this.scrollCurrent * 0.35
      : 0;
    this.orbGroup.position.x = THREE.MathUtils.lerp(this.orbGroup.position.x, scrollShiftX, 0.05);
    this.orbGroup.position.y = THREE.MathUtils.lerp(this.orbGroup.position.y, scrollShiftY, 0.05);

    // 3 Vòng quỹ đạo tần số biến dạng theo FFT
    for (let rIdx = 0; rIdx < this.orbitRings.length; rIdx++) {
      const ring = this.orbitRings[rIdx];
      const bandLvl = ring.cfg.band === 'bass' ? bass : ring.cfg.band === 'mid' ? mid : high;

      ring.group.rotation.z += dt * (ring.cfg.speed + bandLvl * 0.45 * Math.sign(ring.cfg.speed));
      ring.group.rotation.x = ring.cfg.tiltX + Math.sin(t * 0.35 + rIdx) * 0.08 + this.pointer.ty * 0.09;
      ring.group.rotation.y = ring.cfg.tiltY + Math.cos(t * 0.28 + rIdx) * 0.08 + this.pointer.tx * 0.09;

      const linePos = ring.lineGeo.attributes.position;
      const lArr = linePos.array;
      const segs = ring.baseAngles.length;
      const binOffset = rIdx * 16;

      for (let i = 0; i < segs; i++) {
        const a = ring.baseAngles[i];
        const binVal = bins[(binOffset + (i % 16)) % 64];
        const harmonic = Math.sin(a * (4 + rIdx * 2) + t * (2.1 + rIdx * 0.6)) * (0.045 + bandLvl * 0.24);
        const fftRipple = binVal * 0.22;
        const r = ring.cfg.radius + harmonic + fftRipple;
        lArr[i * 3] = Math.cos(a) * r;
        lArr[i * 3 + 1] = Math.sin(a) * r;
        lArr[i * 3 + 2] = Math.cos(a * 3 - t * 1.4) * (0.04 + bandLvl * 0.16);
      }
      linePos.needsUpdate = true;

      const dotPos = ring.dotGeo.attributes.position;
      const dArr = dotPos.array;
      const dCount = ring.dotAngles.length;
      for (let i = 0; i < dCount; i++) {
        const a = ring.dotAngles[i];
        const binVal = bins[(binOffset + (i % 16)) % 64];
        const harmonic = Math.sin(a * (4 + rIdx * 2) + t * (2.1 + rIdx * 0.6)) * (0.045 + bandLvl * 0.24);
        const r = ring.cfg.radius + harmonic + binVal * 0.22;
        dArr[i * 3] = Math.cos(a) * r;
        dArr[i * 3 + 1] = Math.sin(a) * r;
        dArr[i * 3 + 2] = Math.cos(a * 3 - t * 1.4) * (0.04 + bandLvl * 0.16);
      }
      dotPos.needsUpdate = true;

      ring.lineMat.opacity = THREE.MathUtils.clamp(
        (ring.cfg.opacity + bandLvl * 0.35) * intensity,
        0.12,
        0.95
      );
      ring.dotMat.opacity = THREE.MathUtils.clamp(
        (ring.cfg.opacity * 1.15 + bandLvl * 0.35) * intensity,
        0.16,
        1.0
      );
    }

    // Ánh sáng & Hào quang phòng thu
    this.lightIndigo.intensity = (4.8 + bass * 3.8) * (0.35 + intensity * 0.72);
    this.lightMagenta.intensity = (5.2 + mid * 4.2) * (0.35 + intensity * 0.72);
    this.lightAmber.intensity = (4.2 + high * 3.5) * (0.35 + intensity * 0.72);

    this.lightIndigo.position.x = -3.8 + Math.sin(t * 0.4) * 0.7;
    this.lightMagenta.position.y = -1.8 + Math.cos(t * 0.5) * 0.7;
    this.lightAmber.position.x = 0.4 + Math.cos(t * 0.35) * 0.9;

    for (let i = 0; i < this.auraSprites.length; i++) {
      const sp = this.auraSprites[i];
      sp.material.opacity = sp.userData.baseOpacity * (0.28 + intensity * 0.78) * (1 + energy * 0.28);
      const s = sp.userData.baseScale * (1 + energy * 0.14);
      sp.scale.set(s, s, 1);
    }
  }

  _tick = (now) => {
    if (this.disposed || this._paused) {
      this._rafId = null;
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - this._lastTime) / 1000));
    this._lastTime = now;
    this._elapsed += dt;

    // Thử gắn lại Tone.Analyser nếu context vừa mới resume sau thao tác đầu tiên
    if (!this.analyser && window.Tone?.context?.state === 'running') {
      this.connectTone(this.connectedToneNode);
    }

    this._sampleAudio(dt);

    // Nội suy mượt trạng thái ngữ cảnh, chuột & cuộn
    this.currentIntensity = THREE.MathUtils.lerp(this.currentIntensity, this.targetIntensity, 0.05);
    this.currentCamZ = THREE.MathUtils.lerp(this.currentCamZ, this.targetCamZ, 0.055);
    this.currentOrbScale = THREE.MathUtils.lerp(this.currentOrbScale, this.targetOrbScale, 0.055);

    this.pointer.x = THREE.MathUtils.lerp(this.pointer.x, this.pointer.tx, 0.06);
    this.pointer.y = THREE.MathUtils.lerp(this.pointer.y, this.pointer.ty, 0.06);
    this.scrollCurrent = THREE.MathUtils.lerp(this.scrollCurrent, this.scrollTarget, 0.07);

    // Camera parallax mượt (tiến sâu nhẹ & nghiêng theo cuộn + chuột)
    const targetCamX = this.pointer.x * (this.section === 'hub' ? 0.52 : 0.22);
    const targetCamY = -this.pointer.y * (this.section === 'hub' ? 0.36 : 0.16) - this.scrollCurrent * 0.45;
    const targetCamZ = this.currentCamZ - (this.section === 'hub' ? this.scrollCurrent * 0.72 : 0);

    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCamX, 0.07);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCamY, 0.07);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, targetCamZ, 0.07);
    this.camera.lookAt(this.orbGroup.position.x * 0.35, this.orbGroup.position.y * 0.35, 0);

    this._updateOrbAndRings(this._elapsed, dt);

    if (this.dustUniforms) {
      this.dustUniforms.uTime.value = this._elapsed;
      this.dustUniforms.uAudioEnergy.value = this.audio.energy;
      this.dustUniforms.uBrightness.value = 0.28 + this.currentIntensity * 0.75;
    }
    if (this.dustPoints) {
      this.dustPoints.rotation.y = this._elapsed * 0.018 + this.pointer.x * 0.06;
      this.dustPoints.rotation.x = this.pointer.y * 0.04;
    }

    this.renderer.render(this.scene, this.camera);
    this._rafId = requestAnimationFrame(this._tick);
  };

  _startLoop() {
    if (this.disposed || this._paused || this._rafId !== null) return;
    this._rafId = requestAnimationFrame(this._tick);
  }

  dispose() {
    this.disposed = true;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
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
