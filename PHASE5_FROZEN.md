# Phase 5 Frozen Record (a2a.fun) — Minimal Peer Key Binding Subset

Frozen on: 2026-03-13 (Asia/Shanghai)

Phase 5 minimal peer key binding subset is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- `computePeerKeyFingerprint(...)`
  - Module: `src/phase5/keys/fingerprint.mjs`
  - Fingerprint rule (minimal subset):
    - `peer_key_fpr = 'sha256:' + hex(SHA-256(UTF8(peerPublicKeyPem)))`

- `bindPeerKeyFingerprint(...)`
  - Module: `src/phase5/handshake/peerKeyBinding.mjs`
  - Minimal peer key presence / fingerprint comparison / binding decision logic

- Fail-closed input validation
  - Missing `peer_actor_id` → throw (`INVALID_INPUT`)
  - Missing peer public key → throw (`MISSING_KEY`)

- Machine-safe result contract
  - Returns only machine-safe fields: `{ status, peer_key_fpr, patch }`
  - Does not echo raw handles; no friendship side-effects

## 2) Binding rules

- `bound_peer_key_fpr` is authoritative if present
  - If present, the derived `peer_key_fpr` MUST match `bound_peer_key_fpr` or fail closed

- `expected_peer_key_fpr` is only for pre-bind expectation checks
  - Used only when `bound_peer_key_fpr` is not present

- expected/bound conflict must fail closed
  - If both exist and differ: throw (`MISMATCH`)

- missing key / mismatch must fail closed
  - Missing peer public key: throw (`MISSING_KEY`)
  - Fingerprint mismatch vs expected or bound: throw (`MISMATCH`)

## 3) Result contract

Success results:
- `BOUND`
- `ALREADY_BOUND`

Failures (throw, fail closed):
- `MISSING_KEY`
- `MISMATCH`
- `INVALID_INPUT`

## 4) Explicitly NOT implemented

- discovery
- full handshake message exchange
- challenge/response
- transport runtime
- retry/reconnect/backoff
- persistence write
- friendship side-effects
- key rotation acceptance policy

## 5) Hard separation rules

- Phase 5 key binding logic MUST NOT modify SessionManager
- MUST NOT modify protocolProcessor
- MUST NOT write friendship data
- MUST NOT introduce transport/runtime behavior
