// Thin wrapper. Real composition logic lives in composer.js.
// Kept as a named entry point so autoplay.js and tests do not need to change.

import { composePhrase, resetComposer, composerState } from './composer.js';

export function generatePhrase(_opts = {}, rng = Math.random) {
  return composePhrase(rng);
}

export { resetComposer, composerState };
