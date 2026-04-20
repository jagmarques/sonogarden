<script>
  // Bottom-right 44x44 mute toggle. Always visible. Persists via onchange handler.
  let { muted = false, onchange = () => {} } = $props();

  function toggle() {
    onchange(!muted);
  }
</script>

<button
  type="button"
  class="mute"
  aria-pressed={muted}
  aria-label={muted ? 'Audio muted, click to unmute' : 'Audio on, click to mute'}
  onclick={toggle}
>
  {#if muted}
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M4 9 L4 15 L8 15 L13 19 L13 5 L8 9 Z" fill="currentColor" />
      <path d="M16 9 L21 14 M21 9 L16 14" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d="M4 9 L4 15 L8 15 L13 19 L13 5 L8 9 Z" fill="currentColor" />
      <path d="M16 8 Q19 12 16 16 M18 6 Q22 12 18 18" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" />
    </svg>
  {/if}
</button>

<style>
  .mute {
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 44px;
    height: 44px;
    background: transparent;
    border: 1px solid var(--moss);
    color: var(--petal);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font);
    font-size: 14px;
    font-weight: 500;
    border-radius: 9999px;
    z-index: 50;
  }
  .mute:hover {
    background: var(--moss);
    color: var(--pollen);
  }
</style>
