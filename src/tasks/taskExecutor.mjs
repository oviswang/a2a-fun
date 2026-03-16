import { nowIso } from './taskSchema.mjs';
import { computeFingerprint, computeResultHash } from './taskDedup.mjs';
import { executeCapabilityTaskV1 } from './taskCapabilitiesV1.mjs';

async function execQuery(task) {
  const question = String(task?.input?.question || '').trim();
  if (!question) return { ok: false, error: { code: 'MISSING_QUESTION' } };

  // Minimal deterministic response (no LLM): echo back question + timestamp
  return {
    ok: true,
    kind: 'task_result.query.v0.1',
    answered_at: nowIso(),
    question,
    answer: `received: ${question}`
  };
}

async function execFetch(task) {
  const url = String(task?.input?.url || '').trim();
  const max_chars = Number.isFinite(task?.input?.max_chars) ? task.input.max_chars : parseInt(task?.input?.max_chars || '2000', 10);
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: { code: 'INVALID_URL' } };

  const r = await fetch(url, { redirect: 'follow' });
  const text = await r.text();
  const clipped = text.slice(0, Math.max(0, Math.min(max_chars || 2000, 20000)));

  return {
    ok: true,
    kind: 'task_result.fetch.v0.1',
    fetched_at: nowIso(),
    url,
    status: r.status,
    content_type: r.headers.get('content-type'),
    body: clipped
  };
}

async function execRunCheck(task, { relay_local_http = 'http://127.0.0.1:18884' } = {}) {
  const check = String(task?.input?.check || '').trim();
  if (check !== 'relay_health') return { ok: false, error: { code: 'UNSUPPORTED_CHECK' } };

  // Minimal check: fetch relay /nodes and /traces availability
  const out = { ok: true, kind: 'task_result.run_check.v0.1', check, checked_at: nowIso(), relay_local_http, nodes_ok: false, traces_ok: false };
  try {
    const rn = await fetch(`${relay_local_http}/nodes`);
    const jn = await rn.json();
    out.nodes_ok = rn.ok && jn && jn.ok === true;
  } catch {}
  try {
    const rt = await fetch(`${relay_local_http}/traces`);
    const jt = await rt.json();
    out.traces_ok = rt.ok && jt && jt.ok === true;
  } catch {}

  return out;
}

export async function executeTask({ task, relay_local_http } = {}) {
  // Compute and attach fingerprint (deterministic)
  try {
    if (task && typeof task === 'object') task.fingerprint = task.fingerprint || computeFingerprint(task);
  } catch {}

  const type = task?.type;
  let res;
  if (type === 'query') res = await execQuery(task);
  else if (type === 'fetch') res = await execFetch(task);
  else if (type === 'run_check') res = await execRunCheck(task, { relay_local_http });
  else {
    // TASK_CAPABILITIES_V1
    const cap = await executeCapabilityTaskV1({ task, relay_local_http, workspace_path: process.env.A2A_WORKSPACE_PATH || process.cwd() });
    res = cap;
  }

  // Compute result_hash on successful completion
  try {
    if (res && res.ok === true) res.result_hash = computeResultHash(res);
  } catch {}

  return res;
}
