# PHASE 3 SESSION / PROBE RUNTIME — FROZEN

Status: **COMPLETE + PROVEN**

This document freezes the minimal Phase 3 Session / Probe Runtime baseline.

Hard rule: Phase 3 work described here is **documentation + freeze only**. Transport semantics and Phase 2 envelope semantics remain frozen; Phase 3 does not add mailbox, orchestration, capabilities, or friendship persistence.

---

## 1) Implemented components

Implemented minimal Phase 3 components (and only these):

- `src/phase3/session/sessionProbeKinds.mjs`
  - `SESSION_PROBE_INIT`
  - `SESSION_PROBE_ACK`

- `src/phase3/session/sessionStateTransition.mjs`
  - `applySessionProbeMessage({ state, message })`
  - minimal state model:
    - `NEW`
    - `LOCAL_ENTERED`
    - `REMOTE_ENTERED` (defined; not required for the minimal proven transitions)
    - `PROBING`
  - fail-closed behavior on unknown kind / missing required fields / illegal combinations

- `src/runtime/inbound/formalInboundEntry.mjs`
  - Phase 3 hook (opt-in) applied **after** `protocolProcessor.processInbound(...)` succeeds
  - hook activates only when processor returns:
    - `phase3_session_probe_message`
    - optional `phase3_session_state`

- Machine-safe surface:
  - `response.phase3` returned from `formalInboundEntry` when Phase 3 hook is activated
  - minimal machine-safe subset:
    - `session_id`
    - `state`
    - `local_entered`
    - `remote_entered`

---

## 2) Proven runtime path

Proven two-machine relay runtime path (actual relay used):

Machine A
→ `executeTransport(... → relay)`
→ `relayClient`
→ `relayServer`
→ Machine B `relayInbound`
→ `formalInboundEntry`
→ `protocolProcessor`
→ Phase 3 hook
→ `applySessionProbeMessage`
→ machine-safe `response.phase3`

---

## 3) Proven state transitions

The following Phase 3 transitions are proven reachable through the runtime path:

- `NEW` + `SESSION_PROBE_INIT` → `LOCAL_ENTERED`
- `LOCAL_ENTERED` + `SESSION_PROBE_ACK` → `PROBING`

---

## 4) Proven fail-closed behavior

Phase 3 fail-closed behavior is proven at the Phase 3 boundary:

- Unsupported kind fails closed with:
  - `UNKNOWN_KIND`

Additional boundary assertions observed in validation:
- The Phase 3 hook runs only after the protocol runtime path has invoked `protocolProcessor`.
- No friendship side-effects occur in Phase 3 validations:
  - Phase 3 does not trigger friendship persistence.
  - Phase 3 outputs do not include friendship artifacts.

---

## 5) Explicitly NOT implemented

Phase 3 Session / Probe Runtime does **NOT** implement:

- friendship persistence
- capability registry
- task invocation
- task result exchange
- mailbox
- queue / retry / backoff
- runtime-wide orchestration

---

## 6) Hard separation boundaries

Frozen separation boundaries (must remain true):

- Transport remains below protocol semantics.
- Phase 2 envelope semantics remain frozen.
- Friendship is not triggered in Phase 3.
- No capability/task logic exists in Phase 3.

---

## 7) Proof boundary

This phase is considered proven based on:

- Local same-machine Phase 3 E2E validated.
- Real two-machine relay Phase 3 E2E validated.
- Machine-safe `response.phase3` observed on Machine B.
