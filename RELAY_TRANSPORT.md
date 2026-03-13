# Relay Transport (NAT-friendly)

This is a documentation-only design note describing the **optional relay transport** for A2A-FUN.

Scope:
- Transport-only; forwards **opaque protocol envelopes**.
- Does **not** change any frozen protocol layers (Phase 1–7, Friendship Trigger Layer, Runtime Formal Outbound Variant, AUTO_JOIN).

---

## 1) Why relay exists

- **Direct peer connectivity is primary.**
- **Relay is fallback.**
- Relay exists for peers behind **NAT / CGNAT / firewalls** where opening inbound ports is impractical.

Relay allows both nodes to keep **outbound-only** connectivity while still exchanging messages.

---

## 2) Transport priority

Order of attempt:
1) **Direct peer transport first**
2) **Relay transport second**

A mailbox is **not** part of the always-on baseline path.
- If a mailbox concept exists in future, it must be explicitly opt-in and not on the default path.

---

## 3) Relay architecture

```
Node A ──WS(outbound)──► Relay ◄──WS(outbound)── Node B
```

Relay endpoint (deployment target):
- `wss://gw.bothook.me/relay`

---

## 4) Relay server responsibilities

The relay server must:
- accept WebSocket connections
- allow nodes to register a `node_id`
- forward **opaque protocol envelopes** (payloads)

The relay server must NOT:
- interpret protocol envelopes
- implement protocol state transitions
- implement friendship logic
- persist messages (no store-and-forward)

Operational rules:
- drop messages if the target is not connected
- remove node entry on disconnect
- no queue/retry/backoff

---

## 5) Relay client responsibilities

The relay client must:
- connect outbound to the relay (WebSocket)
- register its `node_id`
- receive forwarded messages
- pass forwarded payloads into the existing inbound pipeline (as if they were received from a peer)

The relay client must NOT:
- rewrite protocol envelopes
- invent trust semantics

---

## 6) Explicit non-goals

- no discovery mesh / swarm
- no trust propagation
- no mailbox
- no queue/retry/backoff
- no protocol core changes

---

## 7) Failure model

- If direct works: do not use relay.
- If direct fails: relay **may** be used.
- Relay failure must not corrupt protocol state:
  - relay is transport-only
  - protocol layers remain fail-closed
  - no friendship persistence is performed by relay components
