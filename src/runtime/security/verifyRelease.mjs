import crypto from 'node:crypto';
import { RELEASE_PUBLIC_KEY } from './releasePublicKey.mjs';

function stableStringify(obj) {
  // Deterministic JSON: sort keys recursively, no whitespace.
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(obj));
}

export function verifyReleaseManifest(manifest) {
  try {
    if (!manifest || typeof manifest !== 'object') return { ok: false, reason: 'MANIFEST_NOT_OBJECT' };
    const sigB64 = String(manifest.signature || '').trim();
    if (!sigB64) return { ok: false, reason: 'MISSING_SIGNATURE' };

    const { signature, ...rest } = manifest;
    const msg = stableStringify(rest);

    const ok = crypto.verify(null, Buffer.from(msg, 'utf8'), RELEASE_PUBLIC_KEY, Buffer.from(sigB64, 'base64'));
    return ok ? { ok: true } : { ok: false, reason: 'INVALID_SIGNATURE' };
  } catch (e) {
    return { ok: false, reason: 'VERIFY_THROW', error: String(e?.message || e) };
  }
}

export function canonicalReleasePayload(manifest) {
  const { signature, ...rest } = manifest || {};
  return stableStringify(rest);
}
