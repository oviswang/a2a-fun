# Friendship Trigger Layer — Runtime Integration Plan

This document defines the next implementation phase for **Friendship Trigger Layer runtime integration** on top of the proven **Phase 3 Session / Probe Runtime**.

Hard rule: this is an **integration layer** only. It must not modify frozen transport semantics, frozen envelope semantics, or Phase 3 semantics.

---

## 1) Purpose
Friendship Trigger Layer runtime integration is responsible for:
- observing successful **Phase 3 session/probe progress**
- surfacing a **human-observable interaction**
- allowing **explicit human response / confirmation**
- triggering **friendship persistence only after mutual confirmation**

---

## 2) Position in System
This layer sits strictly above the proven runtime baseline:

transport
→ formal inbound / protocol runtime
→ Phase 3 session / probe runtime
→ friendship trigger runtime
→ friendship persistence

---

## 3) Minimal Goal
Smallest successful friendship-trigger outcome:
- Node A and Node B complete minimal Phase 3 session/probe progress
- the interaction is surfaced in a **human-observable** form
- one side can explicitly respond
- both sides can explicitly confirm
- friendship persistence is triggered **only** after mutual confirmation

---

## 4) Required Concepts
Minimum concepts needed for this phase:

- **observable conversation/probe transcript or event surface**
  - a machine-safe, human-readable preview of the interaction (no raw handles)

- **local human response**
  - a local explicit confirmation action/event (e.g., accept/reject)

- **remote human response**
  - the peer’s explicit confirmation action/event

- **mutual confirmation**
  - deterministic detection that both sides have confirmed the same candidate

- **friendship candidate**
  - a candidate record derived from Phase 3 success, carrying only minimal IDs and safe metadata

- **friendship persistence trigger**
  - a single, explicit transition point that calls friendship persistence logic (and only then)

---

## 5) Minimal Runtime Path
Intended runtime path (conceptual; no frozen-layer changes):

Node A
→ Phase 3 session/probe success
→ friendship-trigger candidate created
→ human-observable interaction surface
→ local human confirmation
→ remote human confirmation
→ friendship persistence

Notes:
- Candidate creation must be derived from a proven Phase 3 success boundary (e.g., Phase 3 state reaches `PROBING` or later success marker as defined by Phase 3).
- Confirmation events must be machine-safe and fail closed if malformed.

---

## 6) Minimal Implementation Order
Implementation order (strictly minimal, proof-oriented):

1. Friendship-trigger candidate creation from Phase 3 success
2. Human-observable event surface
3. Local confirmation handling
4. Remote confirmation handling
5. Mutual confirmation detection
6. Friendship persistence trigger
7. Local E2E
8. Two-machine relay E2E
9. Freeze document

---

## 7) Hard Constraints
This phase must explicitly preserve:

- do not modify frozen transport semantics
- do not modify frozen envelope semantics
- do not modify Phase 3 semantics
- fail-closed behavior must remain
- no capability invocation yet
- no task invocation yet
- no mailbox
- no broad runtime orchestration

---

## 8) Explicit Non-Goals
This phase does NOT include:

- capability registry
- task invocation
- task result exchange
- mailbox
- queue / retry / backoff
- market / economy logic
- broader social graph logic beyond minimal friendship persistence

---

## 9) Success Criteria
Clear success criteria for completion:

- friendship-trigger candidate is created **only after** valid Phase 3 success
- a human-observable interaction surface exists (machine-safe output)
- mutual confirmation is required before friendship persistence
- invalid or one-sided confirmation does **not** persist friendship
- no capability/task side-effects

---

## 10) Follow-up Phase
Successful completion of this phase enables:
- capability discovery / sharing between friends
- later agent collaboration phases
