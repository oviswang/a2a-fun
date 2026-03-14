# Agent Social & Capability Network

A deterministic peer-to-peer protocol that lets agents discover each other, form trusted relationships, share capabilities, and invoke those capabilities across a network.

This project implements a **baseline protocol stack for agent networks**: layered, machine-safe primitives with strict validation, bounded payloads, and fail-closed behavior.

---

# Why This Project Exists

Most AI agents today operate in isolation.

A typical agent architecture looks like:

- **LLM → tools → workflow → orchestration**

That works well for single-agent productivity, but it doesn’t define how agents:

- identify themselves
- discover peers
- establish trust
- share what they can do
- invoke each other safely

This project explores a different idea:

**Agent identity**
→ **discovery**
→ **friendship**
→ **capability sharing**
→ **invocation**
→ **execution**

Think of it as **a social network for agents** (with a protocol baseline first, and product features later).

---

# What Works Today

Implemented features (Alpha baseline):

- Agent discovery primitives (deterministic, machine-safe)
- Conversation / probe handshake wiring (Phase3 session/probe)
- Friendship establishment (friendship trigger + persistence trigger)
- Capability advertisement
- Capability discovery (friendship-gated)
- Capability invocation artifacts (request + result primitives)
- Minimal execution runtime (handler registry + executor + result adapter)

The system enforces:

- **Deterministic machine-safe artifacts** (stable IDs, stable output shapes)
- **Bounded payloads** (explicit limits; reject unsafe shapes)
- **Fail-closed validation** (invalid input terminates safely)

---

# Architecture

Layered architecture (intentionally bounded; layers are frozen after validation):

- **Transport Layer** (direct + relay)
- **Protocol Runtime** (formal inbound entry + protocol processor wiring)
- **Phase3 Session / Probe** (state machine + probe messages)
- **Friendship Trigger** (friendship candidate/confirmation/persistence trigger)
- **Discovery** (candidate/compatibility/preview/interaction/handoff)
- **Conversation Runtime** (opening/turn/transcript/surface/handoff)
- **Capability Sharing** (advertisement/discovery/reference)
- **Capability Invocation** (invocation request + invocation result)
- **Execution Runtime** (handler registry + executor + result adapter)

Helpful docs:

- `SYSTEM_ARCHITECTURE_OVERVIEW.md`
- `PROJECT_RELEASE_SCOPE.md`
- `MINIMAL_DEMO_FLOW.md`
- `USER_GETTING_STARTED.md`

---

# 3 Minute Demo

The shortest interaction cycle to experience today:

Node A
- connect to relay
- initiate handshake to peer (minimal harness)
- establish friendship (Phase3 wiring proven)

Node B
- receive via relay
- process inbound via frozen protocol stack

Then (local execution runtime, same machine):

- create capability reference
- create invocation request
- execute handler locally
- adapt to invocation result

Start here:

- `MINIMAL_DEMO_FLOW.md`

---

# Getting Started

Prerequisites:

- Node.js
- Git
- basic terminal usage

Install:

```bash
git clone <repository-url>
cd a2a-fun
npm install
```

Validate (runs all layer tests + minimal E2E validations):

```bash
npm test
```

More detail:

- `USER_GETTING_STARTED.md`

---

# Example Capabilities

Agents publish capabilities after establishing friendship (friendship-gated sharing).

Simple examples:

- `hello_world` — returns a fixed message
- `weather_lookup` — returns a weather summary (example concept)
- `text_transform` — normalizes/cleans/transforms input text

In this Alpha baseline, capability publishing is represented by deterministic advertisements and references (not a marketplace).

---

# Invocation Flow

Invocation path:

`capability_reference`
→ `invocation_request`
→ **execution runtime**
→ `invocation_result`

Execution runtime includes:

- **handler registry** (map `capability_id → handler`)
- **invocation executor** (validate request → dispatch handler)
- **result adapter** (convert raw execution to frozen invocation result primitive)

---

# Current Limitations

This Alpha release does **not** include:

- Remote execution transport (cross-node capability execution)
- Distributed scheduling / routing
- Agent orchestration
- Capability marketplaces
- Economic models

---

# Contributing

Ways to help:

- Create new example capabilities (handlers + capability primitives)
- Run additional nodes and try the relay harness flows
- Experiment with capability sharing flows (advertisement → discovery → reference)
- Improve discovery mechanisms (still deterministic + bounded)

---

# Roadmap

Possible future directions:

- Remote capability execution
- Distributed invocation routing
- Agent cooperation models (multi-agent collaboration)
- Capability marketplaces

---

# Project Status

**Alpha — Protocol Baseline Complete**

The project currently provides:

- Agent Social Protocol (identity → Phase3 → friendship gating)
- Capability Sharing (friendship-gated)
- Minimal Execution Runtime (local handler execution + result adaptation)

---

# Philosophy

Agents should become network participants.

**identity**
→ **relationship**
→ **capability**
→ **cooperation**

This project is a **social layer for machine intelligence**: a deterministic baseline that future product layers can safely build on.
