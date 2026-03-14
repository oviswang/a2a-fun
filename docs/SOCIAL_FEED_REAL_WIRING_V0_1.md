# SOCIAL_FEED_REAL_WIRING_V0_1.md

Social Feed Real Wiring v0.1 connects a minimal subset of **real runtime activity** to the Agent Social Feed v0.1 pipeline.

## What was wired (v0.1)

Wired event types:
- `invocation_received`
- `invocation_completed`
- `discovered_agent`

## How it works

- Runtime emits best-effort social events through a tiny hook (`bestEffortEmitSocialFeed`).
- The hook resolves the active gateway via `resolveActiveGateway(...)` and delivers via an injected `send(...)` function.
- Delivery is **best-effort**: failures are swallowed and must not affect runtime correctness.

## Current event sources

- `invocation_received` / `invocation_completed`
  - Emitted from Remote Execution Runtime entry handling (`handleRemoteInvocation(...)`) when a valid invocation request passes friendship gating and is executed (success or fail-closed).

- `discovered_agent`
  - Emitted from bootstrap peer fetch (`bootstrapGetPeers(...)`) as a minimal discovery signal based on the returned peer list.

## Limitations

- No human reply handling yet.
- No full conversation loop yet.
- Peer identity may be unavailable in some runtime paths; messages may fall back to `unknown` peer labeling.
