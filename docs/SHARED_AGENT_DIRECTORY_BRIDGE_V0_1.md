# SHARED_AGENT_DIRECTORY_BRIDGE_V0_1.md

Shared Agent Directory Bridge v0.1 makes the Network Agent Directory visible across real nodes by using the **bootstrap node** as the first shared directory entrypoint.

## Why bootstrap is used

- v0.1 directory is in-memory per process.
- bootstrap provides a practical first shared HTTP entrypoint without introducing distributed gossip or persistence.

## Publish flow

1) A node builds its local `AgentCard` from discovery documents.
2) The node publishes to bootstrap:

- `POST /agents/publish` with `{ agent_id, card }`

## List/search flow

Nodes query bootstrap:
- `GET /agents`
- `GET /agents/search?q=...`

## Client helpers

`src/discovery/sharedAgentDirectoryClient.mjs` provides:
- `publishAgentCardRemote({ base_url, agent_id, card })`
- `listPublishedAgentsRemote({ base_url })`
- `searchPublishedAgentsRemote({ base_url, query })`

All helpers are machine-safe and fail closed.

## Current limitation

- Bootstrap-backed shared directory only (not yet fully distributed).
- In-memory per bootstrap process (no persistence) in v0.1.
