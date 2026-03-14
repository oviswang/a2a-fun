# Conversation Runtime Layer — Plan (on top of frozen Discovery + Friendship)

Status: **PLAN (documentation-only)**

This document defines the next implementation phase for the **Conversation Runtime Layer** on top of the frozen:
- Discovery Layer (candidate → compatibility → preview → interaction → handoff)
- Friendship Trigger Layer (Phase3 PROBING gating → confirmations → friendship_record)

No frozen transport/protocol/Phase3/Discovery/Friendship semantics may be changed by this phase.

## 1) Purpose

Conversation Runtime Layer is responsible for:
- Creating a minimal agent-side **opening message** for a discovery interaction.
- Supporting minimal bounded **conversation turns** (agent↔human) as machine-safe artifacts.
- Surfacing a human-observable conversation in a machine-safe form.
- Allowing a human to join/respond (as explicit, bounded inputs).
- Handing successful conversation interaction into the existing **Friendship Trigger Layer** path (without modifying it).

## 2) Position in System

This layer sits between discovery and friendship persistence:

known peers
→ Discovery Layer
→ conversation runtime
→ human-observable conversation
→ Friendship Trigger Layer
→ friendship persistence

Discovery selects/initiates; Conversation Runtime produces bounded conversational artifacts; Friendship Trigger remains the only path to friendship records.

## 3) Minimal Goal

The smallest successful conversation outcome is:
- A discovery interaction with `PROCEED` can produce a minimal **opening message**.
- At least one bounded **conversation turn** can exist.
- The conversation is visible in a machine-safe human-observable form.
- A successful conversation can hand off into the existing Friendship Trigger path (Phase3 probe exchange → PROBING gate → friendship candidate creation).

## 4) Required Concepts

### 4.1 Opening message
A deterministic, bounded, machine-safe message representing what the agent would say first.

Example minimal fields (exact schema to be defined later):
- `opening_id` (deterministic)
- `interaction_id` / `preview_id` linkage
- `text` (short, bounded)
- `created_at` (deterministic)

### 4.2 Conversation turn
A single bounded unit of dialogue.

Constraints:
- must be machine-safe
- bounded text length
- explicit `speaker` allowlist (e.g. `AGENT` | `HUMAN`)

### 4.3 Conversation transcript (minimal, bounded)
A small ordered list of turns.

Constraints:
- bounded size (e.g. max N turns)
- no long-term memory
- deterministic serialization

### 4.4 Human-observable conversation surface
A runtime output artifact that a human can see and act on.

Constraints:
- no real UI requirement
- representable as machine-safe output fields

### 4.5 Handoff boundary into Friendship Trigger Layer
Conversation Runtime ends when a human-approved interaction results in entering the existing probe exchange that can lead to Phase3 `PROBING`.

Key principle:
- Conversation Runtime does not change Phase3 / Friendship Trigger semantics.
- Conversation Runtime produces inputs that cause the already-frozen friendship path to execute.

## 5) Minimal Runtime Path

Intended minimal runtime path (no frozen changes):

discovery interaction
→ opening message
→ conversation turn
→ human-observable conversation
→ explicit response (human chooses proceed)
→ Friendship Trigger candidate path

Notes:
- “explicit response” should be a machine-safe decision artifact (e.g. a runtime flag / handler input), not a new protocol message kind.
- The actual Friendship Trigger still requires the existing Phase3 probe exchange and `PROBING` gate.

## 6) Minimal Implementation Order

1. Opening message primitive
2. Conversation turn primitive
3. Conversation transcript primitive
4. Human-observable conversation surface
5. Local E2E
6. Two-machine relay E2E
7. Freeze document

## 7) Hard Constraints

This phase must obey:
- Do not modify frozen transport semantics.
- Do not modify frozen envelope semantics.
- Do not modify Phase3 semantics.
- Do not modify Friendship Trigger semantics.
- Do not modify Discovery semantics.
- Fail-closed behavior must remain (invalid input → machine-safe error; no partial artifacts).
- No capability invocation yet.
- No task invocation yet.
- No mailbox.
- No broad runtime orchestration.

## 8) Explicit Non-Goals

This phase explicitly does **not** include:
- capability registry
- task invocation
- task result exchange
- mailbox
- queue / retry / backoff
- market / economy logic
- broader multi-turn chat system
- long-term memory or recommendation ranking

## 9) Success Criteria

This phase is successful when:
- Opening message is created in a machine-safe deterministic form.
- A bounded conversation turn is created.
- A human-observable conversation surface exists (machine-safe output).
- Successful conversation can hand off into Friendship Trigger Layer.
- Invalid conversation inputs fail closed.

## 10) Follow-up Phase

Successful completion of this phase enables:
- richer human/agent mixed conversations
- later capability discovery / sharing between friends
