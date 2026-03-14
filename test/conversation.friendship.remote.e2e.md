# Conversation → Friendship — Two-Machine Relay E2E Validation (Minimal)

This is a **minimal two-machine relay** validation plan for Conversation → Friendship runtime integration.

Hard constraints:
- No changes to frozen transport semantics
- No changes to frozen envelope semantics
- No changes to Phase3 semantics
- No changes to Discovery / Friendship Trigger semantics
- No mailbox / retry / orchestration

## What this validates

Machine A
→ conversation pipeline (opening → turn → transcript → surface)
→ conversation handoff (`HANDOFF_TO_FRIENDSHIP`)
→ `startPhase3ProbeFromConversationHandoff(...)` (produces `SESSION_PROBE_INIT`)
→ `executeTransport(... → relay)`
→ relay server
→ Machine B `relayInbound`
→ `formalInboundEntry`
→ `protocolProcessor` (stub decodes embedded probe msg)
→ Phase3 hook (`applySessionProbeMessage`)
→ machine-safe `response.phase3` on Machine B

## Harness

- Script: `scripts/conversation_friendship_two_machine_relay_e2e.mjs`
- Roles: `relay` / `a` / `b`

## Run steps

### 1) Start relay server

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/conversation_friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18883
```

### 2) Start Machine B listener

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/conversation_friendship_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18883/relay --nodeId nodeB
```

Expected:
- prints `{ role: "machineB", connected: true }`
- prints one JSON line per inbound message including `phase3` and `friendship_candidate`

### 3) Send from Machine A

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/conversation_friendship_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18883/relay --nodeId nodeA --to nodeB
```

Expected on Machine A:
- prints `transport:"relay"`
- prints `opening_id`, `turn_id`, `transcript_id`, `surface_id`, `handoff_id`, `phase3_probe_kind:"SESSION_PROBE_INIT"`

Expected on Machine B:
- receives `m-conversation-probe-init`
- `phase3.state` becomes `LOCAL_ENTERED`
- `friendship_candidate` must remain `null` (still gated on PROBING)

Fail-closed check:
- Machine A also sends `m-bad-kind` embedding `kind:"NOPE"`
- Machine B should log `inbound_ok:false` with `inbound_error.code:"UNKNOWN_KIND"`

## Success criteria
- Relay path actually used (Machine A logs `transport:"relay"`)
- Conversation artifacts produced on Machine A (ids present)
- Phase3 probe init delivered to Machine B
- Phase3 state advances correctly on Machine B (`LOCAL_ENTERED`)
- Friendship remains gated (no friendship_candidate before PROBING)
- Invalid kind fails closed (Machine B machine-safe error)
