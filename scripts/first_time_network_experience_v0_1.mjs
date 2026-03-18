#!/usr/bin/env node
/**
 * First-time user network experience (V0.1)
 * Human experience layer: immediate, visual, best-effort.
 * Data sources:
 * - bootstrap peers: global count + country distribution
 * - local gossip presence cache: real-time active peers
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function flagFromCc(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '🌍';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(A + (c.charCodeAt(0) - a), A + (c.charCodeAt(1) - a));
}

function countryNameFromCc(cc) {
  const c = String(cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return 'Unknown';
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(c) || c;
  } catch {
    return c;
  }
}

async function readJsonSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function fetchJson(url, { timeoutMs = 1200 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ac.signal });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) {
    return { ok: false, status: 0, json: null, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function pickCountryCodeFromPeer(peer) {
  const addrs = Array.isArray(peer?.observed_addrs) ? peer.observed_addrs : [];
  for (const a of addrs) {
    if (!a || typeof a !== 'object') continue;
    const cc = a.country_code ? String(a.country_code).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(cc)) return cc;
    const r = a.region ? String(a.region).trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(r)) return r;
  }
  return null;
}

function sortIds(xs) {
  return [...xs].sort((a, b) => String(a).localeCompare(String(b)));
}

async function main() {
  const ws = process.env.A2A_WORKSPACE_PATH ? String(process.env.A2A_WORKSPACE_PATH).trim() : process.cwd();
  const selfNodeId = String(process.env.NODE_ID || process.env.A2A_AGENT_ID || '').trim() || null;

  const base = String(process.env.BOOTSTRAP_BASE_URL || 'https://bootstrap.a2a.fun').replace(/\/$/, '');
  const peersUrl = `${base}/peers`;

  // 1) Bootstrap peers
  const boot = await fetchJson(peersUrl, { timeoutMs: 1200 });
  const peers = Array.isArray(boot.json?.peers) ? boot.json.peers : [];
  const nodeIds = sortIds([...new Set(peers.map((p) => p?.node_id).filter(Boolean))]);

  const totalNodes = nodeIds.length;

  // Country distribution (bootstrap-derived country_code preferred)
  const byCc = new Map();
  for (const p of peers) {
    const cc = pickCountryCodeFromPeer(p) || 'unknown';
    byCc.set(cc, (byCc.get(cc) || 0) + 1);
  }

  const countries = [...byCc.entries()]
    .map(([cc, count]) => ({ cc, count }))
    .sort((a, b) => b.count - a.count || String(a.cc).localeCompare(String(b.cc)));

  // Self info
  const selfIndex = selfNodeId ? nodeIds.indexOf(selfNodeId) : -1;
  const selfPeer = selfNodeId ? peers.find((p) => p?.node_id === selfNodeId) : null;
  const selfCc = (selfPeer && pickCountryCodeFromPeer(selfPeer)) || String(process.env.COUNTRY_CODE || '').trim().toUpperCase() || null;

  // 2) Live peers from gossip presence cache
  const presenceCachePath = path.join(ws, 'data', 'presence-cache.json');
  const presenceActiveWindowMs = Number(process.env.PRESENCE_ACTIVE_WINDOW_MS || 120_000);
  const pc = await readJsonSafe(presenceCachePath);
  const gossipPeersRaw = pc && pc.peers && typeof pc.peers === 'object' ? Object.values(pc.peers) : [];

  const live = gossipPeersRaw
    .map((x) => {
      const node_id = String(x?.peer_id || '').trim();
      if (!node_id) return null;
      const ts = x?.last_presence_ts || null;
      const ageMs = ts ? Date.now() - Date.parse(ts) : NaN;
      const active = Number.isFinite(ageMs) && ageMs <= presenceActiveWindowMs;
      const cc = x?.country_code ? String(x.country_code).trim().toUpperCase() : null;
      return { node_id, ts, ageMs, active, cc };
    })
    .filter(Boolean)
    .sort((a, b) => (a.ageMs ?? 1e18) - (b.ageMs ?? 1e18));

  const liveActive = live.filter((x) => x.active).slice(0, 8);

  // 3) Render
  const lines = [];
  lines.push('🌐 A2A NETWORK ONLINE');
  lines.push('');
  lines.push(`Total nodes: ${typeof totalNodes === 'number' ? totalNodes : 'unknown'}`);
  lines.push('');

  // Country distribution (top 8)
  for (const c of countries.slice(0, 8)) {
    const cc = c.cc === 'unknown' ? null : c.cc;
    const flag = cc ? flagFromCc(cc) : '🌍';
    const name = cc ? countryNameFromCc(cc) : 'Unknown';
    lines.push(`${flag} ${name}: ${c.count}`);
  }

  lines.push('');
  lines.push(`You are node #${selfIndex >= 0 ? selfIndex + 1 : '?'}`);
  lines.push(`Your location: ${selfCc && /^[A-Z]{2}$/.test(selfCc) ? `${flagFromCc(selfCc)} ${countryNameFromCc(selfCc)}` : '🌍 Unknown'}`);
  lines.push('');

  lines.push('🟢 Recently active peers:');
  lines.push('');
  if (!liveActive.length) {
    lines.push('- (no recent gossip presence yet — network will populate as peers talk)');
  } else {
    for (const p of liveActive) {
      const sec = Number.isFinite(p.ageMs) ? Math.max(0, Math.round(p.ageMs / 1000)) : null;
      const cc = p.cc && /^[A-Z]{2}$/.test(p.cc) ? p.cc : null;
      const flag = cc ? flagFromCc(cc) : '🌍';
      lines.push(`- ${p.node_id} (${flag}) — ACTIVE (${sec ?? '?'}s ago)`);
    }
  }

  lines.push('');
  lines.push('⚡ This is a live peer-to-peer network.');

  // Best-effort: always print something.
  console.log(lines.join('\n'));
}

await main().catch(() => {
  console.log('🌐 A2A NETWORK ONLINE\n\nTotal nodes: unknown\n\n🌍 Unknown: unknown\n\nYou are node #?\nYour location: 🌍 Unknown\n\n🟢 Recently active peers:\n\n- (unavailable)\n\n⚡ This is a live peer-to-peer network.');
});
