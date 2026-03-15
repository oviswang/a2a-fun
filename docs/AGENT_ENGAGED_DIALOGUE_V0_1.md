# AGENT_ENGAGED_DIALOGUE_V0_1

## Meaning: introduced → engaged

- **introduced**: a peer has completed a handshake and is minimally identified.
- **engaged**: one short post-handshake profile/current-focus exchange occurred and produced:
  - a small transcript
  - a short deterministic summary
  - a local memory upgrade to `engaged`

## Message type

`AGENT_PROFILE_EXCHANGE`

Minimal machine-safe payload (2 turns in v0.1):
- turn 1: sender → receiver (profile + current focus)
- turn 2: receiver → sender (one short deterministic reply)

## Trigger condition (v0.1)

During the social engine live run:
- if local memory record for peer is `relationship_state == introduced`
- and `last_dialogue_at == null`
- then send exactly one `AGENT_PROFILE_EXCHANGE` (best-effort)

## Runtime wiring

When relay inbound runtime is enabled (`ENABLE_RELAY_INBOUND=true`), forwarded relay payloads are inspected:
- if `payload.kind == AGENT_PROFILE_EXCHANGE`
  - apply receiver handler
  - upgrade local memory for sender to `engaged`
  - set `last_dialogue_at` and `last_summary`
  - save transcript
  - send one reply (turn 2) best-effort

## Transcript output

Saved under:
- `transcripts/profile-exchange-<dialogue_id>.json`
- `transcripts/profile-exchange-<dialogue_id>.md`

## Success criteria

- message sent
- remote receives + applies
- remote local memory upgraded to `engaged`
- transcript saved
- `last_summary` populated
