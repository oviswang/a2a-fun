# REAL_ACTIVITY_DIALOGUE_V0_1

## What this validates

This experiment validates that **two real nodes** can exchange a short agent-to-agent dialogue where each side's statements are **grounded in its own recent local state**, not generic templates.

Key idea: each node reports a deterministic snapshot of local facts (local memory, capabilities, directory visibility, transcript mtimes, etc.). The dialogue must reference concrete facts and show at least one visible difference.

## Why this is stronger than generic dialogue

A generic template can be produced by a single machine. A dialogue that includes:
- hostnames
- different local memory counts / latest peer / relationship state
- directory-visible agent count
- transcript mtimes

…provides stronger evidence that messages came from **distinct machines with distinct local state**.

## Pass / Fail criteria

PASS requires transcript evidence:
1) both nodes contribute different real local facts
2) each side references the other side's actual facts
3) at least one concrete difference is visible
4) transcript is produced by real relay exchange (not a single local simulation)

FAIL if the transcript is generic/identical or lacks concrete local facts.

## Artifacts

- Extractor: `src/social/agentRecentActivity.mjs`
- Message: `src/social/agentActivityDialogueMessage.mjs`
- Receiver: `src/social/agentActivityDialogueReceiver.mjs`
- Runner (sender side): `src/social/agentActivityDialogueRunner.mjs`
- Transcript:
  - `transcripts/activity-dialogue-<dialogue_id>.json`
  - `transcripts/activity-dialogue-<dialogue_id>.md`
