import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSocialFeedReply } from '../src/social/socialFeedReplyParser.mjs';

test('reply parser: handles 1/2/3', () => {
  assert.deepEqual(parseSocialFeedReply({ text: '1' }), { ok: true, action: 'continue' });
  assert.deepEqual(parseSocialFeedReply({ text: ' 2 ' }), { ok: true, action: 'join' });
  assert.deepEqual(parseSocialFeedReply({ text: '3\n' }), { ok: true, action: 'skip' });
});

test('reply parser: invalid reply fails closed', () => {
  const out = parseSocialFeedReply({ text: 'x' });
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'INVALID_REPLY');
});
