# Friendship Trigger Layer — FROZEN

Status: **FROZEN** (complete + proven)

This document freezes the minimal Friendship Trigger Layer implementation and its validated runtime behavior.

## 1) Implemented components

Primitives (do not modify semantics):
- `src/friendship/friendshipCandidate.mjs` — `createFriendshipCandidate(...)`
- `src/friendship/friendshipConfirmation.mjs` — `confirmFriendshipCandidateLocally(...)`
- `src/friendship/friendshipRemoteConfirmation.mjs` — `confirmFriendshipCandidateRemotely(...)`
- `src/friendship/friendshipPersistenceTrigger.mjs` — `triggerFriendshipPersistence(...)`

Runtime wiring (post-processing only):
- `src/runtime/inbound/formalInboundEntry.mjs`
  - surfaces `response.friendship_candidate`
  - supports runtime confirmation flags and surfaces:
    - `response.friendship_confirmation_local`
    - `response.friendship_confirmation_remote`
    - `response.friendship_record`

## 2) Proven runtime path

Proven relay runtime path:

Machine A
→ `executeTransport(... → relay)`
→ `relayClient`
→ `relayServer`
→ Machine B `relayInbound`
→ `formalInboundEntry`
→ `protocolProcessor`
→ Phase3 hook
→ `friendship_candidate`
→ local confirmation
→ remote confirmation
→ `friendship_record`

## 3) Proven gating rule

- Friendship candidate is created **only when** Phase 3 state is exactly:
  - `response.phase3.state === "PROBING"`

## 4) Proven outputs

- A machine-safe `friendship_candidate` is surfaced on the runtime response when gated:
  - deterministic ID (`candidate_id`)
  - deterministic timestamp (`created_at`)
  - fixed, machine-safe key set

- A machine-safe `friendship_record` is produced only after mutual confirmation:
  - deterministic ID (`friendship_id`)
  - deterministic timestamp (`established_at`)
  - fixed, machine-safe key set

## 5) Proven fail-closed behavior

- Invalid or incomplete confirmation fails closed with `ILLEGAL_STATE`.
- On fail-closed paths:
  - **no friendship artifacts** are produced (no candidate/confirmation/record surfaced by the failing call)

## 6) Explicitly NOT implemented

The Friendship Trigger Layer does **not** implement:
- capability registry
- task invocation
- task result exchange
- mailbox
- retry/backoff
- orchestration
- broader social graph logic

## 7) Hard separation boundaries

Frozen separation rules (must remain true):
- Transport remains below protocol semantics (no transport redesign in this layer).
- Envelope semantics remain frozen.
- Phase 3 semantics remain unchanged.
- Friendship logic is runtime post-processing logic layered **after** Phase 3.
- No capability/task logic exists in the Friendship Trigger Layer.

## 8) Proof boundary

The following were validated and observed:
- Local Friendship Trigger E2E validated.
- Real two-machine relay Friendship Trigger E2E validated.
- `friendship_record` observed on Machine B.
- Fail-closed `ILLEGAL_STATE` observed on invalid confirmation path.
