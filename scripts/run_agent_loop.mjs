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

// v0.1 stable node identity: persist NODE_ID under workspace data/node_id
try {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const p = path.join(workspace_path, 'data', 'node_id');
  await fs.mkdir(path.dirname(p), { recursive: true });

  const existing = await fs.readFile(p, 'utf8').catch(() => null);
  const stable = existing && String(existing).trim() ? String(existing).trim() : null;

  let nodeId = (process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim();
  if (!nodeId && stable) nodeId = stable;

  if (nodeId && !stable) {
    await fs.writeFile(p, nodeId + '\n', 'utf8');
  }

  if (!nodeId && stable) nodeId = stable;

  if (nodeId) {
    process.env.NODE_ID = nodeId;
    process.env.A2A_AGENT_ID = nodeId;
  }
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
