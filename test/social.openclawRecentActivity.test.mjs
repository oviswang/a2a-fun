import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readOpenClawRecentActivity } from '../src/social/openclawRecentActivity.mjs';
import { getAgentRecentActivity } from '../src/social/agentRecentActivity.mjs';

test('openclaw recent activity: valid file loads', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-activity-'));
  const p = path.join(dir, 'recent_activity.json');
  await fs.writeFile(
    p,
    JSON.stringify({
      updated_at: new Date().toISOString(),
      current_focus: 'x',
      recent_tasks: ['a'],
      recent_tools: ['shell'],
      recent_topics: ['relay']
    }),
    'utf8'
  );

  process.env.OPENCLAW_RECENT_ACTIVITY_PATH = p;
  const out = await readOpenClawRecentActivity();
  assert.equal(out.ok, true);
  assert.equal(out.current_focus, 'x');
  assert.deepEqual(out.recent_tasks, ['a']);
});

test('openclaw recent activity: missing file fails closed', async () => {
  process.env.OPENCLAW_RECENT_ACTIVITY_PATH = path.join(os.tmpdir(), 'does-not-exist-' + Math.random() + '.json');
  const out = await readOpenClawRecentActivity();
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'MISSING_FILE');
});

test('openclaw recent activity: invalid json fails closed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-activity-'));
  const p = path.join(dir, 'recent_activity.json');
  await fs.writeFile(p, '{', 'utf8');
  process.env.OPENCLAW_RECENT_ACTIVITY_PATH = p;
  const out = await readOpenClawRecentActivity();
  assert.equal(out.ok, false);
  assert.equal(out.error.code, 'BAD_JSON');
});

test('agentRecentActivity merges openclaw fields when present', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-activity-'));
  const p = path.join(dir, 'recent_activity.json');
  await fs.writeFile(
    p,
    JSON.stringify({
      updated_at: new Date().toISOString(),
      current_focus: 'focus',
      recent_tasks: ['t1'],
      recent_tools: ['shell'],
      recent_topics: ['relay']
    }),
    'utf8'
  );

  process.env.OPENCLAW_RECENT_ACTIVITY_PATH = p;
  const out = await getAgentRecentActivity({ workspace_path: process.cwd() });
  assert.equal(out.ok, true);
  assert.equal(out.openclaw_current_focus, 'focus');
  assert.deepEqual(out.openclaw_recent_tasks, ['t1']);
});
