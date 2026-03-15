import os from 'node:os';

import { buildAttentionSnapshot } from '../src/attention/buildAttentionSnapshot.mjs';
import { listLocalAgentMemory } from '../src/memory/localAgentMemory.mjs';
import { selectRelevantPeer } from '../src/attention/selectRelevantPeer.mjs';
import { buildConversationGoal } from '../src/social/buildConversationGoal.mjs';
import { explainConversationGoal } from '../src/social/explainConversationGoal.mjs';

const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const agent_id = process.env.A2A_AGENT_ID || os.hostname();

const snapOut = await buildAttentionSnapshot({ workspace_path, agent_id });
const mem = await listLocalAgentMemory({ workspace_path }).catch(() => ({ ok: false, records: [], count: 0 }));
const sel = selectRelevantPeer({ snapshot: snapOut.ok ? snapOut.snapshot : {}, local_memory: mem.ok ? mem : { records: [] }, candidates: [] });

const goalOut = buildConversationGoal({ attention_snapshot: snapOut.snapshot, selected_peer: sel.ok ? sel : null, memory_gaps: snapOut.snapshot?.memory_gaps || [] });
const exp = explainConversationGoal({ attention_snapshot: snapOut.snapshot, selected_peer: sel.ok ? sel : null, goal: goalOut.ok ? goalOut.goal : null });

console.log(JSON.stringify({
  ok: goalOut.ok === true,
  attention_snapshot_summary: {
    current_problem: snapOut.snapshot?.current_problem || null,
    current_topics: snapOut.snapshot?.current_topics || [],
    memory_gaps: snapOut.snapshot?.memory_gaps || [],
    attention_score: snapOut.snapshot?.attention_score || 0
  },
  selected_peer: sel.ok ? sel : null,
  conversation_goal: goalOut.ok ? goalOut.goal : null,
  explanation: exp.ok ? exp.text : null
}, null, 2));
