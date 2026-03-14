# Conversation Runtime Layer — FROZEN (Minimal Scope)

Status: **FROZEN** (complete + proven for current minimal scope)

This document freezes the minimal Conversation Runtime Layer primitives and the minimal runtime wiring into Phase 3 / Friendship Trigger.

## 1) Implemented components

Conversation primitives (do not modify semantics):
- `src/conversation/conversationOpeningMessage.mjs` — `createConversationOpeningMessage(...)`
- `src/conversation/conversationTurn.mjs` — `createConversationTurn(...)`
- `src/conversation/conversationTranscript.mjs` — `createConversationTranscript(...)`
- `src/conversation/conversationSurface.mjs` — `createConversationSurface(...)`
- `src/conversation/conversationFriendshipHandoff.mjs` — `createConversationFriendshipHandoff(...)`

Conversation → Phase3 runtime wiring (handoff only; no sends):
- `src/runtime/conversation/conversationHandoffToPhase3.mjs` — `startPhase3ProbeFromConversationHandoff(...)`

## 2) Proven runtime path

Proven Conversation → Friendship relay runtime path (minimal):

discovery_interaction
→ opening_message
→ conversation_turn
→ conversation_transcript
→ conversation_surface
→ `HANDOFF_TO_FRIENDSHIP`
→ conversation_friendship_handoff
→ Phase3 probe init (`SESSION_PROBE_INIT` prepared)
→ relay transport
→ Machine B
→ `formalInboundEntry`
→ `protocolProcessor`
→ Phase3 `LOCAL_ENTERED`

## 3) Proven gating rules

- `HANDOFF_TO_FRIENDSHIP` is required to produce conversation handoff.
- `SKIP` produces **no** handoff.
- `CONTINUE` produces **no** friendship handoff.
- Friendship remains gated on Phase3 `PROBING`.
- No friendship artifacts are created while Phase3 state is `LOCAL_ENTERED`.

## 4) Proven outputs

The following machine-safe outputs were produced and validated:
- machine-safe opening_message
- machine-safe conversation_turn
- machine-safe conversation_transcript
- machine-safe conversation_surface
- machine-safe conversation_friendship_handoff

## 5) Proven fail-closed behavior

- Invalid conversation input fails closed.
- Invalid handoff fails closed.
- Invalid message kind on the remote path fails closed with `UNKNOWN_KIND`.
- On fail-closed paths, no downstream friendship artifacts are produced.

## 6) Explicitly NOT implemented

This Conversation Runtime Layer scope explicitly does **not** include:
- real free-form multi-turn agent conversation runtime
- real UI
- capability registry
- task invocation
- task result exchange
- mailbox
- retry/backoff
- orchestration
- broader chat logic or memory

## 7) Hard separation boundaries

Frozen separation rules (must remain true):
- Transport remains below protocol semantics.
- Envelope semantics remain frozen.
- Phase3 semantics remain unchanged.
- Friendship Trigger Layer semantics remain unchanged.
- Conversation only prepares handoff into Friendship Trigger.
- Conversation does not create friendship directly.

## 8) Proof boundary

The following were validated and observed:
- Local Conversation Runtime E2E validated.
- Real two-machine relay Conversation → Friendship E2E validated.
- Machine B reached `LOCAL_ENTERED` from Conversation-driven probe init.
- Friendship remained gated correctly.
- Fail-closed `UNKNOWN_KIND` observed on invalid path.
