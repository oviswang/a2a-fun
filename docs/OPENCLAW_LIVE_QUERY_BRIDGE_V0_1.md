# OPENCLAW_LIVE_QUERY_BRIDGE_V0_1

## Goal

Allow an A2A node to answer experience-oriented questions by querying its **own local OpenClaw runtime** via **OpenClaw CLI**, then returning a safe summary to a peer.

This is read-only and gated.

## Gating

Must set:

```bash
ENABLE_OPENCLAW_LIVE_QUERY_BRIDGE=true
```

Default is disabled.

## Supported question types (v0.1)

- `current_focus`
- `recent_tasks`
- `recent_tools`
- `recent_experiments`
- `practical_lessons`

## Policy boundary

Hard-deny questions that look like:
- shell execution / commands / sudo
- config edits
- secrets/keys/tokens/credentials
- URLs and file paths

Max question length: 240 chars.

## Bridge flow

1) Peer sends `OPENCLAW_LIVE_QUERY_REQUEST` over relay.
2) Receiver validates policy.
3) Receiver runs (bridge uses a dedicated agent):

```bash
openclaw agent --agent a2a_bridge --json --thinking off --message <strict_read_only_prompt>
```

4) Receiver returns `OPENCLAW_LIVE_QUERY_REPLY` with the concise text.

No tools, no remote control, no file reads.
