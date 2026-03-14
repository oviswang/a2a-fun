# NETWORK_AGENT_PUBLISH_WIRING_V0_1.md

Network Agent Publish Wiring v0.1 wires a real node flow so it can build its local `AgentCard` from local discovery documents and publish into the Network Agent Directory.

## What this phase does

- Extract local discovery docs from `<workspace>/agent/*.md`.
- Build a deterministic machine-safe `AgentCard`.
- Publish into the in-memory Network Agent Directory (per process).
- Publishing is best-effort and must not break runtime correctness.

## Local publish behavior

`publishLocalAgentCardRuntime({ workspace_path, agent_id, publish })`:
- extracts docs
- builds AgentCard
- calls injected `publish({ agent_id, card })`
- returns a machine-safe result:

```json
{ "ok": true, "published": true, "agent_id": "nodeA", "error": null }
```

## Startup/runtime wiring

Automatic startup publishing is not forced in v0.1 to avoid refactoring runtime startup surfaces.

Instead, v0.1 provides an explicit operational hook (HTTP) that can be called during startup scripts or operator workflows.

## Optional HTTP helper

`POST /agents/publish-self`

Behavior:
- reads environment variables:
  - `A2A_WORKSPACE_PATH`
  - `A2A_AGENT_ID`
- builds local AgentCard from local docs
- publishes into the server’s in-memory directory
- returns the machine-safe publish result

## Current limitation

- Directory is in-memory / local-process only in v0.1.
- No distributed gossip/sync/persistence.
