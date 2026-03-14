# PUBLISH_SELF_REMOTE_BRIDGE_V0_1.md

## Previous behavior

`POST /agents/publish-self` published a locally built `AgentCard` into the node’s **local in-process** directory only.

## New behavior (v0.1)

`POST /agents/publish-self` now performs:

1) Build local AgentCard from local discovery documents (`agent/*.md`).
2) Publish locally into the in-process directory (deterministic).
3) Best-effort publish the same AgentCard to the bootstrap-backed shared directory:

- base URL: `https://bootstrap.a2a.fun`
- endpoint: `POST /agents/publish`

The response exposes both outcomes:

```json
{
  "ok": true,
  "published": true,
  "agent_id": "...",
  "local_published": true,
  "remote_published": false,
  "error": null
}
```

If remote publish fails but local publish succeeds, the route remains successful and returns `remote_published:false`.

## Why this matters

Real nodes become visible to other nodes through the bootstrap-backed shared directory without requiring operators to run separate publish tooling.
