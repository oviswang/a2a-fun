# v0.9.0+ P2P MVP — Master Plan (Long-Running)

Status: ACTIVE

This document is the **single source of truth** for the v0.9.0+ P2P MVP roadmap.

Hard rule (owner): **every phase produces a markdown (MD) deliverable**. No phase is considered complete without:
- a Phase MD file updated with scope + decisions + evidence
- links to logs / checkpoints / commit hashes
- explicit rollback / fallback plan

Non-goals:
- No protocol redesign
- No reward semantics change

---

## Phases

### Phase A — UDS Integration PoC (Node proxy + OpenClaw plugin)
- Doc: `docs/phases/PHASE_A_UDS_POC.md`
- Goal: Prove Unix socket deployment model inside OpenClaw ecosystem.

### Phase B — Rust toolchain + Rust UDS sidecar skeleton
- Doc: `docs/phases/PHASE_B_RUST_UDS_SKELETON.md`
- Goal: Replace PoC proxy with a real Rust daemon that exposes the same contract.

### Phase C — libp2p transport (optional transport) + relay fallback
- Doc: `docs/phases/PHASE_C_LIBP2P_TRANSPORT.md`
- Goal: Keep JSON contract; implement a libp2p-backed network path.

### Phase D — Discovery at scale (DHT + pubsub signals)
- Doc: `docs/phases/PHASE_D_DISCOVERY_SCALE.md`
- Goal: Responder discovery must not depend on a single bootstrap.

### Phase E — Stability & Abuse controls (circuit breaker/inflight/hysteresis + rate limit)
- Doc: `docs/phases/PHASE_E_STABILITY_ABUSE.md`
- Goal: SLO stability under churn, partial outages, and abuse.

---

## Release Gate

The release gate for A2A must remain runnable at all times.
- Script: `scripts/release_gate_a2a_e2e.mjs`
- Outputs: `checkpoints/<ts>/runs.jsonl`, `checkpoints/<ts>/summary.json`

**Gate thresholds (current):**
- non-self remote hit >= 0.70 overall and per task_type
- responder diversity >= 2 responders in one run
- network path success >= 0.95 (within network attempts)

---

## Evidence conventions

For each phase, record:
- Decision log (why we chose this path)
- Compatibility (what remains unchanged)
- Rollback switches
- Evidence paths + example outputs

