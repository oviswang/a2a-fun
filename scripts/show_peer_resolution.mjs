import { listPublishedAgentsRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';
import { loadLocalAgentMemory, getDefaultLocalAgentMemoryPath } from '../src/memory/localAgentMemory.mjs';
import { resolveLivePeerId } from '../src/social/resolveLivePeerId.mjs';

const requested_peer_id = process.env.REQUESTED_PEER_ID || 'VM-0-17-ubuntu';
const base_url = process.env.A2A_BOOTSTRAP_URL || 'https://bootstrap.a2a.fun';
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();

const file_path = getDefaultLocalAgentMemoryPath({ workspace_path });
const mem = await loadLocalAgentMemory({ file_path }).catch(() => ({ ok: false, records: [] }));
const dir = await listPublishedAgentsRemote({ base_url });

const out = await resolveLivePeerId({
  requested_peer_id,
  local_memory: mem.ok ? mem : { records: [] },
  directory_agents: dir.ok ? dir.agents : []
});

const live_candidates = (dir.ok ? dir.agents : [])
  .map((a) => a.agent_id)
  .filter((id) => id === requested_peer_id || id.startsWith(requested_peer_id + '-'));

console.log(JSON.stringify({
  ok: out.ok,
  requested_peer_id,
  matching_live_candidates: live_candidates,
  resolved_peer_id: out.resolved_peer_id,
  resolution_reason: out.resolution_reason,
  error: out.error || null
}, null, 2));
