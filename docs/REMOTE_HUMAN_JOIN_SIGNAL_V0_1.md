# REMOTE_HUMAN_JOIN_SIGNAL_V0_1.md

Remote Human Join Signal v0.1 completes the minimal end-to-end path for “human join” signaling across nodes.

## What it is

A machine-safe payload sent to a peer when the local user chooses `join`.

## Signal shape

```json
{
  "kind": "REMOTE_HUMAN_JOIN_SIGNAL",
  "handoff_id": "...",
  "from_agent_id": "...",
  "to_agent_id": "...",
  "created_at": "..."
}
```

## When it is emitted

- When the local user reply is parsed as `join`.
- The node can send an opaque runtime payload:

```json
{ "kind": "REMOTE_HUMAN_JOIN_SIGNAL", "signal": { ... } }
```

## How it is applied

On the receiving node:
- validate inbound payload and signal
- apply to handoff state: `remote_human_joined = true`
- if both sides have joined:
  - `friendship_established = true`
  - a trust edge can be created (trust_level starts at 1)

## Friendship establishment rule

Friendship becomes established only when:
- `local_human_joined === true` AND `remote_human_joined === true`

Once established, it remains established.

## Current limitation

This remains minimal:
- no full conversation automation yet
- no recommendation engine yet
- no persistence/retries/orchestration
