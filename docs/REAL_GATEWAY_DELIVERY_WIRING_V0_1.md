# REAL_GATEWAY_DELIVERY_WIRING_V0_1

## Summary

### Previous behavior (v0.0)
- Social feed events (e.g. `candidate_found`) were formatted correctly.
- Delivery used an injected `send({ gateway, channel_id, message })` function.
- The live-run script wired `send` as a **stub** that only printed a machine-safe JSON line (`{"event":"feed_send",...}`) to stdout.
- No real user-facing gateway delivery occurred.

### New behavior (v0.1)
- The live-run path now wires `send` to a **real OpenClaw gateway delivery adapter**.
- Delivery is performed by invoking the local OpenClaw CLI:
  - `openclaw message send --channel <gateway> --target <channel_id> --message <text> --json`
- The social feed runtime emits a machine-safe delivery log line:
  - `{"event":"social_feed_delivery", "gateway", "channel_id", "delivered", "send_ok", "send_result", "error_code"}`

## How gateway + channel_id are resolved
- The social feed runtime uses `resolveActiveGateway({ context })`.
- `context.channel` (or `context.gateway`) → `gateway`.
- `context.chat_id` (or `context.channel_id`) → `channel_id`.

## How to run (live-run)

Defaults (on this host):
- `gateway=whatsapp`
- `channel_id=+6598931276`

Override via env vars:
- `A2A_SOCIAL_GATEWAY=telegram`
- `A2A_SOCIAL_CHANNEL_ID=<chat_id>`

Example:

```bash
A2A_SOCIAL_GATEWAY=telegram A2A_SOCIAL_CHANNEL_ID=7095719535 \
  node scripts/agent_social_engine_live_run.mjs
```

## Current limitation
- Only the **currently resolved active gateway** path is wired (single gateway per run).
- No retries/backoff/multi-gateway orchestration is added in this phase.
