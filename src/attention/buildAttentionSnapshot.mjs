import os from 'node:os';

import { createEmptyAttentionSnapshot } from './attentionSnapshot.mjs';
import { scoreAttention } from './scoreAttention.mjs';
import { getAgentRecentActivity } from '../social/agentRecentActivity.mjs';
import { listLocalAgentMemory } from '../memory/localAgentMemory.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function uniq(arr, max = 12) {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const s = safeStr(v);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function deriveTopics({ openclaw_current_focus, openclaw_recent_topics } = {}) {
  const topics = [];
  if (safeStr(openclaw_current_focus)) {
    const f = safeStr(openclaw_current_focus).toLowerCase();
    for (const kw of ['relay', 'activity dialogue', 'dialogue', 'memory', 'pool', 'provision', 'identity', 'whatsapp', 'telegram']) {
      if (f.includes(kw)) topics.push(kw);
    }
  }
  for (const t of openclaw_recent_topics || []) topics.push(t);
  return uniq(topics, 12);
}

function derivePreferredPeerTypes(topics) {
  const t = (topics || []).map((x) => safeStr(x).toLowerCase());
  const out = [];
  if (t.some((x) => x.includes('relay') || x.includes('runtime'))) out.push('relay-debug');
  if (t.some((x) => x.includes('memory'))) out.push('memory');
  if (t.some((x) => x.includes('whatsapp') || x.includes('telegram'))) out.push('gateway');
  if (t.some((x) => x.includes('pool') || x.includes('provision'))) out.push('infra-pool');
  return uniq(out, 8);
}

function inferMemoryGaps({ topics, memory_records } = {}) {
  const gaps = [];
  const recs = Array.isArray(memory_records) ? memory_records : [];

  // deterministic gap: no peers at all
  if (recs.length === 0) gaps.push('no local peer records');

  // deterministic gap: focus exists but no engaged/interested peers
  const hasTrusted = recs.some((r) => r && (r.relationship_state === 'engaged' || r.relationship_state === 'interested'));
  if (!hasTrusted) gaps.push('no engaged/interested peer to exchange experience with');

  // topic gap: relay topic but no peer summaries mention relay/runtime
  const wantsRelay = (topics || []).some((t) => String(t).toLowerCase().includes('relay'));
  if (wantsRelay) {
    const hasRelayPeer = recs.some((r) => String(r?.summary || '').toLowerCase().includes('relay') || String(r?.summary || '').toLowerCase().includes('runtime'));
    if (!hasRelayPeer) gaps.push('no verified peer experience for topic: relay');
  }

  return uniq(gaps, 10);
}

export async function buildAttentionSnapshot({ workspace_path, agent_id } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path.trim() : process.cwd();
  const aid = safeStr(agent_id) || process.env.A2A_AGENT_ID || os.hostname();

  const snap = createEmptyAttentionSnapshot({ agent_id: aid });
  snap.updated_at = nowIso();

  const recent = await getAgentRecentActivity({ workspace_path: ws });
  const mem = await listLocalAgentMemory({ workspace_path: ws }).catch(() => ({ ok: false, records: [], count: 0 }));
  const records = mem.ok ? mem.records : [];

  // Evidence
  snap.evidence.openclaw_focus = recent.openclaw_current_focus || null;
  snap.evidence.openclaw_recent_tasks = recent.openclaw_recent_tasks || [];
  snap.evidence.openclaw_recent_tools = recent.openclaw_recent_tools || [];
  snap.evidence.openclaw_recent_topics = recent.openclaw_recent_topics || [];
  snap.evidence.node_recent_events = (recent.node_recent_events || []).map((e) => e.kind).filter(Boolean);
  snap.evidence.latest_peer = recent.latest_peer || null;
  snap.evidence.latest_relationship_state = recent.latest_relationship_state || null;

  // current_problem
  snap.current_problem = recent.openclaw_current_focus || (recent.next_step ? `node_next_step: ${recent.next_step}` : null);

  // topics/actions/tools
  snap.current_topics = deriveTopics({ openclaw_current_focus: recent.openclaw_current_focus, openclaw_recent_topics: recent.openclaw_recent_topics });
  snap.recent_actions = uniq([...(recent.openclaw_recent_tasks || []), ...(recent.node_recent_events || []).map((e) => e.kind)], 16);
  snap.recent_tools = uniq(recent.openclaw_recent_tools || [], 12);

  // gaps + preferred peers
  snap.memory_gaps = inferMemoryGaps({ topics: snap.current_topics, memory_records: records });
  snap.preferred_peer_types = derivePreferredPeerTypes(snap.current_topics);

  // score
  const scored = scoreAttention(snap);
  snap.attention_score = scored.attention_score;
  snap.score_components = scored.components;

  console.log(JSON.stringify({ ok: true, event: 'ATTENTION_SNAPSHOT_BUILT', agent_id: aid, attention_score: snap.attention_score }));

  return { ok: true, snapshot: snap, error: null };
}
