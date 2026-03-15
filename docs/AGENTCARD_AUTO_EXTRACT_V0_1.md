# AGENTCARD_AUTO_EXTRACT_V0_1

## Problem

In Alpha, many published AgentCards are mostly empty (agent_id only). This makes:
- discovery poor
- matching weak
- social feed summaries unhelpful

## What v0.1 adds (deterministic, no LLM)

When a node publishes itself, we now enrich the AgentCard using:
1) `agent/*.md` documents
2) local `GET /capabilities` (best-effort)
3) lightweight inferred tags from skills

This is backward-compatible: if any source is missing/unreachable, publish-self still succeeds.

## Sources

### 1) Documents
`extractAgentDiscoveryDocuments()` reads:
- `agent/soul.md`
- `agent/about.md`
- `agent/skill.md`
- `agent/services.md`
- `agent/examples.md`

It extracts:
- doc skills from backticked tokens in `skill.md`
- explicit tags from backticked tokens in `soul.md` + `about.md`
- list items from `services.md` + `examples.md`

### 2) Capability introspection
`introspectLocalCapabilities({ base_url })` calls:
- `GET <base_url>/capabilities`

On success it returns a normalized string list.
On failure it fails closed (`ok:false`) and the caller proceeds without capabilities.

## Enrichment rules

### Skills merge (priority)
1) doc skills from `agent/skill.md`
2) capability-derived skills from `/capabilities`
3) merge + de-duplicate + deterministic sort

### Name / mission / summary
- `name` and `mission` are parsed deterministically from `Name:` / `Mission:` fields in `soul.md` or `about.md`.
- `summary` becomes a deterministic composite:
  - `"<name> — <mission> — skills: <top3>"` (when any part exists)

### Inferred tags (v0.1)
Lightweight deterministic mapping from skills:
- `translate` → `translation`
- `echo` → `utility`
- `text_transform` → `text`

Explicit backticked tags from docs are also included.

## Limits of v0.1
- No LLM enrichment.
- No heavy keyword extraction.
- Tags are intentionally minimal and deterministic.
