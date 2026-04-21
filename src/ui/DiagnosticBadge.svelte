<script>
  import { onMount, onDestroy } from 'svelte';
  import { getAudioDiagnostics } from '../audio/player.js';

  let { visible = true } = $props();
  let snap = $state(null);
  let timer = null;

  function tick() {
    try { snap = getAudioDiagnostics(); } catch (_) { /* ignore */ }
  }

  onMount(() => {
    tick();
    timer = setInterval(tick, 500);
  });

  onDestroy(() => {
    if (timer) { clearInterval(timer); timer = null; }
  });

  function fmtAgo(ms) {
    if (ms == null) return 'never';
    if (ms < 1000) return `${ms}ms`;
    return `${Math.round(ms / 1000)}s`;
  }
</script>

{#if visible && snap}
  <div class="dbg" aria-hidden="true">
    <div>ctx <span class:ok={snap.toneState === 'running'}>{snap.toneState}</span> / raw <span class:ok={snap.rawState === 'running'}>{snap.rawState}</span></div>
    <div>sr {snap.sampleRate}</div>
    <div>sess <span class:ok={snap.session === 'playback'}>{snap.session}</span></div>
    <div>pad <span class:ok={snap.padConnected}>{snap.padConnected ? 'y' : 'n'}</span> / smp <span class:ok={snap.samplerLoaded}>{snap.samplerLoaded ? 'y' : 'n'}</span></div>
    <div>keep <span class:ok={snap.silentKeepalive}>{snap.silentKeepalive ? 'y' : 'n'}</span></div>
    <div>n {snap.notes} / ago {fmtAgo(snap.lastNoteAgoMs)}</div>
  </div>
{/if}

<style>
  .dbg {
    position: fixed;
    right: 6px;
    bottom: 6px;
    z-index: 120;
    padding: 6px 8px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 10px;
    line-height: 1.3;
    color: #C8D0D6;
    background: rgba(10, 10, 12, 0.82);
    border: 1px solid #2A3A33;
    border-radius: 6px;
    pointer-events: none;
    max-width: 62vw;
    letter-spacing: 0.02em;
  }
  .ok { color: #8BD17C; }
</style>
