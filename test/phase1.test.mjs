import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAccount, makeCanon, deriveActorIdFromCanon } from '../src/identity/canonicalize.mjs';
import { createOutboundLint } from '../src/identity/outboundLint.mjs';
import { ProfileExtractor } from '../src/profile/profileExtractor.mjs';
import { JsonFileStorage } from '../src/storage/jsonStorage.mjs';
import { computeProbeTranscriptHash } from '../src/identity/probeTranscriptHash.mjs';
import { IdentityService } from '../src/identity/identityService.mjs';

test('canonicalization + actor_id vectors (v0.4.3 frozen)', () => {
  const canon1 = makeCanon('whatsapp', normalizeAccount('whatsapp', '+1 415-555-2671'));
  assert.equal(canon1, 'a2a:v1:whatsapp:+14155552671');
  assert.equal(
    deriveActorIdFromCanon(canon1),
    'h:sha256:b0a63061c178f6610666e6ac7e78e9bd51d8d128ec26fe9e398afc249acf1315'
  );

  const canon2 = makeCanon('telegram', normalizeAccount('telegram', '@Example_User'));
  assert.equal(canon2, 'a2a:v1:telegram:example_user');
  assert.equal(
    deriveActorIdFromCanon(canon2),
    'h:sha256:cfcf5b33ae2832f9a56a2680c866f2de05c8d604e15df86f43425de0781800d2'
  );

  // telegram must not start with digit
  assert.throws(() => normalizeAccount('telegram', '1abcde'), /telegram username/);

  const canonUtf8 = 'a2a:v1:email:用户@例子.公司';
  assert.equal(
    deriveActorIdFromCanon(canonUtf8),
    'h:sha256:4db52b7042a37b76161a340ee2da30d45d88c0f5429bd063e1debaa8ced7da44'
  );
});

test('OutboundLint is recursive and checks keys + values', () => {
  const lint = createOutboundLint();
  assert.throws(
    () => lint.assertNoRawHandle({ ok: true, contact: 'user@example.com' }),
    /OutboundLint/
  );
  assert.throws(
    () => lint.assertNoRawHandle({ 'email:me@example.com': 1 }),
    /OutboundLint/
  );
  assert.throws(
    () => lint.assertNoRawHandle(['hi', { nested: '+14155552671' }]),
    /OutboundLint/
  );
});

test('ProfileExtractor defaults agent_label and enforces lint (via IdentityService)', () => {
  const identity = new IdentityService({ keyPath: './data/test-identity-key-2.json' });
  const pe = new ProfileExtractor({ identityService: identity });

  const p = pe.extractLocalProbeProfile({ languages: ['EN', 'zh'], extra_field: 'x' });
  assert.equal(p.agent_label, 'Local Agent');
  assert.deepEqual(p.languages, ['en', 'zh']);
  assert.deepEqual(p.redaction_report, { dropped_fields: ['extra_field'], notes: [] });

  // Default strictLocalProfileLint=false: localContext may contain contact-like strings in dropped fields,
  // but they must NOT appear in output (sanitize + output whitelist).
  const p2 = pe.extractLocalProbeProfile({ languages: ['en'], bio: 'user@example.com' });
  assert.deepEqual(p2.redaction_report, { dropped_fields: ['bio'], notes: [] });

  // Output-facing lint still applies.
  assert.throws(
    () => pe.extractLocalProbeProfile({ agent_label: 'Contact me @someone' }),
    /OutboundLint/
  );

  // When strictLocalProfileLint=true, localContext lint fails closed.
  const peStrict = new ProfileExtractor({ identityService: identity, strictLocalProfileLint: true });
  assert.throws(
    () => peStrict.extractLocalProbeProfile({ languages: ['en'], bio: 'user@example.com' }),
    /OutboundLint/
  );
});

test('ProfileExtractor treats peerBody as hostile input (keys + values + nesting)', () => {
  const identity = new IdentityService({ keyPath: './data/test-identity-key-3.json' });
  const pe = new ProfileExtractor({ identityService: identity });

  // Safe extra fields are dropped (but allowed to parse) and recorded.
  const ok = pe.extractPeerProbeProfile({ languages: ['en'], foo: 'bar' });
  assert.deepEqual(ok.redaction_report, { dropped_fields: ['foo'], notes: [] });

  // Email in value MUST fail closed.
  assert.throws(
    () => pe.extractPeerProbeProfile({ languages: ['en'], bio: 'user@example.com' }),
    /OutboundLint/
  );

  // Phone in nested value
  assert.throws(
    () => pe.extractPeerProbeProfile({ languages: ['en'], nested: { contact: '+14155552671' } }),
    /OutboundLint/
  );

  // Telegram/WhatsApp/WeChat markers in value
  assert.throws(
    () => pe.extractPeerProbeProfile({ languages: ['en'], note: 'telegram:@someone' }),
    /OutboundLint/
  );
  assert.throws(
    () => pe.extractPeerProbeProfile({ languages: ['en'], note: 'whatsapp:+14155552671' }),
    /OutboundLint/
  );
  assert.throws(
    () => pe.extractPeerProbeProfile({ languages: ['en'], note: 'wechat:myid' }),
    /OutboundLint/
  );

  // Contact info in KEY name (keys are checked)
  assert.throws(
    () => pe.extractPeerProbeProfile({ 'email:me@example.com': 'x' }),
    /OutboundLint/
  );
});

test('ProfileExtractor output stability: structure + key order + redaction_report stability', () => {
  const identity = new IdentityService({ keyPath: './data/test-identity-key-4.json' });
  const pe = new ProfileExtractor({ identityService: identity });

  const input = {
    agent_label: 'Local Agent',
    languages: ['EN', 'zh'],
    conversation_mode: 'async',
    no_sensitive_topics: true,
    protocols: ['a2a.friendship/1'],
    transports: ['webrtc'],
    zzz: 'dropme'
  };

  const a = pe.extractLocalProbeProfile(input);
  const b = pe.extractLocalProbeProfile(input);

  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a), [
    'agent_label',
    'languages',
    'conversation_prefs',
    'safety_prefs',
    'capabilities',
    'redaction_report'
  ]);
  assert.deepEqual(Object.keys(a.redaction_report), ['dropped_fields', 'notes']);
  assert.deepEqual(a.redaction_report.dropped_fields, ['zzz']);
});

test('Storage friends keyed by peer_actor_id; peer_key_fpr nullable', () => {
  const s = new JsonFileStorage({ path: './data/testdb.json' });
  const f = s.upsertFriend('h:sha256:abc', { notes: 'x' });
  assert.equal(f.peer_actor_id, 'h:sha256:abc');
  assert.equal(f.peer_key_fpr, null);
  const f2 = s.getFriend('h:sha256:abc');
  assert.equal(f2.notes, 'x');
});

test('probe_transcript_hash uses decoded ciphertext_len bytes', () => {
  const session_id = 's1';
  const e1 = {
    v: '0.4.3',
    type: 'probe.hello',
    msg_id: 'm1',
    session_id,
    ts: '2026-03-13T00:00:00Z',
    from: { actor_id: 'h:sha256:a', key_fpr: 'k1' },
    to: { actor_id: 'h:sha256:b', key_fpr: 'k2' },
    crypto: { enc: 'aead', kdf: 'x', nonce: 'AA==' },
    body: { ciphertext: Buffer.from('abc', 'utf8').toString('base64') }
  };
  const { items } = computeProbeTranscriptHash(session_id, [e1]);
  assert.equal(items[0].ciphertext_len, 3);
});

test('IdentityService façade: derives actor_id, manages keypair, lints outbound, agent_label defaults', () => {
  const svc = new IdentityService({ keyPath: './data/test-identity-key.json' });

  const r = svc.deriveActorId({ provider: 'whatsapp', account: '+1 415-555-2671' });
  assert.equal(r.actor_id, 'h:sha256:b0a63061c178f6610666e6ac7e78e9bd51d8d128ec26fe9e398afc249acf1315');
  assert.ok(!('canon' in r));
  assert.ok(!('normalized_account' in r));

  const label = svc.makeAgentLabel('');
  assert.equal(label, 'Local Agent');
  assert.throws(() => svc.makeAgentLabel('email me test@example.com'), /OutboundLint/);

  const kp = svc.getOrCreateIdentityKeypair();
  assert.ok(kp.publicKeyPem.includes('BEGIN PUBLIC KEY'));
  assert.ok(kp.keyFpr.startsWith('sha256:'));
});
