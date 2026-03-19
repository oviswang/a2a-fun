function norm(s) {
  return String(s || '').trim();
}

function lc(s) {
  return norm(s).toLowerCase();
}

/**
 * Intent → task mapping.
 * Output shape:
 * {
 *   ok: true,
 *   intent: string,
 *   task: string,
 *   args: object
 * }
 */
export function mapTextToTask({ text } = {}) {
  const t = norm(text);
  const l = lc(text);

  if (!t) return { ok: true, intent: 'empty', task: 'help', args: {} };

  // Universal health checks
  if (l === 'ping' || l === '/ping' || l === 'pong?') {
    return { ok: true, intent: 'ping', task: 'ping', args: {} };
  }

  // Chinese examples from spec
  if (t.includes('检查状态') || l === 'status' || l === '/status' || t === '帮我检查状态') {
    return { ok: true, intent: 'runtime_status', task: 'runtime_status', args: {} };
  }
  if (t.includes('找节点') || t === '帮我找节点' || t.includes('network_snapshot')) {
    return { ok: true, intent: 'network_snapshot', task: 'network_snapshot', args: {} };
  }
  if (t.includes('干点事') || t.includes('帮我干点事') || t.includes('帮我做点事')) {
    return { ok: true, intent: 'a2a_request_help', task: 'help', args: { hint: t } };
  }

  // Help
  if (l === 'help' || l === '/help' || t === '帮助') {
    return { ok: true, intent: 'help', task: 'help', args: {} };
  }

  return { ok: true, intent: 'freeform', task: 'help', args: { hint: t } };
}
