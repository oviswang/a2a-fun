# A2A-FUN — Demo Guide (Minimal Local Run)

This guide demonstrates a minimal local demo of A2A-FUN:
- run two HTTP runtime nodes
- send a protocol message
- observe state machine progression and probe interaction
- observe friendship persistence (friends.json)

This is a minimal wiring demo intended for engineers. It is not a full network system.

---

## 1) Introduction

You will:
1) start two local runtime nodes
2) POST a message into one node
3) see the message flow through:
   messageRouter → protocolProcessor → SessionManager → ProbeEngine
4) confirm mutual entry and observe friendship persistence

---

## 2) Prerequisites

- Node.js (example: >= 18; this repo was developed on modern Node)
- npm

Install dependencies:

```bash
cd a2a-fun
npm install
```

Run tests (optional but recommended):

```bash
npm test
```

Agent-style install/run entry:
- See `skill.md`, `.env.example`, `install.sh`, and `start-node.sh`.
- Bootstrap endpoints are documented in `BOOTSTRAP.md` (explicit configuration placeholders; no discovery in current phases).

---

## 3) Repository structure (short)

Key directories/files:

- `src/runtime/`
  - minimal HTTP runtime + router
- `src/phase*/`
  - protocol layers (frozen phases)
- `test/`
  - unit tests
- `friends.json`
  - friendship persistence target (via injected storage in production wiring)

---

## 4) Start two runtime nodes

Example commands:

Node A:

```bash
node src/runtime/node/runtimeNodeFormal.mjs --port 3000
```

Node B:

```bash
node src/runtime/node/runtimeNodeFormal.mjs --port 3001
```

Each node runs a minimal HTTP server with a receive endpoint:
- `POST /message`

Note:
- The runtime in this repo is intentionally minimal.
- The “formal outbound integration” variant is a separate runtime entrypoint and requires explicit configuration to enable formal outbound sending.

---

## 5) Send a minimal protocol message

Example (curl):

```bash
curl -X POST http://localhost:3000/message \
  -H "Content-Type: application/json" \
  -d '{
    "envelope": {
      "session_id": "s1",
      "peer_actor_id": "h:sha256:peer",
      "type": "probe.hello",
      "msg_id": "m1",
      "ts": "2026-03-13T00:00:00Z",
      "v": "0.4.4",
      "from": { "actor_id": "h:sha256:peer", "key_fpr": "sha256:peerkey" },
      "to": { "actor_id": "h:sha256:local", "key_fpr": "sha256:localkey" },
      "crypto": { "enc": "x", "kdf": "y", "nonce": "n" },
      "body": { "ciphertext": "Y2lwaGVy", "content_type": "application/json" },
      "sig": "aGVsbG8="
    }
  }'
```

What happens conceptually:

messageRouter
→ protocolProcessor
→ SessionManager
→ ProbeEngine

(Exact acceptance depends on the injected crypto/verify/decrypt components; the runtime wiring is minimal and fail-closed.)

---

## 6) Observe the probe interaction

Expected probe message sequence (deterministic Phase 4 engine):

- `probe.question`
- `probe.answer`
- `probe.question`
- `probe.answer`
- `probe.summary`
- `probe.done`

The probe engine drives the probing phase by suggesting the next outbound probe message.

---

## 7) Human entry phase

Expected state transitions after probe completion:

PROBE_COMPLETE
→ `local.human.entry`
→ AWAIT_ENTRY
→ remote `human.entry`
→ MUTUAL_ENTRY_CONFIRMED

Notes:
- Local events enter via `processLocalEvent(...)` and must not be encoded as remote protocol messages.

---

## 8) Friendship persistence

Once mutual entry is confirmed, the system triggers:

friendshipTrigger
→ friendshipWriter
→ friends.json

Example `friends.json` record shape:

```json
[
  {
    "peer_actor_id": "h:sha256:...",
    "peer_key_fpr": "sha256:...",
    "session_id": "s1",
    "established_at": "2026-03-13T00:00:00Z"
  }
]
```

---

## 9) Formal outbound message

When enabled (explicit opt-in runtime variant):

ProbeEngine
→ formalOutboundBuilder
→ httpTransport.send

This uses Phase 7 formal protocol envelopes:
- outbound body validation
- encrypt dependency
- envelope assembly
- sign dependency

---

## 10) Test stub outbound mode

Phase 6 runtime also supports:
- `TEST_STUB_OUTBOUND`

This is for wiring/tests only and does NOT represent a formal Phase 2 protocol envelope.

---

## 11) Troubleshooting

- Port issues:
  - make sure ports are free (e.g. 3000/3001)

- JSON format:
  - ensure the request body is valid JSON
  - check commas/quotes

- Runtime not running:
  - confirm the process is listening on the expected port

- Inspect logs:
  - run the node with stdout visible
  - re-run `npm test` to verify local environment
