import { Readable } from 'node:stream';

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) {
        reject(Object.assign(new Error('directInbound: body too large'), { code: 'BODY_TOO_LARGE' }));
        req.destroy?.();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Minimal direct inbound bridge.
 *
 * - parse JSON body
 * - extract { payload }
 * - forward payload to onInbound(payload)
 *
 * Hard rules:
 * - no protocol interpretation
 * - no envelope mutation
 * - no friendship logic
 */
export async function handleDirectInbound(req, { onInbound, maxBytes = 256 * 1024 } = {}) {
  if (!req || typeof req.on !== 'function') {
    const e = new Error('handleDirectInbound: req must be a stream');
    e.code = 'INVALID_REQ';
    throw e;
  }
  if (typeof onInbound !== 'function') {
    const e = new Error('handleDirectInbound: missing onInbound');
    e.code = 'INVALID_INPUT';
    throw e;
  }

  const raw = await readBody(req, maxBytes);
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    const e = new Error('directInbound: BAD_JSON');
    e.code = 'BAD_JSON';
    throw e;
  }

  if (!j || typeof j !== 'object' || !('payload' in j)) {
    const e = new Error('directInbound: missing payload');
    e.code = 'MISSING_PAYLOAD';
    throw e;
  }

  return onInbound(j.payload);
}

// Tiny helper for tests only (not used by runtime).
export const _test = {
  makeReqFromString(s) {
    const r = Readable.from([Buffer.from(String(s), 'utf8')]);
    return r;
  }
};
