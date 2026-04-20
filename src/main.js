import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

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
