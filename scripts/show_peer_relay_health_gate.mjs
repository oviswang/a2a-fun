import { listPublishedAgentsRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { loadLocalAgentMemory, getDefaultLocalAgentMemoryPath } from '../src/memory/localAgentMemory.mjs';
import { resolveLivePeerId } from '../src/social/resolveLivePeerId.mjs';
import { checkPeerRelayHealth } from '../src/social/checkPeerRelayHealth.mjs';

function decide(health) {
  if (health === 'healthy') return { allowed: true, note: null };
  if (health === 'degraded') return { allowed: true, note: 'PEER_RELAY_HEALTH_DEGRADED_BUT_ALLOWED' };
  return { allowed: false, note: 'PEER_RELAY_NOT_READY' };
}

const requested_peer_id = process.env.REQUESTED_PEER_ID || 'VM-0-17-ubuntu';
const base_url = process.env.A2A_BOOTSTRAP_URL || 'https://bootstrap.a2a.fun';
const relay_local_http = process.env.RELAY_LOCAL_HTTP || 'http://127.0.0.1:18884';
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
const mem = await loadLocalAgentMemory({ file_path }).catch(() => ({ ok: false, records: [] }));
const dir = await listPublishedAgentsRemote({ base_url });

const res = await resolveLivePeerId({
  requested_peer_id,
  local_memory: mem.ok ? mem : { records: [] },
  directory_agents: dir.ok ? dir.agents : []
});

let health = null;
let decision = { allowed: false, note: 'PEER_RELAY_NOT_READY' };

if (res.ok) {
  // best-effort traces fetch (local relay)
  let traces = [];
  try {
    const r = await fetch(`${relay_local_http}/traces`);
    const j = await r.json();
    traces = Array.isArray(j?.traces) ? j.traces : [];
  } catch {}

  health = await checkPeerRelayHealth({ node_id: res.resolved_peer_id, relay_local_http, traces });
  decision = decide(health.relay_health);
}

console.log(JSON.stringify({
  requested_peer_id,
  resolved_peer_id: res.resolved_peer_id || null,
  resolution_reason: res.resolution_reason || null,
  relay_health_result: health,
  dialogue_allowed: decision.allowed,
  decision_log: decision.note
}, null, 2));
