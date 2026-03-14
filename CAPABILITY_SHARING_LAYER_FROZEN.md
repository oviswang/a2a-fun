# Capability Sharing Layer — FROZEN (Minimal Scope)

Status: **FROZEN** (complete + proven for current minimal scope)

This document freezes the minimal Capability Sharing Layer primitives and their validated behavior.

## 1) Implemented components

Capability Sharing primitives (do not modify semantics):
- `src/capability/capabilityAdvertisement.mjs` — `createCapabilityAdvertisement(...)`
- `src/capability/capabilityDiscovery.mjs` — `discoverCapabilities(...)`
- `src/capability/capabilityReference.mjs` — `createCapabilityReference(...)`

## 2) Proven runtime path

Proven minimal runtime path:

friendship_record
→ capability_advertisement
→ capability_discovery
→ capability_reference

## 3) Proven gating rules

- Capability sharing is valid only in a friendship-gated context.
- `friendship_record.established` must be `true`.
- Capability discovery only returns advertisements whose `friendship_id` matches the friendship context.
- Mismatched `friendship_id` advertisements are excluded deterministically.

## 4) Proven outputs

The following machine-safe outputs were produced and validated:
- machine-safe capability_advertisement
- machine-safe capability_discovery result
- machine-safe invocation-ready capability_reference

## 5) Proven fail-closed behavior

- Invalid friendship input fails closed.
- Non-established friendship fails closed.
- Invalid capability input fails closed.
- On fail-closed paths, no downstream invocation/task artifacts are produced.

## 6) Explicitly NOT implemented

This Capability Sharing Layer scope explicitly does **not** include:
- capability invocation execution
- task execution
- task result exchange
- mailbox
- retry/backoff
- orchestration
- capability marketplace / ranking
- broader permission economy

## 7) Hard separation boundaries

Frozen separation rules (must remain true):
- Transport remains below protocol semantics.
- Envelope semantics remain frozen.
- Phase3 semantics remain unchanged.
- Friendship Trigger Layer semantics remain unchanged.
- Discovery semantics remain unchanged.
- Conversation semantics remain unchanged.
- Capability Sharing prepares invocation-ready references only.
- Capability Sharing does not execute tasks directly.

## 8) Proof boundary

The following were validated and observed:
- Local Capability Sharing E2E validated.
- Capability advertisement observed.
- Capability discovery observed.
- Capability reference observed.
- Friendship gating remained correct.
- Fail-closed behavior observed on invalid inputs.
