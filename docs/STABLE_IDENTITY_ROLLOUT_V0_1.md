# STABLE_IDENTITY_ROLLOUT_V0_1

## Why hostname identity is insufficient

Hostname / VM-name AgentIDs are:
- plaintext + privacy-leaking
- unstable across reimages, migrations, and autoscaling
- not tied to the controlling account identity

## Stable identity recap

- principal_source (internal): `"<gateway>:<account_id>"`
- stable_agent_id (public): `aid:sha256:<hex>`
  - sha256(`principal_source|agent_slug|v1`)

## publish-self behavior (v0.1 rollout)

`POST /agents/publish-self` attempts stable identity resolution:

1) Priority 1 — explicit env vars:
- `A2A_PRINCIPAL_GATEWAY`
- `A2A_PRINCIPAL_ACCOUNT_ID`

2) Priority 2 — runtime context (best-effort):
- provided via request JSON body (either `{context:{...}}` or top-level)
- uses `gateway/channel` + `account_id/chat_id/channel_id`

3) Priority 3 — gateway adapters:
- not implemented in v0.1 (placeholder for future integration)

If resolved:
- directory `agent_id = stable_agent_id`
- response includes: `stable_identity:true`, `legacy_fallback:false`

If unresolved:
- directory `agent_id = legacy id` (`A2A_AGENT_ID` or hostname)
- response includes: `stable_identity:false`, `legacy_fallback:true`

## Logging

publish-self emits one machine-safe JSON line:
- `stable_identity_resolved` with `principal_source` + `stable_agent_id`
- or `stable_identity_unresolved` with `fallback_legacy_agent_id`

## Migration helper

`scripts/migrate_publish_stable_identity.mjs`
- Reads `GET <base_url>/agents`
- Counts stable vs legacy ids
- If principal env vars are provided and the stable id is not present, it republishes THIS node using stable identity.

Compatibility guarantee:
- If stable identity cannot be resolved, existing nodes continue working unchanged.
