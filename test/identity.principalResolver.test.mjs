import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePrincipalSource } from '../src/identity/principalResolver.mjs';
import { resolveStableAgentIdentity } from '../src/identity/stableIdentityRuntime.mjs';

test('resolvePrincipalSource: resolves from context.channel + context.chat_id', () => {
  const out = resolvePrincipalSource({ context: { channel: 'telegram', chat_id: '7095719535' } });
  assert.equal(out.ok, true);
  assert.equal(out.principal_source, 'telegram:7095719535');
});

test('resolvePrincipalSource: unresolved when missing fields', () => {
  const out = resolvePrincipalSource({ context: { chat_id: 'x' } });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'PRINCIPAL_UNRESOLVED');
});

test('resolveStableAgentIdentity: computes stable_agent_id when principal resolvable', () => {
  const out = resolveStableAgentIdentity({ context: { gateway: 'whatsapp', account_id: '+6598931276' } });
  assert.equal(out.ok, true);
  assert.equal(/^aid:sha256:[0-9a-f]{64}$/.test(out.stable_agent_id), true);
});
