# A2A Network Architecture v0.1

## Purpose
This document defines the **implementation-oriented** network architecture for A2A as a **hybrid libp2p-style system**:

- **Bootstrap** for initial peer discovery + network parameters.
- **Relay** (WebSocket) for guaranteed reachability + message forwarding.
- **Gossip/PubSub** (later) for scalable propagation of peer graph + task advertisements.
- **Opportunistic Direct** (later) for low-latency/high-throughput once peers are directly reachable.

This doc is the source of truth for building the real multi-node P2P network (and avoiding “local self-activity”).

---

## Chosen model (hybrid libp2p-style)

### Why hybrid
A2A nodes often sit behind NAT/firewalls; direct inbound is not reliable. A pure direct P2P model will fail in practice.

Therefore:
1) **Relay is mandatory** for baseline connectivity.
2) **Direct is optional** and used only when both nodes can reach each other.

### Components
- **Bootstrap Directory**: HTTPS API that returns peer seeds + network parameters.
- **Relay Service**: WebSocket relay for:
  - node registration (presence)
  - forwarding envelopes A→B when direct path not viable
  - optional relay-side ack and trace ids
- **Node Runtime**: daemon that:
  - maintains identity + node_id
  - maintains peer graph (from bootstrap + observed relay peers)
  - publishes/claims tasks
  - executes tasks and returns results
- **Proof Layer**: controlled tests + logging standards that produce hard evidence:
  - two-node cross-node execution proof
  - transport/relay envelope traces

---

## Current project mapping (what exists vs missing)

### What exists today (as of v0.2.0 repo state)
- **Local node runtime loop** (`scripts/run_agent_loop.mjs`) with daemon locking.
- **Local artifacts**:
  - `data/node_id`
  - `data/peers.json` (currently can be empty)
  - `data/tasks.json` (local task store)
- **Relay harness + transport primitives**:
  - `src/runtime/transport/*` (executeTransport, relay client)
  - relay servers (`src/relay/*`) and E2E harness scripts (e.g. `scripts/remote_execution_two_machine_relay_e2e.mjs`)

### What is missing (must be implemented)
- **Production bootstrap directory** endpoints and stable schema (not just placeholder artifacts).
- **Production relay endpoint** that is reachable from multiple machines (no 502, correct WS upgrade behavior).
- **Stable, explicit protocol** for:
  - node registration/presence
  - peer gossip
  - task publish/claim/result propagation
- **End-to-end two-node proof** using the **task lifecycle** (not only harness invocations).

---

## Layer model (4 layers)

### Layer 1 — Bootstrap
**Responsibility**: provide initial peer seeds + network parameters.

Inputs:
- node identity (node_id, version, capabilities)

Outputs:
- seed relay URLs
- seed peer URLs
- protocol version constraints
- optional tokens/rate-limits

Persistence:
- node stores bootstrap response snapshot for debugging/audit.

### Layer 2 — Relay
**Responsibility**: guarantee message delivery between nodes even without direct connectivity.

Key properties:
- Nodes connect outbound via WS.
- Node registers presence (`node_id`, optional `session_id`, capabilities hash).
- Relay forwards envelopes addressed to `to.node_id`.
- Relay emits ack events (accepted/dropped_no_target) with optional `trace_id`.

### Layer 3 — Node Runtime
**Responsibility**: real peer graph + task lifecycle.

State:
- `node_id`
- `peer graph` (peers + last_seen + endpoints + capabilities)
- `task store` (published tasks + leases + results)

Behavior:
- periodic bootstrap refresh
- periodic peer refresh (from relay presence/gossip)
- publish tasks
- claim tasks (lease)
- execute tasks
- return results

### Layer 4 — Proof Layer
**Responsibility**: produce hard evidence of multi-node reality.

Must be able to prove:
- multiple distinct node_ids
- at least one remote node
- relay-level message exchange A→B and B→A
- cross-node task lifecycle with matching evidence on both sides

Artifacts:
- structured logs with stable event names
- saved proof bundle per test run (task_id, node_ids, relay trace ids, timestamps)
