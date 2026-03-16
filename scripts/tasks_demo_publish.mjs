#!/usr/bin/env node
import { createTask } from '../src/tasks/taskSchema.mjs';
import { getTasksPath, publishTask } from '../src/tasks/taskStore.mjs';

function parseArgs(argv) {
  const out = { type: 'run_check', topic: 'relay', created_by: 'local', input: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--type') out.type = argv[++i] || out.type;
    else if (a === '--topic') out.topic = argv[++i] || out.topic;
    else if (a === '--created-by') out.created_by = argv[++i] || out.created_by;
    else if (a === '--question') out.input.question = argv[++i] || '';
    else if (a === '--url') out.input.url = argv[++i] || '';
    else if (a === '--max-chars') out.input.max_chars = parseInt(argv[++i] || '2000', 10);
    else if (a === '--check') out.input.check = argv[++i] || 'relay_health';
  }
  if (out.type === 'run_check' && !out.input.check) out.input.check = 'relay_health';
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const tasks_path = getTasksPath({ workspace_path });

const made = createTask({ type: args.type, topic: args.topic, created_by: args.created_by, input: args.input });
if (!made.ok) {
  console.log(JSON.stringify(made, null, 2));
  process.exit(1);
}

const pub = await publishTask({ tasks_path, task: made.task });
console.log(JSON.stringify({
  ok: pub.ok,
  tasks_path,
  task: made.task
}, null, 2));
