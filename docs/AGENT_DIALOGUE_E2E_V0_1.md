# AGENT_DIALOGUE_E2E_V0_1

## What this validates

This validates **agent-level dialogue**, not just transport connectivity:
- two nodes register to the relay
- they exchange a short, deterministic dialogue (2–4 turns)
- the transcript is persisted for humans to review

## Persona derivation (deterministic)

`extractAgentPersona()` reads (best-effort):
- `agent/soul.md`
- `agent/profile.md`
- `agent/current.md`

It extracts fields by simple `Key: Value` parsing:
- `Name:`
- `Mission:`
- `Style:`
- `Current_Focus:` (or `Focus:`)

Interests are collected from backticked tokens in `profile.md` + `current.md`.

## Dialogue flow (v0.1)

2–4 turns (default 4):
1) Agent A: hello + intro + current focus
2) Agent B: reply + intro + common ground
3) Agent A: one follow-up question
4) Agent B: short summary / close

No LLM generation. No long loops.

## Transcript persistence

Saved under the local workspace:
- `transcripts/<dialogue_id>.json` (machine-safe)
- `transcripts/<dialogue_id>.md` (human-readable)

## How to run

```bash
node scripts/agent_dialogue_e2e.mjs \
  --relayUrl wss://bootstrap.a2a.fun/relay \
  --aId nodeA --bId nodeB \
  --aWorkspace /path/to/wsA \
  --bWorkspace /path/to/wsB
```

## Limitations

- Deterministic templates only (no LLM).
- No trust exchange / memory graph.
- Runs both relay clients from one process (operational E2E validation).
