// URL-hash gift sharing. Encode a minimal seed to base64url; decode on boot.
// Fields serialized: notes, scale, form, latentVector, parentIds (optional), generation.
// Excluded (recipient rebuilds or discards): id, createdAt, lastPlayed, lastEvolved,
// age, position, energy, midi. The midi NoteSequence is reconstructable from
// notes+scale+form via buildNoteSequence, which keeps the payload well under 4KB.

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(encoded) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const full = pad === 0 ? padded : padded + '='.repeat(4 - pad);
  const binary = atob(full);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeGift(seed) {
  const payload = {
    notes: Array.isArray(seed.notes) ? seed.notes.slice() : [],
    scale: seed.scale,
    form: seed.form,
    latentVector: Array.isArray(seed.latentVector) ? seed.latentVector.slice() : [],
    generation: typeof seed.generation === 'number' ? seed.generation : 0,
  };
  if (Array.isArray(seed.parentIds) && seed.parentIds.length > 0) {
    payload.parentIds = seed.parentIds.slice();
  }
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return toBase64Url(bytes);
}

export function decodeGift(encoded) {
  if (typeof encoded !== 'string' || encoded.length === 0) return null;
  try {
    const bytes = fromBase64Url(encoded);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

export function buildGiftUrl(seed) {
  const encoded = encodeGift(seed);
  return `${window.location.origin}${window.location.pathname}#gift=${encoded}`;
}

const ALLOWED_SCALES = new Set(['major', 'minor', 'dorian', 'pentatonic_major', 'blues']);
const ALLOWED_FORMS = new Set(['motif', 'riff', 'arpeggio', 'ostinato', 'round']);

export function validateGiftPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (!Array.isArray(payload.notes) || payload.notes.length < 1 || payload.notes.length > 8) {
    return false;
  }
  for (const n of payload.notes) {
    if (typeof n !== 'string' || n.length === 0) return false;
  }
  if (!ALLOWED_SCALES.has(payload.scale)) return false;
  if (!ALLOWED_FORMS.has(payload.form)) return false;
  if (!Array.isArray(payload.latentVector) || payload.latentVector.length !== 256) {
    return false;
  }
  for (const v of payload.latentVector) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -3 || v > 3) return false;
  }
  return true;
}
