#!/usr/bin/env node
import { initRelaySingleton } from '../src/runtime/network/relaySingleton.mjs';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function nowIso(){ return new Date().toISOString(); }

async function makeClient(node_id){
  const relayUrl = process.env.RELAY_URL || 'wss://gw.bothook.me/relay';
  const relay = initRelaySingleton({ node_id, relayCandidates: [relayUrl], allowLocalRelay: true });
  const seen = { peer_hints: null };
  relay.subscribe('relay.peer_hints', ({ payload }) => {
    seen.peer_hints = payload;
    process.stdout.write(JSON.stringify({ ok:true, event:'TEST_PEER_HINTS_RECEIVED', ts: nowIso(), node_id, peer_hint_count: Array.isArray(payload?.peers)?payload.peers.length:null, peers: (payload?.peers||[]).slice(0,5) })+'\n');
  });
  await relay.ensureConnected();
  return { relay, seen };
}

async function main(){
  const a = 'cs-a-' + Math.random().toString(16).slice(2,10);
  const b = 'cs-b-' + Math.random().toString(16).slice(2,10);

  const ca = await makeClient(a);
  await sleep(300);
  const cb = await makeClient(b);
  await sleep(800);

  const out = {
    ok: true,
    event: 'DISCOVERY_BOOTSTRAP_SMOKETEST',
    ts: nowIso(),
    a, b,
    a_peer_hints: ca.seen.peer_hints?.peers?.slice(0,5) || [],
    b_peer_hints: cb.seen.peer_hints?.peers?.slice(0,5) || []
  };
  console.log(JSON.stringify(out, null, 2));
  await ca.relay.close();
  await cb.relay.close();
}

main().catch((e)=>{
  console.error(JSON.stringify({ ok:false, event:'DISCOVERY_BOOTSTRAP_SMOKETEST_FAILED', ts: nowIso(), error: String(e?.stack||e) }));
  process.exit(1);
});
