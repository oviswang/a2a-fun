import { createSocialFeedEvent } from '../social/socialFeedEvent.mjs';

function fail(code) {
  return { ok: false, error: { code: String(code || 'FAILED').slice(0, 64) } };
}

function isFn(x) {
  return typeof x === 'function';
}

export async function runFirstLivePublishFlow({ directory, publishSelf, search, emitSocialFeed, nowIso = '1970-01-01T00:00:00.000Z' } = {}) {
  if (!directory) return fail('MISSING_DIRECTORY');
  if (!isFn(publishSelf)) return fail('MISSING_PUBLISH_SELF');
  if (!isFn(search)) return fail('MISSING_SEARCH');
  if (emitSocialFeed != null && !isFn(emitSocialFeed)) return fail('INVALID_EMIT_SOCIAL_FEED');

  try {
    const published_agents = [];
    const discovered_agents = [];
    const social_events_emitted = [];

    const a = await publishSelf({ agent_id: 'nodeA' });
    if (!a || a.ok !== true) return { ok: false, published_agents, discovered_agents, social_events_emitted, error: a?.error || { code: 'PUBLISH_FAILED' } };
    published_agents.push('nodeA');

    const b = await publishSelf({ agent_id: 'nodeB' });
    if (!b || b.ok !== true) return { ok: false, published_agents, discovered_agents, social_events_emitted, error: b?.error || { code: 'PUBLISH_FAILED' } };
    published_agents.push('nodeB');

    const results = await search({ query: 'openclaw' });
    if (!results || results.ok !== true || !Array.isArray(results.results)) {
      return { ok: false, published_agents, discovered_agents, social_events_emitted, error: results?.error || { code: 'SEARCH_FAILED' } };
    }

    const hit = results.results.find((c) => c && c.agent_id === 'nodeB') || null;
    if (hit) {
      discovered_agents.push(hit.agent_id);

      const evOut = createSocialFeedEvent({
        event_type: 'discovered_agent',
        created_at: nowIso,
        agent_id: 'nodeA',
        peer_agent_id: hit.agent_id,
        summary: 'found via network agent directory search',
        details: { source: 'network_agent_directory' }
      });

      if (evOut.ok && isFn(emitSocialFeed)) {
        await Promise.resolve(emitSocialFeed({ event: evOut.event })).catch(() => {});
        social_events_emitted.push('discovered_agent');
      }
    }

    return { ok: true, published_agents, discovered_agents, social_events_emitted, error: null };
  } catch (e) {
    return { ok: false, published_agents: [], discovered_agents: [], social_events_emitted: [], error: { code: String(e?.code || 'FAILED').slice(0, 64) } };
  }
}
