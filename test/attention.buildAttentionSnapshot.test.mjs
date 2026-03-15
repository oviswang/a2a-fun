import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildAttentionSnapshot } from '../src/attention/buildAttentionSnapshot.mjs';

test('attention snapshot: uses openclaw focus when present', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attn-'));
  const p = path.join(dir, 'recent_activity.json');
  await fs.writeFile(p, JSON.stringify({
    updated_at: new Date().toISOString(),
    current_focus: 'relay stability',
    recent_tasks: ['restart relay'],
    recent_tools: ['shell'],
    recent_topics: ['relay']
  }), 'utf8');

  process.env.OPENCLAW_RECENT_ACTIVITY_PATH = p;
  const out = await buildAttentionSnapshot({ workspace_path: process.cwd(), agent_id: 'nodeA' });
  assert.equal(out.ok, true);
  assert.equal(out.snapshot.current_problem, 'relay stability');
  assert.ok(out.snapshot.attention_score >= 5);
});
