# A2A Execution Plan v0.1

## Goal
Build a real multi-node A2A network with **hard proof** of cross-node execution.

This plan is phase-gated. Each phase has **success criteria** that must be met before moving on.

---

## Phase 0 — Docs (this commit)
**Deliverable**: protocol + architecture + plan docs under `docs/network/`.

Success criteria:
- Docs committed to repo.
- Field names and message kinds are explicit.

---

## Phase 1 — Bootstrap directory (MVP)
**Build**:
- Implement `GET /network/params` (stable schema in protocol doc).
- Implement optional `POST /network/announce`.
- Store bootstrap snapshot on node for audit.

Success criteria:
- Node can fetch bootstrap params reliably.
- Bootstrap returns at least one valid relay URL.

---

## Phase 2 — Relay service (production)
**Build**:
- Deploy relay endpoint (WS upgrade must work; no 502).
- Implement relay registration + forward + deliver + ack semantics.
- Add relay trace ids.

Success criteria:
- Two external machines can connect via WS and remain registered.
- Relay returns `accepted` ack for forwards when target exists.
- Relay returns `dropped_no_target` when target absent.

---

## Phase 3 — Node integration (presence + peer graph)
**Build**:
- Node runtime connects to relay using `relay.register.v0.1`.
- Maintain `data/peers.json` with:
  - peer_id/node_id
  - endpoint(s)
  - last_seen
  - capabilities_hash
- Peer classification: local vs remote vs unknown.

Success criteria:
- Node A sees Node B as peer with `last_seen` updating.
- Node B sees Node A as peer with `last_seen` updating.

---

## Phase 4 — Task transport (publish/claim/result)
**Build**:
- Implement message handlers for:
  - `task.publish.v0.1`
  - `task.claim.v0.1`
  - `task.result.v0.1`
- Implement deterministic lease rules:
  - claim must set `lease.holder`
  - claim must be idempotent
  - lease expiry must be enforced
- Persist task lifecycle changes to `data/tasks.json`.

Success criteria:
- A publishes a task; B receives advertisement.
- B claims lease; A observes lease holder B.
- B executes and returns result; A persists final result.

---

## Phase 5 — Two-node proof (controlled fresh proof test)
**Build**:
- Add a single script/harness:
  - `scripts/two_node_p2p_proof_test_v0_1.mjs`
  - It must generate a unique topic `p2p_proof_<ts>`.
  - It must collect evidence bundles from both nodes.

Success criteria (hard proof bundle must include):
- A identity != B identity (hostname + public ip + node_id)
- A and B are visible peers (peers.json evidence)
- Same `task_id` observed on both
- On B: logs show claim + execution
- On A: logs show result received
- Relay traces show A→B and B→A for that task_id

---

## Phase 6 — Opportunistic direct
**Build**:
- Add direct reachability detection (health gate).
- If direct reachable, prefer direct; otherwise use relay.
- Keep relay as fallback.

Success criteria:
- For a reachable pair, direct is used (logged).
- For NAT’d pair, relay is used (logged).
- Proof harness still passes in both modes.

---

## Phase ordering constraints
- Do not implement Phase 4 task transport until Phase 2 relay is stable.
- Do not claim “P2P network exists” until Phase 5 proof passes.

---

## Known blockers (from current observations)
- Production relay endpoint must be reachable and reliably return 101 Switching Protocols.
- Without relay availability, two-node proof cannot run.
