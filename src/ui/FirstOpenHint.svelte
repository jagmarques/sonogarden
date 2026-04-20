<script>
  // First-open hint. Fades in at 900ms, auto-dismisses after 8s or on first interaction.
  // Spec line (ux.md section 1 step 4): "Plant your own. Close the tab. Return tomorrow."
  let { visible = true, ondismiss = () => {} } = $props();

  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let shown = $state(false);

  $effect(() => {
    if (!visible) return;
    const appearDelay = reduced ? 0 : 900;
    const autoDismiss = 8000;
    const t1 = setTimeout(() => { shown = true; }, appearDelay);
    const t2 = setTimeout(() => ondismiss(), appearDelay + autoDismiss);
    const onFirst = () => ondismiss();
    window.addEventListener('pointerdown', onFirst, { once: true });
    window.addEventListener('keydown', onFirst, { once: true });
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('pointerdown', onFirst);
      window.removeEventListener('keydown', onFirst);
    };
  });
</script>

{#if visible && shown}
  <div class="hint-wrap">
    <p class="hint">Your garden plays on its own.</p>
    <p class="hint-tip">Touch modifiers to stack into the melody. Drag to move.</p>
  </div>
{/if}

<style>
  .hint-wrap {
    position: fixed;
    top: 14%;
    left: 50%;
    transform: translateX(-50%);
    max-width: min(640px, calc(100vw - 32px));
    text-align: center;
    pointer-events: none;
    z-index: 20;
    animation: fade-in 1000ms ease-out both;
  }
  .hint {
    font-family: var(--font);
    font-weight: 500;
    font-size: 28px;
    color: var(--petal);
    margin: 0;
    letter-spacing: -0.01em;
  }
  .hint-tip {
    font-family: var(--font);
    font-weight: 400;
    font-size: 14px;
    color: var(--iris);
    margin: 8px 0 0;
    letter-spacing: 0;
  }
  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .hint { animation: fade-in 80ms linear both; }
  }
</style>
