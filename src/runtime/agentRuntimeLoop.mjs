import fs from 'node:fs/promises'; 
import path from 'node:path'; 
import { randomUUID } from 'node:crypto';
 
import { discoverPeers } from '../peers/discoverPeers.mjs'; 
import { getPeersPath, savePeers } from '../peers/peerStore.mjs'; 
 
import { getTasksPath, loadTasks, saveTasks, acceptTask, markRunning, completeTask, failTask } from '../tasks/taskStore.mjs'; 
import { executeTask } from '../tasks/taskExecutor.mjs'; 
import { sendTaskResult } from '../tasks/taskTransport.mjs'; 
import { sendTaskSyncRequest } from '../tasks/taskSyncTransport.mjs'; 
import { recoverStuckTasks } from '../tasks/taskRecovery.mjs'; 
import { shouldSkipExecution } from '../tasks/taskDedup.mjs'; 
import { loadNodeCapabilities, taskMatchesCapabilities } from './nodeCapabilities.mjs'; 
import { sendTaskAccepted } from '../tasks/taskClaimTransport.mjs'; 
import { sendPeerGossip } from '../peers/peerGossipTransport.mjs'; 
import { recordTaskExecuted } from '../peers/peerStats.mjs'; 
import { fetchAndValidateNetworkStats } from './joinNetworkSignalStats.mjs'; 
import { checkAndMaybeAutoUpgrade } from './autoUpgrade.mjs'; 
import { checkAndMaybeAutoUpgradeV0_3_2 } from './upgrade/autoUpgradeV0_3_2.mjs'; 
import { runAutoRecoveryCheck } from './autoRecovery.mjs'; 
 
function nowIso() { 
 return new Date().toISOString(); 
} 
 
export function getRuntimeStatePath({ workspace_path } = {}) { 
 const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd(); 
 return path.join(ws, 'data', 'runtime_state.json'); 
} 
 
async function readJson(p) { 
 return JSON.parse(await fs.readFile(p, 'utf8')); 
} 
 
async function writeJsonAtomic(p, obj) { 
 await fs.mkdir(path.dirname(p), { recursive: true }); 
 const tmp = p + '.tmp'; 
 await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8'); 
 await fs.rename(tmp, p); 
} 
 
export async function loadRuntimeState({ state_path } = {}) { 
 try { 
 const obj = await readJson(state_path); 
 if (!obj || typeof obj !== 'object') throw new Error('bad'); 
 return { ok: true, state: obj }; 
 } catch { 
 return { 
 ok: true, 
 state: { 
 ok: true, 
 version: 'agent_loop.v0.1', 
 last_peer_refresh_at: null, 
 last_task_sync_at: null, 
 last_task_pick_at: null, 
 last_task_executed_at: null, 
 last_loop_tick_at: null, 
 current_mode: null, 
 last_task_sync_request_at: null, 
 last_task_generation_at: null, 
 last_experience_aggregation_at: null, 
 last_radar_generation_at: null, 
 last_radar_delivery_at: null, 
 first_radar_sent: false, 
 first_join_announced: false, 
 last_upgrade_check_at: null, 
 last_upgrade_attempt_at: null, 
 last_upgrade_success_at: null, 
 last_upgrade_target: null, 
 last_upgrade_error: null, 
 last_recovery_check_at: null, 
 last_recovery_action_at: null, 
 last_recovery_action: null, 
 last_recovery_error: null 
 } 
 }; 
 } 
} 
 
export async function saveRuntimeState({ state_path, state } = {}) { 
 await writeJsonAtomic(state_path, state); 
 return { ok: true }; 
} 
 
function leaseActive(task) { 
 const exp = task?.lease?.expires_at; 
 if (!exp) return false; 
 const t = Date.parse(exp); 
 return Number.isFinite(t) && t > Date.now(); 
} 
 
function pickOldestPublished(tasks, matcher) { 
 // Recovery policy (Option B): prefer newest published tasks to avoid starvation by stale published items.
 const pub = tasks.filter((t) => t && t.status === 'published' && !leaseActive(t)); 
 pub.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))); 
 if (typeof matcher !== 'function') return pub[0] || null; 
 for (const t of pub) { 
 const m = matcher(t); 
 if (m && m.match === true) return t; 
 } 
 return null; 
} 
 
export async function runLoop({ 
 workspace_path, 
 once = false, 
 daemon = false, 
 holder, 
 relay = 'http://127.0.0.1:18884', 
 directory = 'https://bootstrap.a2a.fun', 
 relayUrl = 'wss://bootstrap.a2a.fun/relay', 
 task_sync_peer_id = null, 
 claim_announce_peers = null, 
 gossip_peers = null 
} = {}) { 
 const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd(); 
 const h = String(holder || '').trim(); 
 if (!h) { 
 return { ok: false, error: { code: 'MISSING_HOLDER' } }; 
 } 
 
 const mode = daemon ? 'daemon' : 'once'; 
 const state_path = getRuntimeStatePath({ workspace_path: ws }); 
 const stateLoaded = await loadRuntimeState({ state_path }); 
 const state = stateLoaded.state; 
 state.current_mode = mode; 
 
 const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

 const rand = (a, b) => Math.floor(a + Math.random() * (b - a + 1));

 // IMPLEMENT_NODE_NETWORK_INTEGRATION_V0_1 (best-effort; must not break agent loop)
 let networkHandle = null;
 try {
  if (daemon) {
   const node_id = String(process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim() || h;
   let version = String(process.env.A2A_VERSION || '').trim() || null;
   if (!version) {
    try {
     const raw = await fs.readFile(path.join(ws, 'data', 'local_version'), 'utf8').catch(() => null);
     const j = raw ? JSON.parse(String(raw)) : null;
     const v = j && typeof j === 'object' ? String(j.version || '').trim() : '';
     if (v) version = v;
    } catch {}
   }

   const { loadNodeCapabilities } = await import('./nodeCapabilities.mjs');
   const caps = await loadNodeCapabilities({ workspace_path: ws }).catch(() => ({ ok: true, capabilities: [] }));

   const bootstrap_base_url = String(process.env.BOOTSTRAP_BASE_URL || directory || '').trim();
   const relay_url_override = String(process.env.RELAY_URL || '').trim() || null;

   // Upgrade state hint (v0.3.2 additive): advertise self upgrade state via presence.
   try {
    const raw = await fs.readFile(path.join(ws, 'data', 'upgrade_state.json'), 'utf8').catch(() => null);
    const j = raw ? JSON.parse(String(raw)) : null;
    const st = j && typeof j === 'object' ? String(j.state || '').trim() : '';
    if (st) process.env.A2A_UPGRADE_STATE = st;
   } catch {}

   const { startNodeNetworkIntegrationV0_1 } = await import('./network/nodeNetworkIntegrationV0_1.mjs');
   const { handleTaskRelayMessageV0_1 } = await import('./network/taskMessageFlowV0_1.mjs');

   let networkSend = null;
   const onDeliver = (msg) => {
    try {
     handleTaskRelayMessageV0_1({
      workspace_path: ws,
      node_id,
      capabilities: caps.capabilities || [],
      known_peers: networkHandle?.state?.known_peers || [],
      from: msg?.from || null,
      topic: msg?.topic || null,
      payload: msg?.payload ?? null,
      send: networkSend
     }).catch(() => null);
    } catch {}
   };

   networkHandle = await startNodeNetworkIntegrationV0_1({
    node_id,
    version,
    capabilities: { requires: caps.capabilities || [] },
    relay_urls: relay_url_override ? [relay_url_override] : [],
    observed_addrs: [],
    bootstrap_base_url,
    relay_url_override,
    onDeliver,
    heartbeatEveryMs: rand(30_000, 60_000)
   }).catch((e) => {
    try {
     console.log(JSON.stringify({ ok: true, event: 'NODE_NETWORK_INTEGRATION_FAILED', ts: new Date().toISOString(), node_id, error: { message: e?.message || String(e), stack: String(e?.stack || '').split('\n').slice(0, 6).join('\n') } }));
    } catch {}
    return null;
   });

   // bind send after registration attempt
   if (networkHandle && typeof networkHandle.send === 'function') {
    networkSend = networkHandle.send;
   }
  }
 } catch {}
 
 
 const due24h = (iso) => { 
 if (!iso) return true; 
 const t = Date.parse(iso); 
 if (!Number.isFinite(t)) return true; 
 return (Date.now() - t) >= 24 * 60 * 60 * 1000; 
 }; 
 
 const doOneTick = async () => { 
 try { 
 state.last_loop_tick_at = nowIso(); 
 console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TICK', mode, holder: h, ts: state.last_loop_tick_at })); 
 
 // Failure recovery: reclaim expired/orphaned tasks (every tick) 
 await recoverStuckTasks({ workspace_path: ws }).catch(() => null); 

 // IMPLEMENT_TASK_MESSAGE_FLOW_V0_1: outbound network task messages (best-effort)
 try {
  if (daemon && networkHandle && typeof networkHandle.send === 'function') {
   const node_id = String(process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim() || h;
   const bootstrap_base_url = String(process.env.BOOTSTRAP_BASE_URL || directory || '').trim();
   const { loadNodeCapabilities } = await import('./nodeCapabilities.mjs');
   const caps = await loadNodeCapabilities({ workspace_path: ws }).catch(() => ({ ok: true, capabilities: [] }));
   const { tickTaskNetworkOutboundV0_1 } = await import('./network/taskMessageFlowV0_1.mjs');
   await tickTaskNetworkOutboundV0_1({
    workspace_path: ws,
    node_id,
    bootstrap_base_url,
    send: networkHandle.send,
    capabilities: caps.capabilities || [],
    known_peers: networkHandle?.state?.known_peers || []
   }).catch(() => null);
  }
 } catch {}

 // AUTO_UPGRADE_V0_3_2_MIN: stable version from https://a2a.fun/skill.md (best-effort)
 try {
  if (daemon && String(process.env.DISABLE_SELF_MAINTENANCE||'') !== '1') {
   const useV032 = String(process.env.AUTO_UPGRADE_V0_3_2_ENABLED ?? 'true').toLowerCase() === 'true';
   if (useV032) {
    const node_id = String(process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim() || h;
    await checkAndMaybeAutoUpgradeV0_3_2({ workspace_path: ws, node_id, isBusy: false }).catch(() => null);
   } else {
    // legacy (kept for compatibility; not the primary v0.3.2 path)
    await checkAndMaybeAutoUpgrade({ workspace_path: ws, holder: h, state, state_path, checkEveryHours: 6 }).catch(() => null);
   }
  }
 } catch {}

 // AUTO_UPGRADE_PLUS_AUTO_RECOVERY_V1: low-frequency safe auto-recovery (best-effort)
 try {
  if (daemon && String(process.env.DISABLE_SELF_MAINTENANCE||'') !== '1') {
   await runAutoRecoveryCheck({ workspace_path: ws, holder: h, state, state_path, checkEveryMinutes: 10 }).catch(() => null);
  }
 } catch {}

 // STABILIZATION_SIGNALS_V0_6_6 (observability-only): periodic actionable logs (best-effort; no remediation)
 try {
  if (daemon) {
   const last = state.last_stabilization_signal_at ? Date.parse(state.last_stabilization_signal_at) : 0;
   const due = !last || !Number.isFinite(last) || (Date.now() - last) >= 10 * 60 * 1000;
   if (due) {
    state.last_stabilization_signal_at = nowIso();
    const node_id = String(process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim() || h;
    const { emitStabilizationSignalsV0_6_6 } = await import('./stabilizationSignalsV0_6_6.mjs');
    await emitStabilizationSignalsV0_6_6({ workspace_path: ws, node_id }).catch(() => null);
   }
  }
 } catch {}
 
 // JOIN_NETWORK_SIGNAL_V1: announce first successful join (best-effort) 
 try { 
 if (daemon && state.first_join_announced !== true) { 
 const channel = (process.env.RADAR_DELIVERY_CHANNEL || '').trim(); 
 const target = (process.env.RADAR_DELIVERY_TARGET || '').trim(); 
 if (channel && target) { 
 const flag = (country) => { 
 const c = String(country || '').trim().toLowerCase(); 
 if (!c) return ''; 
 const map = { 
 singapore: '🇸🇬', 
 'united states': '🇺🇸', 
 usa: '🇺🇸', 
 china: '🇨🇳', 
 japan: '🇯🇵', 
 germany: '🇩🇪' 
 }; 
 return map[c] || ''; 
 }; 
 
 const base = String(process.env.BOOTSTRAP_BASE_URL || directory || 'https://bootstrap.a2a.fun').replace(/\/$/, '');
 const fetched = await fetchAndValidateNetworkStats({ url: `${base}/network_stats` }).catch(() => null); 
 const statsAvailable = fetched && fetched.ok === true && fetched.available === true; 
 const stats = statsAvailable ? fetched.stats : null; 
 
 const connected = statsAvailable ? stats.connected_nodes : null; 
 const active24h = statsAvailable ? stats.active_agents_last_24h : null; 
 const regions = statsAvailable ? stats.regions : []; 
 
 const regionLines = []; 
 for (const x of regions.slice(0, 4)) { 
 const country = String(x?.country || '').trim(); 
 const count = Number(x?.count ?? 0); 
 if (!country) continue; 
 const f = flag(country); 
 if (f) regionLines.push(`${f} ${country} — ${count}`); 
 else regionLines.push(`- ${country}: ${count}`); 
 } 
 
 const msg = [ 
 '🌐 Agent Network', 
 '', 
 'Your agent has successfully joined the network.', 
 '', 
 'Node ID', 
 `${h}`, 
 '', 
 'Network status', 
 `Connected nodes: ${connected}`, 
 `Active agents (24h): ${active24h}`, 
 '', 
 'Active regions', 
 ...(regionLines.length ? regionLines : ['(region stats unavailable)']), 
 '', 
 'Your agent is now starting its first tasks.' 
 ].join('\n'); 
 
 const minimal = [ 
 '🌐 Agent Network', 
 '', 
 'Your agent has successfully joined the network.', 
 '', 
 'It is now connected and starting its first tasks.' 
 ].join('\n'); 
 
 try { 
 const { createOpenClawCliSend } = await import('../social/openclawCliSend.mjs'); 
 const send = createOpenClawCliSend(); 
 await send({ gateway: channel, channel_id: target, message: statsAvailable ? msg : minimal }); 
 state.first_join_announced = true; 
 await saveRuntimeState({ state_path, state }).catch(() => null); 
 console.log(JSON.stringify({ ok: true, event: 'JOIN_NETWORK_SIGNAL_SENT' })); 
 } catch { 
 console.log(JSON.stringify({ ok: false, event: 'JOIN_NETWORK_SIGNAL_ERROR' })); 
 } 
 } 
 } else if (daemon && state.first_join_announced === true) {

console.log(JSON.stringify({ ok: true, event: 'JOIN_NETWORK_SIGNAL_SKIPPED_ALREADY_SENT' })); 
 } 
 } catch {} 
 
 // RADAR_PENDING_DELIVERY_V0_1: deliver existing non-empty radar artifact if pending. 
 // Root issue: daemon previously only delivered immediately after regeneration. 
 try { 
 if ( 
 daemon && 
 state.first_radar_sent !== true && 
 !state.last_radar_delivery_at 
 ) { 
 const radarPath = path.join(ws, 'data', 'radar.latest.json'); 
 let radar = null; 
 try { 
 radar = await readJson(radarPath); 
 } catch { 
 radar = null; 
 } 
 
 const kind = String(radar?.kind || '').trim(); 
 const stories = Array.isArray(radar?.stories) ? radar.stories : null; 
 const storiesCount = stories ? stories.length : 0; 
 
 if (kind === 'RADAR_V0_1' && stories && storiesCount > 0) { 
 console.log(JSON.stringify({ ok: true, event: 'RADAR_PENDING_DELIVERY_ATTEMPT', stories_count: storiesCount, date: radar?.date || null })); 
 try { 
 const channel = (process.env.RADAR_DELIVERY_CHANNEL || '').trim(); 
 const target = (process.env.RADAR_DELIVERY_TARGET || '').trim(); 
 if (channel && target) { 
 const { createOpenClawCliSend } = await import('../social/openclawCliSend.mjs'); 
 const send = createOpenClawCliSend({ openclawBin: process.env.OPENCLAW_BIN || 'openclaw' }); 
 const lines = stories.map((s) => `- ${String(s?.story || '').trim()}`).filter(Boolean); 
 const msg = [`Daily Radar (${radar?.date || ''})`, ...lines].join('\n'); 
 await send({ gateway: channel, channel_id: target, message: msg }); 
 
 state.last_radar_delivery_at = nowIso(); 
 state.first_radar_sent = true; 
 await saveRuntimeState({ state_path, state }).catch(() => null); 
 console.log(JSON.stringify({ ok: true, event: 'RADAR_PENDING_DELIVERY_SENT' })); 
 } else { 
 console.log(JSON.stringify({ ok: false, event: 'RADAR_PENDING_DELIVERY_ERROR', error: { code: 'DELIVERY_NOT_CONFIGURED' } })); 
 } 
 } catch (e) { 
 console.log(JSON.stringify({ ok: false, event: 'RADAR_PENDING_DELIVERY_ERROR', error: { message: String(e?.message || e) } })); 
 } 
 } else if (kind === 'RADAR_V0_1' && stories && storiesCount === 0) { 
 console.log(JSON.stringify({ ok: true, event: 'RADAR_PENDING_DELIVERY_SKIPPED_EMPTY', date: radar?.date || null })); 
 } 
 } 
 } catch {} 
 
 // FIRST_RADAR_BOOTSTRAP_V0_1: one-time bootstrap path (do not change daily cadence) 
 try { 
 if (daemon && state.first_radar_sent !== true) { 
 const tasks_path = getTasksPath({ workspace_path: ws }); 
 const loaded0 = await loadTasks({ tasks_path }); 
 const tasks0 = Array.isArray(loaded0.table?.tasks) ? loaded0.table.tasks : []; 
 
 if (tasks0.length === 0) { 
 const { createTask } = await import('../tasks/taskSchema.mjs'); 
 
 const bootstrapSpecs = [ 
 { type: 'run_check', topic: 'relay_bootstrap', input: { check: 'relay_health', time_window: 'last_24h' }, requires: ['run_check'] }, 
 { type: 'node_diagnose', topic: 'peer_connectivity', input: { check: 'network_diagnostics', time_window: 'last_24h' }, requires: ['node_diagnose'] }, 
 { type: 'web_research', topic: 'agent_network_bootstrap', input: { question: 'agent network bootstrap', time_window: 'last_24h' }, requires: ['web_research'] } 
 ]; 
 
 for (const s of bootstrapSpecs.slice(0, 3)) { 
 const made = createTask({ type: s.type, topic: s.topic, created_by: h, input: s.input }); 
 if (made.ok) { 
 made.task.requires = s.requires;

await (await import('../tasks/taskStore.mjs')).publishTask({ tasks_path, task: made.task }).catch(() => null); 
 } 
 } 
 
 console.log(JSON.stringify({ ok: true, event: 'FIRST_RADAR_BOOTSTRAP_TASKS_CREATED', count: Math.min(3, bootstrapSpecs.length) })); 
 } 
 } 
 } catch {} 
 
 // MVP automation wiring (daily): task generation -> aggregation -> radar 
 try { 
 const dailyDue = due24h(state.last_task_generation_at); 
 if (daemon && dailyDue) { 
 const { generateTasksOnce } = await import('../tasks/taskGenerator.mjs'); 
 const gen = await generateTasksOnce({ workspace_path: ws, node_id: h, cadence: '24h', max_per_run: 3 }).catch(() => null); 
 if (gen && gen.ok) state.last_task_generation_at = nowIso(); 
 await saveRuntimeState({ state_path, state }).catch(() => null); 
 } 
 
 const aggDue = due24h(state.last_experience_aggregation_at); 
 if (daemon && aggDue) { 
 const { aggregateExperience } = await import('../experience/experienceAggregator.mjs'); 
 const agg = await aggregateExperience({ workspace_path: ws, window: 'last_24h' }).catch(() => null); 
 if (agg && agg.ok) { 
 const outAgg = path.join(ws, 'data', 'experience_aggregate.latest.json'); 
 await writeJsonAtomic(outAgg, agg); 
 state.last_experience_aggregation_at = nowIso(); 
 await saveRuntimeState({ state_path, state }).catch(() => null); 
 
 const { generateRadar } = await import('../observability/radarGenerator.mjs'); 
 const radar = await generateRadar({ aggregate: agg }).catch(() => null); 
 if (radar && radar.ok) { 
 const outRadar = path.join(ws, 'data', 'radar.latest.json'); 
 await writeJsonAtomic(outRadar, radar); 
 state.last_radar_generation_at = nowIso(); 
 await saveRuntimeState({ state_path, state }).catch(() => null); 
 
 // Minimal radar delivery via OpenClaw CLI (best-effort, once per 24h) 
 // FIRST_RADAR_NONEMPTY_GUARD_V0_1: 
 // - skip delivery when stories_count == 0 
 // - only set first_radar_sent=true when: radar ok + non-empty + delivery succeeded 
 const storiesCount = Array.isArray(radar.stories) ? radar.stories.length : 0; 
 if (storiesCount === 0) { 
 console.log(JSON.stringify({ ok: true, event: 'FIRST_RADAR_SKIPPED_EMPTY', date: radar.date || null })); 
 } else { 
 const deliverDue = due24h(state.last_radar_delivery_at); 
 if (deliverDue) { 
 try { 
 const channel = (process.env.RADAR_DELIVERY_CHANNEL || '').trim(); 
 const target = (process.env.RADAR_DELIVERY_TARGET || '').trim(); 
 if (channel && target) { 
 const { createOpenClawCliSend } = await import('../social/openclawCliSend.mjs'); 
 const send = createOpenClawCliSend({ openclawBin: process.env.OPENCLAW_BIN || 'openclaw' }); 
 const lines = (radar.stories || []).map((s) => `- ${String(s.story || '').trim()}`).filter(Boolean); 
 const msg = [`Daily Radar (${radar.date || ''})`, ...lines].join('\n'); 
 await send({ gateway: channel, channel_id: target, message: msg }); 
 state.last_radar_delivery_at = nowIso(); 
 // Only consume one-time first radar after successful non-empty delivery. 
 state.first_radar_sent = true; 
 await saveRuntimeState({ state_path, state }).catch(() => null); 
 } 
 } catch {} 
 } 
 } 
 } 
 } 
 } 
 } catch {} 
 
 // A) discover peers (every 30s)

const peerDue = !state.last_peer_refresh_at || (Date.now() - Date.parse(state.last_peer_refresh_at)) >= 30000; 
 if (peerDue) { 
 const disc = await discoverPeers({ workspace_path: ws, directory_base_url: directory, relay_local_http: relay }); 
 if (disc.ok) { 
 const peers_path = getPeersPath({ workspace_path: ws }); 
 await savePeers({ peers_path, table: disc.table }); 
 state.last_peer_refresh_at = nowIso(); 
 } 
 } 
 
 // Peer gossip (every 30s, best-effort) 
 const gossipDue = peerDue; 
 if (daemon && gossipDue) { 
 try { 
 const peers_path = getPeersPath({ workspace_path: ws }); 
 const loadedPeers = await (await import('../peers/peerStore.mjs')).loadPeers({ peers_path }); 
 const known = Array.isArray(loadedPeers.table?.peers) ? loadedPeers.table.peers : []; 
 const peersList = known.map((p) => ({ node_id: p.peer_id, relay: p?.endpoints?.relay_url || 'wss://bootstrap.a2a.fun/relay', last_seen: p?.liveness?.last_seen || null })); 
 
 const toList = Array.isArray(gossip_peers) ? gossip_peers : []; 
 for (const to of toList) { 
 const tid = String(to || '').trim(); 
 if (!tid || tid === h) continue; 
 await sendPeerGossip({ relayUrl, from_node_id: h, to_node_id: tid, peers: peersList }).catch(() => null); 
 } 
 } catch {} 
 } 
 
 // B) sync tasks (every 10s) + task sync protocol (every 60s) 
 const taskDue = !state.last_task_sync_at || (Date.now() - Date.parse(state.last_task_sync_at)) >= 10000; 
 const tasks_path = getTasksPath({ workspace_path: ws }); 
 const loaded = await loadTasks({ tasks_path }); 
 state.last_task_sync_at = nowIso(); 
 
 const syncDue = !state.last_task_sync_request_at || (Date.now() - Date.parse(state.last_task_sync_request_at)) >= 60000; 
 if (daemon && syncDue && task_sync_peer_id) { 
 await sendTaskSyncRequest({ relayUrl, from_node_id: h, to_node_id: String(task_sync_peer_id), limit: 50 }).catch(() => null); 
 state.last_task_sync_request_at = nowIso(); 
 } 
 
 // C) pick task (capability-aware) 
 const caps = await loadNodeCapabilities({ workspace_path: ws }); 
 const matcher = (task) => {
  // If this node is configured to publish tasks to peers, do not self-execute tasks it created.
  // This preserves task semantics but avoids local self-activity for network-visible tasks.
  const toCfg = String(process.env.TASK_PUBLISH_TO || '').trim();
  const createdBySelf = String(task?.created_by || '').trim() === h;
  const broadcasted = task?.meta && typeof task.meta === 'object' && task.meta.task_publish_sent === true;
  if (createdBySelf && (toCfg || broadcasted)) {
    return { ok: true, match: false, reason: 'originator_skip_for_network' };
  }
  return taskMatchesCapabilities({ task, capabilities: caps.capabilities });
 }; 
 
 const picked = pickOldestPublished(loaded.table.tasks, matcher); 
 if (!picked) { 
 console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_IDLE', mode, holder: h, reason: 'NO_PUBLISHED_TASK' })); 
 await saveRuntimeState({ state_path, state }); 
 return { idle: true, reason: 'NO_PUBLISHED_TASK' }; 
 } 
 
 // Claim fairness: jitter + recent-work delay 
 const jitterMs = 100 + Math.floor(Math.random() * 701); // 100..800 
 console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_JITTER_APPLIED', mode, holder: h, task_id: picked.task_id, jitter_ms: jitterMs })); 
 await sleep(jitterMs); 
 
 const lastExec = state.last_task_executed_at ? Date.parse(state.last_task_executed_at) : NaN; 
 if (Number.isFinite(lastExec)) { 
 const agoMs = Date.now() - lastExec; 
 if (agoMs >= 0 && agoMs < 5000) { 
 const extra = 400 + Math.floor(Math.random() * 401); // 400..800 
 console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_DELAYED_RECENT_WORK', mode, holder: h, task_id: picked.task_id, extra_delay_ms: extra, last_task_executed_at: state.last_task_executed_at })); 
 await sleep(extra); 
 } 
 } 
 
 state.last_task_pick_at = nowIso(); 
 console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_SELECTED', mode, holder: h, task_id: picked.task_id })); 
 console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TASK_PICKED', mode, holder: h, task_id: picked.task_id })); 
 console.log(JSON.stringify({ ok: true, event: 'TASK_PICKED', mode, holder: h, task_id: picked.task_id })); 
 
 // D) execution gate for remote-published broadcast tasks: claim window must finish before accept/execute
 {
  const created_by = String(picked?.created_by || '').trim();
  const isRemoteBroadcast = !!(picked?.meta && typeof picked.meta === 'object' && picked.meta.received_from) && created_by && created_by !== h;

  if (daemon && isRemoteBroadcast) {
    const claim_id = randomUUID();
    const claim_ts = Date.now();
    const window_ms = 500;

    console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_WINDOW_STARTED', ts: nowIso(), node_id: h, task_id: picked.task_id, claim_id, claim_ts, window_ms }));

    // Telemetry to creator (NO-SSH proof support)
    try {
      if (networkHandle && typeof networkHandle.send === 'function' && created_by) {
        const topic = 'task.arbitration.telemetry';
        const message_id = `task.telemetry:${picked.task_id}:${created_by}:${h}:TASK_CLAIM_WINDOW_STARTED:${claim_id}`;
        const payload = { task_id: picked.task_id, node_id: h, event: 'TASK_CLAIM_WINDOW_STARTED', claim_id, claim_ts, window_ms };
        console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_ATTEMPT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id }));
        const tx = networkHandle.send({ to: created_by, topic, payload, message_id });
        console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id, ok_send: !!tx?.ok }));
      }
    } catch (e) {
      console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by || null, topic: 'task.arbitration.telemetry', ok_send: false, error: String(e?.message || e || 'telemetry_send_failed') }));
    }

    // persist our own claim locally
    try {
      const cur = await loadTasks({ tasks_path });
      const curTask = cur.table.tasks.find((t) => t.task_id === picked.task_id) || null;
      if (curTask) {
        curTask.meta = curTask.meta && typeof curTask.meta === 'object' ? curTask.meta : {};
        const claims = Array.isArray(curTask.meta.claims) ? curTask.meta.claims : [];
        claims.push({ task_id: picked.task_id, claimed_by: h, claim_ts, claim_id, from: h, seen_at: nowIso() });
        curTask.meta.claims = claims;
        await saveTasks({ tasks_path, table: cur.table });
      }
    } catch {}

    // broadcast claim proposal (best-effort)
    try {
      if (networkHandle && typeof networkHandle.send === 'function') {
        const targets = [];
        if (created_by) targets.push(created_by);
        const kp = networkHandle?.state?.known_peers;
        if (Array.isArray(kp)) {
          for (const p of kp) {
            const tid = String(p?.node_id || '').trim();
            if (!tid || tid === h) continue;
            targets.push(tid);
          }
        }
        const uniq = Array.from(new Set(targets));
        const payload = { task_id: picked.task_id, claimed_by: h, claim_ts, claim_id };
        for (const to of uniq.slice(0, 50)) {
          networkHandle.send({ to, topic: 'task.claim', payload, message_id: `task.claim:${picked.task_id}:${to}:${claim_id}` });
        }
      }
    } catch {}

    await sleep(window_ms);

    // collect claims observed during the window
    let claims = [];
    try {
      const cur = await loadTasks({ tasks_path });
      const curTask = cur.table.tasks.find((t) => t.task_id === picked.task_id) || null;
      claims = Array.isArray(curTask?.meta?.claims) ? curTask.meta.claims : [];
    } catch {}

    // normalize + decide winner
    const norm = [];
    for (const c of claims || []) {
      const by = String(c?.claimed_by || '').trim();
      const tsn = Number(c?.claim_ts);
      if (!by || !Number.isFinite(tsn)) continue;
      norm.push({ claimed_by: by, claim_ts: tsn });
    }
    norm.sort((a, b) => (a.claim_ts - b.claim_ts) || String(a.claimed_by).localeCompare(String(b.claimed_by)));
    const winner = norm[0]?.claimed_by || h;

    console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_WINDOW_COLLECTED', ts: nowIso(), node_id: h, task_id: picked.task_id, total_claims: norm.length }));

    // Telemetry to creator (NO-SSH proof support)
    try {
      if (networkHandle && typeof networkHandle.send === 'function' && created_by) {
        const topic = 'task.arbitration.telemetry';
        const message_id = `task.telemetry:${picked.task_id}:${created_by}:${h}:TASK_CLAIM_WINDOW_COLLECTED:${claim_id}`;
        const payload = { task_id: picked.task_id, node_id: h, event: 'TASK_CLAIM_WINDOW_COLLECTED', total_claims: norm.length };
        console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_ATTEMPT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id }));
        const tx = networkHandle.send({ to: created_by, topic, payload, message_id });
        console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id, ok_send: !!tx?.ok }));
      }
    } catch (e) {
      console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by || null, topic: 'task.arbitration.telemetry', ok_send: false, error: String(e?.message || e || 'telemetry_send_failed') }));
    }

    if (winner === h) {
      console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_DECIDED_WINNER', ts: nowIso(), node_id: h, task_id: picked.task_id, winner, total_claims: norm.length }));

      // Telemetry to creator (NO-SSH proof support)
      try {
        if (networkHandle && typeof networkHandle.send === 'function' && created_by) {
          const topic = 'task.arbitration.telemetry';
          const message_id = `task.telemetry:${picked.task_id}:${created_by}:${h}:TASK_CLAIM_DECIDED_WINNER:${claim_id}`;
          const payload = { task_id: picked.task_id, node_id: h, event: 'TASK_CLAIM_DECIDED_WINNER', winner, total_claims: norm.length };
          console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_ATTEMPT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id }));
          const tx = networkHandle.send({ to: created_by, topic, payload, message_id });
          console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id, ok_send: !!tx?.ok }));
        }
      } catch (e) {
        console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by || null, topic: 'task.arbitration.telemetry', ok_send: false, error: String(e?.message || e || 'telemetry_send_failed') }));
      }
    } else {
      console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_DECIDED_LOSER', ts: nowIso(), node_id: h, task_id: picked.task_id, winner, total_claims: norm.length }));

      // Telemetry to creator (NO-SSH proof support)
      try {
        if (networkHandle && typeof networkHandle.send === 'function' && created_by) {
          const topic = 'task.arbitration.telemetry';
          const message_id = `task.telemetry:${picked.task_id}:${created_by}:${h}:TASK_CLAIM_DECIDED_LOSER:${claim_id}`;
          const payload = { task_id: picked.task_id, node_id: h, event: 'TASK_CLAIM_DECIDED_LOSER', winner, total_claims: norm.length };
          console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_ATTEMPT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id }));
          const tx = networkHandle.send({ to: created_by, topic, payload, message_id });
          console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by, topic, message_id, ok_send: !!tx?.ok }));
        }
      } catch (e) {
        console.log(JSON.stringify({ ok: true, event: 'TELEMETRY_SEND_RESULT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: created_by || null, topic: 'task.arbitration.telemetry', ok_send: false, error: String(e?.message || e || 'telemetry_send_failed') }));
      }

      await saveRuntimeState({ state_path, state });
      return { idle: true, reason: 'LOST_CLAIM_WINDOW', winner };
    }
  }
 }

 // D) accept + execute 
 console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_ATTEMPT', ts: nowIso(), node_id: h, task_id: picked.task_id }));
 const acc = await acceptTask({ tasks_path, task_id: picked.task_id, holder: h }); 
 if (!acc.ok) {
  // Another node may have claimed it first; treat as benign contention.
  let holder = null;
  try {
    const cur = await loadTasks({ tasks_path });
    const curTask = cur.table.tasks.find((t) => t.task_id === picked.task_id) || null;
    holder = String(curTask?.assigned_to || curTask?.lease?.holder || '').trim() || null;
  } catch {}

  console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_LOST', ts: nowIso(), node_id: h, task_id: picked.task_id, claimed_by: holder }));
  console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_IDLE', mode, holder: h, reason: 'TASK_ALREADY_CLAIMED', task_id: picked.task_id, error: acc.error }));
  await saveRuntimeState({ state_path, state });
  return { idle: true, reason: 'TASK_ALREADY_CLAIMED' };
 }

 console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_WON', ts: nowIso(), node_id: h, task_id: picked.task_id, claimed_by: h }));
 
 // IMPLEMENT_TASK_MESSAGE_FLOW_V0_1: emit task.claim to the creator when this node actually accepts the task.
// (Do not emit claim earlier on task.publish receipt; that would fake behavior.)
try {
  const creator = String(picked.created_by || '').trim();
  if (daemon && networkHandle && typeof networkHandle.send === 'function') {
    const afterAcc = await loadTasks({ tasks_path });
    const claimed = afterAcc.table.tasks.find((t) => t.task_id === picked.task_id) || null;
    const lease_until = claimed?.lease?.expires_at || null;
    const payload = { task_id: picked.task_id, claimed_by: h, lease_until };

    const targets = [];
    if (creator && creator !== h) targets.push(creator);

    // Broadcast claim to all known peers (arbitration signal)
    const kp = networkHandle?.state?.known_peers;
    if (Array.isArray(kp)) {
      for (const p of kp) {
        const tid = String(p?.node_id || '').trim();
        if (!tid || tid === h) continue;
        targets.push(tid);
      }
    }

    const uniq = Array.from(new Set(targets));
    for (const to of uniq.slice(0, 50)) {
      const tx = networkHandle.send({ to, topic: 'task.claim', payload, message_id: `task.claim:${picked.task_id}:${to}` });
      if (tx?.ok) {
        console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_SENT', ts: nowIso(), node_id: h, task_id: picked.task_id, to }));
      } else {
        console.log(JSON.stringify({ ok: true, event: 'TASK_CLAIM_SENT', ts: nowIso(), node_id: h, task_id: picked.task_id, to, warning: 'send_failed' }));
      }
    }
  }
} catch {}
 
 // Re-check ownership before executing (claim protocol) 
 { 
 const cur = await loadTasks({ tasks_path }); 
 const curTask = cur.table.tasks.find((t) => t.task_id === picked.task_id) || null; 
 if (curTask && String(curTask.assigned_to || '').trim() && String(curTask.assigned_to || '').trim() !== h) { 
 console.log(JSON.stringify({ ok: true, event: 'TASK_EXECUTION_SKIPPED_LOST_CLAIM', ts: nowIso(), node_id: h, task_id: picked.task_id, claimed_by: curTask.assigned_to }));
 await saveRuntimeState({ state_path, state }); 
 return { idle: true, reason: 'NOT_CLAIM_OWNER' }; 
 } 
 } 
 
 // Dedup guard: skip execution if already completed with matching fingerprint 
 const guard = shouldSkipExecution({ task: picked }); 
 if (guard.ok && guard.skip) { 
 console.log(JSON.stringify({ ok: true, event: 'TASK_EXECUTION_SKIPPED_DUPLICATE', task_id: picked.task_id, fingerprint: guard.fingerprint })); 
 } else { 
 await markRunning({ tasks_path, task_id: picked.task_id }); 
 
 let execRes = null; 
 try { 
 execRes = await executeTask({ task: picked, relay_local_http: relay }); 
 if (execRes && execRes.ok) { 
 // persist fingerprint + result_hash 
 picked.fingerprint = picked.fingerprint || guard.fingerprint || null; 
 picked.result_hash = execRes.result_hash || null; 
 await completeTask({ tasks_path, task_id: picked.task_id, result: execRes }); 
 } else { 
 await failTask({ tasks_path, task_id: picked.task_id, error: execRes?.error || { code: 'EXEC_FAILED' } }); 
 } 
 } catch (e) { 
 await failTask({ tasks_path, task_id: picked.task_id, error: { code: 'EXEC_THROW', message: String(e?.message || e) } }); 
 } 
 } 
 
 // IMPLEMENT_TASK_MESSAGE_FLOW_V0_1: if this task originated from a remote creator, send task.result back via relay.
const creator = String(picked.created_by || '').trim();
if (creator && creator !== h && daemon && networkHandle && typeof networkHandle.send === 'function') {
  const afterLocal = await loadTasks({ tasks_path });
  const finalLocal = afterLocal.table.tasks.find((t) => t.task_id === picked.task_id) || null;
  const payload = {
    task_id: picked.task_id,
    executed_by: h,
    status: finalLocal?.status || null,
    result: finalLocal?.status === 'completed' ? (finalLocal?.result || null) : { ok: false, error: finalLocal?.error || { code: 'FAILED' } }
  };
  const tx = networkHandle.send({ to: creator, topic: 'task.result', payload });
  if (tx?.ok) {
    console.log(JSON.stringify({ ok: true, event: 'TASK_RESULT_SENT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: creator }));
  } else {
    console.log(JSON.stringify({ ok: true, event: 'TASK_RESULT_SENT', ts: nowIso(), node_id: h, task_id: picked.task_id, to: creator, warning: 'send_failed' }));
  }
} 
 
 state.last_task_executed_at = nowIso(); 
 await saveRuntimeState({ state_path, state }); 
 
 const after = await loadTasks({ tasks_path }); 
 const final = after.table.tasks.find((t) => t.task_id === picked.task_id) || null; 
 
 console.log(JSON.stringify({ ok: true, event: 'AGENT_LOOP_TASK_COMPLETED', mode, holder: h, task_id: picked.task_id, final_status: final?.status || null }));

// Peer graph stats: update self execution counters 
 await recordTaskExecuted({ workspace_path: ws, node_id: h, at: nowIso() }).catch(() => null); 
 
 return { idle: false, task_id: picked.task_id, final_status: final?.status || null }; 
 } catch (e) { 
 console.log(JSON.stringify({ ok: false, event: 'AGENT_LOOP_ERROR', mode, holder: h, error: { message: String(e?.message || e) } })); 
 return { idle: true, reason: 'ERROR' }; 
 } 
 }; 
 
 // ONCE mode 
 if (!daemon) { 
 const r = await doOneTick(); 
 return r.idle 
 ? { ok: true, mode, holder: h, idle: true, reason: r.reason, runtime_state_path: state_path } 
 : { ok: true, mode, holder: h, picked_task_id: r.task_id, final_status: r.final_status, runtime_state_path: state_path }; 
 } 
 
 // DAEMON mode 
 while (true) { 
 const r = await doOneTick(); 
 if (r.idle) await sleep(rand(1000, 3000)); 
 } 
 
}
