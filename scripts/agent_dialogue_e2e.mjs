#!/usr/bin/env node
import os from 'node:os';

import { createRelayClient } from '../src/runtime/transport/relayClient.mjs';
import { extractAgentPersona } from '../src/social/agentPersona.mjs';
import { runAgentDialogue } from '../src/social/agentDialogueRunner.mjs';
import { saveAgentDialogueTranscript } from '../src/social/agentDialogueTranscript.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--relayUrl') out.relayUrl = argv[++i];
    else if (a === '--aId') out.aId = argv[++i];
    else if (a === '--bId') out.bId = argv[++i];
    else if (a === '--aWorkspace') out.aWorkspace = argv[++i];
    else if (a === '--bWorkspace') out.bWorkspace = argv[++i];
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

const pa = await extractAgentPersona({ workspace_path: aWorkspace, agent_id: aId });
const pb = await extractAgentPersona({ workspace_path: bWorkspace, agent_id: bId });

const agentA = pa.ok ? pa.persona : { agent_id: aId, name: '', mission: '', style: '', interests: [], current_focus: '' };
const agentB = pb.ok ? pb.persona : { agent_id: bId, name: '', mission: '', style: '', interests: [], current_focus: '' };

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
