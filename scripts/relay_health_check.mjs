#!/usr/bin/env node
/**
 * Relay health checklist v0.1
 * - Small, deterministic, machine-safe JSON output
 * - Based on practical experience: /nodes + /traces fast-loop + avoid session churn
 */

function parseArgs(argv) {
  const out = { node_id: null, base_url: 'https://bootstrap.a2a.fun' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--node-id') out.node_id = argv[++i] || null;
    else if (a === '--base-url') out.base_url = argv[++i] || out.base_url;
  }
  return out;
}

function jlog(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function finding(code, detail) {
  return { code, detail };
}

function normalizeBase(base_url) {
  return String(base_url || '').replace(/\/$/, '');
}

function countNodeSessions(nodes, node_id) {
  const hits = nodes.filter((n) => n && n.node_id === node_id);
  return { count: hits.length, sessions: hits.map((h) => ({ session_id: h.session_id || null, last_seen: h.last_seen || null })) };
}

function analyzeTraces(traces, node_id) {
  const recent = Array.isArray(traces) ? traces.slice(-80) : [];
  const hits = {
    dropped_no_target: [],
    unregister: [],
    relay_received_to_node: [],
    forwarded_from_node: []
  };

  for (const t of recent) {
    const ev = t?.event;
    if (ev === 'dropped_no_target' && (t?.to === node_id || t?.from === node_id)) hits.dropped_no_target.push(t);
    if (ev === 'unregister' && t?.from === node_id) hits.unregister.push(t);
    if (ev === 'relay_received' && t?.to === node_id) hits.relay_received_to_node.push(t);
    if (ev === 'forwarded' && t?.from === node_id) hits.forwarded_from_node.push(t);
  }

  // Heuristic: relay_received to node without corresponding forwarded (recent window)
  const received = hits.relay_received_to_node.length;
  const forwarded = hits.forwarded_from_node.length;
  const receivedWithoutForwarded = received > 0 && forwarded === 0;

  return {
    recent_count: recent.length,
    dropped_no_target_count: hits.dropped_no_target.length,
    unregister_count: hits.unregister.length,
    received_to_node_count: received,
    forwarded_from_node_count: forwarded,
    received_without_forwarded: receivedWithoutForwarded,
    examples: {
      dropped_no_target: hits.dropped_no_target.slice(-3),
      unregister: hits.unregister.slice(-3)
    }
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  const text = await r.text();
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    obj = null;
  }
  return { ok: r.ok && !!obj && obj.ok === true, status: r.status, obj, text: text.slice(0, 500) };
}

const args = parseArgs(process.argv);
const node_id = args.node_id ? String(args.node_id).trim() : '';
const base_url = normalizeBase(args.base_url);

if (!node_id) {
  jlog({
    ok: false,
    node_id: null,
    base_url,
    relay_health: 'unknown',
    session_count: 0,
    findings: [finding('MISSING_NODE_ID', 'Provide --node-id <node_id>.')],
    recommendation: 'Run again with --node-id.'
  });
  process.exit(2);
}

const nodesUrl = `${base_url}/nodes`;
const tracesUrl = `${base_url}/traces`;

const findings = [];
let nodes = [];
let traces = [];

let nodesFetch = null;
let tracesFetch = null;

try {
  nodesFetch = await fetchJson(nodesUrl);
  if (!nodesFetch.ok) {
    findings.push(finding('NODES_ENDPOINT_UNAVAILABLE', `GET ${nodesUrl} failed (status=${nodesFetch.status}).`));
  } else {
    nodes = Array.isArray(nodesFetch.obj?.nodes) ? nodesFetch.obj.nodes : [];
  }
} catch (e) {
  findings.push(finding('NODES_ENDPOINT_UNAVAILABLE', `GET ${nodesUrl} threw.`));
}

try {
  tracesFetch = await fetchJson(tracesUrl);
  if (!tracesFetch.ok) {
    findings.push(finding('TRACES_ENDPOINT_UNAVAILABLE', `GET ${tracesUrl} failed (status=${tracesFetch.status}).`));
  } else {
    traces = Array.isArray(tracesFetch.obj?.traces) ? tracesFetch.obj.traces : [];
  }
} catch (e) {
  findings.push(finding('TRACES_ENDPOINT_UNAVAILABLE', `GET ${tracesUrl} threw.`));
}

// Identity health (/nodes presence + session count)
const { count: session_count, sessions } = countNodeSessions(nodes, node_id);

let relay_health = 'unknown';
let recommendation = 'No recommendation.';

if (nodesFetch?.ok && session_count === 0) {
  relay_health = 'unknown';
  findings.push(finding('NODE_NOT_VISIBLE', `node_id not present in /nodes: ${node_id}`));
  recommendation = 'Ensure the node is connected to the relay and registered (inbound relay session running).';
}

if (nodesFetch?.ok && session_count === 1) {
  relay_health = 'healthy';
}

if (nodesFetch?.ok && session_count > 1) {
  relay_health = 'unhealthy';
  findings.push(finding('MULTIPLE_SESSIONS_FOR_NODE_ID', `Found ${session_count} sessions for node_id=${node_id}.`));
  recommendation = 'Stop extra inbound relay clients; keep exactly one long-running inbound relay session.';
}

// Trace health (degrade/unhealthy)
if (tracesFetch?.ok) {
  const t = analyzeTraces(traces, node_id);

  if (t.dropped_no_target_count > 0) {
    findings.push(finding('DROPPED_NO_TARGET_RECENT', `Recent dropped_no_target events involving ${node_id}: ${t.dropped_no_target_count}`));
    if (relay_health === 'healthy') relay_health = 'degraded';
  }

  if (t.unregister_count > 0) {
    findings.push(finding('UNREGISTER_RECENT', `Recent unregister events for ${node_id}: ${t.unregister_count}`));
    // unregister is a stronger sign of churn
    if (relay_health === 'healthy') relay_health = 'degraded';
    if (relay_health === 'degraded' && t.unregister_count >= 2) relay_health = 'unhealthy';
  }

  if (t.received_without_forwarded) {
    findings.push(finding('RELAY_RECEIVED_WITHOUT_FORWARDED', `Saw relay_received to ${node_id} but no forwarded-from-${node_id} in recent window.`));
    if (relay_health === 'healthy') relay_health = 'degraded';
  }

  if (relay_health === 'healthy' && findings.length === 0) {
    recommendation = 'Keep using the fast loop: check /nodes and /traces after each change.';
  }

  if (relay_health === 'degraded') {
    recommendation = 'Investigate recent relay traces; session churn and dropped deliveries are common culprits.';
  }
}

if (!nodesFetch?.ok && !tracesFetch?.ok) {
  relay_health = 'unknown';
  recommendation = 'Relay endpoints unavailable; run locally on bootstrap host or ensure /nodes and /traces are exposed.';
}

jlog({
  ok: relay_health === 'healthy' || relay_health === 'degraded',
  node_id,
  base_url,
  relay_health,
  session_count,
  sessions,
  findings,
  recommendation
});
