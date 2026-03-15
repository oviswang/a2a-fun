import os from 'node:os';

import { buildAttentionSnapshot } from '../src/attention/buildAttentionSnapshot.mjs';
import { listLocalAgentMemory } from '../src/memory/localAgentMemory.mjs';
import { selectRelevantPeer } from '../src/attention/selectRelevantPeer.mjs';
import { explainAttentionDecision } from '../src/attention/explainAttentionDecision.mjs';

const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const agent_id = process.env.A2A_AGENT_ID || os.hostname();

const snapOut = await buildAttentionSnapshot({ workspace_path, agent_id });
if (!snapOut.ok) {
  console.log(JSON.stringify({ ok: false, error: snapOut.error }));
  process.exit(1);
}

const mem = await listLocalAgentMemory({ workspace_path }).catch(() => ({ ok: false, records: [], count: 0 }));
const sel = selectRelevantPeer({ snapshot: snapOut.snapshot, local_memory: mem, candidates: [] });
if (sel.ok) console.log(JSON.stringify({ ok: true, event: 'ATTENTION_PEER_SELECTED', selected_peer_agent_id: sel.selected_peer_agent_id, reason: sel.reason, score: sel.score }));

const exp = explainAttentionDecision({ snapshot: snapOut.snapshot, peerSelection: sel });

console.log(JSON.stringify({ ok: true, snapshot: snapOut.snapshot, peer_selection: sel.ok ? sel : null, explanation: exp.ok ? exp.text : null }, null, 2));
