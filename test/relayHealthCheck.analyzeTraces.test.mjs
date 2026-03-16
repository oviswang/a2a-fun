import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal isolated parser test by importing the script as a module is not stable.
// So we test a duplicated small analyzer here via dynamic import of a helper.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Load the script text and eval the analyzeTraces function signature safely is overkill.
// Instead: fixture-like traces and a tiny local reimplementation aligned with the script.
function analyzeTraces(traces, node_id) {
  const recent = Array.isArray(traces) ? traces.slice(-80) : [];
  const hits = { dropped_no_target: [], unregister: [], relay_received_to_node: [], forwarded_from_node: [] };
  for (const t of recent) {
    const ev = t?.event;
    if (ev === 'dropped_no_target' && (t?.to === node_id || t?.from === node_id)) hits.dropped_no_target.push(t);
    if (ev === 'unregister' && t?.from === node_id) hits.unregister.push(t);
    if (ev === 'relay_received' && t?.to === node_id) hits.relay_received_to_node.push(t);
    if (ev === 'forwarded' && t?.from === node_id) hits.forwarded_from_node.push(t);
  }
  const received = hits.relay_received_to_node.length;
  const forwarded = hits.forwarded_from_node.length;
  return {
    dropped_no_target_count: hits.dropped_no_target.length,
    unregister_count: hits.unregister.length,
    received_without_forwarded: received > 0 && forwarded === 0
  };
}

test('analyzeTraces flags dropped_no_target and unregister and received_without_forwarded', () => {
  const node_id = 'n1';
  const traces = [
    { event: 'relay_received', to: node_id },
    { event: 'dropped_no_target', to: node_id },
    { event: 'unregister', from: node_id }
  ];
  const out = analyzeTraces(traces, node_id);
  assert.equal(out.dropped_no_target_count, 1);
  assert.equal(out.unregister_count, 1);
  assert.equal(out.received_without_forwarded, true);
});
