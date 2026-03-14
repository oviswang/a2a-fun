import { createHttpTransport } from '../src/runtime/transport/httpTransport.mjs';
import { publishAgentCardRemote, listPublishedAgentsRemote, searchPublishedAgentsRemote } from '../src/discovery/sharedAgentDirectoryClient.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv);

// Demo mode: start a local "bootstrap-backed" directory server in-process.
const transport = createHttpTransport();
const srv = await transport.startServer({ port: 0, onMessage: async () => ({ ok: true }) });
const base_url = args.baseUrl || `http://127.0.0.1:${srv.port}`;

function card(agent_id, name, summary) {
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

const publishA = await publishAgentCardRemote({ base_url, agent_id: 'nodeA', card: card('nodeA', 'Node A', 'publishes') });
const publishB = await publishAgentCardRemote({ base_url, agent_id: 'nodeB', card: card('nodeB', 'Node B', 'openclaw automation') });

const list = await listPublishedAgentsRemote({ base_url });
const search = await searchPublishedAgentsRemote({ base_url, query: 'openclaw' });

console.log(
  JSON.stringify({
    ok: true,
    base_url,
    publishA,
    publishB,
    list,
    search
  })
);

await srv.close();
