import crypto from 'node:crypto';

import { createAgentDialogueMessage } from './agentDialogueMessage.mjs';

function nowIso() {
  return new Date().toISOString();
}

function safeLine(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, 400);
}

function listTop(xs, n) {
  return Array.isArray(xs) ? xs.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : [];
}

function stylePrefix(style) {
  const s = safeLine(style).toLowerCase();
  if (!s) return '';
  if (s.includes('formal')) return 'Note: ';
  if (s.includes('casual')) return 'Hey — ';
  if (s.includes('concise')) return '';
  return '';
}

function renderIntro(persona, topic) {
  const p = persona || {};
  const name = safeLine(p.name) || safeLine(p.agent_id);
  const mission = safeLine(p.mission);
  const focus = safeLine(p.current_focus);
  const interests = listTop(p.interests, 4);

  const bits = [];
  bits.push(`${name} here.`);
  if (mission) bits.push(`Mission: ${mission}.`);
  bits.push(`Topic: ${safeLine(topic)}.`);
  if (focus) bits.push(`Current focus: ${focus}.`);
  if (interests.length) bits.push(`Interests: ${interests.join(', ')}.`);

  return stylePrefix(p.style) + bits.join(' ');
}

function renderReply(persona, otherPersona) {
  const p = persona || {};
  const name = safeLine(p.name) || safeLine(p.agent_id);
  const mission = safeLine(p.mission);
  const focus = safeLine(p.current_focus);

  const otherName = safeLine(otherPersona?.name) || safeLine(otherPersona?.agent_id);

  const bits = [];
  bits.push(`Hi ${otherName}.`);
  bits.push(`${name} here.`);
  if (mission) bits.push(`I’m oriented around: ${mission}.`);
  if (focus) bits.push(`Right now I’m focused on: ${focus}.`);
  bits.push('Potential common ground: discovery, capability exchange, and lightweight coordination.');

  return stylePrefix(p.style) + bits.join(' ');
}

function renderFollowUp(persona, otherPersona) {
  const p = persona || {};
  const otherName = safeLine(otherPersona?.name) || safeLine(otherPersona?.agent_id);
  const skills = listTop(p.interests, 3);

  const bits = [];
  bits.push(`Quick question, ${otherName}:`);
  bits.push('what’s one strength you can contribute immediately in a new collaboration?');
  if (skills.length) bits.push(`I can complement with: ${skills.join(', ')}.`);

  return stylePrefix(p.style) + bits.join(' ');
}

function renderClose(persona, otherPersona) {
  const p = persona || {};
  const name = safeLine(p.name) || safeLine(p.agent_id);
  const otherName = safeLine(otherPersona?.name) || safeLine(otherPersona?.agent_id);

  const bits = [];
  bits.push(`Summary:`);
  bits.push(`${name} ↔ ${otherName}: aligned on short, capability-driven collaboration.`);
  bits.push('Next step: if both humans opt in, exchange one concrete task/capability to trial.');

  return stylePrefix(p.style) + bits.join(' ');
}

function fail(code) {
  return { ok: false, dialogue_id: null, messages: [], error: { code: String(code || 'FAILED').slice(0, 64) } };
}

/**
 * runAgentDialogue({ agentA, agentB, topic, turns=4, send })
 *
 * send({ to, payload }) must deliver payload to the other node (relay transport).
 */
export async function runAgentDialogue({ agentA, agentB, topic = 'current focus and common ground', turns = 4, send } = {}) {
  if (!agentA || typeof agentA !== 'object') return fail('INVALID_AGENT_A');
  if (!agentB || typeof agentB !== 'object') return fail('INVALID_AGENT_B');
  if (typeof send !== 'function') return fail('MISSING_SEND');

  const dialogue_id = `dlg:${crypto.randomUUID()}`;
  const messages = [];

  const scripts = [
    { from: agentA, to: agentB, render: () => renderIntro(agentA, topic) },
    { from: agentB, to: agentA, render: () => renderReply(agentB, agentA) },
    { from: agentA, to: agentB, render: () => renderFollowUp(agentA, agentB) },
    { from: agentB, to: agentA, render: () => renderClose(agentB, agentA) }
  ].slice(0, Math.max(2, Math.min(4, turns)));

  for (let i = 0; i < scripts.length; i++) {
    const step = scripts[i];
    const body = step.render();
    const msgOut = createAgentDialogueMessage({
      dialogue_id,
      turn: i + 1,
      from_agent_id: step.from.agent_id,
      to_agent_id: step.to.agent_id,
      topic,
      message: body,
      created_at: nowIso()
    });
    if (!msgOut.ok) return fail(msgOut.error?.code || 'MESSAGE_BUILD_FAILED');

    const payload = msgOut.message;
    messages.push(payload);

    await send({ to: step.to.agent_id, payload });
  }

  return { ok: true, dialogue_id, messages, error: null };
}
