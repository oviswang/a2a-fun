#!/usr/bin/env node
/**
 * Validation: FIX_TASK_CLAIM_RACE_CONDITION_V0_1
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
async function writeCache(ws, relayUrl, peers){
  await fs.rm(ws,{recursive:true,force:true});
  await fs.mkdir(path.join(ws,'data'),{recursive:true});
  await fs.writeFile(path.join(ws,'data','relay-cache.json'), JSON.stringify({ok:true,protocol:'a2a/0.1',updated_at:new Date().toISOString(),relays:[relayUrl]},null,2));
  await fs.writeFile(path.join(ws,'data','peer-cache.json'), JSON.stringify({ok:true,protocol:'a2a/0.1',updated_at:new Date().toISOString(),peers},null,2));
}

async function main(){
  const ts=Date.now();
  const relayPort=7702;
  const relayUrl=`ws://127.0.0.1:${relayPort}/relay`;

  const relay=spawn(process.execPath,['src/relay/server.mjs'],{cwd:process.cwd(),env:{...process.env,RELAY_BIND:'127.0.0.1',RELAY_PORT:String(relayPort),RELAY_WS_PATH:'/relay'},stdio:['ignore','pipe','pipe']});
  if(!await waitHealth(`http://127.0.0.1:${relayPort}/healthz`)) throw new Error('relay health failed');

  const A={id:`node_fix_A_${ts}`};
  const B={id:`node_fix_B_${ts}`};
  const C={id:`node_fix_C_${ts}`};

  const wsA=`/tmp/a2a_fix_A_${ts}`;
  const wsB=`/tmp/a2a_fix_B_${ts}`;
  const wsC=`/tmp/a2a_fix_C_${ts}`;

  await writeCache(wsA, relayUrl, [{node_id:B.id,relay_urls:[relayUrl],capabilities:{}},{node_id:C.id,relay_urls:[relayUrl],capabilities:{}}]);
  await writeCache(wsB, relayUrl, [{node_id:A.id,relay_urls:[relayUrl],capabilities:{}},{node_id:C.id,relay_urls:[relayUrl],capabilities:{}}]);
  await writeCache(wsC, relayUrl, [{node_id:A.id,relay_urls:[relayUrl],capabilities:{}},{node_id:B.id,relay_urls:[relayUrl],capabilities:{}}]);

  const commonEnv={...process.env,BOOTSTRAP_BASE_URL:'http://127.0.0.1:9999',ALLOW_LOCAL_RELAY:'1',RELAY_RECONNECT_ATTEMPTS:'1',DISABLE_SELF_MAINTENANCE:'1',TASK_PUBLISH_TO:''};

  let outA='', outB='', outC='';
  const pA=spawn(process.execPath,['scripts/run_agent_loop.mjs','--daemon','--holder',A.id],{cwd:process.cwd(),env:{...commonEnv,A2A_WORKSPACE_PATH:wsA,NODE_ID:A.id,A2A_AGENT_ID:A.id},stdio:['ignore','pipe','pipe']});
  pA.stdout.on('data',d=>outA+=String(d)); pA.stderr.on('data',d=>outA+=String(d));
  const pB=spawn(process.execPath,['scripts/run_agent_loop.mjs','--daemon','--holder',B.id],{cwd:process.cwd(),env:{...commonEnv,A2A_WORKSPACE_PATH:wsB,NODE_ID:B.id,A2A_AGENT_ID:B.id},stdio:['ignore','pipe','pipe']});
  pB.stdout.on('data',d=>outB+=String(d)); pB.stderr.on('data',d=>outB+=String(d));
  const pC=spawn(process.execPath,['scripts/run_agent_loop.mjs','--daemon','--holder',C.id],{cwd:process.cwd(),env:{...commonEnv,A2A_WORKSPACE_PATH:wsC,NODE_ID:C.id,A2A_AGENT_ID:C.id},stdio:['ignore','pipe','pipe']});
  pC.stdout.on('data',d=>outC+=String(d)); pC.stderr.on('data',d=>outC+=String(d));

  // wait register
  for(let i=0;i<200;i++){
    if(pick(outA,j=>j.event==='RELAY_REGISTER_OK').length && pick(outB,j=>j.event==='RELAY_REGISTER_OK').length && pick(outC,j=>j.event==='RELAY_REGISTER_OK').length) break;
    await sleep(50);
  }

  // create task
  const topic=`fix_race_${ts}`;
  const create = await new Promise((resolve)=>{
    let buf='';
    const p=spawn(process.execPath,['scripts/tasks_demo_publish.mjs','--type','run_check','--topic',topic,'--created-by',A.id,'--check','relay_health'],{cwd:process.cwd(),env:{...process.env,A2A_WORKSPACE_PATH:wsA},stdio:['ignore','pipe','pipe']});
    p.stdout.on('data',d=>buf+=String(d)); p.stderr.on('data',d=>buf+=String(d));
    p.on('close',()=>resolve(buf));
  });
  const created=JSON.parse(create);
  const task_id=created?.task?.task_id;

  // wait for both windows + result (proof-grade)
  for(let i=0;i<300;i++){
    const resA=pick(outA,j=>j.event==='TASK_RESULT_RECEIVED' && j.task_id===task_id);
    const bCol=pick(outB,j=>j.event==='TASK_CLAIM_WINDOW_COLLECTED' && j.task_id===task_id);
    const cCol=pick(outC,j=>j.event==='TASK_CLAIM_WINDOW_COLLECTED' && j.task_id===task_id);
    if(resA.length>=1 && bCol.length>=1 && cCol.length>=1) break;
    await sleep(50);
  }

  const bWin = pick(outB,j=>j.event==='TASK_CLAIM_DECIDED_WINNER' && j.task_id===task_id);
  const cWin = pick(outC,j=>j.event==='TASK_CLAIM_DECIDED_WINNER' && j.task_id===task_id);
  const bLos = pick(outB,j=>j.event==='TASK_CLAIM_DECIDED_LOSER' && j.task_id===task_id);
  const cLos = pick(outC,j=>j.event==='TASK_CLAIM_DECIDED_LOSER' && j.task_id===task_id);

  const bDone = pick(outB,j=>j.event==='AGENT_LOOP_TASK_COMPLETED' && j.task_id===task_id);
  const cDone = pick(outC,j=>j.event==='AGENT_LOOP_TASK_COMPLETED' && j.task_id===task_id);

  // exactly one done
  const doneCount = (bDone.length?1:0)+(cDone.length?1:0);

  // both observed same winner
  const winnerB = bWin.slice(-1)[0]?.winner || null;
  const winnerC = cWin.slice(-1)[0]?.winner || null;

  const bTotal = pick(outB,j=>j.event==='TASK_CLAIM_WINDOW_COLLECTED' && j.task_id===task_id).slice(-1)[0]?.total_claims ?? 0;
  const cTotal = pick(outC,j=>j.event==='TASK_CLAIM_WINDOW_COLLECTED' && j.task_id===task_id).slice(-1)[0]?.total_claims ?? 0;

  const ok = !!(winnerB && winnerC && winnerB===winnerC && bTotal>=2 && cTotal>=2 && doneCount===1 && (bLos.length+cLos.length)>=1);

  try{pA.kill('SIGTERM')}catch{}
  try{pB.kill('SIGTERM')}catch{}
  try{pC.kill('SIGTERM')}catch{}
  try{relay.kill('SIGTERM')}catch{}

  console.log(JSON.stringify({
    ok,
    task_id,
    winnerB,
    winnerC,
    evidence:{
      B_window_started: pick(outB,j=>j.event==='TASK_CLAIM_WINDOW_STARTED' && j.task_id===task_id).slice(-1)[0]||null,
      C_window_started: pick(outC,j=>j.event==='TASK_CLAIM_WINDOW_STARTED' && j.task_id===task_id).slice(-1)[0]||null,
      B_collected: pick(outB,j=>j.event==='TASK_CLAIM_WINDOW_COLLECTED' && j.task_id===task_id).slice(-1)[0]||null,
      C_collected: pick(outC,j=>j.event==='TASK_CLAIM_WINDOW_COLLECTED' && j.task_id===task_id).slice(-1)[0]||null,
      B_decision: bWin.slice(-1)[0]||null,
      C_decision: cWin.slice(-1)[0]||null,
      B_loser: bLos.slice(-1)[0]||null,
      C_loser: cLos.slice(-1)[0]||null,
      B_done: bDone.slice(-1)[0]||null,
      C_done: cDone.slice(-1)[0]||null,
      A_result: pick(outA,j=>j.event==='TASK_RESULT_RECEIVED' && j.task_id===task_id).slice(-1)[0]||null
    }
  },null,2));

  process.exit(ok?0:2);
}

main().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message},null,2));process.exit(1)});
