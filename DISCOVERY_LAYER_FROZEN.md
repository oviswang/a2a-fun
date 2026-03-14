# Discovery Layer — FROZEN (Minimal Scope)

Status: **FROZEN** (complete + proven for current minimal scope)

This document freezes the minimal Discovery Layer primitives and the minimal runtime wiring into Phase 3 / Friendship Trigger.

## 1) Implemented components

Discovery primitives (do not modify semantics):
- `src/discovery/discoveryCandidate.mjs` — `createDiscoveryCandidate(...)`
- `src/discovery/discoveryCompatibility.mjs` — `evaluateDiscoveryCompatibility(...)`
- `src/discovery/discoveryConversationPreview.mjs` — `createDiscoveryConversationPreview(...)`
- `src/discovery/discoveryInteraction.mjs` — `createDiscoveryInteraction(...)`
- `src/discovery/discoveryFriendshipHandoff.mjs` — `createDiscoveryFriendshipHandoff(...)`

Discovery → Phase3 runtime wiring (handoff only; no sends):
- `src/runtime/discovery/discoveryHandoffToPhase3.mjs` — `startPhase3ProbeFromDiscoveryHandoff(...)`

## 2) Proven runtime path

Proven Discovery → Friendship relay runtime path (minimal):

known peers
→ `discovery_candidate`
→ `compatibility`
→ `conversation_preview`
→ `discovery_interaction`
→ `PROCEED`
→ `discovery_friendship_handoff`
→ Phase3 probe init (`SESSION_PROBE_INIT` prepared)
→ relay transport
→ Machine B
→ `formalInboundEntry`
→ `protocolProcessor`
→ Phase3 `LOCAL_ENTERED`

## 3) Proven gating rules

- `PROCEED` is required to produce a discovery handoff.
- `SKIP` produces **no** handoff.
- Friendship remains gated on Phase3 `PROBING`.
- No friendship artifacts are created while Phase3 state is `LOCAL_ENTERED`.

## 4) Proven outputs

The following machine-safe outputs were produced and validated:
- machine-safe `discovery_candidate`
- machine-safe compatibility result
- machine-safe `conversation_preview`
- machine-safe `discovery_interaction`
- machine-safe `discovery_friendship_handoff`

## 5) Proven fail-closed behavior

- Invalid discovery input fails closed.
- Invalid handoff fails closed.
- Invalid message kind on the remote path fails closed with `UNKNOWN_KIND`.
- On fail-closed paths, no downstream friendship artifacts are produced.

## 6) Explicitly NOT implemented

This Discovery Layer scope explicitly does **not** include:
- real free-form agent conversation runtime
- human UI
- capability registry
- task invocation
- task result exchange
- mailbox
- retry/backoff
- orchestration
- broader recommendation/ranking logic

## 7) Hard separation boundaries

Frozen separation rules (must remain true):
- Transport remains below protocol semantics.
- Envelope semantics remain frozen.
- Phase3 semantics remain unchanged.
- Friendship Trigger Layer semantics remain unchanged.
- Discovery only prepares handoff into Friendship Trigger.
- Discovery does not create friendship directly.

## 8) Proof boundary

The following were validated and observed:
- Local Discovery Layer E2E validated.
- Real two-machine relay Discovery → Friendship E2E validated.
- Machine B reached `LOCAL_ENTERED` from Discovery-driven probe init.
- Friendship remained gated correctly.
- Fail-closed `UNKNOWN_KIND` observed on invalid path.
