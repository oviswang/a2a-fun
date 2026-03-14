# Remote Execution Runtime — Two-Machine Relay E2E

Goal: validate Remote Execution Runtime across **two real machines** using the relay.

## Preconditions

- Both machines have the repo checked out at the same path (or adjust commands):
  - `git clone https://github.com/oviswang/a2a-fun.git`
  - `cd a2a-fun && npm install`

- Choose one machine to run the relay server (can be Machine A or a third host).

## 1) Start relay server

On the relay host:

```bash
node scripts/remote_execution_two_machine_relay_e2e.mjs relay --host 0.0.0.0 --port 18884
```

It prints `relayUrl` like:

- `ws://<relay-host>:18884/relay`

## 2) Start Machine B (executor)

On Machine B:

```bash
node scripts/remote_execution_two_machine_relay_e2e.mjs b \
  --relayUrl ws://<relay-host>:18884/relay \
  --nodeId nodeB \
  --to nodeA
```

Expected: JSON logs indicating `connected:true`.

## 3) Start Machine A (caller)

On Machine A:

```bash
node scripts/remote_execution_two_machine_relay_e2e.mjs a \
  --relayUrl ws://<relay-host>:18884/relay \
  --nodeId nodeA \
  --to nodeB
```

Expected: Machine A logs `transport_used:"relay"` for all sends.

## 4) What to verify in logs

### Success path
- Machine A sends `test:"success"` with `transport_used:"relay"`
- Machine B logs `received_kind:"REMOTE_INVOCATION_REQUEST"` and `entry_ok:true`
- Machine A receives `received_kind:"REMOTE_INVOCATION_RESULT"` with:
  - `invocation_ok:true`
  - `invocation_error:null`

### Unknown handler (fail-closed)
- Machine A sends `test:"unknown_handler"` with `transport_used:"relay"`
- Machine B logs `entry_ok:false` and `entry_error.code:"HANDLER_NOT_FOUND"`
- Machine A receives invocation_result:
  - `invocation_ok:false`
  - `invocation_error.code:"HANDLER_NOT_FOUND"`

### Invalid kind (fail-closed)
- Machine A sends `test:"invalid_kind"` with `transport_used:"relay"`
- Machine B logs `received_kind:"WRONG_KIND"` and `entry_ok:false` with `INVALID_KIND`

### Friendship gate (fail-closed)
- Machine A sends `test:"friendship_gate"` with `transport_used:"relay"`
- Machine B logs `entry_ok:false` with `INVALID_FRIENDSHIP`

## Notes

- This harness forces relay usage by setting an unreachable `peerUrl` and enabling relay.
- No mailbox/orchestration/marketplace behavior is introduced.
