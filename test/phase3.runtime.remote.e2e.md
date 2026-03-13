# Phase 3 Session/Probe Runtime — Two-Machine Relay E2E Validation (Minimal)

This is a **minimal two-machine relay** validation plan for Phase 3 session/probe runtime, scoped strictly to:
- `SESSION_PROBE_INIT`
- `SESSION_PROBE_ACK`

Hard constraints:
- **No transport semantic changes** (`TRANSPORT_BASELINE_FROZEN`)
- **No Phase 2 envelope semantic changes**
- No mailbox, retry/backoff, orchestration
- No capabilities, tasks, or friendship persistence

## What this validates (required path)
Machine A
→ `executeTransport(... → relay)`
→ `relayClient`
→ `relayServer`
→ Machine B `relayInbound`
→ `formalInboundEntry`
→ `protocolProcessor`
→ Phase 3 hook
→ `applySessionProbeMessage`
→ machine-safe `response.phase3`

## Harness
A minimal harness script exists:
- `scripts/phase3_two_machine_relay_e2e.mjs`

It uses:
- existing relay server/client
- existing relayInbound
- existing formalInboundEntry
- the Phase 3 hook in formalInboundEntry

It does **not** modify any frozen semantics.

## Run Steps

### 1) Start relay server (Machine R or either machine)

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/phase3_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18880
```

Record the printed `relayUrl`.

### 2) Start Machine B listener (Machine B)

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/phase3_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18880/relay --nodeId nodeB
```

Expected:
- prints `{ role: "machineB", connected: true }`
- prints one JSON line per inbound message with `phase3` and `processorCalls`

### 3) Send Phase 3 messages from Machine A (Machine A)

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/phase3_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18880/relay --nodeId nodeA --to nodeB
```

Expected on Machine A:
- prints `transport: "relay"` for `m-init`, `m-ack`, and `m-bad`

Expected on Machine B:
- for `m-init`: `phase3.state` becomes `LOCAL_ENTERED`
- for `m-ack`: `phase3.state` becomes `PROBING`
- for `m-bad`: `inbound_ok:false` and `inbound_error.code:"UNKNOWN_KIND"`
- `processorCalls` increments (proves processor invoked on Machine B)

## Success Criteria Checklist
- [ ] Relay path actually used (`transport:"relay"` on Machine A)
- [ ] `SESSION_PROBE_INIT` → `LOCAL_ENTERED` on Machine B (`response.phase3`)
- [ ] `SESSION_PROBE_ACK` → `PROBING` on Machine B (`response.phase3`)
- [ ] `protocolProcessor` invoked on Machine B (`processorCalls` increases)
- [ ] machine-safe `response.phase3` returned (contains only `{session_id,state,local_entered,remote_entered}`)
- [ ] unsupported message fails closed (`UNKNOWN_KIND`)
- [ ] no friendship side-effects (no friendship modules invoked; output contains no friendship artifacts)
