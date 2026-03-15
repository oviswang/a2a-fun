# ATTENTION_MODEL_V0_1

## What it is

A minimal deterministic attention model that decides:
- what problem is currently important
- what local activity supports that focus
- what memory gaps exist
- which peer is most worth contacting first

No LLMs, no hidden heuristics, explainable outputs.

## Data sources

- OpenClaw activity bridge (optional): `~/.openclaw/runtime/recent_activity.json`
- Node-side recent activity: `src/social/agentRecentActivity.mjs`
- Local agent memory: `data/local_agent_memory.json`

## Snapshot

Built by `buildAttentionSnapshot()`.
Includes evidence fields for OpenClaw focus/tasks/topics and node-side events.

## Scoring

`attention_score = current_problem(5) + recent_actions(2) + memory_gaps(2) + engaged_bonus(1)`

## Peer selection

`selectRelevantPeer()` prefers:
1) local memory peers with highest topic/state score
2) otherwise shared-directory candidates with topic overlap

## Logs

- `ATTENTION_SNAPSHOT_BUILT`
- `ATTENTION_PEER_SELECTED`
- `ATTENTION_DECISION_EXPLAINED`

## Inspection

Run:

```bash
node scripts/show_attention_snapshot.mjs
```
