import { checkRelayPeerLiveness } from './checkRelayPeerLiveness.mjs';

function finding(code, detail) {
  return { code, detail };
}

function summarize({ relay_health, node_id, liveness, findings, recommendation }) {
  return {
    ok: relay_health === 'healthy' || relay_health === 'degraded',
    node_id,
    relay_health,
    findings,
    recommendation: recommendation || null,
    _debug: {
      liveness
    }
  };
}

export async function checkPeerRelayHealth({ node_id, relay_local_http = 'http://127.0.0.1:18884', traces = [] } = {}) {
  const nid = typeof node_id === 'string' ? node_id.trim() : '';
  console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_HEALTH_CHECK_STARTED', node_id: nid, relay_local_http }));

  if (!nid) {
    const out = summarize({
      relay_health: 'unknown',
      node_id: nid,
      liveness: null,
      findings: [finding('MISSING_NODE_ID', 'node_id is required')],
      recommendation: 'Provide a node_id.'
    });
    console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_HEALTH_CHECK_RESULT', ...out }));
    return out;
  }

  const liveness = await checkRelayPeerLiveness({ relay_local_http, peer_id: nid });

  const findings = [];
  let relay_health = 'unknown';
  let recommendation = 'No recommendation.';

  if (!liveness.ok) {
    findings.push(finding('RELAY_LIVENESS_CHECK_FAILED', 'Could not query relay /nodes.'));
    relay_health = 'unknown';
    recommendation = 'Check relay availability.';
  } else if (!liveness.on_relay) {
    findings.push(finding('NODE_NOT_VISIBLE', `node_id not present in /nodes: ${nid}`));
    relay_health = 'unknown';
    recommendation = 'Ensure the peer inbound relay session is connected.';
  } else {
    relay_health = 'healthy';
  }

  // Trace-based degradation (minimal, deterministic): only consume provided traces
  const recent = Array.isArray(traces) ? traces.slice(-80) : [];
  const dropped = recent.filter((t) => t?.event === 'dropped_no_target' && (t?.to === nid || t?.from === nid));
  const unreg = recent.filter((t) => t?.event === 'unregister' && t?.from === nid);

  if (relay_health !== 'unknown') {
    if (dropped.length > 0) {
      findings.push(finding('DROPPED_NO_TARGET_RECENT', `Recent dropped_no_target involving ${nid}: ${dropped.length}`));
      relay_health = 'degraded';
      recommendation = 'Investigate dropped deliveries; confirm target is registered and stable.';
    }
    if (unreg.length > 0) {
      findings.push(finding('UNREGISTER_RECENT', `Recent unregister for ${nid}: ${unreg.length}`));
      relay_health = unreg.length >= 2 ? 'unhealthy' : 'degraded';
      recommendation = 'Session churn detected; keep exactly one long-running inbound relay session.';
    }
  }

  const out = summarize({ relay_health, node_id: nid, liveness, findings, recommendation });
  console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_HEALTH_CHECK_RESULT', ...out }));
  return out;
}
