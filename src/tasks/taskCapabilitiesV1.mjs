import { nowIso } from './taskSchema.mjs';

function safeStr(s) {
  return typeof s === 'string' ? s.trim() : '';
}

function limitText(s, maxChars) {
  const n = Math.max(100, Math.min(Number(maxChars) || 2000, 20000));
  return String(s || '').slice(0, n);
}

async function webResearch({ topic, max_chars }) {
  const tp = safeStr(topic);
  if (!tp) return { ok: false, error: { code: 'MISSING_TOPIC' } };

  // Deterministic + bounded: use Brave results only (no LLM). If unavailable, fail gracefully.
  const q = encodeURIComponent(tp);
  const url = `https://r.jina.ai/http://r.jina.ai/https://duckduckgo.com/html/?q=${q}`;
  // Using r.jina.ai as a simple HTML->text proxy; bounded output.
  let text='';
  try {
    const r = await fetch(url);
    text = await r.text();
  } catch {
    return { ok: false, error: { code: 'FETCH_FAILED' } };
  }

  const clipped = limitText(text, max_chars);
  // Minimal summary: first N lines of extracted text.
  const lines = clipped.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 12);

  return {
    ok: true,
    kind: 'task_result.web_research.v0.1',
    topic: tp,
    fetched_at: nowIso(),
    summary: lines.join('\n')
  };
}

async function extractStructuredData({ url, fields }) {
  const u = safeStr(url);
  if (!u || !/^https?:\/\//.test(u)) return { ok: false, error: { code: 'INVALID_URL' } };
  const fs = Array.isArray(fields) ? fields.filter((x) => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];
  if (!fs.length) return { ok: false, error: { code: 'MISSING_FIELDS' } };

  let html = '';
  try {
    const r = await fetch(u, { redirect: 'follow' });
    html = await r.text();
  } catch {
    return { ok: false, error: { code: 'FETCH_FAILED' } };
  }

  const data = {};
  for (const f of fs) {
    if (f === 'title') {
      const m = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
      data.title = m ? m[1].trim() : null;
    } else {
      // Minimal deterministic extractor: look for first occurrence of "<field>" label in text.
      // (v0.1: best-effort placeholder; no semantic parsing)
      const rx = new RegExp(`${f}\\s*[:=]\\s*([^<\\n]{1,120})`, 'i');
      const m = html.replace(/<[^>]+>/g, ' ').match(rx);
      data[f] = m ? m[1].trim() : null;
    }
  }

  return {
    ok: true,
    kind: 'task_result.extract_structured_data.v0.1',
    url: u,
    fetched_at: nowIso(),
    data
  };
}

async function nodeDiagnose({ profile, relay_local_http, workspace_path }) {
  const p = safeStr(profile);
  const relay = safeStr(relay_local_http) || 'http://127.0.0.1:18884';
  const ws = safeStr(workspace_path) || process.cwd();

  const report = { ts: nowIso(), profile: p };

  if (p === 'relay') {
    report.relay_local_http = relay;
    report.nodes = null;
    report.traces_tail = null;
    try {
      const rn = await fetch(`${relay}/nodes`);
      report.nodes = await rn.json();
    } catch {
      report.nodes = { ok: false };
    }
    try {
      const rt = await fetch(`${relay}/traces`);
      const jt = await rt.json();
      const traces = Array.isArray(jt?.traces) ? jt.traces : [];
      report.traces_tail = traces.slice(-20);
    } catch {
      report.traces_tail = null;
    }
  } else if (p === 'runtime') {
    report.env = {
      PORT: process.env.PORT || null,
      NODE_ID: process.env.NODE_ID || null,
      RELAY_URL: process.env.RELAY_URL || null,
      ENABLE_RELAY_INBOUND: process.env.ENABLE_RELAY_INBOUND || null,
      A2A_WORKSPACE_PATH: process.env.A2A_WORKSPACE_PATH || null
    };
  } else if (p === 'task_store') {
    report.tasks_path = `${ws}/data/tasks.json`;
    report.tasks_count = null;
    try {
      const j = JSON.parse(await (await import('node:fs/promises')).readFile(report.tasks_path, 'utf8'));
      report.tasks_count = Array.isArray(j?.tasks) ? j.tasks.length : 0;
    } catch {
      report.tasks_count = null;
    }
  } else {
    return { ok: false, error: { code: 'INVALID_PROFILE' } };
  }

  return {
    ok: true,
    kind: 'task_result.node_diagnose.v0.1',
    profile: p,
    report
  };
}

export async function executeCapabilityTaskV1({ task, relay_local_http, workspace_path } = {}) {
  const type = safeStr(task?.type);
  const input = task?.input && typeof task.input === 'object' ? task.input : {};

  if (type === 'web_research') return webResearch({ topic: input.topic, max_chars: input.max_chars });
  if (type === 'extract_structured_data') return extractStructuredData({ url: input.url, fields: input.fields });
  if (type === 'node_diagnose') return nodeDiagnose({ profile: input.profile, relay_local_http, workspace_path });

  return { ok: false, error: { code: 'NOT_CAPABILITY_V1_TASK' } };
}
