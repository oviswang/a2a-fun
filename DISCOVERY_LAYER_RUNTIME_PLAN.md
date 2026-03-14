# Discovery Layer — Runtime Integration Plan (on top of frozen Friendship Trigger Layer)

Status: **PLAN (documentation-only)**

This document defines the next implementation phase for the **Discovery Layer runtime integration** on top of the **proven + frozen Friendship Trigger Layer**, without modifying any frozen transport/protocol/runtime semantics.

## 1) Purpose

Discovery Layer runtime integration is responsible for:
- Identifying potentially relevant / like-minded peers from **known peers** and other network-safe inputs.
- Creating **machine-safe discovery candidates** (pure data; deterministic shape).
- Generating a minimal **agent-side conversation preview** (machine-safe summary / snippet set).
- Surfacing a **human-observable interaction entry point** (machine-safe, explicit action to proceed).
- Handing off successful discovery interactions into the **Friendship Trigger Layer runtime path**.

## 2) Position in System

This layer sits above bootstrap/known-peers selection and below friendship persistence:

bootstrap / known peers
→ discovery layer
→ conversation preview
→ human-observable interaction
→ Friendship Trigger Layer
→ friendship persistence

Key constraint: Discovery must not alter the meaning of transport/protocol/Phase3/Friendship. It composes above them.

## 3) Minimal Goal

The smallest successful discovery outcome is:
- A node can derive a **discovery candidate** from **known peers**.
- A minimal **conversation preview** can be created for that candidate.
- That preview can be surfaced in a **machine-safe human-observable form**.
- A successful human-observable interaction can hand off into the existing **Friendship Trigger Layer** runtime path (candidate → confirmations → record), without changing frozen semantics.

## 4) Required Concepts

### 4.1 Discovery candidate
A machine-safe object describing *who* we might engage and *why*, derived from known peers.

Minimum fields (example; exact schema to be defined as a primitive):
- `discovery_candidate_id` (deterministic)
- `peer_actor_id`
- `peer_url` or routing handle (must not violate transport baseline)
- `source` (e.g. `KNOWN_PEERS`)
- `created_at` (deterministic timestamp for the primitive)

### 4.2 Compatibility / matching signal
A minimal signal explaining *why this peer is relevant*.

Constraints:
- Must be machine-safe.
- Must be explainable and bounded (no free-form long text).

Minimum outputs (example):
- `score` (bounded numeric)
- `reasons` (small allowlisted tags)

### 4.3 Conversation preview
A minimal agent-side preview describing *what a first interaction would look like*.

Constraints:
- Machine-safe output only (bounded lengths).
- No capability invocation, no tasks.
- Does not require new envelope/protocol semantics.

Minimum outputs (example):
- `preview_id` (deterministic)
- `headline` (short)
- `opening_prompt` or `opening_line` (short)
- `safety_notes` (allowlisted tags)

### 4.4 Human-observable interaction surface
A runtime-visible entry point that a human can see and explicitly choose to proceed.

Constraints:
- Must not require new UI or mailbox.
- Must be representable as a machine-safe response object.

Minimum outputs (example):
- `interaction_id` (deterministic)
- `candidate_ref` (id reference)
- `action` allowlist (e.g. `PROCEED`, `SKIP`)

### 4.5 Handoff boundary into Friendship Trigger Layer
Discovery ends when the system produces an explicit user-approved step that results in entering the already-proven Friendship Trigger path.

Handoff principle:
- Discovery produces *input* that leads to a Phase3 probe message exchange and ultimately Phase3 `PROBING`.
- Friendship Trigger remains the only layer that creates/confirm/persists friendship records.

## 5) Minimal Runtime Path

Intended minimal runtime path (no frozen changes):

known peers
→ discovery candidate
→ conversation preview
→ human-observable interaction
→ explicit response (human chooses proceed)
→ Friendship Trigger candidate path

Notes:
- “explicit response” should be a machine-safe decision artifact (e.g. a local runtime flag / handler input), not a new protocol message type.
- The “proceed” action may trigger the existing probe exchange that ultimately yields Phase3 `PROBING` on the receiving side; Discovery does not redefine the probe protocol.

## 6) Minimal Implementation Order

Implementation order for the next phase:

1. **Discovery candidate primitive**
   - deterministic ID + machine-safe fixed shape
   - derives from known peers input

2. **Compatibility/matching primitive**
   - bounded score + allowlisted reasons
   - fail-closed on invalid input

3. **Conversation preview primitive**
   - machine-safe minimal preview output
   - bounded lengths + deterministic shape

4. **Local E2E**
   - same-machine pipeline validation from known peers → preview → interaction artifact
   - proves fail-closed behavior

5. **Two-machine relay E2E**
   - validates discovery-driven “proceed” can lead into the already-frozen Friendship Trigger path (over relay)
   - must prove relay is used, Phase3 can reach `PROBING`, and Friendship layer remains unchanged

6. **Freeze document**
   - document the Discovery Layer as frozen, including boundaries and proof artifacts

## 7) Hard Constraints

The following constraints are absolute for this phase:
- Do not modify frozen **transport semantics**.
- Do not modify frozen **envelope semantics**.
- Do not modify **Phase 3** semantics.
- Do not modify **Friendship Trigger Layer** semantics.
- Fail-closed behavior must remain (invalid inputs produce machine-safe errors; no partial artifacts).
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
- broader recommendation / social-graph ranking logic

## 9) Success Criteria

This phase is successful when:
- A **discovery candidate** is created from known peers.
- A **conversation preview** is produced and is machine-safe (bounded + deterministic shape).
- A **human-observable interaction surface** exists as machine-safe output.
- A successful “proceed” path can hand off into Friendship Trigger (candidate gating remains Phase3 `PROBING`).
- Invalid discovery inputs fail closed (machine-safe error; no downstream artifacts).

## 10) Follow-up Phase

Successful completion of this phase enables later phases such as:
- capability discovery / sharing between friends
- later agent collaboration phases (still respecting frozen protocol and runtime boundaries)
