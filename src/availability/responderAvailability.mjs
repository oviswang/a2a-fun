import fs from 'node:fs';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

const mem = new Map(); // node_id -> { last_success_ts: iso, last_task_type: string }
let loadedFrom = null;

function resolveStorePath(dataDir) {
  const dir = safeStr(dataDir);
  if (!dir) return null;
  return path.join(dir, 'responder-availability.json');
}

function loadOnce({ dataDir } = {}) {
  const p = resolveStorePath(dataDir);
  if (!p) return;
  if (loadedFrom === p) return;
  loadedFrom = p;

  try {
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    const j = JSON.parse(raw);
    const nodes = j?.nodes && typeof j.nodes === 'object' ? j.nodes : {};
    for (const [node_id, v] of Object.entries(nodes)) {
      const t = safeStr(v?.last_success_ts);
      if (!t) continue;
      mem.set(String(node_id), { last_success_ts: t, last_task_type: safeStr(v?.last_task_type) || null });
    }
  } catch {
    // best-effort
  }
}

function persistBestEffort({ dataDir } = {}) {
  const p = resolveStorePath(dataDir);
  if (!p) return;

  try {
    const out = { ts: nowIso(), nodes: {} };
    for (const [k, v] of mem.entries()) {
      out.nodes[k] = { last_success_ts: v.last_success_ts, last_task_type: v.last_task_type || null };
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(out, null, 2));
  } catch {
    // best-effort
  }
}

export function recordResponderSuccess({ node_id, task_type, ts, dataDir } = {}) {
  const id = safeStr(node_id);
  const tt = safeStr(task_type);
  const t = safeStr(ts) || nowIso();
  if (!id) return;

  loadOnce({ dataDir });
  mem.set(id, { last_success_ts: t, last_task_type: tt || null });
  persistBestEffort({ dataDir });
}

export function getLastSuccessTs(node_id, { dataDir } = {}) {
  const id = safeStr(node_id);
  if (!id) return null;
  loadOnce({ dataDir });
  const v = mem.get(id);
  return v?.last_success_ts || null;
}

export function availabilityBonus(node_id, { dataDir, windowMs = 30 * 60_000 } = {}) {
  const t = getLastSuccessTs(node_id, { dataDir });
  const ms = Date.parse(String(t || ''));
  if (!Number.isFinite(ms)) return 0;
  return (Date.now() - ms) < Math.max(1_000, Number(windowMs) || 0) ? 1 : 0;
}
