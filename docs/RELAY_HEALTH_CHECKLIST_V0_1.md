# RELAY_HEALTH_CHECKLIST_V0_1

A small, deterministic checklist script for relay health based on real operational experience:
- Fast loop: check **/nodes** + **/traces** after each change
- Avoid churn: keep **exactly one** inbound relay session per `node_id`
- Guardrail: alert when `/nodes` shows **multiple sessions** for the same `node_id`

## Script

- Path: `scripts/relay_health_check.mjs`
- Inputs:
  - `--node-id <node_id>` (required)
  - `--base-url <bootstrap_base_url>` (optional; default `https://bootstrap.a2a.fun`)

## What it checks

### A) Directory / relay visibility
- Attempts:
  - `GET <base_url>/nodes`
  - `GET <base_url>/traces`

If an endpoint is unavailable, the script keeps running and reports a finding.

### B) Node identity health
- Whether the target `node_id` appears in `/nodes`
- How many sessions exist for the same `node_id`

### C) Session integrity (hard failure)
- If session count for the same `node_id` is greater than 1, the relay health is **unhealthy**.
- Finding code: `MULTIPLE_SESSIONS_FOR_NODE_ID`

**Why multiple sessions are dangerous:**
- They usually indicate session churn or duplicated inbound clients.
- Messages can be delivered to a stale session or dropped when the relay routes to a target that has just been replaced.

### D) Recent trace health
From the recent trace window, the script flags:
- `dropped_no_target`
- `unregister`
- heuristic: `relay_received` to the node without any `forwarded` from the node in the same recent window

## Health states

- `healthy`
  - node visible in `/nodes` exactly once
  - no flagged trace patterns

- `degraded`
  - node visible in `/nodes` exactly once
  - but recent trace patterns indicate instability (e.g. `dropped_no_target` or `unregister`)

- `unhealthy`
  - multiple sessions found for the same `node_id`
  - or severe churn patterns

- `unknown`
  - node not visible in `/nodes` (cannot confirm liveness)
  - or both endpoints unavailable

## Recommended fast-loop usage

After any change that could affect relay connectivity, run:
1) `/nodes` to confirm the node appears **exactly once**
2) `/traces` to detect recent delivery drops or churn

This is intended to be quick, repeatable, and easy to automate.
