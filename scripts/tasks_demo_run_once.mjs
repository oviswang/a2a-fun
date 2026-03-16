#!/usr/bin/env node
import { getTasksPath, loadTasks, acceptTask, markRunning, completeTask, failTask } from '../src/tasks/taskStore.mjs';
import { executeTask } from '../src/tasks/taskExecutor.mjs';

function parseArgs(argv) {
  const out = { holder: 'local-runner', relay_local_http: 'http://127.0.0.1:18884' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--holder') out.holder = argv[++i] || out.holder;
    else if (a === '--relay') out.relay_local_http = argv[++i] || out.relay_local_http;
  }
  return out;
}

const args = parseArgs(process.argv);
const workspace_path = process.env.A2A_WORKSPACE_PATH || process.cwd();
const tasks_path = getTasksPath({ workspace_path });

const loaded = await loadTasks({ tasks_path });
const tasks = loaded.table.tasks;

// Pick the first published task.
const task = tasks.find((t) => t.status === 'published') || null;
if (!task) {
  console.log(JSON.stringify({ ok: true, event: 'NO_PUBLISHED_TASK', tasks_path }, null, 2));
  process.exit(0);
}

const accept = await acceptTask({ tasks_path, task_id: task.task_id, holder: args.holder });
if (!accept.ok) {
  console.log(JSON.stringify({ ok: false, stage: 'accept', error: accept.error }, null, 2));
  process.exit(1);
}

await markRunning({ tasks_path, task_id: task.task_id });

let result = null;
try {
  result = await executeTask({ task, relay_local_http: args.relay_local_http });
  if (result && result.ok) {
    await completeTask({ tasks_path, task_id: task.task_id, result });
  } else {
    await failTask({ tasks_path, task_id: task.task_id, error: result?.error || { code: 'EXEC_FAILED' } });
  }
} catch (e) {
  await failTask({ tasks_path, task_id: task.task_id, error: { code: 'EXEC_THROW', message: String(e?.message || e) } });
}

const after = await loadTasks({ tasks_path });
const final = after.table.tasks.find((t) => t.task_id === task.task_id) || null;

console.log(JSON.stringify({
  ok: !!final && (final.status === 'completed' || final.status === 'failed'),
  tasks_path,
  task_id: task.task_id,
  final_status: final?.status || null,
  result: final?.result || null,
  error: final?.error || null
}, null, 2));
