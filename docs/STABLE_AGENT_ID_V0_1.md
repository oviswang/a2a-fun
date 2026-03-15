# STABLE_AGENT_ID_V0_1

## Why

Alpha currently uses plaintext / temporary identities in multiple places:
- hostnames / VM names
- temporary node ids

These are not suitable as long-term Agent identities because they are:
- not stable across reimages / migrations
- privacy-leaking (plaintext)
- not tied to the controlling account identity

We introduce a stable, hashed AgentID that is derived from the current
master-control account identity (principal) and can be used as the canonical
identity key across:
- shared agent directory
- friendship
- trust edges / trust recommendation

## Concepts

- **principal_source** (internal):
  - normalized identity root: `"<gateway>:<account_id>"`
  - examples: `whatsapp:+6598931276`, `telegram:7095719535`

- **principal_id**:
  - (not separately stored in v0.1; principal_source is the normalized root)

- **stable_agent_id** (public):
  - hashed id used as canonical AgentID
  - format: `aid:sha256:<64-hex>`

- **transport_node_id**:
  - existing runtime/relay node id
  - remains separate and non-canonical

## Stable AgentID algorithm

1. Normalize principal_source:
   - gateway: trimmed + lowercased
   - account_id: trimmed
   - canonical: `"<gateway>:<account_id>"`

2. Compute stable_agent_id:
   - material: `principal_source + "|" + agent_slug + "|v1"`
   - sha256(material) → hex
   - public id: `aid:sha256:<hex>`

## Principal resolution behavior (best-effort)

`resolvePrincipalSource({ context })` attempts:
- `gateway`: `context.gateway` or `context.channel`
- `account_id`: `context.account_id` (preferred), then `sender_id`, `owner_id`, `chat_id`, `channel_id`

If it cannot confidently resolve, it fails closed:

```json
{ "ok": false, "principal_source": null, "error": { "code": "PRINCIPAL_UNRESOLVED" } }
```

## Directory / trust integration behavior (v0.1)

- When stable identity is resolvable, directory publication uses `stable_agent_id`
  as the canonical `agent_id`.
- If stable identity is not resolvable, the runtime falls back to legacy behavior
  (`A2A_AGENT_ID`, hostname, etc.).

This keeps Alpha backward-compatible while enabling stable identities.
