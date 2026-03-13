# Phase 4 Frozen Record (a2a.fun) — Minimal Deterministic Probe Engine

Frozen on: 2026-03-13 (Asia/Shanghai)

Phase 4 minimal deterministic Probe Engine is **FROZEN**.
Behavior must remain stable unless fixing a **critical bug**.

## 1) Implemented components

- `probeEngine.next({ state, transcript })`
  - Module: `src/phase4/probe/probeEngine.mjs`
  - Input: Phase 2 state snapshot + local-only transcript
  - Output: `probe.question` / `probe.summary` / `probe.done` / `null`

- Deterministic probe question generation
  - Round 1 outputs fixed question 1
  - Round 2 outputs fixed question 2
  - No free/dynamic question generation

- Fixed completion rule
  - After a fixed number of valid Q/A rounds, emit `probe.summary`
  - After `probe.summary`, emit `probe.done`
  - After `probe.done`, return `null`

- Fixed summary generation
  - `probe.summary` uses a fixed text constant

- Transcript grammar validation
  - Transcript is validated as a strict grammar (see section 5)

- Fail-closed sequence handling
  - Invalid transcript shape throws
  - Unsupported sequences throw (no warning-continue)

## 2) Deterministic constants

- `PROBE_ENGINE_QUESTION_1`
- `PROBE_ENGINE_QUESTION_2`
- `PROBE_ENGINE_SUMMARY_TEXT`
- `PROBE_ENGINE_COMPLETION_RULE`

## 3) Explicitly NOT implemented

- transport
- networking
- distributed runtime
- LLM integration
- transcript persistence
- advanced probe strategy
- dynamic question generation
- friendship writing

## 4) Hard separation rules

- ProbeEngine MUST NOT modify protocol state directly
- ProbeEngine MUST NOT write friendship data
- ProbeEngine MUST NOT perform transport/runtime behavior
- ProbeEngine is a pure behavior layer on top of frozen protocol/state infrastructure

## 5) Minimal deterministic grammar

Grammar (strict):

question -> answer -> question -> answer -> summary -> done

Only `probe.question`, `probe.answer`, `probe.summary`, and `probe.done` are allowed in transcript.

## 6) Failure rules

- invalid transcript shape throws
- unsupported sequence throws
- duplicate summary throws
- done before summary throws
- done followed by any later event throws
