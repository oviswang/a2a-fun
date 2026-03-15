import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { extractAgentDiscoveryDocuments } from '../discovery/agentDocumentExtractor.mjs';
import { introspectLocalCapabilities } from '../discovery/agentCapabilityIntrospector.mjs';

function execFileP(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function stableUniqSorted(xs) {
  return [...new Set(xs)].sort((a, b) => a.localeCompare(b));
}

async function latestTranscriptInfo(workspace_path) {
  try {
    const dir = path.join(workspace_path, 'transcripts');
    const names = await fs.readdir(dir);
    const files = [];
    for (const n of names) {
      const p = path.join(dir, n);
      const st = await fs.stat(p).catch(() => null);
      if (!st || !st.isFile()) continue;
      files.push({ name: n, mtimeMs: st.mtimeMs });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return files[0] ? { file: files[0].name, mtime_ms: files[0].mtimeMs } : null;
  } catch {
    return null;
  }
}

async function gitHead(workspace_path) {
  try {
    const r = await execFileP('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspace_path, timeout: 2000 });
    return String(r.stdout || '').trim() || null;
  } catch {
    return null;
  }
}

async function sharedDirectoryAgentCount({ base_url }) {
  try {
    const r = await fetch(`${base_url.replace(/\/$/, '')}/agents`, { method: 'GET' });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    const agents = Array.isArray(j?.agents) ? j.agents : null;
    return agents ? agents.length : null;
  } catch {
    return null;
  }
}

export async function collectAgentEnvironmentReport({
  workspace_path,
  local_base_url = 'http://127.0.0.1:3000',
  shared_directory_base_url = 'https://bootstrap.a2a.fun'
} = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path.trim() : process.cwd();

  // skills_installed: doc skills + best-effort local /capabilities
  let docSkills = [];
  try {
    const docsOut = await extractAgentDiscoveryDocuments({ workspace_path: ws });
    if (docsOut.ok) docSkills = Array.isArray(docsOut.documents?.skills) ? docsOut.documents.skills : [];
  } catch {
    docSkills = [];
  }

  let capSkills = [];
  try {
    const capOut = await introspectLocalCapabilities({ base_url: local_base_url });
    if (capOut.ok) capSkills = capOut.capabilities;
  } catch {
    capSkills = [];
  }

  const skills_installed = stableUniqSorted([
    ...docSkills.map((s) => String(s).trim()).filter(Boolean),
    ...capSkills.map((s) => String(s).trim()).filter(Boolean)
  ]).slice(0, 50);

  return {
    ok: true,
    hostname: os.hostname(),
    workspace_path: ws,
    skills_installed,
    directory_agent_count: await sharedDirectoryAgentCount({ base_url: shared_directory_base_url }),
    recent_activity: {
      git_head: await gitHead(ws),
      latest_transcript: await latestTranscriptInfo(ws)
    }
  };
}
