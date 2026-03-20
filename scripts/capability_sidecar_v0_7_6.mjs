import fs from 'node:fs/promises';
import path from 'node:path';

const WebSocket = globalThis.WebSocket;

function nowIso(){ return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function log(event, fields={}){ process.stdout.write(`${JSON.stringify({ok:true,event,ts:nowIso(),...fields})}\n`); }

const workspace = process.env.A2A_WORKSPACE_PATH || '/home/ubuntu/a2a-fun';
const dataDir = path.join(workspace,'data');
const nodeIdPath = path.join(dataDir,'node_id');
const presencePath = path.join(dataDir,'presence-cache.json');
const cachePath = path.join(dataDir,'capabilities-cache.json');

const relayUrl = process.env.RELAY_URL || 'wss://gw.bothook.me/relay';
const gossipEveryMs = Number(process.env.CAPABILITIES_GOSSIP_EVERY_MS || 120_000);

const capabilities = ['echo','summarize_text','decision_help','code_exec_safe','simple_search'];

async function readTextSafe(p){ try{ return String(await fs.readFile(p,'utf8')).trim(); }catch{ return ''; } }
async function readJsonSafe(p){ try{ return JSON.parse(await fs.readFile(p,'utf8')); }catch{ return null; } }
async function writeJsonAtomic(p,obj){
  const tmp = `${p}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(obj,null,2));
  await fs.rename(tmp,p);
}

function mergeCapability(cache, fromNode, caps, ts){
  const nodes = cache.nodes || {};
  nodes[fromNode] = { capabilities: caps, ts };
  return { ts: nowIso(), nodes };
}

async function main(){
  if(!WebSocket) throw new Error('NO_GLOBAL_WEBSOCKET');
  const node_id = await readTextSafe(nodeIdPath);
  if(!node_id) throw new Error('MISSING_NODE_ID');
  const client_id = `cap:${node_id}`;

  let cache = (await readJsonSafe(cachePath)) || { ts: nowIso(), nodes: {} };
  cache = mergeCapability(cache, node_id, capabilities, nowIso());
  await writeJsonAtomic(cachePath, cache).catch(()=>{});

  while(true){
    log('CAP_SIDECAR_CONNECT_ATTEMPT',{client_id,relayUrl});
    const ws = new WebSocket(relayUrl);

    let registered=false;
    ws.onopen = ()=>{
      ws.send(JSON.stringify({type:'REGISTER',from:client_id,ts:nowIso()}));
    };

    ws.onmessage = async (ev)=>{
      let m=null; try{ m=JSON.parse(String(ev.data)); }catch{ return; }
      if(m?.type==='REGISTER_ACK' && m?.to===client_id && m?.accepted===true){
        registered=true;
        log('CAP_SIDECAR_REGISTER_OK',{client_id});
        // immediate gossip
        void gossip('after_register');
        return;
      }
      if(m?.type==='DELIVER' && m?.data?.topic==='peer.capabilities'){
        const p=m.data.payload||{};
        const fromNode=String(p.node_id||p.from||m.from||'').trim();
        const caps=Array.isArray(p.capabilities)?p.capabilities.map(x=>String(x).trim()).filter(Boolean).slice(0,16):[];
        const tsIn=String(p.ts||'').trim()||nowIso();
        if(fromNode && caps.length){
          cache = mergeCapability(cache, fromNode, caps, tsIn);
          await writeJsonAtomic(cachePath, cache).catch(()=>{});
          log('PEER_CAPABILITIES_RECEIVED',{client_id,from_node:fromNode,capability_count:caps.length,ts_in:tsIn});
        }
      }
    };

    ws.onerror = ()=>{};
    ws.onclose = ()=>{
      log('CAP_SIDECAR_DISCONNECTED',{client_id,registered});
    };

    const gossip = async (reason)=>{
      if(!registered || ws.readyState!==1) return;
      const pres = await readJsonSafe(presencePath);
      const peersObj = pres?.peers && typeof pres.peers==='object' ? pres.peers : {};
      const peers = Object.values(peersObj).map(p=>String(p?.peer_id||'').trim()).filter(Boolean).slice(0,60);
      const payload = { node_id, capabilities, ts: nowIso() };

      // keep self in cache
      cache = mergeCapability(cache, node_id, capabilities, payload.ts);
      await writeJsonAtomic(cachePath, cache).catch(()=>{});

      let ok=0;
      for(const to of peers){
        try{
          ws.send(JSON.stringify({type:'SEND',from:client_id,to,message_id:`cap:${node_id}:${Date.now()}`,data:{topic:'peer.capabilities',payload}}));
          ok++;
        }catch{}
      }
      log('PEER_CAPABILITIES_SENT',{client_id,node_id,capabilities,reason,peer_count:peers.length,ok_count:ok,ts:payload.ts});
    };

    // periodic gossip loop while connected
    const t = setInterval(()=>{ void gossip('periodic'); }, gossipEveryMs);
    t.unref();

    // wait until close
    while(ws.readyState===0 || ws.readyState===1) await sleep(500);
    clearInterval(t);
    await sleep(1000);
  }
}

main().catch((e)=>{
  log('CAP_SIDECAR_FATAL',{error:String(e?.message||e)});
  process.exit(1);
});
