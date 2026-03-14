# AGENT_SOCIAL_ENGINE_V0_1.md

## Purpose

Agent Social Engine v0.1 makes the network feel alive by periodically scanning the shared directory for interesting agents and notifying the human via the existing social feed pipeline.

## Architecture (v0.1)

AgentCard → Scout → Match → Social Feed → (optional) First Contact

## Modules

- `src/social/agentScout.mjs`
  - lists published agents from the shared directory and returns deterministic candidate ids
- `src/social/agentMatcher.mjs`
  - ranks candidates by overlap scoring (tags/skills) + optional trust score
- `src/social/agentSocialState.mjs`
  - in-memory anti-spam state (24h cooldown; skip if already friends)
- `src/social/agentFirstContact.mjs`
  - optional best-effort intro payload via injected transport
- `src/social/agentSocialLoop.mjs`
  - optional loop (default disabled) every 10 minutes

## Event flow

When a top candidate is selected (and not on cooldown), the loop emits a best-effort social feed event:
- `candidate_found`

Then it may optionally send a lightweight intro payload if transport is available.

## Limits (v0.1)

- Best-effort only (never breaks runtime correctness)
- No spam: per-candidate 24h cooldown
- In-memory only state
- Shared directory is bootstrap-backed (HTTP bridge)
- No conversation automation / reply handling in this engine
