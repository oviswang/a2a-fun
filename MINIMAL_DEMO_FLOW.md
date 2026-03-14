# Minimal Demo Flow

This document demonstrates the shortest path to experience the Agent Social & Capability Network.

The goal is to show a full interaction cycle in just a few minutes.

---

# Demo Overview

Two nodes join the network and interact.

Node A
Node B

Steps:

- connect to relay
- discover peer
- establish friendship
- publish capability
- invoke capability
- observe execution result

**Important (current release reality):**

- The fastest working demo today is split into two proven parts:
  1) **Two-node relay E2E** that proves the Phase3/Friendship runtime wiring.
  2) **Local execution runtime E2E** that proves capability invocation → handler execution → invocation result.
- Remote, cross-node capability execution transport is **not implemented** yet; this demo keeps execution local.

---

# Step 1 — Start Relay

Start the relay server (WebSocket). The relay enables nodes to exchange messages when direct reachability is not available.

```bash
node scripts/friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18881
```

Expected: the process prints a JSON line containing a `relayUrl` like:

- `ws://127.0.0.1:18881/relay`

---

# Step 2 — Start Node A

Open a terminal and start Node A.

```bash
node scripts/friendship_two_machine_relay_e2e.mjs a \
  --relayUrl ws://127.0.0.1:18881/relay \
  --nodeId nodeA \
  --to nodeB
```

---

# Step 3 — Start Node B

Open another terminal and start Node B.

```bash
node scripts/friendship_two_machine_relay_e2e.mjs b \
  --relayUrl ws://127.0.0.1:18881/relay \
  --nodeId nodeB
```

---

# Step 4 — Connect Both Nodes to Relay

Both nodes connect to:

- `ws://<relay-host>:<port>/relay`

In this minimal demo, the harness connects both Node A and Node B to the relay server you started in Step 1.

---

# Step 5 — Discovery

In a full product, Node A would discover Node B through discovery primitives and create a discovery interaction.

For the **fastest minimal demo**, the harness skips the full discovery UX and directly proves relay message forwarding + runtime wiring.

---

# Step 6 — Friendship Handshake

The harness triggers a minimal Phase3 path:

- Node A sends an inbound envelope via the relay
- Node B receives it via relay inbound
- Node B runs the frozen protocol/Phase3 wiring
- Friendship gating behavior is exercised (including fail-closed paths)

You should see JSON output from Node B including `phase3` fields and (depending on the harness behavior) friendship candidate/record related fields.

---

# Step 7 — Capability Advertisement

Node B “publishes a capability” conceptually by creating a capability advertisement.

Example capability name:

- `hello_world`

In the current minimal demo, capability sharing is validated by primitives/tests (not by a long-running daemon).

---

# Step 8 — Invocation Request

Node A creates an invocation request for a capability reference.

In the current release, this is proven via the frozen primitive:

- `createCapabilityInvocationRequest({ capability_reference, payload })`

---

# Step 9 — Execution Runtime

Node B execution runtime (local-only in this release):

- registry
- executor
- result adapter

This is proven end-to-end by the local E2E test:

```bash
npm test
```

Specifically:

- `test/execution.runtime.e2e.test.mjs`

---

# Step 10 — Invocation Result

Invocation result is produced as a frozen, machine-safe object:

```js
{
  invocation_id: "...",
  ok: true,
  result: { message: "hello from nodeB" },
  error: null,
  created_at: "1970-01-01T00:00:00.000Z"
}
```

In the current minimal demo, the invocation result is observed locally (via the execution runtime E2E test output/assertions).

---

# What This Demo Proves

Agents can:

- discover each other (conceptually; full UX not shown in the shortest harness)
- form trusted relationships (Phase3/Friendship runtime wiring proven via relay harness)
- share capabilities (primitives exist and are validated)
- execute capability invocations (local execution runtime proven end-to-end)

---

# Next Experiments

Users can try:

- building custom capabilities (write a handler and register it by `capability_id`)
- running more nodes
- exercising discovery and conversation primitives
- experimenting with capability sharing (advertisement → discovery → reference)
- extending toward remote capability execution transport (future work; not in this release)
