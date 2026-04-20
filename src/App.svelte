<script>
  // Sonogarden root. Boots Magenta, loads the garden, plants starters, wires audio.

  import * as Tone from 'tone';

  import Garden from './visual/Garden.svelte';
  import TendCard from './ui/TendCard.svelte';
  import WelcomeOverlay from './ui/WelcomeOverlay.svelte';
  import MuteButton from './ui/MuteButton.svelte';
  import FirstOpenHint from './ui/FirstOpenHint.svelte';
  import StartOverlay from './ui/StartOverlay.svelte';

  import {
    gardenState,
    loadGardenFromDB,
    plantSeed,
    playSeed,
    unplaySeed,
    pruneSeed,
    importGiftedSeed,
  } from './state/store.svelte.js';
  import { ensureStarterSeeds, STARTER_COUNT } from './state/starter.js';
  import { initMagenta } from './ai/magenta.js';
  import { setGardenState } from './persistence/db.js';
  import { initAudio, playNoteSequence, setMuted, stopAll, playCollision, waitForVoicesLoaded, setMainVoice, setMood } from './audio/player.js';
  import { AVAILABLE_VOICES } from './audio/voices.js';
  import { MOODS, DEFAULT_MOOD } from './audio/moods.js';
  import { startAutoplay, stopAutoplay, refreshAutoplay, onMoodChange } from './audio/autoplay.js';
  import { absorbModifier, isAbsorbed } from './audio/infusion.js';
  import { buildGiftUrl, decodeGift, validateGiftPayload } from './share/gift.js';

  const DEBUG = false;

  let booting = $state(true);
  let bootError = $state(null);
  let tendSeed = $state(null);
  let giftFlashId = $state(null);
  let giftImportedSeedId = $state(null);
  let giftBannerTimer = null;
  let welcomeSummary = $state(null);
  let firstOpen = $state(false);
  let starterProgress = $state(0);
  let audioUnlocked = $state(false);
  let tuningInstruments = $state(false);
  let bootPhase = $state('magenta');
  let samplePercent = $state(0);
  let bootStuck = $state(false);
  let autoplayActive = false;
  let bootStuckTimer = null;
  let respawnTimer = null;
  let spawnOn = $state(true);
  let mainInstrument = $state(MOODS[DEFAULT_MOOD].instrument);
  let activity = $state(DEFAULT_MOOD);

  function toggleSpawn() {
    spawnOn = !spawnOn;
    if (spawnOn) startRespawnTimer();
    else stopRespawnTimer();
  }

  function handleInstrumentChange(e) {
    mainInstrument = e.target.value;
    setMainVoice(mainInstrument);
  }

  // Switching activity reshapes BPM, reverb, voice, density, range.
  function handleActivityChange(e) {
    activity = e.target.value;
    const m = setMood(activity);
    if (m) {
      mainInstrument = m.instrument;
      if (typeof window !== 'undefined') window.__sonoMood = m;
      onMoodChange();
    }
  }

  $effect(() => {
    const m = MOODS[activity];
    if (typeof window !== 'undefined' && m) window.__sonoMood = m;
  });

  const seeds = $derived(gardenState.seeds);
  const playingIds = $derived(gardenState.playingIds);
  const muted = $derived(gardenState.muted);

  function logError(context, err) {
    if (DEBUG) {
      // eslint-disable-next-line no-console
      console.error(`[sonogarden] ${context}`, err);
    }
  }

  function playSeedAudio(seed) {
    if (!seed || gardenState.muted) return;
    playNoteSequence(seed.midi, {
      seedId: seed.id,
      scale: seed.scale,
      form: seed.form,
      energy: typeof seed.energy === 'number' ? seed.energy : 1,
      onEnd: () => unplaySeed(seed.id),
    });
  }

  function markPlayingAutoplay(seedId) {
    if (!gardenState.playingIds.has(seedId)) {
      const next = new Set(gardenState.playingIds);
      next.add(seedId);
      gardenState.playingIds = next;
    }
  }

  function markStoppedAutoplay(seedId) {
    if (gardenState.playingIds.has(seedId)) {
      const next = new Set(gardenState.playingIds);
      next.delete(seedId);
      gardenState.playingIds = next;
    }
  }

  function maybeStartAutoplay() {
    if (autoplayActive) return;
    if (!audioUnlocked || booting) return;
    autoplayActive = true;
    startAutoplay(gardenState, {
      getSeeds: () => gardenState.seeds,
      markPlaying: markPlayingAutoplay,
      markStopped: markStoppedAutoplay,
    });
  }

  async function handleUnlock() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    tuningInstruments = true;
    bootPhase = 'audio';
    try {
      await initAudio();
      // Apply default mood once audio is up so BPM/reverb match.
      const m = setMood(activity);
      if (m) mainInstrument = m.instrument;
    } catch (err) {
      logError('initAudio failed', err);
    }
    // block first autoplay on samples so seeds don't miss their first hit.
    bootPhase = 'samples';
    samplePercent = 0;
    const sampleStart = performance.now();
    const progTimer = setInterval(() => {
      const elapsed = performance.now() - sampleStart;
      samplePercent = Math.min(95, Math.round((elapsed / 12000) * 100));
    }, 200);
    try {
      await waitForVoicesLoaded();
    } catch (err) {
      logError('waitForVoicesLoaded failed', err);
    } finally {
      clearInterval(progTimer);
      samplePercent = 100;
    }
    tuningInstruments = false;
    installCollisionHook();
    startRespawnTimer();
    maybeStartAutoplay();
  }

  // Build a short label string for a spawned modifier effect.
  function describeEffect(e) {
    if (!e) return '';
    if (e.kind === 'pitch') return `pitch ${e.shift >= 0 ? '+' : ''}${e.shift}`;
    if (e.kind === 'tone') return e.softness > 0 ? 'softer' : 'brighter';
    if (e.kind === 'progression') return 'progression';
    return '';
  }

  // Spawn a fresh modifier every ~14s up to a cap of 8.
  function startRespawnTimer() {
    if (respawnTimer) return;
    respawnTimer = setInterval(() => {
      const mods = gardenState.seeds.filter((s) => s.role === 'modifier').length;
      if (mods >= 24) return;
      const pool = [
        { notes: ['C4'], scale: 'major', form: 'motif', role: 'modifier', effect: { kind: 'pitch', shift: Math.floor(Math.random() * 14) - 7 }, label: null },
        { notes: ['A4'], scale: 'minor', form: 'motif', role: 'modifier', effect: { kind: 'tone', softness: (Math.random() < 0.5 ? 1 : -1) }, label: null },
        { notes: ['C5', 'G4'], scale: 'major', form: 'motif', role: 'modifier', effect: { kind: 'progression', steps: [0, 7, 5, 0] }, label: null },
      ];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      pick.label = describeEffect(pick.effect);
      plantSeed(pick)
        .then(() => refreshAutoplay())
        .catch((err) => logError('respawn plantSeed failed', err));
    }, 2000);
  }

  function stopRespawnTimer() {
    if (respawnTimer) {
      clearInterval(respawnTimer);
      respawnTimer = null;
    }
  }

  function installCollisionHook() {
    if (typeof window === 'undefined') return;
    window.__sonogarden_onCollision = (idA, idB) => {
      const a = gardenState.seeds.find((s) => s.id === idA);
      const b = gardenState.seeds.find((s) => s.id === idB);
      if (!a || !b) {
        if (window.__SONO_DEBUG__) {
          // eslint-disable-next-line no-console
          console.log('[sonogarden.app] collision ignored: seed lookup failed', { idA, idB });
        }
        return;
      }
      playCollision(a, b);
      // main+modifier collisions absorb the modifier into the main loop.
      const aIsMain = a.role === 'main';
      const bIsMain = b.role === 'main';
      if (window.__SONO_DEBUG__) {
        // eslint-disable-next-line no-console
        console.log('[sonogarden.app] collision', {
          a: { id: a.id, role: a.role },
          b: { id: b.id, role: b.role },
        });
      }
      const modifier = aIsMain && !bIsMain ? b : (bIsMain && !aIsMain ? a : null);
      if (modifier && !isAbsorbed(modifier.id)) {
        absorbModifier(modifier);
        // Publish a flash event for Garden.svelte to render big feedback on main.
        if (typeof window !== 'undefined') {
          window.__sonoAbsorbFlash = {
            label: modifier.label || describeEffect(modifier.effect) || 'absorbed',
            born: performance.now(),
          };
        }
        // Consume the modifier so it disappears after being added.
        pruneSeed(modifier.id).catch((err) => logError('absorb prune failed', err));
      }
    };
  }

  function uninstallCollisionHook() {
    if (typeof window === 'undefined') return;
    if (window.__sonogarden_onCollision) {
      try { delete window.__sonogarden_onCollision; } catch (_) { window.__sonogarden_onCollision = null; }
    }
  }

  async function boot() {
    bootPhase = 'magenta';
    try {
      await initMagenta();
    } catch (err) {
      logError('initMagenta failed', err);
      bootError = err?.message || 'Audio engine unavailable';
      booting = false;
      return;
    }

    try {
      bootPhase = 'db';
      const seedsBefore = [...gardenState.seeds];
      await loadGardenFromDB();

      if (gardenState.seeds.length === 0) {
        firstOpen = true;
        starterProgress = 0;
        bootPhase = 'starters';
        await ensureStarterSeeds(gardenState, (i) => { starterProgress = i; });
      } else if (!gardenState.seeds.some((s) => s?.role === 'main')) {
        // Safety net: loaded seeds but no main - plant one.
        firstOpen = true;
        starterProgress = 0;
        bootPhase = 'starters';
        await plantSeed({ notes: ['C4','E4','G4','A4','G4','F4','E4','D4','C4'], scale: 'major', form: 'riff', role: 'main' }).catch(() => {});
      } else if (seedsBefore.length === 0 && gardenState.__lastSummary) {
        const s = gardenState.__lastSummary;
        if (s.mutations + s.births + s.decays > 0) {
          welcomeSummary = { ...s, changes: [] };
        }
      }

      await processGiftHash();
    } catch (err) {
      logError('loadGardenFromDB failed', err);
      bootError = err?.message || 'Garden failed to load';
    } finally {
      booting = false;
      maybeStartAutoplay();
    }
  }

  function reloadPage() {
    try { window.location.reload(); } catch (_) { /* ignore */ }
  }

  async function processGiftHash() {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash || !hash.startsWith('#gift=')) return;
    const encoded = hash.slice('#gift='.length);
    const payload = decodeGift(encoded);
    try {
      if (!payload || !validateGiftPayload(payload)) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        return;
      }
      const seed = await importGiftedSeed(payload);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      if (seed) {
        giftImportedSeedId = seed.id;
        if (giftBannerTimer) clearTimeout(giftBannerTimer);
        giftBannerTimer = setTimeout(() => {
          giftImportedSeedId = null;
          giftBannerTimer = null;
        }, 4000);
      }
    } catch (err) {
      logError('gift import failed', err);
      try {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (_) {
        // ignore
      }
    }
  }

  function dismissGiftBanner() {
    if (giftBannerTimer) {
      clearTimeout(giftBannerTimer);
      giftBannerTimer = null;
    }
    giftImportedSeedId = null;
  }

  function handleSeedClick(seedId) {
    const seed = gardenState.seeds.find((s) => s.id === seedId);
    if (!seed) return;
    tendSeed = seed;

    // Play immediately on click so the user hears the seed on first interaction.
    if (!gardenState.muted) {
      const next = new Set(gardenState.playingIds);
      next.add(seed.id);
      gardenState.playingIds = next;
      playSeedAudio(seed);
    }
  }

  function handleTendPlay() {
    if (!tendSeed) return;
    const seed = tendSeed;
    const midi = playSeed(seed.id);
    if (midi && !gardenState.muted) {
      playNoteSequence(midi, {
        seedId: seed.id,
        scale: seed.scale,
        form: seed.form,
        energy: typeof seed.energy === 'number' ? seed.energy : 1,
        onEnd: () => unplaySeed(seed.id),
      });
    } else if (midi && gardenState.muted) {
      unplaySeed(seed.id);
    }
  }

  function handleTendPrune() {
    if (!tendSeed) return;
    if (tendSeed.role === 'main') return;
    const id = tendSeed.id;
    tendSeed = null;
    pruneSeed(id)
      .then(() => refreshAutoplay())
      .catch((err) => logError('pruneSeed failed', err));
  }

  async function handleTendGift() {
    if (!tendSeed) return;
    try {
      const url = buildGiftUrl(tendSeed);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
      const flashId = tendSeed.id;
      giftFlashId = flashId;
      setTimeout(() => {
        if (giftFlashId === flashId) giftFlashId = null;
      }, 1600);
    } catch (err) {
      logError('gift copy failed', err);
    }
  }

  function handleTendParent(parentId) {
    const parent = gardenState.seeds.find((s) => s.id === parentId);
    if (parent) tendSeed = parent;
  }

  function handleTendClose() {
    tendSeed = null;
  }

  function handleWelcomeClose() {
    welcomeSummary = null;
  }

  function handleFirstOpenDismiss() {
    firstOpen = false;
  }

  function handleMuteChange(next) {
    gardenState.muted = next;
    // Don't kill loops on mute; just silence Destination so unmute is instant.
    setMuted(next);
  }

  function handleGlobalKeydown(e) {
    if (e.key !== 'Escape') return;
    let handled = false;
    if (tendSeed) { tendSeed = null; handled = true; }
    if (welcomeSummary) { welcomeSummary = null; handled = true; }
    if (handled) e.preventDefault();
  }

  function handleBeforeUnload() {
    try {
      setGardenState({ lastOpened: Date.now(), version: 'v1' });
    } catch (err) {
      logError('setGardenState on unload failed', err);
    }
    try {
      stopAutoplay();
      stopAll();
    } catch (_) {
      /* ignore */
    }
    uninstallCollisionHook();
    stopRespawnTimer();
  }

  // iOS Safari suspends AudioContext on hide; resume explicitly on return.
  function handleVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    if (!audioUnlocked) return;
    try {
      const ctx = Tone.getContext();
      if (ctx && ctx.state !== 'running') {
        const raw = ctx.rawContext;
        if (raw && typeof raw.resume === 'function') {
          raw.resume().catch((err) => logError('audio context resume failed', err));
        }
      }
    } catch (err) {
      logError('visibilitychange resume failed', err);
    }
  }

  $effect(() => {
    boot();
    bootStuckTimer = setTimeout(() => {
      if (booting || tuningInstruments) bootStuck = true;
    }, 25000);
    return () => {
      if (bootStuckTimer) clearTimeout(bootStuckTimer);
      bootStuckTimer = null;
    };
  });

  $effect(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      uninstallCollisionHook();
      stopRespawnTimer();
    };
  });
</script>

{#if bootError}
  <div class="error-banner" role="alert">
    <span class="error-text">{bootError}</span>
  </div>
{/if}

{#if booting}
  <div class="loading" role="status" aria-live="polite">
    {#if bootPhase === 'magenta'}
      <span>loading AI model...</span>
    {:else if bootPhase === 'db'}
      <span>reading garden...</span>
    {:else if bootPhase === 'starters'}
      <span>growing... {starterProgress}/{STARTER_COUNT}</span>
    {:else}
      <span>loading...</span>
    {/if}
    {#if bootStuck}
      <div class="stuck">
        <p>still loading... if stuck, reload the page (cmd+shift+R)</p>
        <button type="button" class="reload-btn" onclick={reloadPage}>Reload</button>
      </div>
    {/if}
  </div>
{:else}
  <Garden
    seeds={seeds}
    playingIds={playingIds}
    onseedClick={handleSeedClick}
  />

  {#if !audioUnlocked || tuningInstruments}
    <StartOverlay
      onunlock={handleUnlock}
      tuning={tuningInstruments}
      phase={bootPhase}
      percent={samplePercent}
      stuck={bootStuck}
      onreload={reloadPage}
    />
  {/if}

  {#if firstOpen && audioUnlocked}
    <FirstOpenHint visible={firstOpen} ondismiss={handleFirstOpenDismiss} />
  {/if}

  {#if welcomeSummary}
    <WelcomeOverlay
      mutations={welcomeSummary.mutations}
      births={welcomeSummary.births}
      decays={welcomeSummary.decays}
      changes={welcomeSummary.changes ?? []}
      onclose={handleWelcomeClose}
    />
  {/if}

  {#if giftFlashId}
    <div class="gift-flash" role="status" aria-live="polite">link copied</div>
  {/if}

  {#if giftImportedSeedId}
    <button
      type="button"
      class="gift-banner"
      aria-live="polite"
      onclick={dismissGiftBanner}
    >
      a gift was planted in your garden
    </button>
  {/if}

  {#if tendSeed}
    <TendCard
      seed={tendSeed}
      onclose={handleTendClose}
      onplay={handleTendPlay}
      onprune={handleTendPrune}
      ongift={handleTendGift}
      onparent={handleTendParent}
    />
  {/if}

  <MuteButton muted={muted} onchange={handleMuteChange} />

  <div class="control-bar">
    <select class="activity-select" aria-label="Activity" value={activity} onchange={handleActivityChange} title={MOODS[activity]?.evidence ?? ''}>
      {#each Object.keys(MOODS) as key}
        <option value={key}>{MOODS[key].label}</option>
      {/each}
    </select>
    <button type="button" class="spawn-toggle" onclick={toggleSpawn} aria-pressed={spawnOn}>
      {spawnOn ? 'stop spawning' : 'start spawning'}
    </button>
    <span class="activity-evidence">{MOODS[activity]?.evidence ?? ''}</span>
  </div>
{/if}

<style>
  .loading {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--petal);
    font-family: var(--font);
    font-weight: 500;
    font-size: 22px;
    letter-spacing: -0.01em;
    background: var(--loam);
    z-index: 60;
  }
  .stuck {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
  }
  .stuck p {
    margin: 0;
    font-size: 13px;
    color: var(--iris);
    font-weight: 400;
    text-align: center;
  }
  .reload-btn {
    height: 32px;
    padding: 0 14px;
    background: color-mix(in srgb, var(--loam) 86%, transparent);
    border: 1px solid var(--moss);
    color: var(--petal);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
  }
  .reload-btn:hover,
  .reload-btn:focus-visible {
    border-color: var(--iris);
    color: var(--pollen);
  }

  .error-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--loam) 92%, transparent);
    border-bottom: 1px solid var(--moss);
    color: var(--petal);
    font-family: var(--font);
    font-style: italic;
    font-size: 15px;
    text-align: center;
    z-index: 70;
  }

  .error-text {
    color: var(--pollen);
  }

  .control-bar {
    position: fixed;
    right: 16px;
    top: 16px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    z-index: 55;
    pointer-events: auto;
    max-width: 280px;
  }
  .control-bar select,
  .control-bar .spawn-toggle {
    height: 32px;
    padding: 0 14px;
    background: #14191C;
    border: 1px solid #2A3A33;
    border-radius: 9999px;
    color: #E8C9A0;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-transform: lowercase;
    letter-spacing: -0.005em;
  }
  .control-bar select {
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238AA6C1' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
    min-width: 160px;
  }
  .control-bar select option { background: var(--loam); color: var(--iris); }
  .control-bar select:hover,
  .control-bar select:focus-visible,
  .control-bar .spawn-toggle:hover,
  .control-bar .spawn-toggle:focus-visible {
    color: var(--iris);
    border-color: var(--iris);
  }
  .mood-symbol {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 320px;
    line-height: 1;
    opacity: 0.08;
    pointer-events: none;
    z-index: 1;
    transition: opacity 600ms ease, color 600ms ease;
    font-family: var(--font);
  }
  .activity-evidence {
    font-family: var(--font);
    font-size: 10px;
    color: color-mix(in srgb, var(--iris) 55%, transparent);
    text-align: right;
    padding: 0 6px;
    opacity: 0;
    transition: opacity 160ms ease-out;
    pointer-events: none;
    line-height: 1.3;
  }
  .control-bar:hover .activity-evidence,
  .control-bar:focus-within .activity-evidence {
    opacity: 1;
  }

  .gift-banner {
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 14px;
    background: color-mix(in srgb, var(--loam) 90%, transparent);
    border: 1px solid var(--moss);
    color: var(--petal);
    font-family: var(--font);
    font-size: 13px;
    font-weight: 500;
    z-index: 55;
    border-radius: 3px;
    cursor: pointer;
  }
  .gift-banner:hover,
  .gift-banner:focus-visible {
    color: var(--pollen);
  }

  .gift-flash {
    position: fixed;
    bottom: 72px;
    right: 16px;
    padding: 6px 10px;
    background: color-mix(in srgb, var(--loam) 90%, transparent);
    border: 1px solid var(--moss);
    color: var(--pollen);
    font-family: var(--font);
    font-size: 13px;
    z-index: 55;
    border-radius: 3px;
  }
</style>
