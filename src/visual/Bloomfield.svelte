<script>
  // SOURCE: https://iquilezles.org/articles/warp/ (domain warping, verbatim: q=vec2(fbm(p+vec2(0,0)),fbm(p+vec2(5.2,1.3))); return fbm(p+4*q))
  // SOURCE: three.js 0.184.0 (npm), Points + ShaderMaterial + AdditiveBlending
  // Art direction: aurora + domain-warped fbm + glow points. EffectComposer and UnrealBloomPass removed
  // for performance; glow is baked into the point shader and an additive-blended bg.

  import * as THREE from 'three';
  import { onNote, onBloom } from '../audio/events.js';

  let { mood = null } = $props();

  let hostEl;
  let disposed = false;
  let raf = 0;
  let renderer = null;
  let scene = null;
  let camera = null;
  let bgScene = null;
  let bgCam = null;
  let bgMat = null;
  let points = null;
  let pointsMat = null;
  let posAttr, sizeAttr, bornAttr, lifeAttr, hueAttr, velAttr;
  const ORB_COUNT = 128;
  let orbIdx = 0;
  let moodRef = mood;
  let clock;
  let unsubscribeNote = null;
  let unsubscribeBloom = null;
  const mouse = { x: 0, y: 0, active: false };
  let mouseSmoothed = { x: 0, y: 0 };
  let moodDwellStart = performance.now();
  let lastMoodLabel = null;
  const ambient = [];
  const AMBIENT_COUNT = 32;

  const bgVertex = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  // Four-style neon shader that continuously blends between aesthetic programs:
  //  style 0 = aurora warp (Inigo Quilez domain warping)
  //  style 1 = neon tunnel (radial SDF rings, log-polar)
  //  style 2 = plasma grid (retro-futuristic wireframe)
  //  style 3 = flow field (curl-noise streaks)
  // Palette is forced to high saturation and uAccent is hue-rotated by uHueDrift which itself
  // advances over time, so the scene is never visually static even when no notes fire.
  const bgFragment = `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform float uEnergy;
    uniform float uStyle;
    uniform float uHueDrift;
    uniform float uUnlocked;
    uniform vec3 uAccent;
    uniform vec3 uDeep;
    uniform vec3 uMid;
    uniform vec2 uMouse;

    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.55;
      mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
      for (int i = 0; i < 6; i++) { v += a * noise(p); p = rot * p * 2.03 + vec2(1.7, -0.9); a *= 0.5; }
      return v;
    }

    vec3 hsl2rgb(float h, float s, float l) {
      vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      float c = (1.0 - abs(2.0 * l - 1.0)) * s;
      return l + c * (rgb - 0.5);
    }
    vec3 rgb2hsl(vec3 c) {
      float mx = max(max(c.r, c.g), c.b);
      float mn = min(min(c.r, c.g), c.b);
      float l = (mx + mn) * 0.5;
      float h = 0.0, s = 0.0;
      if (mx != mn) {
        float d = mx - mn;
        s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
        if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
        else h = (c.r - c.g) / d + 4.0;
        h /= 6.0;
      }
      return vec3(h, s, l);
    }

    vec3 neonize(vec3 c) {
      vec3 hsl = rgb2hsl(c);
      hsl.x = fract(hsl.x + uHueDrift);
      hsl.y = 1.0;
      hsl.z = clamp(hsl.z * 1.1, 0.45, 0.7);
      return hsl2rgb(hsl.x, hsl.y, hsl.z);
    }

    // IQ domain warping f(p+4r) with r = f(p+4q), q = f(p).
    float warped(vec2 p, out vec2 q, out vec2 r) {
      q = vec2(fbm(p + vec2(0.0, 0.0)), fbm(p + vec2(5.2, 1.3)));
      r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.15 * uTime),
               fbm(p + 4.0 * q + vec2(8.3, 2.8) + 0.126 * uTime));
      return fbm(p + 4.0 * r);
    }

    vec3 styleAurora(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(1.8, 1.0) + uMouse * 0.3;
      p.y += uTime * 0.04;
      vec2 q, r;
      float f = warped(p * 2.0, q, r);
      vec3 a = neonize(uAccent);
      vec3 b = neonize(uMid);
      vec3 col = mix(uDeep * 0.4, b, smoothstep(0.0, 0.8, f));
      col = mix(col, a, smoothstep(0.15, 0.9, length(r) * 0.7));
      // vertical curtains
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float ns = noise(vec2(uv.x * 2.0 + uTime * 0.08 + fk * 17.0, uTime * 0.05));
        float band = smoothstep(0.12, 0.0, abs(uv.y - 0.55 + (ns - 0.5) * 0.45 - fk * 0.1));
        col += a * band * 0.9;
      }
      return col;
    }

    vec3 styleTunnel(vec2 uv) {
      vec2 p = (uv - 0.5) * 2.0 + uMouse * 0.3;
      float r = length(p);
      float theta = atan(p.y, p.x);
      float rings = abs(sin(1.0 / (r + 0.05) * 2.5 - uTime * 1.2));
      float spokes = abs(sin(theta * 8.0 + uTime * 0.7 + r * 4.0));
      float grid = 1.0 - smoothstep(0.96, 1.0, max(rings, spokes));
      vec3 a = neonize(uAccent);
      vec3 b = neonize(vec3(0.95, 0.2, 0.9));
      vec3 col = mix(uDeep * 0.2, a, rings * 0.7);
      col += b * spokes * 0.4 * smoothstep(1.3, 0.1, r);
      col += a * pow(1.0 - r, 3.0) * 0.6;
      return col;
    }

    vec3 stylePlasma(vec2 uv) {
      vec2 p = (uv - 0.5) * 6.0 + uMouse;
      float v = 0.0;
      v += sin(p.x + uTime * 0.8);
      v += sin(p.y * 0.8 + uTime * 0.6);
      v += sin((p.x + p.y) * 0.5 + uTime * 0.4);
      v += sin(length(p) - uTime * 1.1);
      v *= 0.25;
      float hue = fract(v * 0.5 + uHueDrift + uTime * 0.02);
      vec3 col = hsl2rgb(hue, 1.0, 0.55);
      // wireframe grid
      vec2 g = abs(fract(uv * 40.0) - 0.5);
      float gm = smoothstep(0.48, 0.5, max(g.x, g.y));
      col += vec3(1.0, 0.4, 1.0) * gm * 0.25;
      return col;
    }

    vec3 styleFlow(vec2 uv) {
      vec2 p = (uv - 0.5) * vec2(3.0, 2.0) + uMouse * 0.5;
      float a = fbm(p + uTime * 0.1);
      float b = fbm(p + 3.0 + uTime * 0.12);
      vec2 dir = vec2(a - 0.5, b - 0.5);
      float stream = 0.0;
      for (int k = 0; k < 4; k++) {
        float t = float(k) * 0.25;
        vec2 q = p + dir * (1.2 + t * 2.0);
        stream += smoothstep(0.45, 0.5, fbm(q * 1.3 + uTime * 0.3));
      }
      vec3 c1 = neonize(uAccent);
      vec3 c2 = neonize(vec3(0.2, 0.9, 0.95));
      vec3 col = mix(uDeep * 0.3, c1, stream * 0.6);
      col += c2 * pow(stream, 3.0) * 0.7;
      return col;
    }

    // Hidden style 4: liquid chrome (domain-warped metaballs).
    vec3 styleChrome(vec2 uv) {
      vec2 p = (uv - 0.5) * 4.0 + uMouse * 0.4;
      vec2 q, r;
      float w = warped(p + uTime * 0.05, q, r);
      float metal = smoothstep(0.35, 0.75, w + 0.2 * sin(uTime * 0.5 + length(r) * 3.0));
      vec3 a = neonize(uAccent);
      vec3 b = neonize(vec3(0.95, 0.3, 0.85));
      vec3 col = mix(a, b, q.x);
      col *= 0.3 + 1.2 * metal;
      col += vec3(1.0) * pow(metal, 8.0) * 0.6;
      return col;
    }

    // Hidden style 5: crystal lattice (hex grid + glow).
    vec3 styleLattice(vec2 uv) {
      vec2 p = (uv - 0.5) * 8.0 + uMouse;
      vec2 h = vec2(1.0, 1.732);
      vec2 a = mod(p, h) - h * 0.5;
      vec2 b = mod(p - h * 0.5, h) - h * 0.5;
      float d = min(length(a), length(b));
      float ring = smoothstep(0.42, 0.4, d) - smoothstep(0.4, 0.36, d);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.2 + p.x * 0.4 + p.y * 0.3);
      vec3 col = neonize(uAccent) * ring * (1.5 + pulse);
      col += neonize(vec3(0.6, 0.9, 1.0)) * smoothstep(0.7, 0.3, d) * 0.12;
      return col;
    }

    void main() {
      vec2 uv = vUv;
      // Style cycles continuously through 4 base styles, widened to 6 when uUnlocked > 0.
      float range = mix(4.0, 6.0, smoothstep(0.0, 1.0, uUnlocked));
      float s = mod(uStyle, range);
      float si = floor(s);
      float sf = smoothstep(0.4, 0.6, fract(s));

      vec3 cA, cB;
      if (si < 0.5)      { cA = styleAurora(uv); cB = styleTunnel(uv); }
      else if (si < 1.5) { cA = styleTunnel(uv); cB = stylePlasma(uv); }
      else if (si < 2.5) { cA = stylePlasma(uv); cB = styleFlow(uv); }
      else if (si < 3.5) { cA = styleFlow(uv);   cB = uUnlocked > 0.5 ? styleChrome(uv) : styleAurora(uv); }
      else if (si < 4.5) { cA = styleChrome(uv); cB = styleLattice(uv); }
      else               { cA = styleLattice(uv); cB = styleAurora(uv); }
      vec3 col = mix(cA, cB, sf);

      // energy pump, scanlines, vignette
      col *= 0.75 + 0.55 * uEnergy;
      col += 0.05 * sin(uv.y * 900.0 + uTime * 6.0);
      float vignette = smoothstep(1.25, 0.3, length(uv - 0.5));
      col *= mix(0.35, 1.0, vignette);
      // chromatic shimmer
      col.r += 0.04 * sin(uTime * 0.8 + uv.x * 3.0);
      col.b += 0.04 * cos(uTime * 0.7 + uv.y * 4.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const ptVertex = `
    attribute float size;
    attribute float born;
    attribute float life;
    attribute float hue;
    attribute float vel;
    varying float vAlpha;
    varying float vHue;
    varying float vVel;
    uniform float uTime;
    uniform float uPixel;
    void main() {
      float age = uTime - born;
      float u = clamp(age / max(life, 0.001), 0.0, 1.0);
      vAlpha = pow(1.0 - u, 1.4);
      vHue = hue;
      vVel = vel;
      vec3 pos = position;
      pos.y += u * 1.6;
      pos.x += sin(uTime * 0.8 + position.x * 0.3) * 0.25;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float s = size * (0.7 + 0.5 * (1.0 - u)) * (1.0 + 0.12 * sin(uTime * 3.0 + position.x));
      gl_PointSize = s * uPixel * (200.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const ptFragment = `
    precision highp float;
    varying float vAlpha;
    varying float vHue;
    varying float vVel;
    uniform vec3 uAccent;

    vec3 hsl2rgb(float h, float s, float l) {
      vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
      float c = (1.0 - abs(2.0 * l - 1.0)) * s;
      return l + c * (rgb - 0.5);
    }
    vec3 rgb2hsl(vec3 c) {
      float mx = max(max(c.r, c.g), c.b);
      float mn = min(min(c.r, c.g), c.b);
      float l = (mx + mn) * 0.5;
      float h = 0.0, s = 0.0;
      if (mx != mn) {
        float d = mx - mn;
        s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
        if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
        else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
        else h = (c.r - c.g) / d + 4.0;
        h /= 6.0;
      }
      return vec3(h, s, l);
    }

    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) discard;
      float core = smoothstep(0.5, 0.0, d);
      float halo = smoothstep(0.5, 0.18, d);
      vec3 hsl = rgb2hsl(uAccent);
      hsl.x = fract(hsl.x + vHue);
      hsl.z = min(0.9, hsl.z + 0.18 + vVel * 0.15);
      vec3 c = hsl2rgb(hsl.x, hsl.y, hsl.z);
      vec3 col = c * (0.6 + 1.3 * core) + c * halo * 0.45;
      gl_FragColor = vec4(col, vAlpha * (0.3 + 0.7 * core));
    }
  `;

  function accentVec3(m) {
    if (m && m.accent) return new THREE.Color(m.accent.r / 255, m.accent.g / 255, m.accent.b / 255);
    return new THREE.Color(0.7, 0.85, 1.0);
  }
  function deepVec3(m) {
    if (m && m.bgBot) return new THREE.Color(m.bgBot);
    return new THREE.Color(0x05080E);
  }
  function midVec3(m) {
    if (m && m.bgTop) return new THREE.Color(m.bgTop);
    return new THREE.Color(0x1A1B2E);
  }

  function spawnOrb(pitch, velocity, posOverride = null) {
    const i = orbIdx % ORB_COUNT;
    orbIdx += 1;
    const norm = Math.max(0, Math.min(1, (pitch - 48) / 40));
    const x = posOverride ? posOverride.x : (Math.random() - 0.5) * 16;
    const y = posOverride ? posOverride.y : -4 + norm * 8;
    const z = posOverride ? posOverride.z : -6 + (Math.random() - 0.5) * 8;
    posAttr.setXYZ(i, x, y, z);
    sizeAttr.setX(i, 0.8 + velocity * 2.2);
    bornAttr.setX(i, clock.getElapsedTime());
    lifeAttr.setX(i, 3.0 + Math.random() * 2.2);
    hueAttr.setX(i, ((pitch % 12) / 12) * 0.35 + (Math.random() - 0.5) * 0.05);
    velAttr.setX(i, velocity);
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    bornAttr.needsUpdate = true;
    lifeAttr.needsUpdate = true;
    hueAttr.needsUpdate = true;
    velAttr.needsUpdate = true;
  }

  function buildPoints() {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(ORB_COUNT * 3);
    const sizes = new Float32Array(ORB_COUNT);
    const borns = new Float32Array(ORB_COUNT);
    const lifes = new Float32Array(ORB_COUNT);
    const hues = new Float32Array(ORB_COUNT);
    const vels = new Float32Array(ORB_COUNT);
    for (let i = 0; i < ORB_COUNT; i++) {
      positions[i * 3 + 0] = 0;
      positions[i * 3 + 1] = -99;
      positions[i * 3 + 2] = 0;
      lifes[i] = 0.01;
    }
    posAttr = new THREE.BufferAttribute(positions, 3);
    sizeAttr = new THREE.BufferAttribute(sizes, 1);
    bornAttr = new THREE.BufferAttribute(borns, 1);
    lifeAttr = new THREE.BufferAttribute(lifes, 1);
    hueAttr = new THREE.BufferAttribute(hues, 1);
    velAttr = new THREE.BufferAttribute(vels, 1);
    geom.setAttribute('position', posAttr);
    geom.setAttribute('size', sizeAttr);
    geom.setAttribute('born', bornAttr);
    geom.setAttribute('life', lifeAttr);
    geom.setAttribute('hue', hueAttr);
    geom.setAttribute('vel', velAttr);
    pointsMat = new THREE.ShaderMaterial({
      vertexShader: ptVertex,
      fragmentShader: ptFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: Math.min(1.6, window.devicePixelRatio || 1) },
        uAccent: { value: accentVec3(moodRef) },
      },
    });
    points = new THREE.Points(geom, pointsMat);
    scene.add(points);
  }

  function seedAmbient() {
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      ambient.push({
        x: (Math.random() - 0.5) * 20,
        y: (Math.random() - 0.5) * 10,
        z: -4 + (Math.random() - 0.5) * 6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.05 + Math.random() * 0.12,
      });
    }
  }

  function stepAmbient(t) {
    for (let k = 0; k < ambient.length; k++) {
      const a = ambient[k];
      const idx = (orbIdx + k) % ORB_COUNT;
      const age = t - bornAttr.array[idx];
      if (age > lifeAttr.array[idx]) {
        const nx = a.x + Math.sin(t * a.speed + a.phase) * 0.4;
        const ny = a.y + Math.cos(t * a.speed * 0.7 + a.phase) * 0.3;
        posAttr.setXYZ(idx, nx, ny, a.z);
        sizeAttr.setX(idx, 0.4 + Math.random() * 0.3);
        bornAttr.setX(idx, t);
        lifeAttr.setX(idx, 5 + Math.random() * 4);
        hueAttr.setX(idx, (Math.random() - 0.5) * 0.1);
        velAttr.setX(idx, 0.25);
        posAttr.needsUpdate = true;
        sizeAttr.needsUpdate = true;
        bornAttr.needsUpdate = true;
        lifeAttr.needsUpdate = true;
        hueAttr.needsUpdate = true;
        velAttr.needsUpdate = true;
      }
    }
  }

  function resize() {
    if (!renderer || !camera || !hostEl) return;
    const w = hostEl.clientWidth;
    const h = hostEl.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function init() {
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(65, hostEl.clientWidth / hostEl.clientHeight, 0.1, 200);
    camera.position.set(0, 0, 12);

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(hostEl.clientWidth, hostEl.clientHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    hostEl.appendChild(renderer.domElement);

    bgScene = new THREE.Scene();
    bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const bgGeom = new THREE.PlaneGeometry(2, 2);
    bgMat = new THREE.ShaderMaterial({
      vertexShader: bgVertex,
      fragmentShader: bgFragment,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0.35 },
        uStyle: { value: Math.random() * 4 },
        uHueDrift: { value: 0 },
        uUnlocked: { value: 0 },
        uAccent: { value: accentVec3(moodRef) },
        uDeep: { value: deepVec3(moodRef) },
        uMid: { value: midVec3(moodRef) },
        uMouse: { value: new THREE.Vector2(0, 0) },
      },
      depthWrite: false,
      depthTest: false,
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgScene.add(bgMesh);

    buildPoints();
    seedAmbient();

    unsubscribeNote = onNote((e) => {
      if (disposed) return;
      spawnOrb(e.pitch, e.velocity);
      bgMat.uniforms.uEnergy.value = Math.min(1, bgMat.uniforms.uEnergy.value + 0.22 * e.velocity);
    });
    // Bloom event: 24-orb radial burst at centre, big energy punch.
    unsubscribeBloom = onBloom(() => {
      if (disposed) return;
      for (let k = 0; k < 24; k++) {
        const angle = (k / 24) * Math.PI * 2;
        const r = 4 + Math.random() * 2;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * 0.7;
        spawnOrb(60 + (k % 12), 1.1, { x, y, z: -3 });
      }
      bgMat.uniforms.uEnergy.value = 1;
    });

    const onPointerMove = (ev) => {
      const r = hostEl.getBoundingClientRect();
      mouse.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -(((ev.clientY - r.top) / r.height) * 2 - 1);
      mouse.active = true;
    };
    const onPointerLeave = () => { mouse.active = false; };
    const onPointerDown = (ev) => {
      const r = hostEl.getBoundingClientRect();
      const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
      const ny = -(((ev.clientY - r.top) / r.height) * 2 - 1);
      const x = nx * 9;
      const y = ny * 5;
      const pitch = 60 + Math.round(ny * 18);
      spawnOrb(pitch, 1.2, { x, y, z: -3 });
      spawnOrb(pitch + 7, 0.9, { x: x + 0.8, y: y + 0.5, z: -3 });
      spawnOrb(pitch - 5, 0.9, { x: x - 0.8, y: y - 0.5, z: -3 });
      bgMat.uniforms.uEnergy.value = Math.min(1, bgMat.uniforms.uEnergy.value + 0.35);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', resize);
    hostEl.__cleanupPointers = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointerdown', onPointerDown);
    };

    const loop = () => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();
      bgMat.uniforms.uTime.value = t;
      bgMat.uniforms.uEnergy.value *= Math.max(0, 1 - dt * 0.35);
      // Style cycles one full 0-4 range every ~180 seconds (each style ~45 s on screen); hue drift
      // advances every frame so color never freezes.
      // Same-mood dwell unlocks hidden styles after 10 min; target lerps toward 1.0.
      const dwellMin = (performance.now() - moodDwellStart) / 60000;
      const target = dwellMin >= 10 ? 1 : 0;
      bgMat.uniforms.uUnlocked.value += (target - bgMat.uniforms.uUnlocked.value) * 0.02;
      const range = 4.0 + bgMat.uniforms.uUnlocked.value * 2.0;
      bgMat.uniforms.uStyle.value = (bgMat.uniforms.uStyle.value + dt * (range / 180.0)) % range;
      bgMat.uniforms.uHueDrift.value = (bgMat.uniforms.uHueDrift.value + dt * 0.015) % 1.0;
      mouseSmoothed.x += (mouse.x - mouseSmoothed.x) * 0.05;
      mouseSmoothed.y += (mouse.y - mouseSmoothed.y) * 0.05;
      bgMat.uniforms.uMouse.value.set(mouseSmoothed.x, mouseSmoothed.y);
      if (moodRef) {
        bgMat.uniforms.uAccent.value.lerp(accentVec3(moodRef), 0.02);
        bgMat.uniforms.uDeep.value.lerp(deepVec3(moodRef), 0.02);
        bgMat.uniforms.uMid.value.lerp(midVec3(moodRef), 0.02);
        pointsMat.uniforms.uAccent.value.copy(bgMat.uniforms.uAccent.value);
      }
      pointsMat.uniforms.uTime.value = t;
      camera.position.x = Math.sin(t * 0.09) * 2.8 + mouseSmoothed.x * 3.5;
      camera.position.y = Math.sin(t * 0.065 + 1.2) * 1.3 + mouseSmoothed.y * 2.2;
      camera.position.z = 12 + Math.sin(t * 0.04) * 1.8;
      camera.lookAt(mouseSmoothed.x * 0.8, mouseSmoothed.y * 0.6, 0);
      stepAmbient(t);
      renderer.clear();
      renderer.render(bgScene, bgCam);
      renderer.render(scene, camera);
    };
    loop();
  }

  $effect(() => {
    if (!hostEl) return;
    init();
    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (unsubscribeNote) { try { unsubscribeNote(); } catch (_) { /* ignore */ } }
      if (unsubscribeBloom) { try { unsubscribeBloom(); } catch (_) { /* ignore */ } }
      window.removeEventListener('resize', resize);
      if (hostEl && hostEl.__cleanupPointers) { try { hostEl.__cleanupPointers(); } catch (_) { /* ignore */ } }
      if (renderer) {
        try { renderer.dispose(); } catch (_) { /* ignore */ }
        try { hostEl.removeChild(renderer.domElement); } catch (_) { /* ignore */ }
      }
      if (bgMat) bgMat.dispose();
      if (points) {
        points.geometry.dispose();
        pointsMat.dispose();
      }
    };
  });

  $effect(() => {
    const label = mood ? mood.label : null;
    if (label !== lastMoodLabel) {
      moodDwellStart = performance.now();
      lastMoodLabel = label;
    }
    moodRef = mood;
  });
</script>

<div bind:this={hostEl} class="bloomfield" aria-hidden="true"></div>

<style>
  .bloomfield {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 10;
  }
  .bloomfield :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }
</style>
