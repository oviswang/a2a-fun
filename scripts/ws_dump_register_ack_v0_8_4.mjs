#!/usr/bin/env node
const relayUrl = process.env.RELAY_URL || 'wss://gw.bothook.me/relay';
const nodeId = process.argv[2] || ('dump-' + Math.random().toString(16).slice(2,10));
function nowIso(){return new Date().toISOString();}
const ws = new WebSocket(relayUrl);
ws.onopen=()=>{ ws.send(JSON.stringify({type:'REGISTER',from:nodeId})); };
ws.onmessage=(ev)=>{
  let m; try{m=JSON.parse(String(ev.data));}catch{return;}
  if(m.type==='REGISTER_ACK' && m.accepted){
    console.log(JSON.stringify({ok:true,event:'DUMP_REGISTER_ACK',ts:nowIso(),node_id:nodeId,peer_hint_count:Array.isArray(m.peers)?m.peers.length:0,peers:(m.peers||[]).slice(0,5)},null,2));
    ws.close();
  }
};
ws.onerror=()=>{ console.log(JSON.stringify({ok:false,event:'DUMP_WS_ERROR',ts:nowIso(),node_id:nodeId})); process.exit(1); };
setTimeout(()=>{ console.log(JSON.stringify({ok:false,event:'DUMP_TIMEOUT',ts:nowIso(),node_id:nodeId})); process.exit(2); },5000);
