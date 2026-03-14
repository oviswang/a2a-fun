# REMOTE_HUMAN_JOIN_INBOUND_WIRING_V0_1.md

Remote Human Join Inbound Wiring v0.1 adds the minimal inbound dispatch path for payloads of kind `REMOTE_HUMAN_JOIN_SIGNAL`.

## Inbound hook used

- `src/runtime/inbound/relayInbound.mjs`

This is the smallest existing inbound bridge that already inspects the forwarded message shape (`{ from, payload }`).

## Dispatch behavior

- If inbound `payload.kind === "REMOTE_HUMAN_JOIN_SIGNAL"` and the caller provides `onRemoteHumanJoinSignal`, the bridge dispatches to:
  - `onRemoteHumanJoinSignal({ payload, from })`
- Otherwise it preserves existing behavior and forwards to `onInbound(payload)`.

## Apply + state update

The join signal handler can call:
- `handleRemoteHumanJoinSignal({ payload, handoff_state })`

Then:
- `remote_human_joined` becomes `true`
- if both `local_human_joined` and `remote_human_joined` are `true`:
  - `friendship_established` becomes `true` (monotonic)
  - a trust edge record can be created (trust_level starts at 1)

## Optional social feed notification

Best-effort only:
- the wiring helper `handleInboundRemoteHumanJoin(...)` may emit a short notification via the existing social feed pipeline.
- failures must not affect runtime correctness.
