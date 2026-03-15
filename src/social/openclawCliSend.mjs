import { spawn } from 'node:child_process';

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function collectLines(raw) {
  return String(raw || '')
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * createOpenClawCliSend()
 *
 * Minimal operational adapter: use the local OpenClaw CLI to send a message
 * through the active gateway runtime.
 *
 * Returns: async ({ gateway, channel_id, message }) => send_result
 */
export function createOpenClawCliSend({ openclawBin = 'openclaw' } = {}) {
  return async function send({ gateway, channel_id, message } = {}) {
    const channel = typeof gateway === 'string' ? gateway.trim().toLowerCase() : '';
    const target = channel_id == null ? '' : String(channel_id).trim();
    const text = typeof message === 'string' ? message : '';

    if (!channel) throw Object.assign(new Error('missing gateway'), { code: 'MISSING_GATEWAY' });
    if (!target) throw Object.assign(new Error('missing channel_id/target'), { code: 'MISSING_TARGET' });
    if (!text.trim()) throw Object.assign(new Error('missing message'), { code: 'MISSING_MESSAGE' });

    const args = ['message', 'send', '--channel', channel, '--target', target, '--message', text, '--json'];

    const out = await new Promise((resolve, reject) => {
      const child = spawn(openclawBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (b) => {
        stdout += b;
      });
      child.stderr.on('data', (b) => {
        stderr += b;
      });

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
      });
    });

    const stdoutTrimmed = String(out.stdout || '').trim();
    const lines = collectLines(out.stdout);

    // openclaw --json may output either a single-line JSON or a pretty multi-line JSON object.
    const parsedWhole = stdoutTrimmed ? safeJsonParse(stdoutTrimmed) : null;
    const parsedLastLine = lines.length > 0 ? safeJsonParse(lines[lines.length - 1]) : null;

    const json = isPlainObject(parsedWhole) ? parsedWhole : isPlainObject(parsedLastLine) ? parsedLastLine : null;

    if (out.code === 0 && json) return json;

    const err = new Error(`openclaw message send failed (exit ${out.code})`);
    err.code = 'OPENCLAW_SEND_FAILED';
    err.details = {
      exit_code: out.code,
      stderr: collectLines(out.stderr).slice(-20).join('\n').slice(0, 2000),
      stdout_tail: lines.slice(-5).join('\n').slice(0, 2000)
    };
    throw err;
  };
}
