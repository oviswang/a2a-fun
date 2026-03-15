import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function isStringArray(x, max = 20) {
  if (!Array.isArray(x)) return false;
  if (x.length > max) return false;
  return x.every((v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200);
}

function defaultPath() {
  return path.join(os.homedir(), '.openclaw', 'runtime', 'recent_activity.json');
}

function pickPath() {
  const override = safeStr(process.env.OPENCLAW_RECENT_ACTIVITY_PATH);
  return override || defaultPath();
}

export async function readOpenClawRecentActivity({ file_path } = {}) {
  const p = safeStr(file_path) || pickPath();

  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch {
    return { ok: false, updated_at: null, current_focus: null, recent_tasks: [], recent_tools: [], recent_topics: [], error: { code: 'MISSING_FILE', path: p } };
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, updated_at: null, current_focus: null, recent_tasks: [], recent_tools: [], recent_topics: [], error: { code: 'BAD_JSON', path: p } };
  }

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, updated_at: null, current_focus: null, recent_tasks: [], recent_tools: [], recent_topics: [], error: { code: 'INVALID_SHAPE', path: p } };
  }

  const updated_at = safeStr(json.updated_at);
  if (!updated_at) {
    return { ok: false, updated_at: null, current_focus: null, recent_tasks: [], recent_tools: [], recent_topics: [], error: { code: 'INVALID_UPDATED_AT', path: p } };
  }

  const t = Date.parse(updated_at);
  if (!Number.isFinite(t)) {
    return { ok: false, updated_at: null, current_focus: null, recent_tasks: [], recent_tools: [], recent_topics: [], error: { code: 'INVALID_UPDATED_AT', path: p } };
  }

  const current_focus = safeStr(json.current_focus) || null;

  const recent_tasks = isStringArray(json.recent_tasks, 20) ? json.recent_tasks.map((s) => s.trim()) : [];
  const recent_tools = isStringArray(json.recent_tools, 20) ? json.recent_tools.map((s) => s.trim()) : [];
  const recent_topics = isStringArray(json.recent_topics, 20) ? json.recent_topics.map((s) => s.trim()) : [];

  return {
    ok: true,
    updated_at,
    current_focus,
    recent_tasks,
    recent_tools,
    recent_topics,
    error: null
  };
}
