# a2a.fun Friendship Node security notes (draft)

## Threat model (what can go wrong)
- **Impersonation**: attacker claims to be a known friend.
- **Spam / unwanted probes**: repeated connection attempts.
- **Prompt injection / tool abuse**: peer messages attempt to cause unsafe tool actions.
- **Privacy leakage**: probe reveals personal details unnecessarily.
- **Replay**: old consent/establish messages replayed.
- **Key rotation confusion**: friend’s key changes and user is tricked.

## Controls (minimum viable)

### Identity & authenticity
- Use a stable node identifier (recommended: DID based on public key).
- Sign every envelope (`sig`) over canonical JSON.
- Include monotonic `ts` + `id`; reject duplicates (dedupe cache).

### Consent gating
- Never escalate on agent decision alone.
- Require explicit local human confirmation *and* remote human confirmation.
- Bind consent to the probe session: include `session_id` / transcript hash in consent body.

### Safe parsing / tool sandboxing
- Treat all peer-provided text as untrusted.
- Forbid tools during probe unless explicitly allowed by local policy.
- Keep a strict allowlist of actions that the probe agent can perform.

### Spam resistance
Pick one (can iterate later):
- Invite tokens (QR/copy link) only
- Rate limit per peer IP/key
- Lightweight proof-of-work in `probe.hello`

### Data handling
- Store full transcripts locally encrypted at rest (optional in MVP, but design for it).
- Expose redacted summaries by default.
- Provide user controls: delete peer, delete transcript, export friendship list.

### Key change ceremony
- If a known peer’s long-term key changes, mark as `KEY_CHANGED_PENDING`.
- Require out-of-band verification (e.g., compare fingerprints verbally) before restoring `FRIENDS`.

## Non-goals
- Central moderation.
- Central reputation system.
