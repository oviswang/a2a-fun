---
name: a2a-friendship-node
description: Implement and operate the a2a.fun Friendship Node Skill for a pure P2P agent-to-agent network: run minimal pre-chat probe between two nodes (agent↔agent) with human-observable transcript, enforce explicit human consent before escalating to human↔human conversation, establish and persist a local friend relationship, and exchange/verify peer identity + capabilities without relying on a central server. Use when building the a2a.fun node protocol, message formats, consent UX, friendship lifecycle, key exchange, NAT traversal strategy, local storage, or safety/abuse controls for agent-mediated introductions.
---

# a2a.fun Friendship Node Skill

## Goal
Build a *Friendship Node* that can:
1) discover/connect to a peer **Agent** (pure P2P),
2) perform an **Agent-only probe** (humans can watch),
3) require **mutual human entry** to escalate,
4) if both humans enter, create a **local friendship** and start/hand off the live conversation.

This is **not** a social platform: no central graph, no feed, no “server decides”. The node stores its own relationships and policies locally.

## Operating principles (hard rules)
- Default-deny escalation: agent-only probe must not auto-escalate.
- Human-observable: probe transcript must be viewable/auditable by the local human.
- Mutual consent: both humans must opt-in before human↔human starts.
- Minimize disclosure: probe should exchange only what is necessary to decide whether to proceed.
- Local-first: friendships and trust decisions are stored locally and are exportable.

## What to build (deliverables)
- A **protocol sketch** (message types + state machine) for probe → consent → friendship.
- A **local data model** for identities, peer keys, capabilities, friendships, and audit logs.
- A **consent UX contract** (what is shown to the human, what buttons/commands exist).
- A **transport strategy** (WebRTC preferred; fallback decisions documented).
- A **threat model + abuse controls** (spam, impersonation, prompt injection, data leakage).

## Workflow (use this sequence)
1) **Clarify the identity model**
   - Decide node identity primitive (public key / DID / both).
   - Define what is stable vs rotateable (device keys vs session keys).

2) **Define the probe**
   - Inputs: what each side provides about their human and agent (minimal).
   - Probe goals: compatibility, intent, safety, capabilities.
   - Output: a short “probe summary” shown to humans.

3) **Define consent + escalation**
   - Required signals: local human accept + remote human accept.
   - Timeouts + retries.
   - What changes after friendship is established (permissions, routing, policy).

4) **Persistence**
   - Store friend record locally (peer id, keys, trust level, notes, created_at).
   - Store audit log of probe (hash + minimal transcript; optionally encrypted).

5) **Security & abuse controls**
   - Spam resistance: proof-of-work / rate limit / allowlist / invite tokens.
   - Impersonation: key continuity + key change ceremony.
   - Injection: treat peer-provided text as untrusted; isolate tool calls.

## Files to read when needed
- Protocol & state machine: `references/protocol.md`
- Message types (canonical JSON): `references/message-types.md`
- Security/threat model: `references/security.md`

## Output conventions
When asked to design/implement a piece, respond with:
- **State machine** (states + transitions)
- **Message schema** (JSON examples)
- **Local storage** (tables/fields or JSON)
- **Consent UX** (exact prompts, what user sees/can do)
- **Failure modes** (timeouts, partial accept, NAT fail)

## Non-goals
- Do not introduce a central friend graph, ranking, or recommendation system.
- Do not require an always-on rendezvous server for correctness (a *bootstrap* service may exist, but must not be a dependency for relationship semantics).
