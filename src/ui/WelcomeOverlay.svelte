<script>
  // Returning-user overlay. Fades in centered, auto-dismiss 3s.
  // Props:
  //   mutations: number
  //   births: number
  //   decays: number
  //   changes: string[]  (short list, top 3 shown)
  //   onclose: () => void

  let {
    mutations = 0,
    births = 0,
    decays = 0,
    changes = [],
    onclose = () => {}
  } = $props();

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const headlineParts = $derived.by(() => {
    const parts = [];
    if (mutations > 0) parts.push(`${mutations} mutation${mutations === 1 ? '' : 's'}`);
    if (births > 0) parts.push(`${births} new birth${births === 1 ? '' : 's'}`);
    if (decays > 0) parts.push(`${decays} decay${decays === 1 ? '' : 's'}`);
    return parts;
  });

  const visible = $derived(headlineParts.length > 0);
  const topChanges = $derived(changes.slice(0, 3));

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function handleClick() {
    onclose();
  }

  $effect(() => {
    if (!visible) return;
    window.addEventListener('keydown', handleKeydown);
    const dismissMs = reduced ? 1500 : 3000;
    const t = setTimeout(onclose, dismissMs);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      clearTimeout(t);
    };
  });
</script>

{#if visible}
  <div
    class="overlay"
    role="status"
    aria-live="polite"
  >
    <p class="line">
      While you were away: {headlineParts.join(', ')}.
    </p>
    {#if topChanges.length > 0}
      <ul class="changes">
        {#each topChanges as c}
          <li>{c}</li>
        {/each}
      </ul>
    {/if}
    <button
      type="button"
      class="dismiss"
      aria-label="Dismiss welcome message"
      onclick={handleClick}
    ></button>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    top: 14%;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(640px, calc(100vw - 32px));
    text-align: center;
    color: var(--petal);
    z-index: 50;
    animation: fade-in 400ms ease-out both, fade-out 600ms ease-in 2400ms forwards;
    padding: 12px 16px;
  }

  .dismiss {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    z-index: -1;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fade-out {
    to { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay {
      animation: fade-in 80ms linear both, fade-out 80ms linear 1420ms forwards;
    }
  }

  .line {
    font-family: var(--font);
    font-weight: 500;
    font-size: 28px;
    letter-spacing: -0.01em;
    margin: 0;
    line-height: 1.25;
  }

  .changes {
    list-style: none;
    padding: 0;
    margin: 10px 0 0;
    font-family: var(--font);
    font-size: 13px;
    color: var(--iris);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
</style>
