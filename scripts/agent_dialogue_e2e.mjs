#!/usr/bin/env node
import os from 'node:os';
import { execFile } from 'node:child_process';

import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { extractAgentPersona } from '../src/social/agentPersona.mjs';
import { runAgentDialogue } from '../src/social/agentDialogueRunner.mjs';
import { saveAgentDialogueTranscript } from '../src/social/agentDialogueTranscript.mjs';
import { collectAgentEnvironmentReport } from '../src/social/agentEnvironmentReport.mjs';
import { checkPeerRelayHealth } from '../src/social/checkPeerRelayHealth.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--relayUrl') out.relayUrl = argv[++i];
    else if (a === '--aId') out.aId = argv[++i];
    else if (a === '--bId') out.bId = argv[++i];
    else if (a === '--aWorkspace') out.aWorkspace = argv[++i];
    else if (a === '--bWorkspace') out.bWorkspace = argv[++i];
    else if (a === '--bSshHost') out.bSshHost = argv[++i];
    else if (a === '--bSshKey') out.bSshKey = argv[++i];
    else if (a === '--topic') out.topic = argv[++i];
    else if (a === '--turns') out.turns = parseInt(argv[++i], 10);
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function defer(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function makeInbox() {
  const q = [];
  return {
    push: (m) => q.push(m),
    waitFor: async (pred, timeoutMs = 4000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const idx = q.findIndex(pred);
        if (idx >= 0) return q.splice(idx, 1)[0];
        await defer(25);
      }
      const e = new Error('TIMEOUT');
      e.code = 'DIALOGUE_RECV_TIMEOUT';
      throw e;
    }
  };
}

const args = parseArgs(process.argv);
const relayUrl = args.relayUrl || process.env.RELAY_URL || 'wss://bootstrap.a2a.fun/relay';
const aId = (args.aId || process.env.A2A_DIALOGUE_A_ID || `${os.hostname()}-A`).trim();
const bId = (args.bId || process.env.A2A_DIALOGUE_B_ID || `${os.hostname()}-B`).trim();
const aWorkspace = args.aWorkspace || process.env.A2A_WORKSPACE_PATH || process.cwd();
const bWorkspace = args.bWorkspace || process.env.A2A_WORKSPACE_PATH_B || process.cwd();
const bSshHost = args.bSshHost || process.env.A2A_DIALOGUE_B_SSH_HOST || '';
const bSshKey = args.bSshKey || process.env.A2A_DIALOGUE_B_SSH_KEY || '/home/ubuntu/.openclaw/credentials/pool_ssh/id_ed25519';
const topic = args.topic || 'current focus, strengths, and common ground';
const turns = Number.isFinite(args.turns) ? args.turns : 4;

const inboxA = makeInbox();
const inboxB = makeInbox();

const clientA = createRelayClient({
  relayUrl,
  nodeId: aId,
  registrationMode: 'v2',
  sessionId: `sess:${aId}`,
  onForward: ({ from, payload }) => inboxA.push({ from, payload })
});

const clientB = createRelayClient({
  relayUrl,
  nodeId: bId,
  registrationMode: 'v2',
  sessionId: `sess:${bId}`,
  onForward: ({ from, payload }) => inboxB.push({ from, payload })
});

await clientA.connect();
await clientB.connect();

// Minimal preflight gate (peer relay health)
// - healthy: allow
// - degraded: allow with warning
// - unknown/unhealthy: block
try {
  const relay_local_http = process.env.RELAY_LOCAL_HTTP || 'http://127.0.0.1:18884';
  let traces = [];
  try {
    const r = await fetch(`${relay_local_http}/traces`);
    const j = await r.json();
    traces = Array.isArray(j?.traces) ? j.traces : [];
  } catch {}

  const healthB = await checkPeerRelayHealth({ node_id: bId, relay_local_http, traces });
  if (healthB.relay_health === 'unknown' || healthB.relay_health === 'unhealthy') {
    console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_NOT_READY', node_id: bId, relay_health: healthB.relay_health }));
    process.exit(3);
  }
  if (healthB.relay_health === 'degraded') {
    console.log(JSON.stringify({ ok: true, event: 'PEER_RELAY_HEALTH_DEGRADED_BUT_ALLOWED', node_id: bId }));
  }
} catch {}

const pa = await extractAgentPersona({ workspace_path: aWorkspace, agent_id: aId });
const pb = await extractAgentPersona({ workspace_path: bWorkspace, agent_id: bId });

// Collect per-agent environment report.
const envA = await collectAgentEnvironmentReport({ workspace_path: aWorkspace }).catch(() => null);

let envB = null;
if (bSshHost) {
  // Remote collection via SSH to avoid local simulation.
  // Outputs machine-safe JSON.
  const remoteJs = `
    const os=require('node:os');
    const fs=require('node:fs');
    const path=require('node:path');
    function bt(s){const out=new Set(); for(const m of String(s||'').matchAll(/\`([a-zA-Z0-9_\\-]{2,32})\`/g)) out.add(m[1]); return [...out].sort();}
    const ws=process.env.A2A_WORKSPACE_PATH||process.cwd();
    let skills=[];
    try{skills=bt(fs.readFileSync(path.join(ws,'agent','skill.md'),'utf8'));}catch{}
    async function dirCount(){
      try{const r=await fetch('https://bootstrap.a2a.fun/agents'); const j=await r.json(); return Array.isArray(j.agents)?j.agents.length:null;}catch{return null;}
    }
    async function main(){
      let head=null; try{head=require('child_process').execSync('git rev-parse --short HEAD',{cwd:ws,stdio:['ignore','pipe','ignore']}).toString().trim()||null;}catch{}
      let latest=null; try{const dir=path.join(ws,'transcripts'); const names=fs.readdirSync(dir); let best=null; for(const n of names){const p=path.join(dir,n); const st=fs.statSync(p); if(!st.isFile()) continue; if(!best||st.mtimeMs>best.mtimeMs) best={file:n,mtime_ms:st.mtimeMs};} latest=best;}catch{}
      function pickField(txt,key){const rx=new RegExp('^\\s*'+key+'\\s*:\\s*(.+)$','im'); const m=String(txt||'').match(rx); return m&&m[1]?String(m[1]).trim():'';}
      let soul=''; let profile=''; let current='';
      try{soul=fs.readFileSync(path.join(ws,'agent','soul.md'),'utf8');}catch{}
      try{profile=fs.readFileSync(path.join(ws,'agent','profile.md'),'utf8');}catch{}
      try{current=fs.readFileSync(path.join(ws,'agent','current.md'),'utf8');}catch{}
      const persona={
        name: pickField(soul,'name') || os.hostname(),
        mission: pickField(soul,'mission'),
        style: pickField(soul,'style'),
        current_focus: pickField(current,'current_focus') || pickField(current,'focus')
      };
      console.log(JSON.stringify({ok:true,hostname:os.hostname(),workspace_path:ws,skills_installed:skills,directory_agent_count:await dirCount(),recent_activity:{git_head:head,latest_transcript:latest},persona}));
    }
    main();
  `.trim();

  try {
    const b64 = Buffer.from(remoteJs, 'utf8').toString('base64');
    const remoteCmd = `A2A_WORKSPACE_PATH=${bWorkspace} bash -lc 'node -e "$(echo ${b64} | base64 -d)"'`;
    const r = await execFileP('ssh', [
      '-i', bSshKey,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      'ubuntu@' + bSshHost,
      remoteCmd
    ], { timeout: 20000 });
    envB = JSON.parse(String(r.stdout || '').trim());
  } catch {
    envB = null;
  }
}

const agentA = pa.ok ? { ...pa.persona, env_report: envA && envA.ok ? envA : null } : { agent_id: aId, name: '', mission: '', style: '', interests: [], current_focus: '', env_report: envA && envA.ok ? envA : null };
const baseB = pb.ok ? pb.persona : { agent_id: bId, name: '', mission: '', style: '', interests: [], current_focus: '' };
const remotePersona = envB && envB.ok && envB.persona && typeof envB.persona === 'object' ? envB.persona : null;
const agentB = {
  ...baseB,
  name: remotePersona?.name || baseB.name,
  mission: remotePersona?.mission || baseB.mission,
  style: remotePersona?.style || baseB.style,
  current_focus: remotePersona?.current_focus || baseB.current_focus,
  env_report: envB && envB.ok ? envB : null
};

// Fail the test if both sides report identical environment data (suggests local simulation).
if (agentA?.env_report && agentB?.env_report) {
  const a = agentA.env_report;
  const b = agentB.env_report;
  const keyA = JSON.stringify({ hostname: a.hostname, workspace_path: a.workspace_path, skills_installed: a.skills_installed, directory_agent_count: a.directory_agent_count, recent_activity: a.recent_activity });
  const keyB = JSON.stringify({ hostname: b.hostname, workspace_path: b.workspace_path, skills_installed: b.skills_installed, directory_agent_count: b.directory_agent_count, recent_activity: b.recent_activity });
  if (keyA === keyB) {
    const e = new Error('distributed dialogue test failed: identical env_report for both agents');
    e.code = 'LOCAL_SIMULATION_DETECTED';
    throw e;
  }
}

const received = [];

async function sendWithVerify({ to, payload }) {
  // Relay out
  if (to === aId) await clientB.relay({ to, payload });
  else await clientA.relay({ to, payload });

  // Wait on the recipient inbox to confirm actual relay delivery.
  if (to === aId) {
    const got = await inboxA.waitFor((m) => m?.payload?.kind === 'AGENT_DIALOGUE' && m.payload.dialogue_id === payload.dialogue_id && m.payload.turn === payload.turn);
    received.push(got.payload);
  } else {
    const got = await inboxB.waitFor((m) => m?.payload?.kind === 'AGENT_DIALOGUE' && m.payload.dialogue_id === payload.dialogue_id && m.payload.turn === payload.turn);
    received.push(got.payload);
  }
}

const runOut = await runAgentDialogue({ agentA, agentB, topic, turns, send: sendWithVerify });

const messages = runOut.ok ? runOut.messages : [];
const dialogue_id = runOut.ok ? runOut.dialogue_id : `dlg:failed:${nowIso()}`;

const saveOut = runOut.ok
  ? await saveAgentDialogueTranscript({ workspace_path: aWorkspace, dialogue_id, topic, agentA, agentB, messages: received.length ? received : messages })
  : { ok: false, paths: null, error: runOut.error };

await clientA.close();
await clientB.close();

console.log(
  JSON.stringify({
    ok: runOut.ok === true && saveOut.ok === true,
    relayUrl,
    dialogue_id,
    turns: messages.length,
    agentA: { agent_id: agentA.agent_id, name: agentA.name || null },
    agentB: { agent_id: agentB.agent_id, name: agentB.name || null },
    transcript_paths: saveOut.ok ? saveOut.paths : null,
    error: runOut.ok ? saveOut.error : runOut.error
  })
);
