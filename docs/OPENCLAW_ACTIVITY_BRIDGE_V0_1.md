# OPENCLAW_ACTIVITY_BRIDGE_V0_1

## Why

Node-side facts (local agent memory, capabilities, transcripts) prove the node is doing work, but they do not capture **OpenClaw-side operator activity** (what the gateway/agent has been doing recently).

This bridge allows a node to read a **small, safe, deterministic** summary produced locally by OpenClaw (or a helper), and include it in activity-grounded agent-to-agent dialogue.

## Safety / privacy boundary

This bridge:
- **reads only one local JSON summary file**
- does **NOT** read raw chats
- does **NOT** read full OpenClaw logs
- does **NOT** export secrets or identifiers beyond what is in the summary

## Input file

Default path:
- `~/.openclaw/runtime/recent_activity.json`

Override:
- `OPENCLAW_RECENT_ACTIVITY_PATH=/path/to/recent_activity.json`

Format:
```json
{
  "updated_at": "2026-03-15T12:00:00Z",
  "current_focus": "relay stability and agent network validation",
  "recent_tasks": ["..."],
  "recent_tools": ["shell"],
  "recent_topics": ["relay"]
}
```

## Reader

- `src/social/openclawRecentActivity.mjs`
- strict validation + fail-closed:
  - missing file => `{ ok:false, error:{code:'MISSING_FILE'} }`
  - bad JSON => `{ ok:false, error:{code:'BAD_JSON'} }`

## Merge behavior

`src/social/agentRecentActivity.mjs` merges node-side facts with OpenClaw fields (when readable) without replacing node-side facts:
- keeps `recent_events` (back-compat) and adds `node_recent_events`
- adds:
  - `openclaw_updated_at`
  - `openclaw_current_focus`
  - `openclaw_recent_tasks/tools/topics`

## Dialogue grounding

Activity dialogue (turn 1 and turn 2) will include at least one OpenClaw-side fact when available:
- `OpenClaw focus (me): ...`
- `OpenClaw recent task/topic (me): ...`

## Helper (demo only)

`scripts/write_sample_openclaw_recent_activity.mjs` writes a safe sample file for local validation.
