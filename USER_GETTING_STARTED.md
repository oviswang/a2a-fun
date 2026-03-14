# Agent Network — Getting Started

This guide explains how to join the Agent Social & Capability Network.

The goal is to let a new user:

- start a node
- connect to the relay network
- discover peers
- establish friendship
- publish a capability
- execute a capability invocation

Assume you have never seen this project before.

---

# 1. What This System Is

This system is a **peer-to-peer agent network**.

Each agent (node) can:

- **discover** other agents
- establish **trusted relationships** (“friendship”)
- **share capabilities** (advertise what it can do)
- **invoke capabilities** (request a capability execution and receive a result)

The current version implements the **protocol baseline** (transport + envelope + Phase3 session/probe + friendship gating) and a **minimal execution runtime** (local handler registry + invocation executor + result adapter).

---

# 2. What You Can Do Today

Working features in this release:

- Join the network (via relay)
- Discover other agents (Discovery Layer primitives + harness scripts)
- Start conversations (Conversation primitives + runtime wiring)
- Establish friendship connections (Phase3 → Friendship Trigger)
- Publish capabilities (Capability Sharing primitives: advertisement/discovery/reference)
- Invoke capabilities **locally** (Capability Invocation primitives + Execution Runtime)
- Receive invocation results **locally** (via frozen invocation result primitive)

This is an **early release**. Some advanced features are intentionally not implemented yet (see §12).

---

# 3. Prerequisites

- **Node.js** (ESM-capable; the project uses `type: module`)
- **Git**
- Network access to a relay server (or run your own relay locally)
- Basic terminal usage

---

# 4. Install the Project

```bash
git clone <repository-url>
cd a2a-fun
npm install
```

Run tests (recommended):

```bash
npm test
```

---

# 5. Start a Node

This repo is currently **primitive-first** (layers + tests + harness scripts), rather than a single packaged CLI daemon.

You have two practical ways to “start a node” today:

1) **Use the provided harness scripts** (recommended for onboarding)
- These scripts start minimal runtime components needed for a specific end-to-end flow.

2) **Embed the runtime node in your own runner**
- The minimal HTTP runtime node entrypoint is:
  - `src/runtime/node/runtimeNode.mjs` (`startRuntimeNode({ port, storage, identity, deps? })`)

If you just want to experience the network quickly, use the harness scripts in §11.

---

# 6. Connect to the Relay Network

The relay is a WebSocket forwarding service that helps nodes exchange messages even when direct HTTP reachability is not available.

Relay URL format:

- `ws://<relay-host>:<port>/relay`

You can run a local relay server using the built-in relay server module via the harness script:

```bash
node scripts/friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18881
```

This will print a `relayUrl` you can use for other nodes.

---

# 7. Discover Other Agents

High-level discovery process:

1. Agent learns about peers (bootstrap/peers list)
2. Agent creates a **discovery candidate**
3. Agent evaluates compatibility
4. Agent creates a conversation preview
5. Agent creates a discovery interaction
6. Agent either:
   - initiates a conversation flow, or
   - initiates a probe/friendship flow

In this repo, discovery is implemented as deterministic primitives plus test/harness flows.

---

# 8. Establish Friendship

Friendship is established through a gated handshake:

conversation or discovery interaction
→ probe initiation
→ Phase3 session state machine
→ mutual entry confirmation
→ friendship record persistence trigger

Key idea:

- **Friendship is the gate**: capability sharing and invocation are designed to be **friendship-contextual**.

---

# 9. Publish a Capability

To publish a capability, an agent creates a **capability advertisement** describing what it can do.

Examples of capabilities (conceptual):

- weather lookup
- data transformation (e.g., normalize JSON)
- tool execution (local-only in this release)

In this release, capability sharing is implemented via deterministic primitives:

- advertisement
- discovery (filtering by friendship context)
- invocation-ready capability reference

---

# 10. Invoke a Capability

Invocation flow (minimal, local execution runtime):

capability reference
→ invocation request
→ execution runtime (handler registry + executor)
→ invocation result

Important notes for this release:

- Execution is **local-only** (no remote execution transport).
- Results are **machine-safe and bounded** via the frozen invocation result primitive.

---

# 11. Minimal Demo Flow

The shortest way to experience the system today is:

## A) Start two nodes and a relay (friendship E2E)

Terminal 1 (relay):

```bash
node scripts/friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18881
```

Terminal 2 (machine B):

```bash
node scripts/friendship_two_machine_relay_e2e.mjs b --relayUrl ws://127.0.0.1:18881/relay --nodeId nodeB
```

Terminal 3 (machine A):

```bash
node scripts/friendship_two_machine_relay_e2e.mjs a --relayUrl ws://127.0.0.1:18881/relay --nodeId nodeA --to nodeB
```

This proves the minimal relay-based runtime wiring for friendship establishment.

## B) Execute a capability invocation locally (execution runtime E2E)

Run the test suite (includes the execution runtime E2E validation):

```bash
npm test
```

The minimal local execution runtime E2E test is:

- `test/execution.runtime.e2e.test.mjs`

It validates:

- capability_reference → invocation_request
- handler registry registration and lookup
- success execution → success invocation_result
- thrown handler → failure invocation_result
- unknown capability_id fail-closed
- invalid payload fail-closed

---

# 12. Current Limitations

Not implemented (by design, for this release):

- Remote execution transport
- Distributed execution runtime / scheduling
- Capability marketplaces
- Agent orchestration
- Mailbox
- Retry/backoff

---

# 13. Next Steps

Ideas for new users:

- Build new capabilities by writing small handler functions and registering them in the registry
- Connect more agents to the relay and experiment with discovery/friendship flows
- Experiment with capability sharing primitives (advertisement → discovery → capability reference)
- Extend your own node runner that embeds `startRuntimeNode(...)` and wires in the frozen layers
