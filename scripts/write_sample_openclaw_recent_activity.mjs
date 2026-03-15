import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function safe(s) {
  return typeof s === 'string' ? s.trim() : '';
}

const override = safe(process.env.OPENCLAW_RECENT_ACTIVITY_PATH);
const file_path = override || path.join(os.homedir(), '.openclaw', 'runtime', 'recent_activity.json');

await fs.mkdir(path.dirname(file_path), { recursive: true });

const payload = {
  updated_at: new Date().toISOString(),
  current_focus: 'relay stability and agent network validation',
  recent_tasks: [
    'restarted relay upstream',
    'validated real activity dialogue',
    'confirmed single-session routing'
  ],
  recent_tools: ['shell', 'file_edit', 'logs'],
  recent_topics: ['relay', 'activity dialogue', 'local memory']
};

await fs.writeFile(file_path, JSON.stringify(payload, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, wrote: true, file_path }));
