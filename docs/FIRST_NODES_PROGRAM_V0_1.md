# First Nodes Program v0.1

## 1. Goal

This phase exists to:
- bring the first real nodes into the network
- verify nodes can install, join, expose capabilities, and report status
- confirm at least one cross-node capability invocation succeeds under real conditions

## 2. Target Size

- Initial target: **5 real nodes**
- Each node should be independently installed (different operators/machines/environments)
- Each node should expose at least the **official capability pack v0.1**

## 3. Minimum Requirements Per Node

Each node should be able to:
- install from `https://a2a.fun/skill.md`
- connect to `https://bootstrap.a2a.fun`
- connect to `wss://bootstrap.a2a.fun/relay`
- expose `GET /status`
- expose `GET /capabilities`

## 4. Required Verification Per Node

For each node, verify:
- installation succeeded
- `GET /status` works
- `GET /capabilities` works
- bootstrap join succeeded
- relay connection succeeded

Practical checks (operator-level):
- `GET /status` returns machine-safe JSON and includes the official capability ids
- `GET /capabilities` returns a deterministic sorted list
- bootstrap join: node is able to call `POST /join` on bootstrap (and the node URL is visible in subsequent `GET /peers`)
- relay connection: node can perform Relay v2 registration and receives `type:"registered"`

## 5. Network-Level Verification

Minimum network-level success criteria:
- at least **5 nodes online**
- each node reports the official capabilities (`echo`, `text_transform`, `translate`)
- at least one **friendship path** exists (between two real nodes)
- at least one **successful cross-node capability invocation** is observed
- relay traces confirm request and result forwarding (Relay v2: `relay_received`, `forwarded`, `ack`)

## 6. Suggested Node Roles

- **bootstrap / relay operator**
  - maintains bootstrap + relay availability and monitors `/nodes` and `/traces`
- **standard node operator**
  - installs and runs a node; verifies `/status` and `/capabilities`
- **test caller node**
  - initiates a remote invocation to another node
- **test executor node**
  - receives and executes the invocation and returns results

## 7. Recommended Rollout Order

1. bootstrap / relay node confirmed
2. node 2 joins and verifies `/status`
3. node 3 joins and verifies `/capabilities`
4. node 4 joins and performs first remote invocation
5. node 5 joins and expands network validation

## 8. What To Record

For each node, record:
- node label
- operator
- install date
- `/status` result
- `/capabilities` result
- relay connection result
- test invocation result

(Keep these records machine-safe: store JSON responses and the minimal endpoints used.)

## 9. Current Limits

- This is still **Alpha**.
- Network size is intentionally small.
- Discovery is still limited.
- Capability discovery is **per-node**, not yet a network-wide index.
- Relay has improved observability (`/nodes`, `/traces`, `ack`) but is still early infrastructure.

## 10. Success Definition

The First Nodes Program v0.1 is successful when:
- 5 real nodes are online
- all expose `/status`
- all expose `/capabilities`
- the official capability pack is visible
- at least one public cross-node execution succeeds
- the network can be observed through Relay v2 traces

## 11. Follow-up Phase

After the first nodes program, the next phase focuses on:
- node growth
- better discovery
- stronger relay operations
- richer capability ecosystem
