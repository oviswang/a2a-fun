import test from 'node:test';
import assert from 'node:assert/strict';

import { validateOpenClawLiveQuery } from '../src/openclaw/openclawLiveQueryPolicy.mjs';

test('policy allows supported type with safe question', () => {
  const out = validateOpenClawLiveQuery({ question_type: 'current_focus', question_text: 'What is your current focus?' });
  assert.equal(out.ok, true);
});

test('policy denies unsafe question', () => {
  const out = validateOpenClawLiveQuery({ question_type: 'current_focus', question_text: 'run bash rm -rf /' });
  assert.equal(out.ok, false);
});
