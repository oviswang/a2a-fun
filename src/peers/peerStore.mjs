import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, 'utf8'));
}

async function writeJsonAtomic(p, obj) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}

export function getPeersPath({ workspace_path } = {}) {
  const ws = typeof workspace_path === 'string' && workspace_path.trim() ? workspace_path : process.cwd();
  return path.join(ws, 'data', 'peers.json');
}

export async function loadPeers({ peers_path } = {}) {
  try {
    const obj = await readJson(peers_path);
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.peers)) {
      return { ok: true, peers_path, table: { ok: true, version: 'peers.v0.1', updated_at: null, peers: [] } };
    }
    return { ok: true, peers_path, table: obj };
  } catch {
    return { ok: true, peers_path, table: { ok: true, version: 'peers.v0.1', updated_at: null, peers: [] } };
  }
}

export async function savePeers({ peers_path, table } = {}) {
  const t = table && typeof table === 'object' ? table : { ok: true, version: 'peers.v0.1', updated_at: null, peers: [] };
  await writeJsonAtomic(peers_path, t);
  return { ok: true, peers_path };
}
