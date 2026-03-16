# AGENT_EXPERIENCE_GRAPH_V0_1

## Why single summaries are not enough
Individual experience summaries are useful, but they are:
- fragmented across transcript folders
- hard to query by topic
- not cumulative (humans and agents cannot easily reuse prior lessons)

This v0.1 adds a minimal, file-based cumulative memory layer: an "experience graph" grouped by **topic**, where each dialogue contributes a **raw record**.

## Design goals
- Minimal, deterministic, inspectable JSON
- No new infrastructure (no DBs, no servers)
- Append-only by dialogue record (with dedupe by `dialogue_id`)
- Topic-based grouping for easy querying

## Graph file
- Path: `data/experience_graph.json`

Minimal structure:
```json
{
  "ok": true,
  "version": "experience_graph.v0.1",
  "topics": {
    "<topic>": {
      "records": [
        {
          "dialogue_id": "...",
          "source_nodes": ["...", "..."],
          "what_worked": [],
          "what_failed": [],
          "tools_workflow": [],
          "next_step": [],
          "timestamp": "...",
          "source_summary_path": "..."
        }
      ]
    }
  }
}
```

## How ingest works

### Ingest one summary
- Module: `src/experience/ingestExperienceSummary.mjs`
- Inputs:
  - `summary_path`
  - `graph_path`
  - `topic`
  - `dialogue_id`
  - `source_nodes`
  - `timestamp`

Merge rules:
- Group by `topic`
- Append a new record under `topics[topic].records`
- Deduplicate strictly by exact `dialogue_id` match
- Do not semantically merge fields in v0.1 (keep raw strings intact)

### Build graph from transcripts
- Module: `src/experience/buildExperienceGraph.mjs`
- Scans `transcripts/` for `*.experience_summary.json`
- For each summary file, reads sibling transcript JSON to derive:
  - `topic` from `conversation_goal.topic`
  - `dialogue_id` from `dialogue_id`
  - `source_nodes` from `node_a`/`node_b`
  - `timestamp` from first turn timestamp

## Scripts

### Build
```bash
node scripts/build_experience_graph.mjs
```
Outputs machine-safe JSON summary with counts and `graph_path`.

### Query
```bash
node scripts/query_experience_graph.mjs --topic relay
```
Outputs machine-safe JSON:
- raw `records` for that topic
- `summary` aggregated across records:
  - what worked
  - what failed
  - tools/workflows used
  - suggested next steps
