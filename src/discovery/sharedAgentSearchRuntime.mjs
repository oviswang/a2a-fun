import { searchPublishedAgentsRemote } from './sharedAgentDirectoryClient.mjs';

function nonEmptyString(x) {
  return typeof x === 'string' && x.trim() !== '';
}

function fail(code) {
  return { ok: false, results: [], error: { code: String(code || 'FAILED').slice(0, 64) } };
}

export async function searchSharedAgentDirectory({ base_url, query } = {}) {
  if (!nonEmptyString(base_url)) return fail('INVALID_BASE_URL');
  if (typeof query !== 'string') return fail('INVALID_QUERY');

  return searchPublishedAgentsRemote({ base_url: base_url.trim(), query });
}
