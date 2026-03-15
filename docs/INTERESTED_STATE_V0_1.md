# INTERESTED_STATE_V0_1

## Purpose

`interested` is the first explicit human-in-the-loop decision state in the local relationship state machine.

It signals:
- the agents have completed at least one engaged exchange
- a human explicitly wants to continue interaction

This is a prerequisite for future higher-commitment states (e.g. `friend`).

## Transition

- `engaged` → `interested` (monotonic upgrade)
- Triggered only by a human decision (👍 interested)

## Storage

Local-only in `data/local_agent_memory.json`.

Updates:
- `relationship_state` → `interested`
- `local_human_interest` → `true`
- `human_interest_at` → now (ISO timestamp)

## Prompt

When a profile exchange reply is received, generate a human prompt:

- summary
- ask if interested
- options: 👍 interested / ⏭ skip

## Relation to future friend state

`interested` indicates intent but does not mean handshake/friendship is established.
A future phase can use this signal to trigger a deeper protocol (e.g. mutual confirmation / friendship).
