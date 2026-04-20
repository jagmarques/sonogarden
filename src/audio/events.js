// Minimal pub-sub so the visual layer can react to audio events without tight coupling.

const _noteListeners = new Set();
const _bloomListeners = new Set();

export function onNote(fn) { _noteListeners.add(fn); return () => _noteListeners.delete(fn); }
export function emitNote(evt) {
  for (const fn of _noteListeners) {
    try { fn(evt); } catch (_) { /* ignore */ }
  }
}

export function onBloom(fn) { _bloomListeners.add(fn); return () => _bloomListeners.delete(fn); }
export function emitBloom() {
  for (const fn of _bloomListeners) {
    try { fn(); } catch (_) { /* ignore */ }
  }
}
