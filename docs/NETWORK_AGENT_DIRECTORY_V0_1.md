# NETWORK_AGENT_DIRECTORY_V0_1.md

Network Agent Directory v0.1 extends local Agent Discovery Documents into a minimal shared directory so nodes can publish `AgentCard`s and query other published cards.

## What it is (v0.1)

- In-memory shared directory (per process).
- Publish an `AgentCard`.
- List published cards.
- Keyword search across published cards.
- Optional trust-aware ordering on search results when trust edges are provided (adapter-level).

## Publish flow

1) Build an AgentCard from local docs (`agent/*.md`).
2) Publish it into the directory.

A published directory entry shape:

```json
{ "agent_id": "...", "published_at": "...", "card": { ...AgentCard... } }
```

Publishing replaces existing entry for the same `agent_id` deterministically.

## HTTP endpoints

### POST /agents/publish

Input:

```json
{ "agent_id": "nodeA", "card": { ...AgentCard... } }
```

Behavior:
- validates input
- publishes to in-memory directory
- returns `{ ok:true, published:true, agent_id:"..." }`

### GET /agents

Returns:

```json
{ "ok": true, "agents": [ ...AgentCard... ] }
```

Sorted by `agent_id` ascending.

### GET /agents/search?q=...

Returns:

```json
{ "ok": true, "results": [ ...AgentCard... ] }
```

- keyword match uses the existing AgentCard search logic
- deterministic ordering
- trust-aware ordering is optional; HTTP layer may default to non-trust ordering in v0.1

## Current limitation

- In-memory only (no persistence).
- No distributed gossip / synchronization.
- No network-wide index beyond what each node process receives via publish.
