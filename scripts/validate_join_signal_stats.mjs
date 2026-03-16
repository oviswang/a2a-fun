import http from 'node:http';
import { fetchAndValidateNetworkStats } from '../src/runtime/joinNetworkSignalStats.mjs';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
    server.on('error', reject);
  });
}

async function run() {
  const server = http.createServer((req, res) => {
    if (req.url === '/404') {
      res.statusCode = 404;
      return res.end('');
    }
    if (req.url === '/invalid-json') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      return res.end('{ not-json');
    }
    if (req.url === '/schema-mismatch') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ connected_nodes: '0', active_agents_last_24h: 0, regions: {} }));
    }
    if (req.url === '/ok') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      return res.end(
        JSON.stringify({
          connected_nodes: 12,
          active_agents_last_24h: 9,
          regions: [{ country: 'Singapore', count: 3 }]
        })
      );
    }
    res.statusCode = 500;
    res.end('unexpected');
  });

  const addr = await listen(server);
  const base = `http://${addr.address}:${addr.port}`;

  const cases = [
    { name: '404', url: base + '/404', expectAvailable: false },
    { name: 'invalid-json', url: base + '/invalid-json', expectAvailable: false },
    { name: 'schema-mismatch', url: base + '/schema-mismatch', expectAvailable: false },
    { name: 'ok', url: base + '/ok', expectAvailable: true }
  ];

  const out = [];
  for (const c of cases) {
    const r = await fetchAndValidateNetworkStats({ url: c.url });
    out.push({
      case: c.name,
      available: r.available,
      reason: r.reason || null,
      stats: r.stats || null,
      pass: r.available === c.expectAvailable
    });
  }

  server.close();
  console.log(JSON.stringify({ ok: out.every((x) => x.pass), results: out }, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
