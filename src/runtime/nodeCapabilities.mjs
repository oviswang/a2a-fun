import fs from 'node:fs/promises';
import path from 'node:path';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

export function getNodeCapabilitiesPath({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  return path.join(ws, 'node_capabilities.json');
}

export async function loadNodeCapabilities({ workspace_path } = {}) {
  const p = getNodeCapabilitiesPath({ workspace_path });
  try {
    const j = JSON.parse(await fs.readFile(p, 'utf8'));
    const caps = Array.isArray(j?.capabilities)
      ? j.capabilities.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
      : [];
    return { ok: true, path: p, capabilities: caps };
  } catch {
    return { ok: true, path: p, capabilities: [] };
  }
}

export function taskMatchesCapabilities({ task, capabilities } = {}) {
  const caps = Array.isArray(capabilities) ? new Set(capabilities.map(safeStr).filter(Boolean)) : new Set();
  const req = Array.isArray(task?.requires) ? task.requires.map(safeStr).filter(Boolean) : [];
  if (!req.length) return { ok: true, match: true, reason: 'no_requires' };
  const missing = req.filter((r) => !caps.has(r));
  if (missing.length) return { ok: true, match: false, reason: 'missing_capabilities', missing };
  return { ok: true, match: true, reason: 'all_requirements_met' };
}
