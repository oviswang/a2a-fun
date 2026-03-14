export function listCapabilities({ registry } = {}) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { ok: false, error: { code: 'INVALID_REGISTRY' } };
  }

  const ids = [];
  for (const k of Object.keys(registry)) {
    if (typeof k !== 'string') continue;
    // Only list string keys; handler types are not enforced by discovery.
    ids.push(k);
  }

  ids.sort((a, b) => String(a).localeCompare(String(b)));
  return { ok: true, capabilities: ids };
}
