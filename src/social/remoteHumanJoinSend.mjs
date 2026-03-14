import { validateRemoteHumanJoinSignal } from './remoteHumanJoinSignal.mjs';

function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

function safeFail(code) {
  return { ok: false, sent: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function sendRemoteHumanJoinSignal({ transport, peer, signal } = {}) {
  if (typeof transport !== 'function') return safeFail('INVALID_TRANSPORT');
  if (!isObj(peer)) return safeFail('INVALID_PEER');

  const vs = validateRemoteHumanJoinSignal(signal);
  if (!vs.ok) return safeFail(vs.error?.code || 'INVALID_SIGNAL');

  try {
    const payload = { kind: 'REMOTE_HUMAN_JOIN_SIGNAL', signal };
    const out = await transport({ ...peer, payload });
    const used = typeof out?.transport === 'string' ? out.transport : null;
    if (out && out.ok === true) {
      return { ok: true, sent: true, transport_used: used, error: null };
    }
    return safeFail(out?.error?.code || 'SEND_FAILED');
  } catch (e) {
    return safeFail(e?.code || 'TRANSPORT_FAILED');
  }
}
