<script>
  import p5 from 'p5';
  import { colorForKey, PALETTE, mixRgb } from './colors.js';
  import { updateSeedPosition } from '../state/store.svelte.js';

  const DEBUG = false;

  let { seeds = [], playingIds = new Set(), onseedClick = () => {} } = $props();

  let hostEl;
  let overlayEl;
  let p5Instance = null;
  let reducedMotion = false;

  // p5 reads this every frame, not via runes.
  const state = {
    seeds: [],
    playingIds: new Set(),
    width: 0,
    height: 0,
    hoverId: null,
    focusId: null,
    cursorX: -9999,
    cursorY: -9999,
    cursorActive: false,
    dragTrail: [],
    worms: new Map(),
    collisions: new Map(),
    bursts: [],
    rings: [],
    playPulses: [],
    flashHeads: new Map(),
    sceneSeed: 0,
    frame: 0,
    lastFrameTime: 0,
  };

  // Not $state; p5 polls each frame.
  const drag = {
    id: null,
    startX: 0,
    startY: 0,
    moved: 0,
    lastPx: 0,
    lastPy: 0,
  };

  $effect(() => {
    state.seeds = seeds ?? [];
    const next = playingIds instanceof Set ? playingIds : new Set(playingIds || []);
    for (const id of next) {
      if (!state.playingIds.has(id)) {
        const w = state.worms.get(id);
        if (w) {
          w.lastPlayStart = performance.now();
        }
      }
    }
    state.playingIds = next;
    syncWorms();
  });

  function hashToUnit(str, salt = 0) {
    let h = (2166136261 ^ salt) >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return (h % 100000) / 100000;
  }

  function seedInitialPos(seed) {
    const w = state.width;
    const h = state.height;
    const pad = Math.max(48, w * 0.05);
    const nx = typeof seed.position?.x === 'number' ? seed.position.x : 0.5;
    const ny = typeof seed.position?.y === 'number' ? seed.position.y : 0.5;
    const x = pad + nx * (w - pad * 2);
    const y = pad + ny * (h - pad * 2);
    return { x, y };
  }

  function headRadiusFor(seed) {
    const e = typeof seed.energy === 'number' ? seed.energy : 1;
    const clamped = Math.max(0, Math.min(1, e));
    if (seed.role === 'main') return 90 + clamped * 40;
    return 16 + clamped * 6;
  }

  function wormSpeedFor(seed) {
    const k = hashToUnit(seed.id, 3);
    if (seed.role === 'main') return 18 + k * 18;
    return 25 + k * 25;
  }

  function segmentCountFor(seed) {
    return seed.role === 'main' ? 24 : 12;
  }

  function syncWorms() {
    if (!state.width || !state.height) return;
    const seen = new Set();
    for (const seed of state.seeds) {
      if (!seed || !seed.id) continue;
      seen.add(seed.id);
      let worm = state.worms.get(seed.id);
      if (!worm) {
        worm = spawnWorm(seed);
        state.worms.set(seed.id, worm);
      }
    }
    for (const id of Array.from(state.worms.keys())) {
      if (!seen.has(id)) state.worms.delete(id);
    }
  }

  function spawnWorm(seed) {
    const p0 = seedInitialPos(seed);
    const speed = wormSpeedFor(seed);
    const ang = hashToUnit(seed.id, 11) * Math.PI * 2;
    const segCount = segmentCountFor(seed);
    const gap = 10;
    const segments = new Array(segCount);
    // Spread segments behind head so worm reads as a worm on frame 1, not stacked circles.
    const dx = -Math.cos(ang) * gap;
    const dy = -Math.sin(ang) * gap;
    for (let i = 0; i < segCount; i++) {
      segments[i] = { x: p0.x + dx * (i + 1), y: p0.y + dy * (i + 1) };
    }
    return {
      seedId: seed.id,
      head: { x: p0.x, y: p0.y },
      vel: { vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed },
      target: pickRandomTarget(),
      wander: hashToUnit(seed.id, 17) * Math.PI * 2,
      segments,
      speed,
      lastPlayStart: 0,
      nextTargetAt: performance.now() + 4000 + hashToUnit(seed.id, 23) * 4000,
      lastPulseEmittedAt: 0,
    };
  }

  function pickRandomTarget() {
    const pad = Math.max(60, state.width * 0.06);
    return {
      tx: pad + Math.random() * Math.max(1, state.width - pad * 2),
      ty: pad + Math.random() * Math.max(1, state.height - pad * 2),
    };
  }

  function sketch(p) {
    p.setup = () => {
      const rect = hostEl.getBoundingClientRect();
      state.width = Math.max(1, rect.width | 0);
      state.height = Math.max(1, rect.height | 0);
      const c = p.createCanvas(state.width, state.height);
      c.parent(hostEl);
      p.pixelDensity(1);
      p.frameRate(30);
      syncWorms();
      state.lastFrameTime = performance.now();
    };

    p.windowResized = () => {
      const rect = hostEl.getBoundingClientRect();
      state.width = Math.max(1, rect.width | 0);
      state.height = Math.max(1, rect.height | 0);
      p.resizeCanvas(state.width, state.height);
    };

    p.draw = () => {
      state.frame++;
      const now = performance.now();
      const dt = Math.max(0, Math.min(0.05, (now - state.lastFrameTime) / 1000));
      state.lastFrameTime = now;

      drawBackground(p);

      const ordered = state.seeds.filter((s) => s && s.id);
      for (const seed of ordered) {
        const worm = state.worms.get(seed.id);
        if (!worm) continue;
        stepWorm(worm, seed, now, dt);
      }

      if (!reducedMotion) detectCollisions(now);
      cleanupCollisions(now);

      for (const seed of ordered) {
        const worm = state.worms.get(seed.id);
        if (!worm) continue;
        drawWormBody(p, worm, seed, now);
      }
      // Main renders LAST so it sits on top of modifier heads.
      const mainFirst = ordered.filter((s) => s.role !== 'main').concat(ordered.filter((s) => s.role === 'main'));
      for (const seed of mainFirst) {
        const worm = state.worms.get(seed.id);
        if (!worm) continue;
        drawWormHead(p, worm, seed, now);
      }

      updateAndDrawRings(p, now);
      updateAndDrawPlayPulses(p, now);
      updateAndDrawBursts(p, now);
      drawInfusionStream(p, now);

      updateAndDrawDragTrail(p, now);

      try {
        const flash = window.__sonoAbsorbFlash;
        if (flash && now - flash.born < 1800) {
          const main = state.seeds.find((s) => s && s.role === 'main');
          const mw = main && state.worms.get(main.id);
          if (mw) {
            const k = (now - flash.born) / 1800;
            const alpha = (1 - k) * 255;
            const r = 80 + k * 160;
            const col = colorForKey(main);
            p.noFill();
            p.stroke(col.r, col.g, col.b, alpha);
            p.strokeWeight(4);
            p.circle(mw.head.x, mw.head.y, r * 2);
            p.strokeWeight(1);
            p.noStroke();
            p.fill(col.r, col.g, col.b, alpha);
            p.textSize(22);
            p.textAlign(p.CENTER, p.CENTER);
            p.text('+ ' + (flash.label || 'effect'), mw.head.x, mw.head.y - 110 - k * 40);
          }
        }
      } catch (_) { /* ignore */ }

      positionOverlayButtons();
      updateCursor();
    };
  }

  function hexToRgb(h) {
    const s = String(h || '').replace('#', '');
    const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function drawBackground(p) {
    let top = { r: 6, g: 8, b: 18 };
    let bot = { r: 2, g: 3, b: 8 };
    try {
      const mod = window.__sonoMood;
      if (mod?.bgTop) top = hexToRgb(mod.bgTop);
      if (mod?.bgBot) bot = hexToRgb(mod.bgBot);
    } catch (_) { /* ignore */ }
    for (let y = 0; y < state.height; y += 2) {
      const k = y / Math.max(1, state.height - 1);
      const c = mixRgb(top, bot, k);
      p.stroke(c.r, c.g, c.b, 255);
      p.line(0, y, state.width, y);
      p.line(0, y + 1, state.width, y + 1);
    }
    p.noStroke();
  }

  function stepWorm(worm, seed, now, dt) {
    // Main is anchored to canvas center; no movement.
    if (seed.role === 'main') {
      worm.head.x = state.width / 2;
      worm.head.y = state.height / 2;
      worm.vel.vx = 0;
      worm.vel.vy = 0;
      pushSegments(worm);
      return;
    }
    // Drag freeze: head tracks cursor; release resumes movement.
    if (drag.id === seed.id) {
      worm.head.x = state.cursorX;
      worm.head.y = state.cursorY;
      worm.vel.vx = 0;
      worm.vel.vy = 0;
      pushSegments(worm);
      return;
    }

    if (now >= worm.nextTargetAt) {
      worm.target = pickRandomTarget();
      worm.nextTargetAt = now + 4000 + Math.random() * 4000;
    }

    const rmScale = reducedMotion ? 0.3 : 1.0;

    const dx = worm.target.tx - worm.head.x;
    const dy = worm.target.ty - worm.head.y;
    const d2 = dx * dx + dy * dy;
    const d = Math.sqrt(Math.max(1, d2));
    const steerForce = 6;
    const ax = (dx / d) * steerForce;
    const ay = (dy / d) * steerForce;
    worm.vel.vx += ax * dt;
    worm.vel.vy += ay * dt;

    worm.wander += (Math.random() - 0.5) * 2.0 * dt;
    const wanderForce = 9;
    worm.vel.vx += Math.cos(worm.wander) * wanderForce * dt;
    worm.vel.vy += Math.sin(worm.wander) * wanderForce * dt;

    const spd = Math.sqrt(worm.vel.vx * worm.vel.vx + worm.vel.vy * worm.vel.vy) || 1;
    const minSpd = worm.speed * 0.7 * rmScale;
    const maxSpd = worm.speed * 1.3 * rmScale;
    if (spd < minSpd) {
      const k = minSpd / spd;
      worm.vel.vx *= k;
      worm.vel.vy *= k;
    } else if (spd > maxSpd) {
      const k = maxSpd / spd;
      worm.vel.vx *= k;
      worm.vel.vy *= k;
    }

    worm.head.x += worm.vel.vx * dt;
    worm.head.y += worm.vel.vy * dt;

    const hr = headRadiusFor(seed);
    const pad = 20 + hr;
    if (worm.head.x < pad) {
      worm.head.x = pad;
      worm.vel.vx = Math.abs(worm.vel.vx);
      worm.target = pickRandomTarget();
    } else if (worm.head.x > state.width - pad) {
      worm.head.x = state.width - pad;
      worm.vel.vx = -Math.abs(worm.vel.vx);
      worm.target = pickRandomTarget();
    }
    if (worm.head.y < pad) {
      worm.head.y = pad;
      worm.vel.vy = Math.abs(worm.vel.vy);
      worm.target = pickRandomTarget();
    } else if (worm.head.y > state.height - pad) {
      worm.head.y = state.height - pad;
      worm.vel.vy = -Math.abs(worm.vel.vy);
      worm.target = pickRandomTarget();
    }

    pushSegments(worm);

    const w = state.width, h = state.height;
    const padP = Math.max(48, w * 0.05);
    if (seed.position) {
      seed.position.x = Math.max(0, Math.min(1, (worm.head.x - padP) / Math.max(1, w - padP * 2)));
      seed.position.y = Math.max(0, Math.min(1, (worm.head.y - padP) / Math.max(1, h - padP * 2)));
    }
  }

  function pushSegments(worm) {
    const target = { x: worm.head.x, y: worm.head.y };
    const gap = 4;
    for (let i = 0; i < worm.segments.length; i++) {
      const seg = worm.segments[i];
      const dx = target.x - seg.x;
      const dy = target.y - seg.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > gap) {
        const k = (d - gap) / d;
        seg.x += dx * k;
        seg.y += dy * k;
      }
      target.x = seg.x;
      target.y = seg.y;
    }
  }

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function detectCollisions(now) {
    const worms = [];
    for (const seed of state.seeds) {
      if (!seed || !seed.id) continue;
      const w = state.worms.get(seed.id);
      if (!w) continue;
      worms.push({ seed, worm: w });
    }
    const COOLDOWN_MAIN_MOD = 4000;
    const COOLDOWN_MOD_MOD = 2000;
    for (let i = 0; i < worms.length; i++) {
      const A = worms[i];
      const ar = headRadiusFor(A.seed);
      for (let j = i + 1; j < worms.length; j++) {
        const B = worms[j];
        const br = headRadiusFor(B.seed);
        const dx = A.worm.head.x - B.worm.head.x;
        const dy = A.worm.head.y - B.worm.head.y;
        const d2 = dx * dx + dy * dy;
        const reach = ar + br + 8;
        if (d2 > reach * reach) continue;
        const key = pairKey(A.seed.id, B.seed.id);
        const last = state.collisions.get(key) || 0;
        const mainInvolved = A.seed.role === 'main' || B.seed.role === 'main';
        const cooldown = mainInvolved ? COOLDOWN_MAIN_MOD : COOLDOWN_MOD_MOD;
        if (now - last < cooldown) continue;
        state.collisions.set(key, now);
        fireCollisionEvent(A, B, now);
      }
    }
  }

  function cleanupCollisions(now) {
    for (const [k, t] of state.collisions) {
      if (now - t > 2000) state.collisions.delete(k);
    }
  }

  function fireCollisionEvent(A, B, now) {
    const mx = (A.worm.head.x + B.worm.head.x) / 2;
    const my = (A.worm.head.y + B.worm.head.y) / 2;
    const colA = colorForKey(A.seed);
    const colB = colorForKey(B.seed);
    const colMid = mixRgb(colA, colB, 0.5);

    const count = 8;
    const particles = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const sp = 60 + Math.random() * 60;
      const col = Math.random() < 0.5 ? colA : colB;
      particles.push({
        x: mx,
        y: my,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        col,
      });
    }
    state.bursts.push({ x: mx, y: my, born: now, max: 600, col: colMid, particles });
    if (state.bursts.length > 12) state.bursts.shift();

    state.rings.push({ x: mx, y: my, born: now, max: 900, col: colMid, radiusStart: 6, radiusEnd: 90 });
    if (state.rings.length > 8) state.rings.shift();

    state.flashHeads.set(A.seed.id, now + 400);
    state.flashHeads.set(B.seed.id, now + 400);

    // Visual-only; the collision hook handles absorb logic in App.svelte.
    try {
      const fn = typeof window !== 'undefined' ? window.__sonogarden_onCollision : null;
      if (typeof fn === 'function') fn(A.seed.id, B.seed.id);
    } catch (_) {
      /* ignore */
    }
  }

  function drawWormBody(p, worm, seed, now) {
    if (seed.role === 'main') return;
    const col = colorForKey(seed);
    const segs = worm.segments;
    const headR = headRadiusFor(seed);
    const playing = state.playingIds.has(seed.id);
    let pulseHead = -1;
    if (playing && !reducedMotion) {
      const sinceStart = now - worm.lastPlayStart;
      const period = 500;
      const k = ((sinceStart % period) / period);
      pulseHead = Math.floor(k * segs.length);
    }
    p.noStroke();
    for (let i = segs.length - 1; i >= 0; i--) {
      const seg = segs[i];
      const k = i / Math.max(1, segs.length - 1);
      const segR = headR * (1 - k * 0.7);
      const alpha = 255 * (1 - k * 0.7);
      let boost = 1;
      if (pulseHead >= 0) {
        const d = Math.abs(i - pulseHead);
        if (d <= 2) boost = 1 + (1 - d / 2) * 0.9;
      }
      const tint = mixRgb(col, { r: 255, g: 255, b: 255 }, 0.1 * (i % 2));
      p.fill(tint.r, tint.g, tint.b, Math.min(255, 60 * (alpha / 255) * boost));
      p.circle(seg.x, seg.y, segR * 3.6);
      p.fill(tint.r, tint.g, tint.b, Math.min(255, 120 * (alpha / 255) * boost));
      p.circle(seg.x, seg.y, segR * 2.1);
      p.fill(tint.r, tint.g, tint.b, Math.min(255, alpha * boost));
      p.circle(seg.x, seg.y, segR * 1.1);
    }
  }

  function drawWormHead(p, worm, seed, now) {
    let col = colorForKey(seed);
    const headR = headRadiusFor(seed);
    const playing = state.playingIds.has(seed.id);
    const isHover = state.hoverId === seed.id || state.focusId === seed.id;
    const flashUntil = state.flashHeads.get(seed.id) || 0;
    const flashing = now < flashUntil;

    const infusingMain = false;
    let intensity = 1;
    if (playing) intensity += 1;
    if (isHover) intensity += 0.8;
    if (flashing) intensity += 1.0;

    const pulseInterval = infusingMain ? 220 : 400;
    if (playing && !reducedMotion) {
      if (now - worm.lastPulseEmittedAt > pulseInterval) {
        worm.lastPulseEmittedAt = now;
        state.playPulses.push({
          x: worm.head.x,
          y: worm.head.y,
          born: now,
          max: 700,
          col,
        });
        if (state.playPulses.length > 20) state.playPulses.shift();
      }
    }

    p.noStroke();
    // Cycle 55: main worm gets a soft bloom that pulses at the current mood bpm.
    if (seed.role === 'main') {
      let bpm = 60;
      try { bpm = (window.__sonoMood && typeof window.__sonoMood.bpm === 'number') ? window.__sonoMood.bpm : 60; } catch (_) { /* ignore */ }
      const periodMs = 60000 / Math.max(20, bpm);
      const phase = (now % periodMs) / periodMs;
      const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
      const bloomR = headR * (1.8 + pulse * 0.35);
      p.fill(col.r, col.g, col.b, 22 + pulse * 28);
      p.circle(worm.head.x, worm.head.y, bloomR * 2);
      p.fill(col.r, col.g, col.b, 14 + pulse * 18);
      p.circle(worm.head.x, worm.head.y, bloomR * 2.8);
    }
    for (let i = 4; i >= 1; i--) {
      const rr = headR + i * 6;
      const a = (50 - i * 9) * intensity;
      p.fill(col.r, col.g, col.b, Math.min(255, a));
      p.circle(worm.head.x, worm.head.y, rr * 2);
    }
    p.fill(col.r, col.g, col.b, Math.min(255, 240 * intensity));
    p.circle(worm.head.x, worm.head.y, headR * 1.2);
    const stig = PALETTE.stigma;
    p.fill(stig.r, stig.g, stig.b, Math.min(255, 240 * intensity));
    p.circle(worm.head.x, worm.head.y, headR * 0.45);

    if (seed.role === 'modifier') {
      p.noFill();
      p.stroke(col.r, col.g, col.b, 110);
      p.strokeWeight(1);
      p.circle(worm.head.x, worm.head.y, headR * 2 + 10);
      p.noStroke();
      p.fill(col.r, col.g, col.b, 220);
      p.textSize(11);
      p.textAlign(p.CENTER, p.TOP);
      p.textStyle(p.NORMAL);
      const label = seed.label || `${seed.scale} ${seed.form}`;
      p.text(label, worm.head.x, worm.head.y + headR + 14);
    }

    if (isHover) {
      p.noFill();
      p.stroke(stig.r, stig.g, stig.b, 220);
      p.strokeWeight(1);
      p.circle(worm.head.x, worm.head.y, headR * 2 + 14);
      p.noStroke();
    }

    seed.__screen = { cx: worm.head.x, cy: worm.head.y, r: headR };
  }

  function updateAndDrawRings(p, now) {
    if (!state.rings.length) return;
    const keep = [];
    for (const r of state.rings) {
      if (now < r.born) { keep.push(r); continue; }
      const k = (now - r.born) / r.max;
      if (k >= 1) continue;
      const fade = 1 - k;
      const radius = r.radiusStart + (r.radiusEnd - r.radiusStart) * k;
      p.noFill();
      p.stroke(r.col.r, r.col.g, r.col.b, 220 * fade);
      p.strokeWeight(2.5 * fade + 0.5);
      p.circle(r.x, r.y, radius * 2);
      keep.push(r);
    }
    p.noStroke();
    state.rings = keep;
  }

  function updateAndDrawPlayPulses(p, now) {
    if (!state.playPulses.length) return;
    const keep = [];
    for (const r of state.playPulses) {
      const k = (now - r.born) / r.max;
      if (k >= 1) continue;
      const fade = 1 - k;
      const radius = 8 + k * 48;
      p.noFill();
      p.stroke(r.col.r, r.col.g, r.col.b, 180 * fade);
      p.strokeWeight(1.5 * fade + 0.4);
      p.circle(r.x, r.y, radius * 2);
      keep.push(r);
    }
    p.noStroke();
    state.playPulses = keep;
  }

  function updateAndDrawBursts(p, now) {
    if (!state.bursts.length) return;
    const keep = [];
    for (const b of state.bursts) {
      const k = (now - b.born) / b.max;
      if (k >= 1) continue;
      const fade = 1 - k;
      const dtSec = (now - b.born) / 1000;
      p.noStroke();
      for (const pt of b.particles) {
        const x = pt.x + pt.vx * dtSec;
        const y = pt.y + pt.vy * dtSec - 0.5 * 30 * dtSec * dtSec;
        p.fill(pt.col.r, pt.col.g, pt.col.b, 60 * fade);
        p.circle(x, y, 7);
        p.fill(pt.col.r, pt.col.g, pt.col.b, 220 * fade);
        p.circle(x, y, 2.4);
      }
      keep.push(b);
    }
    state.bursts = keep;
  }

  function drawInfusionStream(_p, _now) {}

  function updateAndDrawDragTrail(p, now) {
    if (!state.dragTrail.length) return;
    const keep = [];
    p.noStroke();
    for (const d of state.dragTrail) {
      const age = now - d.t;
      if (age > 500) continue;
      const k = 1 - age / 500;
      p.fill(d.col.r, d.col.g, d.col.b, 140 * k);
      p.circle(d.x, d.y, 10 * k + 2);
      p.fill(255, 245, 200, 200 * k);
      p.circle(d.x, d.y, 4 * k + 1);
      keep.push(d);
    }
    state.dragTrail = keep;
  }

  function updateCursor() {
    if (!hostEl) return;
    if (drag.id) {
      hostEl.style.cursor = 'grabbing';
    } else if (state.hoverId) {
      hostEl.style.cursor = 'pointer';
    } else {
      hostEl.style.cursor = 'default';
    }
  }

  function positionOverlayButtons() {
    if (!overlayEl) return;
    const kids = overlayEl.children;
    for (let i = 0; i < kids.length; i++) {
      const btn = kids[i];
      const seed = state.seeds[i];
      if (!seed) continue;
      const scr = seed.__screen;
      if (!scr) continue;
      const size = Math.max(36, scr.r * 2 + 12);
      btn.style.left = `${scr.cx - size / 2}px`;
      btn.style.top = `${scr.cy - size / 2}px`;
      btn.style.width = `${size}px`;
      btn.style.height = `${size}px`;
    }
  }

  function localPointer(ev) {
    const rect = hostEl.getBoundingClientRect();
    return { mx: ev.clientX - rect.left, my: ev.clientY - rect.top };
  }

  function hitTestHover(mx, my) {
    let best = null;
    let bestD = 40 * 40;
    for (const seed of state.seeds) {
      const scr = seed.__screen;
      if (!scr) continue;
      const dx = mx - scr.cx;
      const dy = my - scr.cy;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = seed.id;
      }
    }
    return best;
  }

  function hitTestGrab(mx, my) {
    let best = null;
    let bestD = Infinity;
    for (const seed of state.seeds) {
      const scr = seed.__screen;
      if (!scr) continue;
      const grabR = Math.max(18, scr.r + 6);
      const dx = mx - scr.cx;
      const dy = my - scr.cy;
      const d = dx * dx + dy * dy;
      if (d <= grabR * grabR && d < bestD) {
        bestD = d;
        best = seed.id;
      }
    }
    return best;
  }

  function pointerMove(ev) {
    const { mx, my } = localPointer(ev);
    state.cursorX = mx;
    state.cursorY = my;
    state.cursorActive = true;
    if (drag.id) {
      const seed = state.seeds.find((s) => s.id === drag.id);
      if (seed) {
        const dx = mx - drag.lastPx;
        const dy = my - drag.lastPy;
        drag.moved += Math.sqrt(dx * dx + dy * dy);
        drag.lastPx = mx;
        drag.lastPy = my;
        state.dragTrail.push({ x: mx, y: my, t: performance.now(), col: colorForKey(seed) });
        if (state.dragTrail.length > 40) state.dragTrail.shift();
      }
      return;
    }
    state.hoverId = hitTestHover(mx, my);
  }

  function pointerLeave() {
    state.hoverId = null;
    state.cursorActive = false;
    if (drag.id) finishDrag(null);
  }

  function pointerDown(ev) {
    hostEl.setPointerCapture?.(ev.pointerId);
    const { mx, my } = localPointer(ev);
    const id = hitTestGrab(mx, my);
    if (id) {
      drag.id = id;
      drag.startX = mx;
      drag.startY = my;
      drag.lastPx = mx;
      drag.lastPy = my;
      drag.moved = 0;
    }
  }

  function pointerUp(ev) {
    if (!drag.id) return;
    hostEl.releasePointerCapture?.(ev.pointerId);
    finishDrag(ev);
  }

  function finishDrag(_ev) {
    const id = drag.id;
    const moved = drag.moved;
    drag.id = null;
    if (!id) return;
    const seed = state.seeds.find((s) => s.id === id);
    if (!seed) return;
    const worm = state.worms.get(id);
    if (moved < 4) {
      onseedClick(id);
      return;
    }
    if (worm) {
      const ang = Math.random() * Math.PI * 2;
      worm.vel.vx = Math.cos(ang) * worm.speed;
      worm.vel.vy = Math.sin(ang) * worm.speed;
      worm.target = pickRandomTarget();
      worm.nextTargetAt = performance.now() + 3000 + Math.random() * 3000;
    }
    if (worm && state.width && state.height) {
      const padP = Math.max(48, state.width * 0.05);
      const nx = Math.max(0, Math.min(1, (worm.head.x - padP) / Math.max(1, state.width - padP * 2)));
      const ny = Math.max(0, Math.min(1, (worm.head.y - padP) / Math.max(1, state.height - padP * 2)));
      if (!seed.position) seed.position = { x: nx, y: ny };
      else { seed.position.x = nx; seed.position.y = ny; }
      updateSeedPosition(id, { x: nx, y: ny });
    } else {
      updateSeedPosition(id, { x: seed.position?.x ?? 0.5, y: seed.position?.y ?? 0.5 });
    }
  }

  function handleBtnClick(id) {
    onseedClick(id);
  }

  function handleBtnFocus(id) { state.focusId = id; }
  function handleBtnBlur()    { state.focusId = null; }

  function seedAriaLabel(seed) {
    const noteNames = (seed.notes || []).map(noteToName).filter((n) => n.length > 0).join(' ');
    const age = Math.max(0, Math.round(Number(seed.age) || 0));
    const gen = Math.max(0, Math.round(Number(seed.generation) || 0));
    const scale = seed.scale || 'major';
    const form = seed.form || 'motif';
    return `Seed, ${scale} ${form}, notes ${noteNames}, age ${age} days, generation ${gen}. Press Enter to play.`;
  }

  function noteToName(m) {
    if (typeof m === 'string') return m;
    if (typeof m === 'number' && Number.isFinite(m)) {
      const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const pc = ((m % 12) + 12) % 12;
      const oct = Math.floor(m / 12) - 1;
      return `${names[pc]}${oct}`;
    }
    return '';
  }

  $effect(() => {
    if (!hostEl) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion = mq.matches;
    const onMq = (e) => {
      reducedMotion = e.matches;
    };
    mq.addEventListener?.('change', onMq);

    const onResize = () => { p5Instance?.windowResized?.(); };
    window.addEventListener('resize', onResize);

    p5Instance = new p5(sketch);

    return () => {
      window.removeEventListener('resize', onResize);
      mq.removeEventListener?.('change', onMq);
      p5Instance?.remove();
      p5Instance = null;
    };
  });
</script>

<div
  class="garden-host"
  bind:this={hostEl}
  onpointermove={pointerMove}
  onpointerleave={pointerLeave}
  onpointerdown={pointerDown}
  onpointerup={pointerUp}
  onpointercancel={pointerUp}
  role="presentation"
></div>

<div class="a11y-layer" bind:this={overlayEl} aria-label="Garden seeds">
  {#each seeds as seed (seed.id)}
    <button
      type="button"
      class="seed-a11y"
      data-seed-id={seed.id}
      aria-label={seedAriaLabel(seed)}
      onclick={() => handleBtnClick(seed.id)}
      onfocus={() => handleBtnFocus(seed.id)}
      onblur={handleBtnBlur}
    ></button>
  {/each}
</div>

<style>
  .garden-host {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: #04060F;
    overflow: hidden;
    touch-action: none;
  }

  .a11y-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }

  /* pointer-events: none so canvas handles mouse/touch; focus still works. */
  .seed-a11y {
    position: absolute;
    pointer-events: none;
    background: transparent;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    border-radius: 50%;
    color: transparent;
  }

  .seed-a11y:focus {
    pointer-events: auto;
  }

  .seed-a11y:focus-visible {
    outline: 2px solid #C4FF8C;
    outline-offset: 3px;
  }

  @media (prefers-reduced-motion: reduce) {
    .seed-a11y:focus-visible {
      outline: 2px solid #C4FF8C;
      outline-offset: 3px;
    }
  }
</style>
