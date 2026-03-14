import { createNetworkAgentDirectory, publishAgentCard, searchPublishedAgents } from '../src/discovery/networkAgentDirectory.mjs';
import { createNetworkAgentDirectoryEntry } from '../src/discovery/networkAgentDirectoryEntry.mjs';
import { runFirstLivePublishFlow } from '../src/discovery/firstLivePublishFlow.mjs';
import { formatSocialFeedMessage } from '../src/social/socialFeedFormatter.mjs';

function mkCard(agent_id, name, summary) {
  return {
    agent_id,
    name,
    mission: '',
    summary,
    skills: [],
    tags: [],
    services: [],
    examples: []
  };
}

const directory = createNetworkAgentDirectory();

async function publishSelf({ agent_id }) {
  const card = agent_id === 'nodeA'
    ? mkCard('nodeA', 'Node A', 'publishes itself')
    : mkCard('nodeB', 'Node B', 'openclaw automation');

  const entryOut = createNetworkAgentDirectoryEntry({
    agent_id,
    published_at: new Date().toISOString(),
    card
  });
  if (!entryOut.ok) return entryOut;
  return publishAgentCard({ directory, entry: entryOut.entry });
}

async function search({ query }) {
  return searchPublishedAgents({ directory, query });
}

async function emitSocialFeed({ event }) {
  const msgOut = formatSocialFeedMessage({ event });
  if (!msgOut.ok) return;
  console.log(JSON.stringify({ ok: true, event_type: event.event_type, message: msgOut.message }));
}

const out = await runFirstLivePublishFlow({
  directory,
  publishSelf,
  search,
  emitSocialFeed,
  nowIso: new Date().toISOString()
});

console.log(JSON.stringify(out));
