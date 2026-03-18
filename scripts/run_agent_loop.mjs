#!/usr/bin/env node
import { runLoop } from '../src/runtime/agentRuntimeLoop.mjs';

function parseArgs(argv) {
  const out = { once: false, daemon: false, holder: null, relay: 'http://127.0.0.1:18884', directory: 'https://bootstrap.a2a.fun', relayUrl: 'wss://bootstrap.a2a.fun/relay', taskSyncPeer: null, claimAnnouncePeers: null, gossipPeers: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') out.once = true;
    else if (a === '--daemon') out.daemon = true;
    else if (a === '--holder') out.holder = argv[++i] || null;
    else if (a === '--relay') out.relay = argv[++i] || out.relay;
    else if (a === '--directory') out.directory = argv[++i] || out.directory;
    else if (a === '--relayUrl') out.relayUrl = argv[++i] || out.relayUrl;
    else if (a === '--task-sync-peer') out.taskSyncPeer = argv[++i] || null;
    else if (a === '--claim-announce-peers') out.claimAnnouncePeers = (argv[++i] || '').split(',').map(s=>s.trim()).filter(Boolean);
    else if (a === '--gossip-peers') out.gossipPeers = (argv[++i] || '').split(',').map(s=>s.trim()).filter(Boolean);
  }
  return out;
}

const args = parseArgs(process.argv);

// Config overrides (IMPLEMENT_NODE_NETWORK_INTEGRATION_V0_1)
if (process.env.BOOTSTRAP_BASE_URL && String(process.env.BOOTSTRAP_BASE_URL).trim()) {
  args.directory = String(process.env.BOOTSTRAP_BASE_URL).trim();
}
if (process.env.RELAY_URL && String(process.env.RELAY_URL).trim()) {
  args.relayUrl = String(process.env.RELAY_URL).trim();
}

const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

// SINGLE INSTANCE LOCK (data/daemon.lock)
// - If lock exists and PID is alive for a daemon run_agent_loop, exit safely.
// - If stale, replace.
if (args.daemon) {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const lockPath = path.join(workspace_path, 'data', 'daemon.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });

    const raw = await fs.readFile(lockPath, 'utf8').catch(() => null);
    const lock = raw ? JSON.parse(String(raw)) : null;
    const lockedPid = Number(lock?.pid || 0);

    const isPidAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    if (lockedPid && Number.isFinite(lockedPid) && isPidAlive(lockedPid)) {
      // Best-effort: only treat as held when the pid looks like a daemon run_agent_loop.
      const cmdline = await fs.readFile(`/proc/${lockedPid}/cmdline`, 'utf8').catch(() => '');
      const ok = String(cmdline || '').includes('scripts/run_agent_loop.mjs') && String(cmdline || '').includes('--daemon');
      if (ok) {
        console.log(JSON.stringify({ ok: true, event: 'DAEMON_LOCK_HELD_BY_OTHER', pid: lockedPid }));
        process.exit(0);
      }
    }

    if (raw) {
      console.log(JSON.stringify({ ok: true, event: 'DAEMON_LOCK_STALE_REPLACED', prev_pid: lockedPid || null }));
    }

    await fs.writeFile(lockPath, JSON.stringify({ ok: true, pid: process.pid, at: new Date().toISOString() }, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify({ ok: true, event: 'DAEMON_LOCK_ACQUIRED', pid: process.pid }));
  } catch {}
}

// Bootstrap identity (IMPLEMENT_A2A_IDENTITY_BOOTSTRAP_V0_1)
// Phase 1: node_seed + machine fingerprint -> derived node_id.
// NOTE: Future phase will bind node_id -> agent_id (NOT implemented here).
try {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const crypto = await import('node:crypto');

  const dataDir = path.join(workspace_path, 'data');
  await fs.mkdir(dataDir, { recursive: true });

  const pNodeId = path.join(dataDir, 'node_id');
  const pSeed = path.join(dataDir, 'node_seed');
  const pFp = path.join(dataDir, 'node_fingerprint');

  const nowIso = () => new Date().toISOString();
  const log = (event, obj = {}) => {
    try {
      console.log(JSON.stringify({ ok: true, event, ts: nowIso(), ...obj }));
    } catch {}
  };

  const readTrim = async (p) => {
    const raw = await fs.readFile(p, 'utf8').catch(() => null);
    const v = raw && String(raw).trim() ? String(raw).trim() : null;
    return v;
  };

  const getMachineFingerprint = async () => {
    // Test override for validation/simulation (optional)
    const ovr = String(process.env.A2A_MACHINE_FINGERPRINT_OVERRIDE || '').trim();
    if (ovr) return ovr;

    const mid = await readTrim('/etc/machine-id').catch(() => null);
    if (mid) return mid;
    return os.hostname();
  };

  const deriveNodeId = ({ machineFp, seedHex } = {}) => {
    const h = crypto.createHash('sha256').update(`a2a.node_id.v0.1|${machineFp}|${seedHex}`, 'utf8').digest('hex');
    return `nd-${h.slice(0, 12)}`;
  };

  const machineFpNow = await getMachineFingerprint();
  const fpRecorded = await readTrim(pFp);

  const stableNodeIdExisting = await readTrim(pNodeId);
  const seedExisting = await readTrim(pSeed);

  // Clone detection: workspace copied to another machine
  if (fpRecorded && fpRecorded !== machineFpNow) {
    log('NODE_ID_CLONE_DETECTED', { reason: 'fingerprint_mismatch', recorded: 'present', node_id: stableNodeIdExisting || null });

    const seedHex = crypto.randomBytes(16).toString('hex');
    const nodeId = deriveNodeId({ machineFp: machineFpNow, seedHex });

    await fs.writeFile(pSeed, seedHex + '\n', 'utf8');
    await fs.writeFile(pNodeId, nodeId + '\n', 'utf8');
    await fs.writeFile(pFp, machineFpNow + '\n', 'utf8');

    process.env.NODE_ID = nodeId;
    process.env.A2A_AGENT_ID = nodeId;

    log('NODE_ID_REGENERATED', { node_id: nodeId, reason: 'clone_detected' });
  } else if (stableNodeIdExisting) {
    // Backward compatibility: never replace existing node_id
    if (!fpRecorded) {
      await fs.writeFile(pFp, machineFpNow + '\n', 'utf8').catch(() => {});
    }
    process.env.NODE_ID = stableNodeIdExisting;
    process.env.A2A_AGENT_ID = stableNodeIdExisting;
    log('NODE_ID_BOOTSTRAP_REUSED', { node_id: stableNodeIdExisting, reason: 'node_id_exists' });
  } else {
    // node_id missing
    let seedHex = seedExisting;
    let created = false;

    if (!seedHex) {
      seedHex = crypto.randomBytes(16).toString('hex');
      await fs.writeFile(pSeed, seedHex + '\n', 'utf8');
      created = true;
    }

    const nodeId = deriveNodeId({ machineFp: machineFpNow, seedHex });
    await fs.writeFile(pNodeId, nodeId + '\n', 'utf8');
    if (!fpRecorded) await fs.writeFile(pFp, machineFpNow + '\n', 'utf8').catch(() => {});

    process.env.NODE_ID = nodeId;
    process.env.A2A_AGENT_ID = nodeId;

    if (created) log('NODE_ID_BOOTSTRAP_CREATED', { node_id: nodeId, reason: 'seed_created' });
    else log('NODE_ID_BOOTSTRAP_CREATED', { node_id: nodeId, reason: 'seed_reused_node_id_missing' });
  }

  // Agent ID binding (DESIGN_AND_IMPLEMENT_AGENT_ID_BINDING_V0_1)
  // - node_id: runtime instance identity (unchanged)
  // - agent_id: stable owner/controller identity (optional for now)
  // Binding: node_id -> agent_id (persisted locally)
  const pAgentId = path.join(dataDir, 'agent_id');
  const pKeypair = path.join(dataDir, 'agent_keypair.json');
  const pBinding = path.join(dataDir, 'identity_binding.json');

  const nodeIdFinal = String(process.env.NODE_ID || '').trim() || null;

  const sha256hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

  const readJsonSafe = async (p) => {
    try {
      const raw = await fs.readFile(p, 'utf8');
      return JSON.parse(String(raw || '{}'));
    } catch {
      return null;
    }
  };

  // Input model:
  // - Legacy: if data/agent_id exists (or env AGENT_ID provided), keep it.
  // - Verifiable mode: if AGENT_ID_MODE=verifiable and no agent_id exists, derive agent_id from public_key.
  let agentId = await readTrim(pAgentId);
  const provided = String(process.env.AGENT_ID || '').trim();
  if (!agentId && provided) {
    agentId = provided;
    await fs.writeFile(pAgentId, agentId + '\n', 'utf8');
  }

  // Keypair: generate once if agent_id exists but no keypair.
  let keypair = await readJsonSafe(pKeypair);
  const hasKeypair = !!(keypair?.public_key && keypair?.private_key);

  const ensureKeypair = async () => {
    if (hasKeypair) return keypair;
    const kp = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    const next = { public_key: kp.publicKey, private_key: kp.privateKey };
    await fs.writeFile(pKeypair, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  };

  // If agent_id missing but verifiable mode requested, derive agent_id from keypair.
  if (!agentId && String(process.env.AGENT_ID_MODE || '').trim() === 'verifiable') {
    keypair = await ensureKeypair();
    const h = sha256hex(keypair.public_key).slice(0, 12);
    agentId = `ag-${h}`;
    await fs.writeFile(pAgentId, agentId + '\n', 'utf8');
  }

  // Placeholder mode (older behavior) remains supported.
  if (!agentId && String(process.env.AGENT_ID_MODE || '').trim() === 'placeholder') {
    const seedHex = (await readTrim(pSeed)) || '';
    if (seedHex) {
      const h = sha256hex(`a2a.agent_id.placeholder.v0.1|${seedHex}`).slice(0, 12);
      agentId = `ag-${h}`;
      await fs.writeFile(pAgentId, agentId + '\n', 'utf8');
    }
  }

  // If agent_id exists but keypair missing, generate keypair (verifiable identity becomes available).
  let publicKey = null;
  let signature = null;
  if (agentId) {
    try {
      keypair = await ensureKeypair();
      publicKey = String(keypair.public_key || '').trim() || null;
      const priv = String(keypair.private_key || '').trim() || null;
      if (publicKey && priv && nodeIdFinal) {
        signature = crypto.sign(null, Buffer.from(String(nodeIdFinal), 'utf8'), priv).toString('base64');
      }
    } catch {}

    process.env.AGENT_ID = agentId;
    if (publicKey) process.env.AGENT_PUBLIC_KEY = publicKey;
    if (signature) process.env.AGENT_SIGNATURE = signature;

    log('AGENT_ID_BOUND', { node_id: nodeIdFinal, agent_id: agentId, reason: provided ? 'env_provided' : 'file_or_mode' });
  } else {
    // Missing agent_id is allowed; node remains fully functional.
    log('AGENT_ID_UNSET', { node_id: nodeIdFinal, reason: 'not_provided' });
  }

  // Persist binding metadata (best-effort; additive)
  try {
    const binding = {
      ok: true,
      version: 'v0.1',
      updated_at: nowIso(),
      node_id: nodeIdFinal,
      agent_id: agentId || null,
      public_key: publicKey || null,
      signature: signature || null
    };
    await fs.writeFile(pBinding, JSON.stringify(binding, null, 2) + '\n', 'utf8');
  } catch {}
} catch {}

const out = await runLoop({
  workspace_path,
  once: args.once,
  daemon: args.daemon,
  holder: args.holder,
  relay: args.relay,
  directory: args.directory,
  relayUrl: args.relayUrl,
  task_sync_peer_id: args.taskSyncPeer,
  claim_announce_peers: args.claimAnnouncePeers,
  gossip_peers: args.gossipPeers
});

console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
