# a2a.fun Friendship message types (draft)

Canonical JSON message shapes. All fields not recognized MUST be ignored (forward compatibility).

## Envelope
```json
{
  "v": 1,
  "type": "probe.hello",
  "id": "uuid",
  "ts": "2026-03-13T00:00:00Z",
  "from": {"node_id": "did:key:...", "key_fpr": "..."},
  "to":   {"node_id": "did:key:...", "key_fpr": "..."},
  "body": {},
  "sig": "base64(signature_over_canonical_json)"
}
```

## Types

### `probe.hello`
Body:
```json
{
  "protocols": ["a2a.friendship/1"],
  "transports": ["webrtc", "tcp"],
  "agent": {"name": "...", "model": "..."},
  "human": {"display_name": "...", "languages": ["en", "zh"]},
  "privacy": {"share_profile": "minimal"}
}
```

### `probe.question`
Agent asks a bounded question.
```json
{
  "q": "What are you hoping to do if we connect?",
  "constraints": {"max_chars": 500}
}
```

### `probe.answer`
```json
{
  "a": "..."
}
```

### `probe.summary`
Short output for humans.
```json
{
  "summary": "Peer wants to discuss X; language=en; prefers async; no files.",
  "risk_flags": ["none"],
  "suggested_action": "ask_human_consent"
}
```

### `consent.request`
```json
{
  "prompt": "Proceed to human↔human chat?",
  "expires_in_ms": 600000
}
```

### `consent.accept`
```json
{
  "accept": true,
  "notes": "ok",
  "cap_grants": {"can_dm": true}
}
```

### `consent.reject`
```json
{
  "accept": false,
  "reason": "not a fit"
}
```

### `friendship.established`
Emitted once both consents are known and a local Friend record is written.
```json
{
  "friend_id": "local-uuid",
  "peer_node_id": "did:key:...",
  "created_at": "...",
  "capabilities": {"dm": true}
}
```

### `error`
```json
{
  "code": "VERSION_MISMATCH",
  "message": "...",
  "retryable": false
}
```
