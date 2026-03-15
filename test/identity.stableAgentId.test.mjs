import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePrincipalSource, computeStableAgentId, isStableAgentId } from '../src/identity/stableAgentId.mjs';

test('normalizePrincipalSource: deterministic and normalized "gateway:account"', () => {
  const out = normalizePrincipalSource({ gateway: ' WhatsApp ', account_id: ' +6598931276 ' });
  assert.equal(out.ok, true);
  assert.equal(out.principal_source, 'whatsapp:+6598931276');
});

test('computeStableAgentId: deterministic, stable format, does not expose plaintext principal', () => {
  const principal_source = 'telegram:123456789';
  const a = computeStableAgentId({ principal_source, agent_slug: 'default' });
  const b = computeStableAgentId({ principal_source, agent_slug: 'default' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.stable_agent_id, b.stable_agent_id);
  assert.equal(isStableAgentId(a.stable_agent_id), true);
  // The public ID must not contain the plaintext principal.
  assert.equal(a.stable_agent_id.includes('telegram'), false);
  assert.equal(a.stable_agent_id.includes('123456789'), false);
});

test('isStableAgentId: validates exact aid:sha256:<64hex>', () => {
  assert.equal(isStableAgentId('aid:sha256:' + 'a'.repeat(64)), true);
  assert.equal(isStableAgentId('aid:sha256:' + 'A'.repeat(64)), false);
  assert.equal(isStableAgentId('aid:sha256:' + 'a'.repeat(63)), false);
  assert.equal(isStableAgentId('x'), false);
});

test('stableAgentId: invalid inputs fail closed', () => {
  assert.equal(normalizePrincipalSource({ gateway: '', account_id: 'x' }).ok, false);
  assert.equal(normalizePrincipalSource({ gateway: 'wa', account_id: '' }).ok, false);
  assert.equal(computeStableAgentId({ principal_source: '', agent_slug: 'default' }).ok, false);
  assert.equal(computeStableAgentId({ principal_source: 'wa:+1', agent_slug: '' }).ok, false);
});
