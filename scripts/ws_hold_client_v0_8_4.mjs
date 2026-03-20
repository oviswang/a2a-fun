#!/usr/bin/env node
const relayUrl = process.env.RELAY_URL || 'wss://gw.bothook.me/relay';
const nodeId = process.argv[2] || ('hold-' + Math.random().toString(16).slice(2,10));
function nowIso(){return new Date().toISOString();}
console.log(JSON.stringify({ok:true,event:'HOLD_CLIENT_START',ts:nowIso(),node_id:nodeId,relay_url:relayUrl}));
const ws = new WebSocket(relayUrl);
ws.onopen=()=>{ ws.send(JSON.stringify({type:'REGISTER',from:nodeId})); };
ws.onmessage=(ev)=>{
  let m; try{m=JSON.parse(String(ev.data));}catch{return;}
  if(m.type==='REGISTER_ACK' && m.accepted){
    console.log(JSON.stringify({ok:true,event:'HOLD_CLIENT_REGISTER_ACK',ts:nowIso(),node_id:nodeId,peer_hint_count:Array.isArray(m.peers)?m.peers.length:0}));
  }
};
ws.onclose=()=>{ console.log(JSON.stringify({ok:true,event:'HOLD_CLIENT_CLOSED',ts:nowIso(),node_id:nodeId})); process.exit(0); };
setInterval(()=>{},1000);
