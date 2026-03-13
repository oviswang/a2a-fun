import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDecryptedBodyByType } from '../src/phase2/body/body.schema.mjs';

const V = '0.4.3';

// Minimal legal fixtures per supported type (Phase 2)
const fixtures = {
  'probe.hello': { protocols: ['a2a.friendship/1'], transports: ['webrtc'], languages: ['en'] },
  'probe.question': { q: 'A safe question?' },
  'probe.answer': { a: 'A safe answer.' },
  'probe.summary': { summary: 'Short safe summary.', risk_flags: ['none'], suggested_action: 'ask_human_consent' },
  'probe.done': { done: true },
  'session.close': { reason: 'USER_CLOSE', final: true },
  'error': { code: 'VALIDATION_FAILED', reason: 'SCHEMA' },
  'friendship.establish': { peer_actor_id: 'h:sha256:abc', session_id: 's1', created_at: '2026-03-13T00:00:00Z' }
};

test('BodySchema: minimal legal fixtures validate', () => {
  for (const [type, body] of Object.entries(fixtures)) {
    assert.doesNotThrow(() => validateDecryptedBodyByType({ v: V, type, body }), `type ${type} should validate`);
  }
});

test('BodySchema: probe.hello required/optional semantics + structured constraints + normalization', () => {
  // optional fields may be omitted
  assert.doesNotThrow(() => validateDecryptedBodyByType({
    v: V,
    type: 'probe.hello',
    body: { protocols: ['a2a.friendship/1'] }
  }));

  // schema-valid but unsupported protocol must fail closed
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.discovery/1'] } }),
    /unsupported in Phase 2/
  );

  // non-a2a prefix must fail closed at schema layer
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['x.friendship/1'] } }),
    /pattern/
  );

  // optional fields if present MUST be non-empty arrays
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.friendship/1'], transports: [] } }), /non-empty/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.friendship/1'], languages: [] } }), /non-empty/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: [] } }), /non-empty/);

  // dedupe + sort stable (languages normalize lowercase)
  const body = { protocols: ['A2A.friendship/1', 'a2a.friendship/1'], transports: ['TCP', 'webrtc'], languages: ['ZH', 'en', 'en-US'] };
  validateDecryptedBodyByType({ v: V, type: 'probe.hello', body });
  assert.deepEqual(body.protocols, ['a2a.friendship/1']);
  assert.deepEqual(body.transports, ['tcp', 'webrtc']);
  assert.deepEqual(body.languages, ['en', 'en-us', 'zh']);

  // languages strict subset: allow lang or lang-region only
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.friendship/1'], languages: ['en-us-posix'] } }),
    /pattern/
  );
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.friendship/1'], languages: ['eng'] } }),
    /pattern/
  );
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.friendship/1'], languages: ['en_us'] } }),
    /(pattern|markdown|richtext|whitespace)/
  );

  // maxItems boundary (use repeated supported protocol to avoid support-layer rejection)
  assert.doesNotThrow(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: Array(8).fill('a2a.friendship/1') } }));
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: Array(9).fill('a2a.friendship/1') } }), /too many/);

  // maxItemLen boundary (construct a valid a2a protocol string)
  const p64 = 'a2a.' + 'a'.repeat(58) + '/1'; // length 4 + 58 + 2 = 64
  const p65 = 'a2a.' + 'a'.repeat(59) + '/1';
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: [p64] } }), /unsupported in Phase 2/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: [p65] } }), /too long/);

  // schema-valid but unsupported transport must fail closed
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a.friendship/1'], transports: ['quic'] } }),
    /unsupported in Phase 2/
  );

  // URL / whitespace / markdown / contact-like token
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['https://x.com'] } }), /URL/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['a2a friendship'] } }), /whitespace/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['*md*'] } }), /markdown/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.hello', body: { protocols: ['telegram:@someone'] } }), /(OutboundLint|BodySchema)/);
});

test('BodySchema: safe short text policy shared by probe.summary/probe.question/probe.answer', () => {
  // 160 chars pass, 161 chars fail
  const s160 = 'a'.repeat(160);
  const s161 = 'a'.repeat(161);

  assert.doesNotThrow(() => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: s160 } }));
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: s161 } }), /too long/);

  assert.doesNotThrow(() => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: s160 } }));
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: s161 } }), /too long/);

  assert.doesNotThrow(() => validateDecryptedBodyByType({ v: V, type: 'probe.answer', body: { a: s160 } }));
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.answer', body: { a: s161 } }), /too long/);

  // email / phone / telegram / whatsapp / wechat => fail closed for q/a/summary
  const bad = [
    'email me user@example.com',
    'call +1 415-555-2671',
    'telegram:@someone',
    'whatsapp:+14155552671',
    'wechat:myid'
  ];

  for (const s of bad) {
    assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: s } }), /(BodySchema|OutboundLint)/);
    assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: s } }), /(BodySchema|OutboundLint)/);
    assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.answer', body: { a: s } }), /(BodySchema|OutboundLint)/);
  }

  // URL => fail closed
  const badUrls = ['https://example.com', 'www.example.com', 'example.com/path'];
  for (const s of badUrls) {
    assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: s } }), /URL/);
    assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: s } }), /URL/);
    assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.answer', body: { a: s } }), /URL/);
  }

  // multi-line => fail closed
  const ml = 'line1\nline2';
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: ml } }), /single-line/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: ml } }), /single-line/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.answer', body: { a: ml } }), /single-line/);

  // markdown/rich text => fail closed
  const md = 'hello *world*';
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: md } }), /markdown/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: md } }), /markdown/);
  assert.throws(() => validateDecryptedBodyByType({ v: V, type: 'probe.answer', body: { a: md } }), /markdown/);

  // Mixed bypass variants (a few)
  // - spaced phone should still fail (handled by outbound lint digit normalization)
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.summary', body: { summary: 'reach me at +1 415 555 2671' } }),
    /(OutboundLint|BodySchema)/
  );
  // - messenger marker with spaces
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'probe.question', body: { q: 'telegram : @someone' } }),
    /(OutboundLint|BodySchema)/
  );
});

test('BodySchema: error is machine-safe only (no details/echo/handles)', () => {
  // Disallow unknown fields
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'error', body: { code: 'INTERNAL', reason: 'UNKNOWN', details: 'nope' } }),
    /unknown field/
  );

  // Disallow free-text reason (must be from allowlist)
  assert.throws(
    () => validateDecryptedBodyByType({ v: V, type: 'error', body: { code: 'INTERNAL', reason: 'something long' } }),
    /error\.reason/
  );
});
