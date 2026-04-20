import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// Cycle 18 debug toggle. Setting `#debug` or `?debug=1` in the URL flips the
// global __SONO_DEBUG__ flag so audio/autoplay/infusion/collision modules log
// fire events to the console. Off by default; no effect on production runs.
if (typeof window !== 'undefined') {
  try {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    if (hash.includes('debug') || /(^|[?&])debug=1(&|$)/.test(search)) {
      window.__SONO_DEBUG__ = true;
    }
  } catch (_) {
    /* ignore */
  }
}

export default mount(App, { target: document.getElementById('app') });
