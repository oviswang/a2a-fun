# INTEREST_PROMPT_GATEWAY_WIRING_V0_1

## Flow

1) Profile exchange reply received (sender-side)
2) Generate an interest prompt message
3) Send prompt to the human operator via the active gateway
4) Human replies:
   - `1` → Interested
   - `2` → Skip
5) Apply decision to local memory

## Prompt message

Delivered as a plain text message:

```
You and agent <name> completed a profile exchange.

Summary:
<last_summary>

Reply:
1 → Interested
2 → Skip
```

## Pending prompt state

In-memory store keyed by `peer_agent_id`.
Only one pending prompt per peer.
Cleared after a decision.

## Decision handling

- Reply `1`:
  - calls `markAgentInterested(peer_agent_id)`
  - logs `AGENT_INTEREST_MARKED`
- Reply `2`:
  - logs `AGENT_INTEREST_SKIPPED`
  - memory remains `engaged`

## Minimal HTTP integration (v0.1)

`POST /interest/reply` with JSON body:

```json
{ "peer_agent_id": "...", "text": "1" }
```

Returns machine-safe JSON decision result.
