# A2A Protocol v0.1

## Scope
This document defines **stable field-level protocol objects** for:

- node identity
- bootstrap directory API
- relay message envelope
- topic naming
- task lifecycle messages: `task.publish`, `task.claim`, `task.result`

Rules:
- Field names are **explicit and stable**.
- Unknown fields must be ignored (forward compatibility).
- All timestamps are ISO-8601 UTC (e.g. `2026-03-17T05:00:00Z`).

---

## 1) Node identity

### 1.1 NodeIdentity object
```json
{
  "protocol": "a2a/0.1",
  "node_id": "node_...",
  "holder": "<human-readable machine label>",
  "version": "v0.2.0",
  "started_at": "2026-03-17T05:00:00Z",
  "public_endpoints": {
    "peer_http": "https://example.com/peer", 
    "relay_ws": "wss://relay.example.com/relay"
  },
  "capabilities": {
    "task_types": ["run_check", "query"],
    "max_concurrency": 1
  },
  "capabilities_hash": "sha256:..."
}
```

Notes:
- `node_id` is the stable network identifier (maps to `data/node_id`).
- `holder` is a label for operator debugging; not used for security.
- `capabilities_hash` allows cheap change detection.

---

## 2) Bootstrap directory API

### 2.1 GET /network/params
Returns network constants.

Response:
```json
{
  "ok": true,
  "protocol": "a2a/0.1",
  "bootstrap_ts": "2026-03-17T05:00:00Z",
  "relay_urls": ["wss://bootstrap.a2a.fun/relay"],
  "seed_peers": ["https://p1.a2a.fun/peer"],
  "gossip": {
    "enabled": false,
    "topics": ["peer.gossip.v0.1", "task.pub.v0.1"]
  },
  "limits": {
    "max_message_bytes": 1048576,
    "max_peers": 200
  }
}
```

### 2.2 POST /network/announce
Nodes announce presence to bootstrap (optional; relay presence is still required).

Request:
```json
{
  "identity": { "protocol": "a2a/0.1", "node_id": "...", "version": "..." },
  "observed": {
    "public_ip": "1.2.3.4",
    "relay_connected": true
  }
}
```

Response:
```json
{ "ok": true }
```

---

## 3) Relay protocol

### 3.1 Relay registration (client → relay)
On WS connect, client must send:
```json
{
  "kind": "relay.register.v0.1",
  "protocol": "a2a/0.1",
  "node_id": "node_...",
  "session_id": "optional-stable-session",
  "capabilities_hash": "sha256:...",
  "ts": "2026-03-17T05:00:00Z"
}
```

### 3.2 Relay ack (relay → client)
```json
{
  "kind": "relay.ack.v0.1",
  "status": "accepted|dropped_no_target|error",
  "reason": "OK|NO_TARGET|BAD_PAYLOAD|RATE_LIMIT",
  "trace_id": "relay:...",
  "ts": "2026-03-17T05:00:00Z"
}
```

### 3.3 Relay forward envelope (client → relay)
```json
{
  "kind": "relay.forward.v0.1",
  "protocol": "a2a/0.1",
  "from_node_id": "nodeA",
  "to_node_id": "nodeB",
  "topic": "task.pub.v0.1",
  "msg_id": "msg:uuid",
  "trace_parent": "relay:...",
  "ts": "2026-03-17T05:00:00Z",
  "payload": { }
}
```

### 3.4 Relay delivered (relay → target client)
```json
{
  "kind": "relay.deliver.v0.1",
  "protocol": "a2a/0.1",
  "from_node_id": "nodeA",
  "to_node_id": "nodeB",
  "topic": "task.pub.v0.1",
  "msg_id": "msg:uuid",
  "trace_id": "relay:...",
  "ts": "2026-03-17T05:00:00Z",
  "payload": { }
}
```

---

## 4) Topic names (stable)
- `peer.gossip.v0.1` — peer graph updates
- `task.pub.v0.1` — task advertisements
- `task.claim.v0.1` — task lease claims
- `task.result.v0.1` — task completion results
- `task.sync.req.v0.1` — request task sync
- `task.sync.res.v0.1` — response task sync

---

## 5) Task lifecycle payloads

### 5.1 Task object (canonical)
```json
{
  "task_id": "task:uuid",
  "type": "run_check|query",
  "topic": "p2p_proof_1773727000",
  "created_at": "2026-03-17T05:00:00Z",
  "created_by": "nodeA",
  "input": { "check": "relay_health" },
  "requires": ["cap:run_check"],
  "status": "open|leased|running|completed|failed",
  "lease": {
    "holder": "nodeB",
    "leased_at": "2026-03-17T05:00:05Z",
    "expires_at": "2026-03-17T05:10:05Z"
  },
  "result": {
    "ok": true,
    "finished_at": "2026-03-17T05:00:10Z",
    "output": { }
  }
}
```

### 5.2 task.publish (A → relay/pubsub)
Topic: `task.pub.v0.1`
```json
{
  "kind": "task.publish.v0.1",
  "protocol": "a2a/0.1",
  "task": { "task_id": "task:uuid", "type": "run_check", "topic": "...", "created_by": "nodeA" },
  "ts": "2026-03-17T05:00:00Z"
}
```

### 5.3 task.claim (B → relay/pubsub)
Topic: `task.claim.v0.1`
```json
{
  "kind": "task.claim.v0.1",
  "protocol": "a2a/0.1",
  "task_id": "task:uuid",
  "claimer_node_id": "nodeB",
  "lease": {
    "holder": "nodeB",
    "leased_at": "2026-03-17T05:00:05Z",
    "expires_at": "2026-03-17T05:10:05Z"
  },
  "ts": "2026-03-17T05:00:05Z"
}
```

### 5.4 task.result (B → relay/pubsub)
Topic: `task.result.v0.1`
```json
{
  "kind": "task.result.v0.1",
  "protocol": "a2a/0.1",
  "task_id": "task:uuid",
  "executor_node_id": "nodeB",
  "ok": true,
  "finished_at": "2026-03-17T05:00:10Z",
  "output": { "check": "relay_health", "ok": true },
  "error": null,
  "ts": "2026-03-17T05:00:10Z"
}
```

---

## 6) Required logging (for proof layer)
All nodes MUST log these events with stable JSON keys:
- `RELAY_REGISTERED` {node_id, relay_url}
- `RELAY_FORWARD_SENT` {msg_id, from_node_id, to_node_id, topic, trace_id}
- `RELAY_DELIVER_RECEIVED` {msg_id, from_node_id, to_node_id, topic, trace_id}
- `TASK_PUBLISHED` {task_id, created_by, topic}
- `TASK_CLAIMED` {task_id, claimer_node_id}
- `TASK_EXECUTED` {task_id, executor_node_id, ok}
- `TASK_RESULT_RECEIVED` {task_id, created_by, executor_node_id, ok}
