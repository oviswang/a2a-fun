import { createHash } from 'node:crypto';
import { jcsStringify } from './jcs.mjs';

function sha256HexUtf8(s) {
  return createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function b64DecodedLen(b64) {
  if (typeof b64 !== 'string') return 0;
  try {
    return Buffer.from(b64, 'base64').length;
  } catch {
    return 0;
  }
}

/**
 * Compute probe_transcript_hash per v0.4.3 frozen rules.
 *
 * @param {string} session_id
 * @param {Array<object>} probeEnvelopes
 */
export function computeProbeTranscriptHash(session_id, probeEnvelopes) {
  if (!session_id) throw new Error('session_id required');
  const onlyProbe = (probeEnvelopes ?? []).filter(e => e && typeof e.type === 'string' && e.type.startsWith('probe.'))
    .filter(e => e.session_id === session_id);

  const ordered = onlyProbe.slice().sort((a, b) => {
    const ta = String(a.ts ?? '');
    const tb = String(b.ts ?? '');
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    const ma = String(a.msg_id ?? '');
    const mb = String(b.msg_id ?? '');
    return ma < mb ? -1 : ma > mb ? 1 : 0;
  });

  const items = ordered.map((e, idx) => {
    const e_core = {
      v: e.v,
      type: e.type,
      msg_id: e.msg_id,
      session_id: e.session_id,
      ts: e.ts,
      from: { actor_id: e.from?.actor_id, key_fpr: e.from?.key_fpr },
      to: { actor_id: e.to?.actor_id, key_fpr: e.to?.key_fpr },
      crypto: { enc: e.crypto?.enc, kdf: e.crypto?.kdf, nonce: e.crypto?.nonce },
      body: { ciphertext: e.body?.ciphertext }
    };

    const msg_hash = sha256HexUtf8(jcsStringify(e_core));
    const ciphertext_len = b64DecodedLen(e.body?.ciphertext);

    return {
      i: idx + 1,
      ts: e.ts,
      type: e.type,
      msg_hash,
      ciphertext_len
    };
  });

  const transcript_core = { session_id, v: '0.4.3', probe: items };
  const probe_transcript_hash = sha256HexUtf8(jcsStringify(transcript_core));
  return { probe_transcript_hash, items };
}
