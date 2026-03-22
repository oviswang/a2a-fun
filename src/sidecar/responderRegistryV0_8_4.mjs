import fs from 'node:fs/promises';
import path from 'node:path';
import { getLastSuccessTs } from '../availability/responderAvailability.mjs';
import { summarizeResponderHealth } from './responderHealthV0_8_4.mjs';

function nowIso() { return new Date().toISOString(); }
function safeStr(s) { return typeof s === 'string' ? s.trim() : ''; }

async function readJsonSafe(p) {
  try { return JSON.parse(String(await fs.readFile(p, 'utf8'))); } catch { return null; }
}

async function writeJsonAtomic(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, p);
}

export function deriveAvailabilityStatus({ last_seen_ts, last_ready_ts, last_success_ts, health_status } = {}) {
  const now = Date.now();
  const seenMs = Date.parse(String(last_seen_ts || ''));
  const successMs = Date.parse(String(last_success_ts || ''));

  // Failure-driven priority gate
  if (health_status === 'unreliable') return { status: 'unavailable', reason: 'health_unreliable' };

  // If recently successful, it is available.
  if (Number.isFinite(successMs) && (now - successMs) < 2 * 60_000) {
    return { status: 'available', reason: 'recent_success' };
  }

  // If recently seen/ready, but not recently successful → stale.
  const readyMs = Date.parse(String(last_ready_ts || ''));
  const anyFresh = [seenMs, readyMs].some((t) => Number.isFinite(t) && (now - t) < 2 * 60_000);
  if (anyFresh) return { status: 'stale', reason: 'recent_seen_no_recent_success' };

  // If ever seen, but not fresh → unknown unless degraded.
  const everSeen = Number.isFinite(seenMs) || Number.isFinite(readyMs);
  if (everSeen) {
    if (health_status === 'degraded') return { status: 'stale', reason: 'health_degraded' };
    return { status: 'unknown', reason: 'seen_but_not_fresh' };
  }

  return { status: 'unknown', reason: 'no_signals' };
}

export async function updateResponderRegistry({ dataDir, logger } = {}) {
  const dir = safeStr(dataDir) || path.join(process.cwd(), 'data');
  const registryPath = path.join(dir, 'responder-registry.json');

  const presenceCache = await readJsonSafe(path.join(dir, 'presence-cache.json')) || null;
  const capabilitiesCache = await readJsonSafe(path.join(dir, 'capabilities-cache.json')) || null;

  const peers = (presenceCache?.peers && typeof presenceCache.peers === 'object') ? presenceCache.peers : {};
  const capNodes = (capabilitiesCache?.nodes && typeof capabilitiesCache.nodes === 'object') ? capabilitiesCache.nodes : {};

  const prev = await readJsonSafe(registryPath);
  const prevNodes = (prev?.nodes && typeof prev.nodes === 'object') ? prev.nodes : {};

  const nextNodes = { ...prevNodes };

  const discovered = [];

  // Merge from presence-cache
  for (const [node_id, entry] of Object.entries(peers)) {
    const id = safeStr(node_id);
    if (!id) continue;

    const prevN = nextNodes[id] && typeof nextNodes[id] === 'object' ? nextNodes[id] : {};

    const supported = Array.isArray(entry?.supported_task_types)
      ? entry.supported_task_types.map((x) => safeStr(x)).filter(Boolean)
      : [];

    const capsFromPresence = entry?.capabilities && typeof entry.capabilities === 'object'
      ? Object.keys(entry.capabilities).map((x) => safeStr(x)).filter(Boolean)
      : [];

    const capsFromCapCache = capNodes?.[id]?.capabilities && Array.isArray(capNodes[id].capabilities)
      ? capNodes[id].capabilities.map((x) => safeStr(x)).filter(Boolean)
      : [];

    const capabilities = Array.from(new Set([...
      supported,
      ...capsFromPresence,
      ...capsFromCapCache,
    ])).slice(0, 24);

    const last_seen_ts = safeStr(entry?.last_presence_ts) || safeStr(prevN.last_seen_ts) || null;

    // Interpret any capability advertisement as a ready signal.
    const last_ready_ts = capabilities.length
      ? (safeStr(entry?.last_presence_ts) || safeStr(prevN.last_ready_ts) || nowIso())
      : (safeStr(prevN.last_ready_ts) || null);

    const last_success_ts = getLastSuccessTs(id, { dataDir: dir }) || safeStr(prevN.last_success_ts) || null;

    const health = summarizeResponderHealth(id, { dataDir: dir });

    const derived = deriveAvailabilityStatus({
      last_seen_ts,
      last_ready_ts,
      last_success_ts,
      health_status: health.status,
    });

    nextNodes[id] = {
      capabilities,
      last_seen_ts,
      last_ready_ts,
      last_success_ts,
      availability_status: derived.status,
      health_status: health.status,
      health_stats: health.stats,
      last_failure_ts: health.last_failure_ts || null,
    };

    if (!prevNodes[id]) discovered.push(id);
  }

  const out = { ts: nowIso(), nodes: nextNodes };
  await writeJsonAtomic(registryPath, out);

  for (const id of discovered.slice(0, 20)) {
    try { process.stdout.write(`${JSON.stringify({ ok: true, event: 'RESPONDER_DISCOVERED', node_id: id, ts: out.ts })}\n`); } catch {}
  }
  try { process.stdout.write(`${JSON.stringify({ ok: true, event: 'RESPONDER_REGISTRY_UPDATED', ts: out.ts, node_count: Object.keys(nextNodes).length })}\n`); } catch {}

  if (typeof logger === 'function') {
    try { logger({ ok: true, updated: true, node_count: Object.keys(nextNodes).length }); } catch {}
  }

  return { ok: true, path: registryPath, registry: out };
}

export async function loadResponderRegistry({ dataDir } = {}) {
  const dir = safeStr(dataDir) || path.join(process.cwd(), 'data');
  const registryPath = path.join(dir, 'responder-registry.json');
  const j = await readJsonSafe(registryPath);
  if (j && j.nodes && typeof j.nodes === 'object') return { ok: true, path: registryPath, registry: j };
  return { ok: false, path: registryPath, registry: { ts: nowIso(), nodes: {} } };
}
