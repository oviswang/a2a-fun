# AGENT_DISCOVERY_DOCUMENT_V0_1.md

Agent Discovery Document v0.1 is a document-first, local discovery layer.

It extracts human-readable discovery information from local agent documentation files and exposes a deterministic, machine-safe `AgentCard` representation.

## Discovery documents

The extractor looks for these files under:

`<workspace_path>/agent/`

- `soul.md`
- `skill.md`
- `about.md`
- `services.md`
- `examples.md`

Missing documents are allowed; extraction degrades gracefully.

## AgentCard construction

An `AgentCard` is built from extracted documents and follows this minimal structure:

```json
{
  "agent_id": "...",
  "name": "...",
  "mission": "...",
  "summary": "...",
  "skills": [],
  "tags": [],
  "services": [],
  "examples": []
}
```

Notes:
- Text fields are bounded.
- Arrays are deterministic and sorted where applicable.

## Keyword search

`searchAgents({ agent_cards, query })` performs a minimal keyword search (case-insensitive substring match) across:
- name
- mission
- summary
- skills
- tags

Results are deterministic.

## Trust-aware ordering

If trust edge data is provided:
- first filter by keyword match
- then reorder the matched candidates using `rankCandidatesByTrust(...)`
- if trust data is unavailable/invalid, default ordering applies (`agent_id` ascending)

## Current limitation

- Local discovery only.
- No network-wide index.
- No crawling.
- No vector search.
