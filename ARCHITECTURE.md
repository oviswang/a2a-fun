# a2a.fun — System Architecture (Network Baseline Frozen)

Status:
- Protocol stack phases are frozen (Phase 1–7 + Friendship Trigger Layer + Runtime Formal Outbound Variant).
- Network baseline components are also frozen at the documentation level (auto-join, transport baseline, relay guardrails).
- **A2A-FUN v1 Network Baseline — Proven** (real two-machine relay E2E validated; payload unchanged at `relayInbound → onInbound(payload)`; drop-safe behavior observed).
- This document describes the architecture as implemented and the hard boundaries between layers.

---

## 0) Network Baseline (Bootstrap + Auto-Join + Transport + Relay)

Baseline network components (all transport-only; below protocol semantics):
- **Bootstrap server** (candidate peers only): `POST /join`, `GET /peers`
- **Auto-join** (opt-in): joins bootstrap, fetches peers, selects deterministically, persists `data/known-peers.json`
- **Known peers**: minimal local record of selected peers (no friend graph propagation)
- **Transport selection** (frozen baseline):
  - direct peer transport is primary
  - relay transport is fallback
  - mailbox is not part of the baseline always-on path
- **Reachability probe** (direct): minimal HTTP reachability check; no protocol semantics
- **Relay layer**:
  - relayServer + relayClient; relay is dumb/stateless/opaque forwarder (see `RELAY_GUARDRAILS.md`)
- **Inbound bridges**:
  - directInbound / relayInbound only hand off payload to an injected `onInbound(payload)`

Hard statement:
- Transport must not interpret protocol, must not mutate envelopes, and must not embed friendship logic.

Proven boundary (v1 baseline):
- Two real machines successfully delivered an opaque payload via relay fallback.
- Payload was unchanged at the final inbound handoff: `relayInbound → onInbound(payload)`.
- Drop-safe behavior was observed when the target node_id was not connected.

Intentionally unimplemented (still out of baseline scope):
- runtime-wide always-on orchestration
- mailbox/offline queue
- queue/retry/backoff
- direct multi-machine proof in environments where inbound ports are unavailable

---

## 1) High-Level System Layers

### Phase 1 — Identity / Safety / Storage
Responsibility:
- Local identity derivation and safety primitives
- Canonicalization → `actor_id` derivation (hash of canonical local identifier)
- Outbound no-raw-handle lint (defense-in-depth)
- Local persistence primitives (JSON storage)

Key properties:
- Never transmits raw handles; only hashed `actor_id` is used in protocol identifiers.
- Treats peer input as hostile; fail-closed posture.


### Phase 2 — Protocol Core
Responsibility:
- Protocol message schema + validation
- Envelope signing/verification interface (Ed25519 over `UTF8(JCS(envelope_without_sig))`)
- Deterministic pipeline ordering (validate → verify → decrypt → body-validate → session-apply → audit)
- Minimal state machine (SessionManager) for state transitions
- Audit core hashing + binding, preview-safe metadata only
- Local event injection (only `local.human.entry` and `local.session.close` in Phase 2)

Key properties:
- Fail-closed everywhere; unknown fields/types/transitions throw.
- No transport, no handshake, no peer key discovery.


### Phase 3 — Friendship Persistence
Responsibility:
- Side-effect persistence of friendship records (`friends.json` via injected storage)
- Idempotent write behavior (unique on `peer_actor_id`)
- Machine-safe local-only audit record on successful write

Key properties:
- Side-effect only; never mutates protocol/session state.
- Friendship write audit is local-only and MUST NOT be transmitted outbound.


### Phase 3.5 — Trigger Layer (Friendship Trigger)
Responsibility:
- Glue layer that inspects Phase 2 `session_apply_result.next_state`
- Triggers Phase 3 friendshipWriter only when state reaches `MUTUAL_ENTRY_CONFIRMED`

Key properties:
- No retry/backoff.
- No trigger-level audit (explicitly not implemented).
- Does not mutate protocol state.


### Phase 4 — Probe Engine
Responsibility:
- Deterministic probe conversation logic (behavior layer)
- Given `(state, transcript)` suggests the next probe output message

Key properties:
- Pure behavior: no state writes, no persistence, no LLM.
- Strict transcript grammar + fail-closed sequence checks.

---

## 2) Data Flow Pipeline (End-to-End)

The end-to-end architecture is a layered pipeline. The core processing is always Phase 2; behavior and side-effects sit above it.

### Remote protocol messages
1) Remote inbound message (envelope)
2) `protocolProcessor.processInbound(...)`
3) Phase 2 pipeline (strict order):
   - envelope validate
   - verify signature
   - decrypt ciphertext
   - body schema validate
   - SessionManager apply (state transition)
   - audit bind (1:1)
4) Output: `{ session_apply_result, audit_records, decrypted_body? }`

### Local system/UI events
1) Local event (e.g. `local.human.entry`)
2) `protocolProcessor.processLocalEvent(...)`
3) SessionManager applyLocalEvent
4) audit bind (1:1)
5) Output: `{ session_apply_result, audit_records, local_event? }`

### Behavior + side-effects (outside Phase 2)
After a successful state transition result exists:
- ProbeEngine (Phase 4) may be consulted to generate the next outbound probe message during `PROBING`.
- Friendship Trigger (Phase 3.5) inspects `session_apply_result.next_state`:
  - If `next_state.state === MUTUAL_ENTRY_CONFIRMED` → call friendshipWriter (Phase 3)
- FriendshipWriter persists idempotently:
  - writes friendship record into `friends.json`

End-to-end conceptual flow:
remote/local messages
→ protocolProcessor
→ SessionManager
→ (optional) ProbeEngine suggestion
→ state transitions
→ friendshipTrigger
→ friendshipWriter
→ friends.json

---

## 3) Module Map

### Phase 1 (identity / safety / storage)
- `src/identity/canonicalize.mjs`
  - Canonicalizes controlling account identifiers
- `src/identity/identityService.mjs`
  - `deriveActorId()`, key management façade, outbound lint integration
- `src/identity/outboundLint.mjs`
  - Recursive no-raw-handle/contact-token lint (keys + values)
- `src/storage/jsonStorage.mjs`
  - Local JSON storage primitives (friends keyed by `peer_actor_id`)
- `src/profile/profileExtractor.mjs`
  - Hostile-input profile extraction; stable ordering; lint-first fail-closed

### Phase 2 (protocol core)
- `src/phase2/processor/protocolProcessor.mjs`
  - Orchestrates inbound and local processing; never writes friendships
- `src/phase2/pipeline/processInbound.mjs`
  - Strict ordered pipeline with DI
- `src/phase2/session/session.manager.mjs`
  - Minimal state machine transitions + local event apply
- `src/phase2/envelope/envelope.schema.mjs`
  - Envelope schema validation
- `src/phase2/body/body.schema.mjs`
  - Body schema validation + allowlists
- `src/phase2/verify/signer_ed25519.mjs` / `src/phase2/verify/verifier_ed25519.mjs`
  - Ed25519 signature scheme
- `src/phase2/audit/audit.hashing.mjs` / `src/phase2/audit/audit.binding.mjs`
  - Deterministic audit hashing + preview-safe binding

### Phase 3 (friendship persistence)
- `src/phase3/friendship/friendshipWriter.mjs`
  - `writeFriendshipIfNeeded(...)` side-effect persistence (idempotent; audit on success)

### Phase 3.5 (trigger layer)
- `src/phase3/friendship/friendshipTrigger.mjs`
  - `triggerFriendshipWriteIfNeeded(...)` glue from `session_apply_result` to friendshipWriter

### Phase 4 (probe engine)
- `src/phase4/probe/probeEngine.mjs`
  - `probeEngine.next({ state, transcript })` deterministic probe suggestion engine

### Network baseline (bootstrap / auto-join / transport / relay)
- Bootstrap server:
  - `src/bootstrap/bootstrapServer.mjs`
- Auto-join:
  - `src/runtime/bootstrap/bootstrapClient.mjs`
  - `src/runtime/bootstrap/nodeAutoJoin.mjs`
- Transport baseline:
  - `src/runtime/transport/checkDirectReachability.mjs`
  - `src/runtime/transport/selectTransport.mjs`
  - `src/runtime/transport/decideTransport.mjs`
  - `src/runtime/transport/executeTransport.mjs`
- Relay:
  - `src/relay/relayServer.mjs`
  - `src/runtime/transport/relayClient.mjs`
- Inbound bridges:
  - `src/runtime/inbound/directInbound.mjs`
  - `src/runtime/inbound/relayInbound.mjs`

---

## 4) Hard Separation Boundaries (What each layer MUST NOT do)

### Phase 1 boundaries
- MUST NOT perform protocol state transitions.
- MUST NOT implement transport/network.

### Phase 2 boundaries
- SessionManager:
  - MUST NOT write friendships
  - MUST NOT do transport/network
  - MUST NOT run probe strategy/LLM
- protocolProcessor:
  - MUST NOT write friendships
  - MUST NOT embed side-effect logic (friendship persistence is out-of-core)
  - MUST preserve strict fail-closed validation/pipeline ordering
- Local events:
  - MUST NOT be encoded or treated as remote protocol messages

### Phase 3 boundaries (friendshipWriter)
- MUST NOT modify SessionManager state.
- MUST NOT modify protocolProcessor behavior.
- MUST NOT implement retry/backoff (minimal version).

### Phase 3.5 boundaries (friendshipTrigger)
- MUST NOT modify SessionManager.
- MUST NOT modify protocolProcessor.
- MUST NOT write friendship data except through friendshipWriter.
- MUST NOT introduce protocol behavior.

### Phase 4 boundaries (probeEngine)
- MUST NOT mutate protocol state.
- MUST NOT write friendships.
- MUST NOT perform transport/runtime behavior.
- MUST NOT use LLM integration.

---

## 5) Relationship Establishment Flow

High-level relationship establishment path:

1) Probe conversation (PROBING)
- Remote `probe.hello` moves DISCONNECTED → PROBING
- Probe question/answer rounds occur while in PROBING

2) Probe completion
- `probe.summary` / `probe.done` causes PROBING → PROBE_COMPLETE

3) Human entry
- Local `local.human.entry` (Phase 2 local event) causes PROBE_COMPLETE → AWAIT_ENTRY
- Remote `human.entry` causes AWAIT_ENTRY → MUTUAL_ENTRY_CONFIRMED

4) Friendship write (side-effect)
- Trigger layer sees `next_state.state === MUTUAL_ENTRY_CONFIRMED`
- Calls friendshipWriter to persist idempotently

---

## 6) Deterministic Probe Engine Rules (Phase 4)

### Fixed questions
- `PROBE_ENGINE_QUESTION_1`: the first round question (fixed)
- `PROBE_ENGINE_QUESTION_2`: the second round question (fixed)
- No free/dynamic question generation

### Completion rule
- After 2 valid Q/A rounds: emit `probe.summary` with fixed summary text
- After summary: emit `probe.done`
- After done: return `null`

### Transcript grammar (strict)
question -> answer -> question -> answer -> summary -> done

Disallowed examples (fail-closed):
- answer-start
- question-question
- answer-answer
- summary then question/answer
- summary-summary
- done before summary
- any event after done

---

## 7) Future Phases (Not Implemented Yet)

These are potential next phases; not part of the frozen system:

- Phase 5 — Handshake / peer key binding
  - Peer key discovery/binding, explicit key continuity rules

- Phase 6 — Transport / networking runtime
  - Transport implementations (e.g. WebRTC/TCP) and runtime orchestration

- Phase 7 — Distributed agent runtime
  - Multi-node runtime semantics, coordination, resilience

Any future phase MUST preserve the hard separation boundaries and fail-closed safety posture established in Phases 1–4.
