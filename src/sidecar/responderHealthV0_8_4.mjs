import fs from 'node:fs';
import path from 'node:path';

function nowIso() { return new Date().toISOString(); }
function safeStr(s) { return typeof s === 'string' ? s.trim() : ''; }

const mem = new Map();
let loadedFrom = null;

function resolvePath(dataDir) {
  const d = safeStr(dataDir);
  if (!d) return null;
  return path.join(d, 'responder-health.json');
}

function loadOnce({ dataDir } = {}) {
  const p = resolvePath(dataDir);
  if (!p) return;
  if (loadedFrom === p) return;
  loadedFrom = p;
  try {
    if (!fs.existsSync(p)) return;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const nodes = j?.nodes && typeof j.nodes === 'object' ? j.nodes : {};
    for (const [node_id, v] of Object.entries(nodes)) {
      const events = Array.isArray(v?.events) ? v.events : [];
      mem.set(node_id, { events: events.slice(-80) });
    }
  } catch {}
}

function persistBestEffort({ dataDir } = {}) {
  const p = resolvePath(dataDir);
  if (!p) return;
  try {
    const out = { ts: nowIso(), nodes: {} };
    for (const [k, v] of mem.entries()) out.nodes[k] = { events: (v?.events || []).slice(-80) };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(out, null, 2));
  } catch {}
}

export function recordResponderEvent({ node_id, task_type, kind, ts, dataDir } = {}) {
  const id = safeStr(node_id);
  if (!id) return;
  loadOnce({ dataDir });
  const cur = mem.get(id) || { events: [] };
  cur.events.push({ ts: safeStr(ts) || nowIso(), task_type: safeStr(task_type) || null, kind: safeStr(kind) || 'unknown' });
  cur.events = cur.events.slice(-120);
  mem.set(id, cur);
  persistBestEffort({ dataDir });
}

export function summarizeResponderHealth(node_id, { dataDir, windowMs = 10 * 60_000 } = {}) {
  const id = safeStr(node_id);
  if (!id) return { status: 'unknown', stats: {} };
  loadOnce({ dataDir });
  const cur = mem.get(id);
  const ev = Array.isArray(cur?.events) ? cur.events : [];
  const cutoff = Date.now() - Math.max(60_000, Number(windowMs) || 0);

  const stats = { success: 0, timeout: 0, unsupported: 0, failure: 0 };
  let last_success_ts = null;
  let last_failure_ts = null;

  for (const e of ev) {
    const t = Date.parse(String(e?.ts || ''));
    if (!Number.isFinite(t) || t < cutoff) continue;
    const k = String(e?.kind || 'unknown');
    if (k === 'success') { stats.success++; last_success_ts = e.ts; }
    else if (k === 'timeout') { stats.timeout++; last_failure_ts = e.ts; }
    else if (k === 'unsupported') { stats.unsupported++; last_failure_ts = e.ts; }
    else { stats.failure++; last_failure_ts = e.ts; }
  }

  // Derived status (no permanent blacklist; decays by window)
  let status = 'healthy';
  const bad = stats.timeout + stats.unsupported + stats.failure;
  if (bad >= 4 && stats.success === 0) status = 'unreliable';
  else if (bad >= 2) status = 'degraded';

  return { status, stats, last_success_ts, last_failure_ts };
}
