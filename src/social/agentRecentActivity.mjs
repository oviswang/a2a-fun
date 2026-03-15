import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import * as officialCapabilities from '../../examples/capabilities/index.mjs';
import { listCapabilities } from '../capability/capabilityDiscoveryList.mjs';
import { listLocalAgentMemory } from '../memory/localAgentMemory.mjs';
import { readOpenClawRecentActivity } from './openclawRecentActivity.mjs';

async function safeStat(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function pickLatestRecord(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  const withTs = records
    .map((r) => {
      const t = Date.parse(String(r?.last_seen_at || r?.last_dialogue_at || r?.last_handshake_at || r?.first_seen_at || ''));
      return { r, t: Number.isFinite(t) ? t : -1 };
    })
    .sort((a, b) => b.t - a.t);
  return withTs[0]?.r || null;
}

function shortCaps(caps) {
  if (!Array.isArray(caps)) return [];
  return caps
    .map((c) => (typeof c?.id === 'string' ? c.id : typeof c === 'string' ? c : ''))
    .filter(Boolean)
    .slice(0, 12);
}

async function bestEffortVisibleAgentsCount() {
  try {
    const r = await fetch('https://bootstrap.a2a.fun/agents', { method: 'GET' });
    if (!r.ok) return null;
    const json = await r.json();
    if (!json || json.ok !== true || !Array.isArray(json.agents)) return null;
    return json.agents.length;
  } catch {
    return null;
  }
}

/**
 * Deterministic, best-effort snapshot of local recent activity.
 * No LLMs, no fake facts.
 */
export async function getAgentRecentActivity({ workspace_path } = {}) {
  const hostname = os.hostname();
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();

  const recent_events = [];

  // 1) local memory signals
  let mem = { ok: false, count: 0, records: [], error: { code: 'UNKNOWN' } };
  try {
    mem = await listLocalAgentMemory({ workspace_path: ws });
  } catch {
    mem = { ok: false, count: 0, records: [], error: { code: 'FAIL_CLOSED' } };
  }

  if (mem.ok) recent_events.push({ kind: 'local_memory', count: mem.count, ts: nowIso() });

  const latest = pickLatestRecord(mem.records);
  const latest_peer = latest ? (latest.stable_agent_id || latest.legacy_agent_id || null) : null;
  const latest_relationship_state = latest ? latest.relationship_state || null : null;

  // 2) capabilities summary (local registry)
  const capsOut = listCapabilities({ registry: officialCapabilities });
  const caps = capsOut.ok ? capsOut.capabilities : [];
  const capIds = shortCaps(caps);
  if (capIds.length) recent_events.push({ kind: 'capabilities', count: capIds.length, ids: capIds, ts: nowIso() });

  // 3) visible agents count (best-effort remote directory)
  const visible_agents_count = await bestEffortVisibleAgentsCount();
  if (typeof visible_agents_count === 'number') recent_events.push({ kind: 'visible_agents', count: visible_agents_count, ts: nowIso() });

  // 4) infer whether refresh_agentcards ran recently (best-effort: script mtime)
  const refreshPath = path.join(ws, 'scripts', 'refresh_agentcards.mjs');
  const refreshStat = await safeStat(refreshPath);
  if (refreshStat) {
    recent_events.push({ kind: 'refresh_agentcards_script_present', mtime: refreshStat.mtime.toISOString(), ts: nowIso() });
  }

  // 5) infer whether we recently generated transcripts (best-effort: latest transcript mtime)
  const transcriptsDir = path.join(ws, 'transcripts');
  try {
    const entries = await fs.readdir(transcriptsDir);
    const candidates = entries.filter((n) => n.includes('profile-exchange') || n.includes('activity-dialogue') || n.includes('dlg:'));
    let latestMtime = null;
    for (const name of candidates.slice(0, 200)) {
      const st = await safeStat(path.join(transcriptsDir, name));
      if (!st) continue;
      const mt = st.mtimeMs;
      if (latestMtime == null || mt > latestMtime) latestMtime = mt;
    }
    if (latestMtime != null) recent_events.push({ kind: 'transcripts_recent', latest_mtime: new Date(latestMtime).toISOString(), ts: nowIso() });
  } catch {
    // ignore
  }

  // OpenClaw recent activity (best-effort, fail-closed)
  const oc = await readOpenClawRecentActivity();

  // next step inference (deterministic)
  let next_step = null;
  if (mem.ok && Array.isArray(mem.records)) {
    const hasEngaged = mem.records.some((r) => r && r.relationship_state === 'engaged');
    const hasInterested = mem.records.some((r) => r && r.local_human_interest === true);
    if (hasEngaged && !hasInterested) next_step = 'collect human decision: interested vs skip';
    else if (hasInterested) next_step = 'validate distributed activity dialogue (anti-simulation proof)';
    else next_step = 'discover peers and complete handshake/profile exchange';
  }

  const node_recent_events = recent_events;

  return {
    ok: true,
    hostname,
    visible_agents_count: typeof visible_agents_count === 'number' ? visible_agents_count : null,
    capabilities: capIds,

    // Back-compat
    recent_events,

    // Explicit provenance
    node_recent_events,

    // OpenClaw-side enrichment (optional)
    openclaw_updated_at: oc.ok ? oc.updated_at : null,
    openclaw_current_focus: oc.ok ? oc.current_focus : null,
    openclaw_recent_tasks: oc.ok ? oc.recent_tasks : [],
    openclaw_recent_tools: oc.ok ? oc.recent_tools : [],
    openclaw_recent_topics: oc.ok ? oc.recent_topics : [],

    latest_peer,
    latest_relationship_state,
    next_step,
    error: null
  };
}
