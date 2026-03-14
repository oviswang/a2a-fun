# Discovery → Friendship — Two-Machine Relay E2E Validation (Minimal)

This is a **minimal two-machine relay** validation plan for Discovery → Friendship runtime integration.

Hard constraints:
- No changes to frozen transport semantics
- No changes to frozen envelope semantics
- No changes to protocolProcessor semantics (harness uses a stub processor)
- No changes to Phase3 state machine semantics
- No changes to Friendship Trigger Layer semantics
- No mailbox / retry / orchestration

## What this validates (required path)

Machine A
→ discovery pipeline (candidate → compatibility → preview → interaction → handoff)
→ `startPhase3ProbeFromDiscoveryHandoff(...)` (produces `SESSION_PROBE_INIT`)
→ `executeTransport(... → relay)`
→ relay server
→ Machine B `relayInbound`
→ `formalInboundEntry`
→ `protocolProcessor` (stub decodes embedded probe msg)
→ Phase3 hook (`applySessionProbeMessage`)
→ machine-safe `response.phase3` on Machine B

## Harness

- Script: `scripts/discovery_friendship_two_machine_relay_e2e.mjs`
- Roles: `relay` / `a` / `b`

## Run steps

### 1) Start relay server

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/discovery_friendship_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18882
```

Record printed `relayUrl`.

### 2) Start Machine B listener

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/discovery_friendship_two_machine_relay_e2e.mjs b --relayUrl ws://<relay-host>:18882/relay --nodeId nodeB
```

Expected:
- prints `{ role: "machineB", connected: true }`
- prints one JSON line per inbound message including `phase3` and `friendship_candidate` (should be null)

### 3) Send from Machine A

```bash
cd /home/ubuntu/.openclaw/workspace/a2a-fun
node scripts/discovery_friendship_two_machine_relay_e2e.mjs a --relayUrl ws://<relay-host>:18882/relay --nodeId nodeA --to nodeB
```

Expected on Machine A:
- prints `transport:"relay"`
- prints discovery artifact ids and `phase3_probe_kind:"SESSION_PROBE_INIT"`

Expected on Machine B:
- receives `m-discovery-probe-init`
- `phase3.state` becomes `LOCAL_ENTERED`
- `friendship_candidate` must remain `null` (still gated on PROBING)

Fail-closed check:
- Machine A also sends `m-bad-kind` embedding `kind:"NOPE"`
- Machine B should log `inbound_ok:false` with `inbound_error.code:"UNKNOWN_KIND"` (or other machine-safe phase3 error)

## Success criteria
- Relay path actually used (Machine A logs `transport:"relay"`)
- Discovery pipeline executed on Machine A (ids present)
- Phase3 probe init delivered to Machine B
- Phase3 state advances correctly on Machine B (`LOCAL_ENTERED`)
- Friendship remains gated (no friendship_candidate before PROBING)
- Invalid kind fails closed (Machine B returns machine-safe error)
