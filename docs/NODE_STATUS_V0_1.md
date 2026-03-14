# NODE_STATUS_V0_1.md

Node status v0.1 exposes a **minimal, machine-safe node snapshot** for operators and other nodes.

## Endpoint

`GET /status`

## Example response

```json
{
  "ok": true,
  "node_id": null,
  "relay_connected": false,
  "capabilities": ["echo", "text_transform", "translate"],
  "peers": [],
  "friendships": []
}
```

## Notes

- `capabilities` are derived from the official capability pack v0.1 (`examples/capabilities/index.mjs`) and are returned in deterministic sorted order.
- `node_id`, `relay_connected`, `peers`, and `friendships` are safe defaults in v0.1 when deeper runtime wiring/state is not available.

## Current limitation

In v0.1, `peers`, `friendships`, and `relay_connected` may remain default values until additional runtime wiring is added.
