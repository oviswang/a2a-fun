# CAPABILITY_DISCOVERY_V0_1.md

Capability discovery v0.1 provides a **minimal, local-per-node** capability listing so other nodes (or operators) can query what a node exposes.

## Endpoint

`GET /capabilities`

## Response (machine-safe)

```json
{
  "ok": true,
  "node_id": null,
  "capabilities": ["echo", "text_transform", "translate"]
}
```

Notes:
- `node_id` is `null` in v0.1 if the current server wiring does not expose a stable node identity.
- `capabilities` are sorted deterministically.

## Source of truth (v0.1)

The returned list is derived from the official capability pack v0.1:

- `examples/capabilities/index.mjs`

Expected capability ids:
- `echo`
- `text_transform`
- `translate`

## Current limitation

Discovery is **local-per-node only**. There is no network-wide index, aggregation, or search in v0.1.
