# Phase 4 Plan — Probe Engine (a2a.fun) — Planning Only

Date: 2026-03-13

Phases 1, 2, 3, and the Friendship Trigger layer are frozen.
This document is Phase 4 planning only. **Do NOT implement yet.**

---

## 1) Purpose

The Probe Engine:
- Decides what **probe message** to produce next
- Drives the `PROBING` flow until `PROBE_COMPLETE`

Concretely, it is the conversation-logic component that determines:
- Which `probe.question` to ask next
- How to interpret `probe.answer`
- When to emit `probe.summary` / `probe.done`

---

## 2) Separation of concerns

Hard boundaries:
- SessionManager: state transitions only
- protocolProcessor: protocol message processing orchestration only
- probeEngine: probe conversation logic only

Rules:
- probeEngine MUST NOT modify protocol state directly
- probeEngine MUST NOT call SessionManager.apply/applyLocalEvent
- probeEngine output is an outbound suggestion; the application layer decides whether/how to send it

---

## 3) Supported probe message types

Phase 4 probeEngine supports generating/handling only:
- `probe.hello`
- `probe.question`
- `probe.answer`
- `probe.summary`
- `probe.done`

(Other message types remain outside the probe engine.)

---

## 4) Engine responsibilities

The probeEngine is responsible for:
- Generating probe questions (`probe.question`)
- Evaluating answers (`probe.answer`)
- Deciding when probing is complete
- Producing the next outbound probe message

Notes:
- For the minimal version, “evaluate answers” should be deterministic and rule-based (no LLM).
- The engine should be able to run without any network calls.

---

## 5) Explicit non-goals

Not in scope for Phase 4 minimal planning/implementation:
- transport
- networking
- distributed runtime
- LLM integration
- persistence of probe transcripts

(Transcript persistence and ciphertext-bound hashing remain Phase 2/upper-layer concerns.)

---

## 6) Minimal API proposal

Proposed minimal API (pure function style):

```js
probeEngine.next({
  state,
  transcript
})
// -> { next_probe_message } | { next_probe_message: null }
```

Where:
- `state` is a snapshot of the session state (Phase 2 state object)
- `transcript` is a local-only list of probe events/messages (minimal structure; no persistence required)

Return:
- `next_probe_message`: either a machine-safe probe message object (type + body) or `null`

Example shape:
```js
{
  type: 'probe.question',
  body: { q: 'Short safe question...' }
}
```

---

## 7) Failure rules

- probeEngine MUST NOT corrupt protocol state (it does not write state)
- Invalid input MUST throw (fail closed)
- Minimal engine MUST remain deterministic
  - Given the same `state` + `transcript`, it must always return the same `next_probe_message`
  - No random sampling, no time-based branching, no external I/O

Recommended approach for determinism:
- Use a fixed, small question set
- Use a strict allowlist of transcript events it will consider
- Enforce a fixed maximum number of rounds (align with v0.4.3 defaults at integration time)
