<script>
  // audio unlock overlay. one gesture required before Tone.start() can resume.
  let {
    onunlock = () => {},
    tuning = false,
    phase = 'audio',
    percent = 0,
    stuck = false,
    onreload = () => {},
  } = $props();

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function unlock(e) {
    if (tuning) return;
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    onunlock();
  }

  function onKey(e) {
    if (tuning) return;
    unlock(e);
  }

  function triggerReload(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    onreload();
  }
</script>

<svelte:window onkeydown={onKey} />

<button
  type="button"
  class="overlay"
  class:reduced
  class:tuning
  onpointerdown={unlock}
  aria-label={tuning ? 'Tuning instruments' : 'Tap to wake the garden'}
  disabled={tuning}
>
  <div class="inner">
    {#if tuning}
      {#if phase === 'audio'}
        <p class="title">waking audio engine...</p>
      {:else if phase === 'samples'}
        <p class="title">loading instruments... {percent}%</p>
      {:else}
        <p class="title">tuning instruments...</p>
      {/if}
      <p class="sub">loading harp</p>
      {#if stuck}
        <p class="stuck-text">still loading... if stuck, reload the page (cmd+shift+R)</p>
        <button type="button" class="reload-btn" onpointerdown={triggerReload}>Reload</button>
      {/if}
    {:else}
      <p class="title">Tap to wake the garden</p>
      <p class="sub">your garden plays on its own. click a flower to hear it close. listen, prune, plant rarely.</p>
    {/if}
  </div>
</button>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--loam) 80%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: none;
    cursor: pointer;
    padding: 32px;
    font-family: var(--font);
    color: var(--petal);
    z-index: 100;
    animation: fade-in 600ms ease-out both;
  }
  .overlay.reduced {
    animation: fade-in 80ms linear both;
  }
  .overlay.tuning {
    cursor: progress;
  }
  .overlay:disabled {
    opacity: 0.95;
  }
  .inner {
    max-width: min(520px, calc(100vw - 64px));
    text-align: center;
    pointer-events: none;
  }
  .title {
    font-family: var(--font);
    font-weight: 500;
    font-size: 28px;
    letter-spacing: -0.01em;
    margin: 0 0 14px;
    color: var(--petal);
  }
  .sub {
    font-family: var(--font);
    font-weight: 400;
    font-size: 14px;
    color: var(--iris);
    margin: 0;
    letter-spacing: 0;
    line-height: 1.5;
  }
  .stuck-text {
    font-family: var(--font);
    font-weight: 400;
    font-size: 13px;
    color: var(--iris);
    margin: 18px 0 10px;
    letter-spacing: 0;
  }
  .reload-btn {
    pointer-events: auto;
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
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
