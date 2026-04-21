<script>
  // Clean 3D orb field. No psychedelic cycling, no scanlines, no hue drift.
  // Backdrop is a single calm gradient derived from the mood palette. Camera drifts slowly
  // and follows the mouse. Orbs spawn on real note events and drift outward.

  import * as THREE from 'three';
  import { onNote } from '../audio/events.js';

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
  const ORB_COUNT = 96;
  let orbIdx = 0;
  let moodRef = mood;
  let clock;
  let unsubscribeNote = null;
  let centerpiece = null;
  let centerInner = null;
  const mouse = { x: 0, y: 0, active: false };
  let mouseSmoothed = { x: 0, y: 0 };
  const ambient = [];
  const AMBIENT_COUNT = 16;

  const bgVertex = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  // Calm vertical gradient with slow fbm haze. Single colour family.
  const bgFragment = `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 uAccent;
    uniform vec3 uDeep;

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
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
      return v;
    }

    void main() {
      vec2 uv = vUv;
      float gradient = smoothstep(1.0, 0.0, uv.y);
      float haze = fbm(uv * 3.0 + vec2(0.0, uTime * 0.015));
      vec3 col = mix(uDeep, uAccent * 0.35, gradient * (0.4 + 0.4 * haze));
      float vignette = smoothstep(1.2, 0.5, length(uv - 0.5));
      col *= mix(0.5, 1.0, vignette);
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
      vAlpha = pow(1.0 - u, 1.3);
      vHue = hue;
      vVel = vel;
      vec3 pos = position;
      pos.y += u * 1.2;
      pos.x += sin(uTime * 0.5 + position.x * 0.25) * 0.15;
      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float s = size * (0.75 + 0.35 * (1.0 - u));
      gl_PointSize = s * uPixel * (180.0 / -mv.z);
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
      float halo = smoothstep(0.5, 0.22, d);
      vec3 hsl = rgb2hsl(uAccent);
      hsl.x = fract(hsl.x + vHue * 0.12);
      hsl.z = min(0.85, hsl.z + 0.1 + vVel * 0.1);
      vec3 c = hsl2rgb(hsl.x, min(1.0, hsl.y * 1.1), hsl.z);
      vec3 col = c * (0.55 + 1.0 * core) + c * halo * 0.35;
      gl_FragColor = vec4(col, vAlpha * (0.35 + 0.65 * core));
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

  function spawnOrb(pitch, velocity, posOverride = null) {
    const i = orbIdx % ORB_COUNT;
    orbIdx += 1;
    const norm = Math.max(0, Math.min(1, (pitch - 48) / 40));
    const x = posOverride ? posOverride.x : (Math.random() - 0.5) * 14;
    const y = posOverride ? posOverride.y : -4 + norm * 8;
    const z = posOverride ? posOverride.z : -6 + (Math.random() - 0.5) * 6;
    posAttr.setXYZ(i, x, y, z);
    sizeAttr.setX(i, 0.7 + velocity * 1.8);
    bornAttr.setX(i, clock.getElapsedTime());
    lifeAttr.setX(i, 3.5 + Math.random() * 2.0);
    hueAttr.setX(i, (pitch % 12) / 12);
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
      positions[i * 3 + 1] = -99;
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
        x: (Math.random() - 0.5) * 18,
        y: (Math.random() - 0.5) * 9,
        z: -4 + (Math.random() - 0.5) * 6,
        phase: Math.random() * Math.PI * 2,
        speed: 0.03 + Math.random() * 0.07,
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
        sizeAttr.setX(idx, 0.25 + Math.random() * 0.2);
        bornAttr.setX(idx, t);
        lifeAttr.setX(idx, 6 + Math.random() * 4);
        hueAttr.setX(idx, 0);
        velAttr.setX(idx, 0.2);
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
    camera = new THREE.PerspectiveCamera(55, hostEl.clientWidth / hostEl.clientHeight, 0.1, 200);
    camera.position.set(0, 0, 14);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
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
        uAccent: { value: accentVec3(moodRef) },
        uDeep: { value: deepVec3(moodRef) },
      },
      depthWrite: false,
      depthTest: false,
    });
    const bgMesh = new THREE.Mesh(bgGeom, bgMat);
    bgScene.add(bgMesh);

    buildPoints();
    seedAmbient();

    // Atmospheric fog so distant orbs fade gently. Gives a sense of depth.
    scene.fog = new THREE.FogExp2(0x000000, 0.04);

    // Central slowly-rotating wireframe icosahedron. Low-contrast, just enough to give
    // the scene a focal structure without being a gimmick.
    const icoGeom = new THREE.IcosahedronGeometry(3.2, 1);
    const icoEdges = new THREE.EdgesGeometry(icoGeom);
    const icoMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.18 });
    icoMat.color = accentVec3(moodRef);
    centerpiece = new THREE.LineSegments(icoEdges, icoMat);
    scene.add(centerpiece);

    const inGeom = new THREE.IcosahedronGeometry(1.6, 0);
    const inEdges = new THREE.EdgesGeometry(inGeom);
    const inMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.32 });
    inMat.color = accentVec3(moodRef);
    centerInner = new THREE.LineSegments(inEdges, inMat);
    scene.add(centerInner);

    unsubscribeNote = onNote((e) => {
      if (disposed) return;
      spawnOrb(e.pitch, e.velocity);
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
      const x = nx * 8;
      const y = ny * 4;
      const pitch = 60 + Math.round(ny * 14);
      spawnOrb(pitch, 1.0, { x, y, z: -3 });
      spawnOrb(pitch + 7, 0.7, { x: x + 0.6, y: y + 0.4, z: -3 });
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
      mouseSmoothed.x += (mouse.x - mouseSmoothed.x) * 0.04;
      mouseSmoothed.y += (mouse.y - mouseSmoothed.y) * 0.04;
      if (moodRef) {
        bgMat.uniforms.uAccent.value.lerp(accentVec3(moodRef), 0.02);
        bgMat.uniforms.uDeep.value.lerp(deepVec3(moodRef), 0.02);
        pointsMat.uniforms.uAccent.value.copy(bgMat.uniforms.uAccent.value);
        if (centerpiece) centerpiece.material.color.copy(bgMat.uniforms.uAccent.value);
        if (centerInner) centerInner.material.color.copy(bgMat.uniforms.uAccent.value);
      }
      pointsMat.uniforms.uTime.value = t;
      // Global slow rotation keeps the composition from looking frozen, but stays gentle.
      scene.rotation.y = Math.sin(t * 0.04) * 0.25;
      if (centerpiece) {
        centerpiece.rotation.x = t * 0.09;
        centerpiece.rotation.y = t * 0.07;
      }
      if (centerInner) {
        centerInner.rotation.x = -t * 0.13;
        centerInner.rotation.z = t * 0.1;
      }
      camera.position.x = Math.sin(t * 0.06) * 1.8 + mouseSmoothed.x * 2.0;
      camera.position.y = Math.sin(t * 0.05 + 1.2) * 0.9 + mouseSmoothed.y * 1.2;
      camera.position.z = 14 + Math.sin(t * 0.03) * 1.0;
      camera.lookAt(mouseSmoothed.x * 0.4, mouseSmoothed.y * 0.3, 0);
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
      if (centerpiece) { centerpiece.geometry.dispose(); centerpiece.material.dispose(); }
      if (centerInner) { centerInner.geometry.dispose(); centerInner.material.dispose(); }
    };
  });

  $effect(() => {
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
