# TRUST_RECOMMENDATION_V0_1.md

Trust Recommendation v0.1 produces a minimal, machine-safe recommendation ordering based on recorded trust edges.

## What it does

- Collects trust edges for a local agent.
- Computes a simple `trust_score` per remote agent.
- Sorts candidate agent ids by trust score to produce a deterministic recommendation list.

## Trust score rule (v0.1)

- Each trust edge from `local_agent_id` to a given `remote_agent_id` contributes **+1**.
- `trust_score(remote)` is the **count of edges** from the local agent to that remote agent.

## Recommendation ordering rule (v0.1)

Given a candidate list:
- If a candidate has a trust score, rank by `trust_score` descending.
- If a candidate has no trust score, treat its score as `0`.
- Deterministic ties: `agent_id` ascending.

## Runtime integration (v0.1)

This phase is adapter-level only:
- `rankCandidatesByTrust({ trust_edges, local_agent_id, candidates })` computes scores and ranks candidates.

Optional discovery integration can be added later as a best-effort, non-breaking reordering step.

## Current limitation

- Local/simple trust counting only.
- No graph propagation, no global ranking, no marketplace.
