const ALLOWED_TYPES = new Set([
  'current_focus',
  'recent_tasks',
  'recent_tools',
  'recent_experiments',
  'practical_lessons'
]);

export function validateOpenClawLiveQuery({ question_type, question_text } = {}) {
  const qt = typeof question_type === 'string' ? question_type.trim() : '';
  const qx = typeof question_text === 'string' ? question_text.trim() : '';

  if (!ALLOWED_TYPES.has(qt)) return { ok: false, error: { code: 'QUERY_TYPE_NOT_ALLOWED' } };

  // Keep questions short and non-operational.
  if (!qx) return { ok: false, error: { code: 'MISSING_QUESTION_TEXT' } };
  if (qx.length > 240) return { ok: false, error: { code: 'QUESTION_TOO_LONG' } };

  // Hard deny obvious control / execution intents.
  const deny = [
    'run ', 'execute', 'shell', 'bash', 'sh ', 'sudo', 'rm ', 'cat ', 'curl', 'wget',
    'edit', 'patch', 'config', 'token', 'secret', 'credential', 'key', 'ssh',
    'http://', 'https://', 'file://'
  ];
  const low = qx.toLowerCase();
  if (deny.some((w) => low.includes(w))) return { ok: false, error: { code: 'QUESTION_NOT_SAFE' } };

  return { ok: true, error: null };
}

export function listAllowedOpenClawLiveQueryTypes() {
  return Array.from(ALLOWED_TYPES.values());
}
