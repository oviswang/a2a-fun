# A2A-FUN — Minimal Agent-to-Agent Trust Protocol Node

This repository implements a minimal runnable Agent-to-Agent (A2A) trust protocol node: strict protocol validation, a fail-closed session state machine, a deterministic probe engine, minimal peer key binding, friendship persistence (as a side-effect layer), a minimal HTTP runtime, and a minimal formal outbound protocol egress builder.

The codebase is organized as a phased, frozen protocol stack baseline. It is not a full network system.

---

## 1) What this project is

A minimal **Agent-to-Agent trust establishment protocol stack**.

It demonstrates the lifecycle:

formal inbound protocol message
→ validation
→ session state machine
→ probe interaction
→ mutual entry confirmation
→ friendship persistence
→ formal outbound protocol message

This is a **protocol baseline implementation** (schemas/validators/state machine/orchestration primitives + minimal wiring), not a discovery/mesh/distributed runtime.

---

## 2) Architecture overview

Layered phases (all frozen and documented):

- Phase 1 — Identity / Safety / Storage
- Phase 2 — Protocol Core / State Machine
- Phase 3 — Friendship Persistence
- Phase 3.5 — Friendship Trigger Layer
- Phase 4 — Deterministic Probe Engine
- Phase 5 — Peer Key Binding
- Phase 6 — Minimal HTTP Runtime
- Phase 7 — Formal Protocol Egress
- Runtime Variant — Formal outbound integration

Reference docs:
- `ARCHITECTURE.md`
- `PROJECT_STATUS.md`
- `PHASE*_PLAN.md`, `PHASE*_FROZEN.md`

---

## 3) Repository structure

Simplified structure:

- `src/`
  - `identity/` (Phase 1)
  - `storage/` (Phase 1)
  - `profile/` (Phase 1)
  - `phase2/`
  - `phase3/`
  - `phase4/`
  - `phase5/`
  - `phase7/`
  - `runtime/`

- `test/`

Docs:
- `ARCHITECTURE.md`
- `PHASE*_PLAN.md`
- `PHASE*_FROZEN.md`
- `PROJECT_STATUS.md`

---

## 4) Minimal runtime example (HTTP)

The repository includes a minimal HTTP runtime for wiring tests and small demos.

Start two nodes (example):

Node A:

```bash
node src/runtime/node/runtimeNodeFormal.mjs --port 3000
```

Node B:

```bash
node src/runtime/node/runtimeNodeFormal.mjs --port 3001
```

Example request:

```http
POST /message
Content-Type: application/json

{
  "envelope": { "...": "..." }
}
```

Ingress processing (conceptual):

`protocolProcessor → SessionManager → ProbeEngine → Trigger → FriendshipWriter`

Note:
- The Phase 6 runtime supports `TEST_STUB_OUTBOUND` (test-only wiring output).
- The formal outbound integration variant adds an explicit opt-in path to send Phase 7 formal envelopes.

---

## 5) Supported outbound protocol messages (Phase 7 minimal)

Currently implemented formal outbound types:
- `probe.question`
- `probe.done`

All other outbound message types fail closed.

---

## 6) Safety design principles

Key architectural rules:
- Protocol logic is separated from side effects.
- Runtime wiring is separated from protocol semantics.
- Friendship persistence is triggered externally (trigger layer + writer), never inside the protocol core.
- Validation and crypto operations fail closed (throw; no warning-continue).
- Frozen phases must not drift without explicit approval.

---

## 7) What this project intentionally does NOT implement

Out of scope (by design):
- peer discovery
- distributed runtime / mesh / swarm
- retry/backoff
- queueing or batching
- dynamic peer routing
- transcript persistence
- advanced probe strategies

---

## 8) Current project status

Minimal A2A Node Protocol Stack — baseline implementation.

All protocol layers up to Phase 7 are implemented and frozen, including a formal outbound runtime integration variant.

---

## 9) Agent installation entry

See:
- `skill.md` (agent-oriented install/run steps)
- `install.sh`
- `.env.example`
- `start-node.sh`
- `BOOTSTRAP.md`

Bootstrap servers (explicit configuration placeholders):
- Primary (active): `https://gw.bothook.me`
- Fallback (inactive until DNS exists): `https://bootstrap.a2a.fun`

Notes:
- Attempt primary first.
- Only attempt fallback if fallback DNS resolves; otherwise treat fallback as inactive.
- No discovery/mesh/routing is implemented in the frozen phases.

---

## 10) Future directions

Possible future work (not implemented here):
- discovery layer
- distributed runtime
- queue/retry infrastructure
- extended protocol message types
- transcript persistence
- advanced handshake models
