#!/usr/bin/env node
/**
 * Deterministic validation: reliable task.publish delivery (ACK + retry)
 *
 * Proof conditions:
 * 1) A/B/C relay-registered
 * 2) A creates fresh task
 * 3) B + C receive task.publish
 * 4) A receives ACK from B + C
 * 5) A logs TASK_PUBLISH_DELIVERY_COMPLETE
 * 6) arbitration (claim window) happens only AFTER delivery complete
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitHealth(url, tries=80){
  for(let i=0;i<tries;i++){
    try{const r=await fetch(url); const j=await r.json().catch(()=>null); if(r.status===200 && j?.ok) return true;}catch{}
    await sleep(100);
  }
  return false;
}
function parse(buf){
  const out=[];
  for(const ln of String(buf||'').split('\n')){ if(!ln.trim().startsWith('{')) continue; try{out.push(JSON.parse(ln));}catch{} }
  return out;
}
function pick(buf, pred){ return parse(buf).filter(pred); }
function last(buf, pred){ const arr=pick(buf,pred); return arr.length?arr[arr.length-1]:null; }

async function writeCache(ws, relayUrl, peers){
  await fs.rm(ws,{recursive:true,force:true});
  await fs.mkdir(path.join(ws,'data'),{recursive:true});
  await fs.writeFile(path.join(ws,'data','relay-cache.json'), JSON.stringify({ok:true,protocol:'a2a/0.1',updated_at:new Date().toISOString(),relays:[relayUrl]},null,2));
  await fs.writeFile(path.join(ws,'data','peer-cache.json'), JSON.stringify({ok:true,protocol:'a2a/0.1',updated_at:new Date().toISOString(),peers},null,2));
}

async function main(){
  const ts=Date.now();
  const relayPort=7812;
  const relayUrl=`ws://127.0.0.1:${relayPort}/relay`;

  const relay=spawn(process.execPath,['src/relay/server.mjs'],{cwd:process.cwd(),env:{...process.env,RELAY_BIND:'127.0.0.1',RELAY_PORT:String(relayPort),RELAY_WS_PATH:'/relay'},stdio:['ignore','pipe','pipe']});
  if(!await waitHealth(`http://127.0.0.1:${relayPort}/healthz`)) throw new Error('relay health failed');

  const A={id:`node_pub_A_${ts}`};
  const B={id:`node_pub_B_${ts}`};
  const C={id:`node_pub_C_${ts}`};

  const wsA=`/tmp/a2a_pub_A_${ts}`;
  const wsB=`/tmp/a2a_pub_B_${ts}`;
  const wsC=`/tmp/a2a_pub_C_${ts}`;

  await writeCache(wsA, relayUrl, [{node_id:B.id,relay_urls:[relayUrl],capabilities:{}},{node_id:C.id,relay_urls:[relayUrl],capabilities:{}}]);
  await writeCache(wsB, relayUrl, [{node_id:A.id,relay_urls:[relayUrl],capabilities:{}},{node_id:C.id,relay_urls:[relayUrl],capabilities:{}}]);
  await writeCache(wsC, relayUrl, [{node_id:A.id,relay_urls:[relayUrl],capabilities:{}},{node_id:B.id,relay_urls:[relayUrl],capabilities:{}}]);

  const envCommon={...process.env,BOOTSTRAP_BASE_URL:'http://127.0.0.1:9999',ALLOW_LOCAL_RELAY:'1',RELAY_RECONNECT_ATTEMPTS:'1',DISABLE_SELF_MAINTENANCE:'1'};

  let outA='', outB='', outC='';

  // Force A to never self-execute its own published tasks in this proof.
  const pA=spawn(process.execPath,['scripts/run_agent_loop.mjs','--daemon','--holder',A.id],{cwd:process.cwd(),env:{...envCommon,A2A_WORKSPACE_PATH:wsA,NODE_ID:A.id,A2A_AGENT_ID:A.id,TASK_PUBLISH_TO:`${B.id},${C.id}`},stdio:['ignore','pipe','pipe']});
  pA.stdout.on('data',d=>outA+=String(d)); pA.stderr.on('data',d=>outA+=String(d));

  const pB=spawn(process.execPath,['scripts/run_agent_loop.mjs','--daemon','--holder',B.id],{cwd:process.cwd(),env:{...envCommon,A2A_WORKSPACE_PATH:wsB,NODE_ID:B.id,A2A_AGENT_ID:B.id},stdio:['ignore','pipe','pipe']});
  pB.stdout.on('data',d=>outB+=String(d)); pB.stderr.on('data',d=>outB+=String(d));

  const pC=spawn(process.execPath,['scripts/run_agent_loop.mjs','--daemon','--holder',C.id],{cwd:process.cwd(),env:{...envCommon,A2A_WORKSPACE_PATH:wsC,NODE_ID:C.id,A2A_AGENT_ID:C.id},stdio:['ignore','pipe','pipe']});
  pC.stdout.on('data',d=>outC+=String(d)); pC.stderr.on('data',d=>outC+=String(d));

  // readiness barrier: require RELAY_REGISTER_OK on A/B/C
  for(let i=0;i<300;i++){
    const aReg=pick(outA,j=>j.event==='RELAY_REGISTER_OK').length;
    const bReg=pick(outB,j=>j.event==='RELAY_REGISTER_OK').length;
    const cReg=pick(outC,j=>j.event==='RELAY_REGISTER_OK').length;
    if(aReg&&bReg&&cReg) break;
    await sleep(50);
  }

  // small stabilization delay to ensure outbound tick is active
  await sleep(500);

  // Create task on A
  const topic=`pub_proof_${ts}`;
  const create = await new Promise((resolve)=>{
    let buf='';
    const p=spawn(process.execPath,['scripts/tasks_demo_publish.mjs','--type','run_check','--topic',topic,'--created-by',A.id,'--check','relay_health'],{cwd:process.cwd(),env:{...process.env,A2A_WORKSPACE_PATH:wsA},stdio:['ignore','pipe','pipe']});
    p.stdout.on('data',d=>buf+=String(d)); p.stderr.on('data',d=>buf+=String(d));
    p.on('close',()=>resolve(buf));
  });
  const task_id=JSON.parse(create)?.task?.task_id;

  // wait for delivery complete + receipts + ACKs
  for(let i=0;i<500;i++){
    const bRecv=pick(outB,j=>j.event==='TASK_PUBLISH_RECEIVED' && j.task_id===task_id).length;
    const cRecv=pick(outC,j=>j.event==='TASK_PUBLISH_RECEIVED' && j.task_id===task_id).length;
    const ackB=pick(outA,j=>j.event==='TASK_PUBLISH_ACK_RECEIVED' && j.task_id===task_id && j.received_by===B.id).length;
    const ackC=pick(outA,j=>j.event==='TASK_PUBLISH_ACK_RECEIVED' && j.task_id===task_id && j.received_by===C.id).length;
    const complete=pick(outA,j=>j.event==='TASK_PUBLISH_DELIVERY_COMPLETE' && j.task_id===task_id).length;
    if(bRecv&&cRecv&&ackB&&ackC&&complete) break;
    await sleep(50);
  }

  const evComplete = last(outA, j=>j.event==='TASK_PUBLISH_DELIVERY_COMPLETE' && j.task_id===task_id);
  const completeTs = evComplete?.ts ? Date.parse(evComplete.ts) : NaN;

  // arbitration-after-delivery check (best-effort): if window logs exist, they must be after complete
  const bWin = last(outB, j=>j.event==='TASK_CLAIM_WINDOW_STARTED' && j.task_id===task_id);
  const cWin = last(outC, j=>j.event==='TASK_CLAIM_WINDOW_STARTED' && j.task_id===task_id);
  const bWinOk = !bWin?.ts || (!Number.isFinite(completeTs)) || (Date.parse(bWin.ts) >= completeTs);
  const cWinOk = !cWin?.ts || (!Number.isFinite(completeTs)) || (Date.parse(cWin.ts) >= completeTs);

  const retry = pick(outA,j=>j.event==='TASK_PUBLISH_RETRY' && j.task_id===task_id);
  const bReceived = pick(outB,j=>j.event==='TASK_PUBLISH_RECEIVED' && j.task_id===task_id).length>0;
  const cReceived = pick(outC,j=>j.event==='TASK_PUBLISH_RECEIVED' && j.task_id===task_id).length>0;
  const ackB = last(outA,j=>j.event==='TASK_PUBLISH_ACK_RECEIVED' && j.task_id===task_id && j.received_by===B.id);
  const ackC = last(outA,j=>j.event==='TASK_PUBLISH_ACK_RECEIVED' && j.task_id===task_id && j.received_by===C.id);

  const ok = !!(bReceived && cReceived && ackB && ackC && evComplete && bWinOk && cWinOk);

  try{pA.kill('SIGTERM')}catch{}
  try{pB.kill('SIGTERM')}catch{}
  try{pC.kill('SIGTERM')}catch{}
  try{relay.kill('SIGTERM')}catch{}

  console.log(JSON.stringify({
    ok,
    task_id,
    evidence:{
      A_registered: !!pick(outA,j=>j.event==='RELAY_REGISTER_OK').length,
      B_registered: !!pick(outB,j=>j.event==='RELAY_REGISTER_OK').length,
      C_registered: !!pick(outC,j=>j.event==='RELAY_REGISTER_OK').length,
      B_received: bReceived,
      C_received: cReceived,
      A_ackB: ackB||null,
      A_ackC: ackC||null,
      A_complete: evComplete||null,
      A_retry_sample: retry.slice(0,3),
      B_window_started: bWin||null,
      C_window_started: cWin||null
    }
  },null,2));

  process.exit(ok?0:2);
}

main().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message},null,2));process.exit(1)});
