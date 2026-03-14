# FIRST_LIVE_PUBLISH_FLOW_V0_1.md

First Live Publish Flow v0.1 demonstrates the first minimal product loop:

publish-self → directory → search → social event

## What this flow proves

- Two live identities (Node A and Node B) can publish their `AgentCard` into the Network Agent Directory.
- Both appear in the shared directory.
- A keyword search can find the other node.
- A best-effort social/discovery signal (`discovered_agent`) can be emitted from that result.

## Minimal live flow behavior

1) Node A publishes itself.
2) Node B publishes itself.
3) Directory contains both AgentCards.
4) Search (keyword) finds B.
5) Emit one best-effort social feed event: `discovered_agent`.

## Operational path

- Script: `scripts/first_live_publish_flow.mjs`
  - Runs the flow against the in-memory directory model (v0.1).
  - Emits a machine-safe JSON line for the social feed message and for the final flow result.

## Why this matters

It is the first live visibility loop for real nodes: nodes can make themselves visible, be found, and trigger a human-visible event.

## Current limitation

- Directory is still local/in-memory (per process) in v0.1.
- No distributed synchronization or persistence yet.
