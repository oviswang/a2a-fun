# A2A-FUN — Architecture Diagram (ASCII)

This document provides a visual/structural architecture view of the A2A-FUN protocol stack.
All phases referenced here are frozen/completed; this is documentation only.

**A2A-FUN v1 Network Baseline — Proven**
- Real two-machine relay end-to-end validated.
- Payload unchanged at `relayInbound → onInbound(payload)`.
- Drop-safe behavior observed (`type: dropped` when target not connected).

---

## 1) System overview diagram (major layers + flow)

Legend:
- [CORE] = protocol core behavior (validation + state transitions)
- [BEHAVIOR] = deterministic logic suggestions (no state writes)
- [SIDE-EFFECT] = persistence/action outside protocol core
- [WIRING] = runtime I/O and orchestration
- [TRANSPORT] = delivery only (no protocol semantics)

Network baseline (direct primary, relay fallback; mailbox not baseline):

```
        ┌──────────────────────┐
        │ Bootstrap (gw)        │
        │  POST /join           │
        │  GET  /peers          │
        └─────────┬────────────┘
                  │ candidate peers (no trust)
                  v
        ┌──────────────────────┐
        │ Auto-Join (opt-in)    │
        │  select peers         │
        │  persist known-peers  │
        └─────────┬────────────┘
                  │
                  v
        ┌──────────────────────────────────────────┐
        │ Transport decision (baseline)             │
        │  checkDirectReachability (HTTP probe)     │
        │  selectTransport: direct first, relay 2nd │
        └─────────┬────────────────────────────────┘
                  │
      ┌───────────┴───────────┐
      │                       │
      v                       v
┌───────────────┐     ┌──────────────────┐
│ Direct [TRAN] │     │ Relay [TRAN]     │
│ HTTP POST     │     │ WS client/server │
└───────┬───────┘     └────────┬─────────┘
        │                      │
        v                      v
┌──────────────────┐   ┌──────────────────┐
│ directInbound     │   │ relayInbound      │
│ onInbound(payload)│   │ onInbound(payload)│
└─────────┬────────┘   └─────────┬────────┘
          │                      │
          └──────────┬───────────┘
                     v
        ┌──────────────────────────────────────────┐
        │ Protocol boundary [CORE]                 │
        │  payload treated as opaque by transport  │
        └──────────────────────────────────────────┘

Mailbox: NOT part of baseline always-on path.
Proven (v1): two-machine relay path delivers payload unchanged at relayInbound → onInbound(payload).
```

---

```
                          ┌────────────────────────────────────────────┐
                          │ HTTP Runtime (Phase 6) [WIRING]            │
                          │  - httpTransport.receive (POST /message)    │
                          │  - messageRouter                            │
                          └───────────────┬────────────────────────────┘
                                          │
                                          │ remote inbound envelope
                                          v
                          ┌────────────────────────────────────────────┐
                          │ protocolProcessor.processInbound [CORE]    │
                          │  validate → verify → decrypt → bodyValidate │
                          │  → SessionManager.apply → audit bind        │
                          └───────────────┬────────────────────────────┘
                                          │
                                          v
                          ┌────────────────────────────────────────────┐
                          │ SessionManager (Phase 2) [CORE]            │
                          │  - state transitions only                   │
                          └───────────────┬────────────────────────────┘
                                          │ next_state
                                          v
                ┌─────────────────────────┴─────────────────────────┐
                │                                                   │
                │                                                   │
                v                                                   v
  ┌──────────────────────────────┐                    ┌──────────────────────────────┐
  │ ProbeEngine (Phase 4)        │                    │ FriendshipTrigger (3.5)       │
  │ [BEHAVIOR]                   │                    │ [SIDE-EFFECT WIRING]          │
  │ - suggests next probe msg     │                    │ - triggers only on            │
  │   (question/summary/done/null)│                    │   MUTUAL_ENTRY_CONFIRMED      │
  └───────────────┬──────────────┘                    └───────────────┬──────────────┘
                  │                                                    │
                  │ (optional outbound intent)                         │
                  v                                                    v
    ┌──────────────────────────────┐                    ┌──────────────────────────────┐
    │ FormalOutboundBuilder (P7)    │                    │ FriendshipWriter (Phase 3)    │
    │ [CORE-ADJACENT BUILDER]       │                    │ [SIDE-EFFECT]                 │
    │ - body validate → encrypt     │                    │ - idempotent write            │
    │ - assemble Phase2 envelope    │                    │ - friends.json                │
    │ - sign envelope_without_sig   │                    └───────────────┬──────────────┘
    └───────────────┬──────────────┘                                    │
                    │ formal envelope                                   v
                    v                                      ┌──────────────────────────────┐
      ┌──────────────────────────────┐                      │ friends.json (storage target) │
      │ httpTransport.send [WIRING]  │                      └──────────────────────────────┘
      └──────────────────────────────┘


Local event path (separate concern):

  local UI/system event
        │
        v
  ┌────────────────────────────────────────────┐
  │ protocolProcessor.processLocalEvent [CORE]  │
  │  SessionManager.applyLocalEvent → audit bind │
  └───────────────────────┬────────────────────┘
                          │ next_state
                          v
                 FriendshipTrigger → FriendshipWriter → friends.json


Outbound alternatives (separate concerns):

  - Formal outbound path (optional + explicit):
      ProbeEngine intent → FormalOutboundBuilder → httpTransport.send

  - TEST_STUB_OUTBOUND path (Phase 6; test-only wiring output):
      ProbeEngine intent → (stub envelope) → httpTransport.send
      (must NOT be treated as formal protocol output)
```

Separation highlights:
- Remote protocol messages and local events have distinct entrypoints.
- SessionManager only does state transitions.
- Side-effects (friendship persistence) are outside the protocol core.
- Runtime wiring does not define protocol semantics.

---

## 2) Layered architecture diagram (layers + responsibilities + MUST NOT)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 7 — Formal Outbound Builder (Phase 7)                           │
│  Does: build formal Phase 2 outbound envelopes (validate/encrypt/sign) │
│  MUST NOT: send transport messages; modify SessionManager/processor     │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 6 — Runtime / Transport (Phase 6 + runtime variants)            │
│  Does: HTTP receive, wiring/orchestration, optional outbound send      │
│  MUST NOT: invent protocol behavior; infer peer endpoints dynamically  │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 5 — Probe Engine (Phase 4)                                      │
│  Does: deterministic next-message suggestion in PROBING                │
│  MUST NOT: mutate session state; do transport; do persistence          │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 4 — Friendship Trigger (Phase 3.5)                              │
│  Does: detect MUTUAL_ENTRY_CONFIRMED and invoke friendshipWriter       │
│  MUST NOT: modify SessionManager/protocolProcessor; do discovery       │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 3 — Friendship Persistence (Phase 3)                             │
│  Does: idempotent friendship record write + machine-safe audit         │
│  MUST NOT: modify protocol/session state; run retries/backoff          │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2 — Protocol Core / Validation / State Machine (Phase 2)         │
│  Does: validate/verify/decrypt/bodyValidate; state transitions; audit   │
│  MUST NOT: transport send; friendship persistence; probe strategy       │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1 — Identity / Safety / Storage (Phase 1)                        │
│  Does: canonicalize → actor_id; outbound lint; local JSON storage       │
│  MUST NOT: implement protocol runtime; leak raw handles                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3) Relationship establishment flow diagram (happy path)

```
probe.hello
→ PROBING
→ probe.question
→ probe.answer
→ probe.question
→ probe.answer
→ probe.summary
→ probe.done
→ PROBE_COMPLETE
→ local.human.entry
→ AWAIT_ENTRY
→ remote human.entry
→ MUTUAL_ENTRY_CONFIRMED
→ friendshipTrigger
→ friendshipWriter
→ friends.json
```

---

## 4) Inbound / local / outbound paths (three distinct paths)

### A) Remote inbound path

```
HTTP receive
→ processInbound
→ SessionManager
→ ProbeEngine (optional suggestion)
→ Trigger (optional)
→ FriendshipWriter (optional)
```

### B) Local event path

```
local UI/system event
→ processLocalEvent
→ SessionManager
→ Trigger (optional)
→ FriendshipWriter (optional)
```

### C) Formal outbound path

```
ProbeEngine
→ formalOutboundBuilder
→ httpTransport.send
```

Notes:
- TEST_STUB_OUTBOUND remains separate.
- Formal outbound is optional and explicit.

---

## 5) Hard separation boundaries (architecture invariants)

- SessionManager MUST NOT perform side-effects
- protocolProcessor MUST NOT write friendship data
- FriendshipWriter MUST NOT modify protocol state
- ProbeEngine MUST NOT mutate session state
- runtime MUST NOT invent protocol behavior
- local events MUST NOT be treated as remote protocol messages
- test_stub outbound MUST NOT be treated as formal protocol output

---

## 6) Frozen phases map

| Phase | Responsibility | Status |
|---|---|---|
| Phase 1 | Identity / Safety / Storage | Frozen / Completed |
| Phase 2 | Protocol Core / Validation / State Machine | Frozen / Completed |
| Phase 3 | Friendship Persistence (side-effect) | Frozen / Completed |
| Friendship Trigger Layer | Trigger MUTUAL_ENTRY_CONFIRMED → writer | Frozen / Completed |
| Phase 4 | Deterministic Probe Engine | Frozen / Completed |
| Phase 5 | Minimal Peer Key Binding subset | Frozen / Completed |
| Phase 6 | Minimal HTTP Runtime (TEST_STUB_OUTBOUND) | Frozen / Completed |
| Phase 7 | Formal Protocol Egress Builder | Frozen / Completed |

---

## 7) Future extension points (not implemented)

These attach above/beside frozen layers without changing them:

- Discovery layer
  - provides trusted peer endpoint acquisition (explicit policy)

- Distributed runtime
  - multiple nodes, coordination, resilience (still must preserve frozen boundaries)

- Transcript persistence
  - durable probe transcript storage; audit/trace improvements

- Advanced probe strategy
  - additional deterministic rules or controlled LLM integration (future)

- Additional outbound message types
  - extend formal outbound builder allowlist beyond probe.question/probe.done
