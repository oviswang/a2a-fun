# RELAY_V2_SPEC.md

This document freezes the externally observable behavior of **Relay v2** for the Alpha release.

Hard rule: after Alpha, no protocol/runtime semantics above the relay may rely on undefined relay behavior. Relay v2 must remain deterministic and machine-safe.

## 1. WebSocket Endpoint

- Path: `/relay`
- Transport: WebSocket
- Messages are JSON objects.

## 2. Registration

### Register message
Client → Relay:

```json
{ "type": "register", "node_id": "<string>", "session_id": "<string>" }
```

Constraints:
- `node_id`: required, non-empty string, length-bounded.
- `session_id`: required, non-empty string, length-bounded.

### Registered response
Relay → Client:

```json
{ "ok": true, "type": "registered", "node_id": "<string>", "session_id": "<string>" }
```

Deterministic duplicate policy (frozen):
- Same `(node_id, session_id)`: replace mapping to the new socket; close old socket best-effort.
- Same `node_id`, different `session_id`: allow multiple sessions; the latest registration becomes the default route for `to=node_id`.

## 3. Relay (Forward)

### Relay message
Client → Relay:

```json
{ "type": "relay", "to": "<node_id>", "payload": <any-json> }
```

- `payload` is opaque to Relay v2.

### Forwarded message
Relay → Target client:

```json
{ "from": "<source-node_id>", "payload": <any-json> }
```

Routing (frozen):
- `to` resolves to the latest registered session for that `node_id`.

## 4. Delivery Acknowledgement (ack)

Ack is transport-level observability only.

Relay → Sender client (sender socket only):

```json
{ "type": "ack", "trace_id": null, "status": "forwarded"|"dropped_no_target"|"dropped_invalid", "reason": null|"NO_TARGET"|"NOT_REGISTERED"|"INVALID_TO" }
```

Rules (frozen):
- Ack is deterministic.
- Ack is written only to the **sender socket**.
- Ack does not modify, interpret, or gate the payload.

## 5. HTTP Diagnostics

Relay v2 exposes minimal, read-only diagnostics on the same server.

### GET /nodes
Returns current routing table view:

```json
{ "ok": true, "nodes": [ { "node_id": "...", "session_id": "...", "connected_at": "...", "last_seen": "...", "is_latest": true|false } ] }
```

### GET /traces
Returns a bounded in-memory append-only trace list:

```json
{ "ok": true, "traces": [ { "event": "register|unregister|relay_received|forwarded|dropped_no_target|dropped_invalid|ack", "trace_id": null, "from": "...", "to": "...", "kind": "...", "ts": "..." } ] }
```

Trace behavior (frozen):
- Bounded in-memory retention.
- Append order is stable within a process.
- Fields are machine-safe and minimal.

## 6. Non-Goals (Frozen)

Relay v2 does NOT implement:
- mailbox/persistence
- retries/backoff
- orchestration
- scheduling/marketplace
- protocol interpretation of `payload`
