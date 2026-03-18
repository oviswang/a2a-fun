#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { getNetworkSnapshot } from '../src/runtime/network/networkSnapshotV0_1.mjs';

function nowIso() {
  return new Date().toISOString();
}

function workspacePath() {
  return String(process.env.A2A_WORKSPACE_PATH || process.cwd());
}

function trustStateOf(p) {
  return String(p?.trust_state || p?.trust_level || 'UNVERIFIED');
}

async function main() {
  const ws = workspacePath();
  const snap = await getNetworkSnapshot({ bootstrap_timeout_ms: 500 }).catch(() => null);
  const gp = Array.isArray(snap?.gossip_peers) ? snap.gossip_peers : [];

  let verified = 0;
  let unverified = 0;
  let invalid = 0;
  let quarantined = 0;

  for (const p of gp) {
    const st = trustStateOf(p);
    if (st === 'VERIFIED') verified++;
    else if (st === 'QUARANTINED') quarantined++;
    else if (st === 'INVALID') invalid++;
    else unverified++;
  }

  const denom = verified + invalid + quarantined;
  const health_score = denom > 0 ? verified / denom : 1;
  const health_class = health_score >= 0.8 ? 'HEALTHY' : health_score >= 0.5 ? 'MIXED' : 'DEGRADED';

  const sample = {
    ok: true,
    event: 'NETWORK_OBSERVATION_SAMPLE',
    ts: nowIso(),
    node_id: snap?.self?.node_id || null,
    peer_count: gp.length,
    active_peer_count: Array.isArray(snap?.active_peers) ? snap.active_peers.length : null,
    verified,
    unverified,
    invalid,
    quarantined,
    health_score,
    health_class
  };

  const outDir = path.join(ws, 'data');
  await fs.mkdir(outDir, { recursive: true });

  const jsonlPath = path.join(outDir, 'network_observation.jsonl');
  await fs.appendFile(jsonlPath, JSON.stringify(sample) + '\n', 'utf8');

  const latestPath = path.join(outDir, 'network_observation.latest.json');
  await fs.writeFile(latestPath, JSON.stringify({
    ok: true,
    ts: sample.ts,
    node_id: sample.node_id,
    verified: sample.verified,
    unverified: sample.unverified,
    invalid: sample.invalid,
    quarantined: sample.quarantined,
    health_score: sample.health_score,
    health_class: sample.health_class
  }, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify(sample));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, event: 'NETWORK_OBSERVATION_SAMPLE_FAILED', ts: nowIso(), error: String(err?.message || err) }));
  process.exit(1);
});
