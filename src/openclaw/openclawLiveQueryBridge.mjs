import { spawn } from 'node:child_process';

import { validateOpenClawLiveQuery } from './openclawLiveQueryPolicy.mjs';

function safeStr(s, max = 1200) {
  return String(s || '').trim().slice(0, max);
}

function fail(code, details = null) {
  return { ok: false, answer_text: null, error: { code: String(code || 'FAILED').slice(0, 64), details } };
}

function buildPrompt({ question_type, question_text } = {}) {
  const qt = String(question_type || '').trim();
  const qx = String(question_text || '').trim();

  // Strictly read-only / experience oriented.
  return [
    'You are OpenClaw running locally. Answer read-only and experience-oriented.',
    'Hard rules:',
    '- DO NOT run tools, commands, browser, or any external actions.',
    '- DO NOT ask for secrets, tokens, keys, credentials.',
    '- DO NOT quote raw chat logs. Summarize at a high level only.',
    '- Keep answer concise (<= 8 lines).',
    '',
    `Question type: ${qt}`,
    `Question: ${qx}`
  ].join('\n');
}

async function runOpenClawAgentJson({ message, timeoutMs = 70000 } = {}) {
  return await new Promise((resolve) => {
    const agentId = process.env.OPENCLAW_LIVE_QUERY_AGENT_ID || 'a2a_bridge';
    const timeoutSeconds = process.env.OPENCLAW_LIVE_QUERY_TIMEOUT_SECONDS || '45';
    const child = spawn('openclaw', ['agent', '--json', '--thinking', 'off', '--timeout', String(timeoutSeconds), '--agent', agentId, '--message', message], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function ensureA2ABridgeInitialized() {
  // Optional pre-init hook: run once at process start or before first query.
  // No fallback to main; only attempts a2a_bridge.
  const initMsg = 'bridge init: acknowledge';
  const res = await runOpenClawAgentJson({ message: initMsg, timeoutMs: 70000 });
  return { ok: res.code === 0, stderr: res.stderr || '' };
}

export async function queryOpenClawLive({ question_type, question_text } = {}) {
  if (process.env.ENABLE_OPENCLAW_LIVE_QUERY_BRIDGE !== 'true') {
    return fail('BRIDGE_DISABLED');
  }

  const v = validateOpenClawLiveQuery({ question_type, question_text });
  if (!v.ok) return { ok: false, answer_text: null, error: v.error };

  // Lazy init (best-effort) to ensure a2a_bridge exists before first real query.
  await ensureA2ABridgeInitialized();

  const prompt = buildPrompt({ question_type, question_text });
  const res = await runOpenClawAgentJson({ message: prompt, timeoutMs: 70000 });
  if (res.code !== 0) return fail('OPENCLAW_AGENT_FAILED', safeStr(res.stderr, 800));

  let obj = null;
  try {
    obj = JSON.parse(res.stdout);
  } catch {
    return fail('BAD_OPENCLAW_JSON', safeStr(res.stdout, 800));
  }

  const text = safeStr(obj?.reply || obj?.message || obj?.output || obj?.result?.payloads?.[0]?.text || '', 1200);
  if (!text) return fail('EMPTY_REPLY');

  return {
    ok: true,
    answer_text: text,
    evidence: {
      via: 'openclaw_cli_agent',
      question_type: String(question_type || '').trim()
    },
    error: null
  };
}
