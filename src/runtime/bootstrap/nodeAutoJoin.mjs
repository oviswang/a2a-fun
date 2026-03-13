import { promises as fs } from 'node:fs';
import path from 'node:path';

import { bootstrapJoin, bootstrapGetPeers, _internal as _clientInternal } from './bootstrapClient.mjs';

function safeResult(status, fields = {}) {
  return { ok: status === 'SUCCESS', status, ...fields };
}

function isUnreachableError(e) {
  // Treat network/timeout/DNS as unreachable; HTTP-level errors are "reachable".
  const msg = String(e?.message || '');
  return (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('aborted')
  );
}

async function atomicWriteJson(filePath, obj) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, filePath);
}

function selectPeers({ peers, selfNodeUrl, maxPeers }) {
  const self = _clientInternal.validateNodeUrl(selfNodeUrl);
  const set = new Set(peers.map(_clientInternal.validateNodeUrl));
  set.delete(self);
  const arr = Array.from(set);
  arr.sort();
  return arr.slice(0, maxPeers);
}

export async function runNodeAutoJoin({
  selfNodeUrl,
  bootstrapPrimary,
  bootstrapFallback,
  maxPeers = 3,
  storage = null,
  httpClient
}) {
  if (!selfNodeUrl) throw new Error('AutoJoin: missing selfNodeUrl');
  if (!bootstrapPrimary) throw new Error('AutoJoin: missing bootstrapPrimary');
  if (!bootstrapFallback) throw new Error('AutoJoin: missing bootstrapFallback');
  if (!httpClient) throw new Error('AutoJoin: missing httpClient');
  if (!Number.isFinite(maxPeers) || maxPeers < 1 || maxPeers > 3) throw new Error('AutoJoin: maxPeers must be 1..3');

  // Try primary first.
  let used = 'primary';
  let base = bootstrapPrimary;

  try {
    await bootstrapJoin({ bootstrapUrl: base, selfNodeUrl, httpClient });
    const { peers } = await bootstrapGetPeers({ bootstrapUrl: base, httpClient });
    const selected = selectPeers({ peers, selfNodeUrl, maxPeers });

    await persistKnownPeers({ storage, selected, base });

    return safeResult('SUCCESS', {
      bootstrap_used: used,
      joined: true,
      peers_fetched: peers.length,
      selected_peers: selected
    });
  } catch (e) {
    if (!isUnreachableError(e)) {
      // Primary reachable but rejected/failed -> fail closed; do not fallback.
      throw e;
    }
  }

  // Fallback only if primary unreachable.
  used = 'fallback';
  base = bootstrapFallback;

  await bootstrapJoin({ bootstrapUrl: base, selfNodeUrl, httpClient });
  const { peers } = await bootstrapGetPeers({ bootstrapUrl: base, httpClient });
  const selected = selectPeers({ peers, selfNodeUrl, maxPeers });

  await persistKnownPeers({ storage, selected, base });

  return safeResult('SUCCESS', {
    bootstrap_used: used,
    joined: true,
    peers_fetched: peers.length,
    selected_peers: selected
  });
}

async function persistKnownPeers({ storage, selected, base }) {
  const record = {
    source: base,
    selected_peers: selected,
    updated_at: new Date().toISOString()
  };

  // Optional storage integration (additive):
  // - if caller provides storage.writeKnownPeers, use it
  // - else persist to data/known-peers.json
  try {
    if (storage && typeof storage.writeKnownPeers === 'function') {
      await storage.writeKnownPeers(record);
      return;
    }

    await atomicWriteJson('data/known-peers.json', record);
  } catch (e) {
    const err = new Error('AutoJoin: persist failed (fail closed)');
    err.cause = e;
    throw err;
  }
}

export const _internalAutoJoin = { selectPeers };
