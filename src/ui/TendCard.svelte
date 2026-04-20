<script>
  // Tend card: appears anchored to a clicked seed. Shows DNA, actions.
  // Props:
  //   seed: Seed object (see seed-dna.md schema)
  //   anchor: {x, y} viewport px for positioning (optional)
  //   onclose, onplay, onprune, ongift, onparent
  // All actions are emitted via handler callbacks.

  import { gardenState } from '../state/store.svelte.js';

  let {
    seed,
    anchor = null,
    onclose = () => {},
    onplay = () => {},
    onprune = () => {},
    ongift = () => {},
    onparent = () => {}
  } = $props();

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function midiLabel(m) {
    if (typeof m === 'string' && m.length > 0) return m;
    if (typeof m === 'number' && Number.isFinite(m)) {
      const pc = ((m % 12) + 12) % 12;
      const octave = Math.floor(m / 12) - 1;
      return `${NOTE_NAMES[pc]}${octave}`;
    }
    return '';
  }

  // Main seed shows the composer's live RH melody; modifiers keep static notes.
  // Reading liveMelodyTick keeps this derived reactive to composer publishes.
  const notesLabel = $derived.by(() => {
    const tick = gardenState.liveMelodyTick;
    void tick;
    const useLive = seed?.role === 'main' && gardenState.liveMelody.length > 0;
    const source = useLive ? gardenState.liveMelody : (seed?.notes ?? []);
    return source.map(midiLabel).filter((s) => s.length > 0).join(', ');
  });

  const energyPct = $derived(
    Math.max(0, Math.min(1, seed?.energy ?? 0)) * 100
  );

  const ageLabel = $derived(formatAge(seed));

  function formatAge(s) {
    if (!s) return '';
    const now = Date.now();
    const ms = now - (s.createdAt ?? now);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days >= 1) return `planted ${days} day${days === 1 ? '' : 's'} ago`;
    if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const minutes = Math.max(0, Math.floor(ms / (1000 * 60)));
    return `${minutes} min${minutes === 1 ? '' : 's'} ago (${s.age ?? 0} ticks)`;
  }

  let cardEl = $state(null);

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }

  function handleOutsideClick(e) {
    if (cardEl && !cardEl.contains(e.target)) {
      onclose();
    }
  }

  $effect(() => {
    window.addEventListener('keydown', handleKeydown);
    // delay so the click that opened the card does not close it
    const t = setTimeout(() => {
      window.addEventListener('mousedown', handleOutsideClick);
    }, 0);
    queueMicrotask(() => cardEl?.querySelector('button')?.focus());
    return () => {
      window.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('mousedown', handleOutsideClick);
      clearTimeout(t);
    };
  });

  const style = $derived(
    anchor
      ? `left: ${Math.min(anchor.x, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 300)}px; top: ${anchor.y + 20}px;`
      : ''
  );
</script>

<div
  bind:this={cardEl}
  class="tend-card"
  role="dialog"
  aria-labelledby="tend-title"
  {style}
>
  <h2 id="tend-title" class="dna-heading">DNA</h2>

  <dl class="dna-list">
    <dt>notes</dt><dd>{notesLabel || '--'}</dd>
    <dt>scale</dt><dd>{seed?.scale ?? ''}</dd>
    <dt>form</dt><dd>{seed?.form ?? ''}</dd>
    <dt>age</dt><dd>{ageLabel}</dd>
    {#if (seed?.generation ?? 0) > 0}
      <dt>generation</dt><dd>{seed.generation}</dd>
    {/if}
    {#if seed?.parentIds?.length}
      <dt>parents</dt>
      <dd class="parents">
        {#each seed.parentIds as pid, i}
          <button
            type="button"
            class="parent-link"
            aria-label={`Open parent seed ${pid}`}
            onclick={() => onparent(pid)}
          >{pid.slice(0, 6)}</button>{#if i < seed.parentIds.length - 1}, {/if}
        {/each}
      </dd>
    {/if}
  </dl>

  <div class="energy" aria-label={`Energy ${Math.round(energyPct)} percent`}>
    <div class="energy-label">energy</div>
    <div class="energy-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(energyPct)}>
      <div class="energy-fill" style={`width: ${energyPct}%`}></div>
    </div>
  </div>

  <div class="actions">
    <button type="button" class="action" onclick={onplay}>Play now</button>
    {#if seed?.role !== 'main'}
      <button type="button" class="action" onclick={onprune}>Prune</button>
    {/if}
    <button type="button" class="action" onclick={ongift}>Gift (copy link)</button>
  </div>
</div>

<style>
  .tend-card {
    position: fixed;
    width: 280px;
    max-width: calc(100vw - 32px);
    background: color-mix(in srgb, var(--loam) 90%, transparent);
    color: var(--petal);
    font-family: var(--font);
    padding: 16px;
    z-index: 30;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--iris) 10%, transparent),
                0 12px 40px -12px color-mix(in srgb, var(--iris) 18%, transparent);
    border-radius: 4px;
  }

  .dna-heading {
    margin: 0 0 10px;
    font-family: var(--font);
    font-weight: 600;
    font-size: 18px;
    letter-spacing: -0.01em;
    color: var(--petal);
  }

  .dna-list {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 4px 10px;
    margin: 0 0 14px;
    font-size: 13px;
  }
  .dna-list dt {
    color: var(--iris);
    font-weight: 400;
    text-transform: lowercase;
  }
  .dna-list dd {
    margin: 0;
    color: var(--petal);
    word-break: break-word;
  }

  .parents { display: inline; }
  .parent-link {
    background: transparent;
    border: none;
    color: var(--iris);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .parent-link:hover { color: var(--petal); }

  .energy { margin-bottom: 14px; }
  .energy-label {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--iris);
    margin-bottom: 4px;
  }
  .energy-bar {
    height: 3px;
    background: var(--moss);
    border-radius: 2px;
    overflow: hidden;
  }
  .energy-fill {
    height: 100%;
    background: var(--pollen);
    transition: width 300ms ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .energy-fill { transition: none; }
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .action {
    background: transparent;
    color: var(--petal);
    border: none;
    padding: 4px 0;
    font-family: var(--font);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }
  .action:hover { color: var(--pollen); }
</style>
