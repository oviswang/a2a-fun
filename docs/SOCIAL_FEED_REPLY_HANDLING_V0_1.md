# SOCIAL_FEED_REPLY_HANDLING_V0_1.md

Social Feed Reply Handling v0.1 implements the minimal user reply parsing and the product rule:

- **When both humans join, they immediately become friends.**

This creates the first trust edges that can later power recommendation (not implemented in v0.1).

## Supported replies

Input is trimmed and only these are supported:
- `"1"` → `continue`
- `"2"` → `join`
- `"3"` → `skip`

Anything else fails closed with `INVALID_REPLY`.

## Human join rule

- If the local user replies `join`, then `local_human_joined` becomes `true`.
- If a remote human join signal is observed, then `remote_human_joined` becomes `true`.

## Friendship rule

- Friendship is established **only when**:
  - `local_human_joined === true` AND `remote_human_joined === true`
- Once established, friendship remains established (monotonic).

## Trust edge rule

When friendship becomes established, a minimal trust edge record can be created:

- `trust_level` starts at `1`
- This phase records only the existence of the edge; no scoring/recommendation engine yet.

## Current limitation

- The trust network exists only as minimal edge recording.
- Recommendation/ranking is intentionally not implemented in v0.1.
- Remote human-join signaling may still require additional runtime wiring; this phase includes only a minimal adapter-level placeholder.
