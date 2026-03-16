import crypto from 'node:crypto';

function safeObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

function stableStringify(obj) {
  // deterministic stringify: sort keys recursively
  const seen = new WeakSet();
  const norm = (v) => {
    if (v === null) return null;
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return null;
    seen.add(v);
    if (Array.isArray(v)) return v.map(norm);
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = norm(v[k]);
    return o;
  };
  return JSON.stringify(norm(obj));
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

export function computeFingerprint(task) {
  const t = safeObj(task);
  const type = String(t.type || '').trim();
  const normalized_input = safeObj(t.input);
  const body = stableStringify({ type, normalized_input });
  return `sha256:${sha256Hex(body)}`;
}

export function computeResultHash(result) {
  const body = stableStringify(result ?? null);
  return `sha256:${sha256Hex(body)}`;
}

export function shouldSkipExecution({ task } = {}) {
  if (!task || typeof task !== 'object') return { ok: false, skip: false, reason: 'INVALID_TASK' };
  const fp = computeFingerprint(task);
  const completed = task.status === 'completed';
  const matches = completed && typeof task.fingerprint === 'string' && task.fingerprint === fp;
  return { ok: true, skip: !!matches, fingerprint: fp, reason: matches ? 'completed_fingerprint_match' : null };
}

export function handleDuplicateResult({ localTask, incomingFinalStatus, incomingResult, incomingResultHash } = {}) {
  const lt = localTask && typeof localTask === 'object' ? localTask : null;
  if (!lt) return { ok: false, action: 'no_local_task' };

  if (lt.status === 'completed') {
    const localHash = lt.result_hash || null;
    const inHash = incomingResultHash || computeResultHash(incomingResult);

    if (localHash && inHash && localHash === inHash) {
      return { ok: true, action: 'ignore', log: 'DUPLICATE_TASK_RESULT_IGNORED' };
    }

    return { ok: true, action: 'conflict', log: 'DUPLICATE_TASK_RESULT_CONFLICT' };
  }

  // not completed locally: allow apply
  return { ok: true, action: 'apply', log: null };
}
