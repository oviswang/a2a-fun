# a2a.fun — Project Status (All Planned Phases Frozen)

Date: 2026-03-14 (Asia/Shanghai)

All currently planned phases are frozen.
This document is the final status summary of the implemented system and its hard boundaries.

**A2A-FUN v1 Network Baseline — Proven**
- Real two-machine relay end-to-end validated (relay fallback path).
- Payload unchanged at `relayInbound → onInbound(payload)`.
- Relay drop-safe behavior observed (`type: dropped` when target not connected).

**A2A-FUN v1 Protocol Runtime Baseline — Proven**
- Real two-machine relay protocol-over-transport validated.
- Relay path actually used.
- `formalInboundEntry` reached on Machine B.
- `protocolProcessor` invoked on Machine B for a valid envelope.
- Machine-safe response/result produced.
- Invalid input failed closed before processor invocation.

---

## 1) Completed frozen phases

- Phase 1 — Frozen
- Phase 2 — Frozen
- Phase 3 — Frozen
- Friendship Trigger Layer (Phase 3.5) — Frozen
- Phase 4 — Frozen
- Phase 5 — Frozen
- Phase 6 — Frozen
- Phase 7 — Frozen (builder + formal outbound variant)

Network baseline (documentation-level freezes):
- `AUTO_JOIN_FROZEN.md` — auto-join bootstrap flow frozen
- `TRANSPORT_BASELINE_FROZEN.md` — transport baseline frozen
- `RELAY_GUARDRAILS.md` — relay layer guardrails

---

## 2) What each frozen phase implements (short summary)

### Phase 1 — Identity / Safety / Storage
- Canonicalization + `actor_id` derivation (hash of canonicalized controlling account)
- Recursive outbound no-raw-handle lint (keys + values)
- Local JSON storage primitives
- Hostile-input profile extraction (lint-first fail-closed)

### Phase 2 — Protocol Core
- Envelope + body schemas, strict validation and allowlists
- Ed25519 signing/verification interface (`UTF8(JCS(envelope_without_sig))`)
- Strict ordered pipeline: validate → verify → decrypt → bodyValidate → apply → audit
- Minimal SessionManager state machine transitions
- Local event injection (Phase 2 local events only)
- Audit hashing + preview-safe binding

### Phase 3 — Friendship Persistence (side-effect)
- `friendshipWriter.writeFriendshipIfNeeded(...)`
- Idempotent friendship persistence (`peer_actor_id` uniqueness)
- Machine-safe local-only friendship audit on successful write
- Failure isolation (storage failure throws; no protocol state mutation)

### Friendship Trigger Layer (Phase 3.5)
- `triggerFriendshipWriteIfNeeded(...)` glue from `session_apply_result.next_state` → friendshipWriter
- Trigger only on `MUTUAL_ENTRY_CONFIRMED`
- No trigger-level audit; no retry/backoff

### Phase 4 — Probe Engine (deterministic)
- `probeEngine.next({ state, transcript })` deterministic behavior layer
- Fixed questions (round 1 + round 2)
- Fixed completion rule (2 rounds → summary → done)
- Strict transcript grammar and fail-closed sequence handling

### Phase 5 — Minimal Peer Key Binding Subset
- `computePeerKeyFingerprint(peerPublicKeyPem)`
- `bindPeerKeyFingerprint(...)` minimal binding decision:
  - bound fingerprint authoritative
  - expected fingerprint only pre-bind
  - fail-closed on missing/mismatch/conflict

### Phase 6 — Minimal HTTP Runtime Node
- Minimal HTTP ingress (`POST /message`) + JSON parsing (fail closed)
- Runtime wiring to protocolProcessor + session persistence
- Optional probe wiring
- Optional friendship trigger wiring (disabled by default)
- Test-stub outbound mode only (disabled by default; localhost-only)

### Network baseline — Bootstrap + Auto-Join + Transport + Relay (Frozen + Proven)
Proven boundary (v1 baseline):
- Real two-machine relay end-to-end validated.
- Payload preserved unchanged at the final inbound handoff: `relayInbound → onInbound(payload)`.
- Drop-safe behavior observed when target not connected.

### Protocol runtime baseline — Formal Inbound → Processor → Machine-safe Response (Proven)
Proven boundary (v1 baseline):
- Real two-machine relay protocol-over-transport validated.
- Relay path actually used.
- `formalInboundEntry` reached on Machine B.
- `protocolProcessor.processInbound({ envelope, state })` invoked on Machine B for valid envelope.
- Machine-safe response/result produced.
- Invalid input failed closed before processor invocation.

Components:
- Bootstrap server (`bootstrap.a2a.fun`): `/join`, `/peers` (candidate peer source; no trust)
- Auto-join (opt-in): joins bootstrap, fetches peers, selects deterministically, persists `data/known-peers.json`
- Transport baseline (direct first, relay second; mailbox not baseline):
  - `checkDirectReachability`, `selectTransport`, `decideTransport`, `executeTransport`
  - inbound bridges: `directInbound`, `relayInbound`
- Relay layer:
  - `relayServer`: dumb/stateless/opaque forwarder
  - `relayClient`: outbound WS, register node_id, forward received payloads to inbound callback

---

## 3) Current minimal end-to-end capability

Current runnable path (minimal wiring + side-effects):

1) Inbound message received (Phase 6 HTTP runtime)
- `POST /message` with `{ envelope }`

2) Protocol processing (Phase 2 core)
- runtime loads current session state snapshot
- calls `protocolProcessor.processInbound({ envelope, state })`
- SessionManager applies state transition (inside Phase 2)
- runtime persists `session_apply_result.next_state` (full snapshot)

3) Behavior suggestion (optional) (Phase 4)
- runtime may call `probeEngine.next({ state: next_state, transcript: [] })`
- returns next probe output suggestion (question/summary/done/null)

4) Friendship persistence (optional) (Phase 3.5 + Phase 3)
- trigger layer checks `next_state.state === MUTUAL_ENTRY_CONFIRMED`
- if true, calls `friendshipWriter.writeFriendshipIfNeeded(...)`
- writer persists idempotently into friends store (`friends.json` via injected storage interface)

Note:
- Phase 6 outbound send is test-stub only in this frozen set; formal protocol egress envelope is not implemented.

---

## 4) Current hard architectural boundaries

- State machine is separate from side-effects
  - SessionManager never writes friendships
  - Friendship persistence happens only in Phase 3 side-effect layer

- Remote protocol messages are separate from local events
  - `processInbound(...)` handles remote protocol messages only
  - `processLocalEvent(...)` handles local UI/system events only
  - Local events MUST NOT be encoded/treated as remote protocol messages

- Friendship persistence is separate from protocol core
  - protocolProcessor MUST NOT write friendships
  - friendshipWriter MUST NOT mutate protocol/session state

- Runtime wiring is separate from protocol behavior
  - Phase 6 runtime must not change protocol semantics
  - outbound is disabled by default; test-stub outbound must not be treated as formal protocol output

- Frozen phases must not drift without explicit approval
  - Any changes to frozen behavior require explicit reopen/approval

---

## 5) Explicitly not implemented yet

- runtime-wide automatic orchestration (always-on direct/relay switching across the whole runtime)
- mailbox / offline queue
- queue/retry/backoff infrastructure
- direct multi-machine proof in environments where inbound ports are unavailable (relay is the proven path)

- discovery
- formal runtime egress envelope
- distributed runtime
- transcript persistence
- advanced probe strategy
- key rotation acceptance
- mesh/swarm behavior

---

## 6) Next possible future directions (not implemented)

- Phase 7: formal outbound protocol envelope runtime
  - real Phase 2 envelope construction, signing, and (later) encryption for runtime egress

- Phase 8: discovery/runtime expansion
  - explicit peer endpoints, routing, and controlled discovery (still fail-closed)

- Advanced handshake/runtime evolution
  - challenge/response handshake messages, key continuity rules, and rotation acceptance via explicit local approval

---

## 7) Maintenance rule

Any future change must either:
- fit inside a new phase, OR
- explicitly reopen a frozen phase with approval
