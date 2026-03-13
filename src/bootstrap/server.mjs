import { createBootstrapServer } from './bootstrapServer.mjs';

const port = Number(process.env.BOOTSTRAP_PORT || 3100);
const bindHost = process.env.BOOTSTRAP_BIND || '127.0.0.1';
const dataFile = process.env.BOOTSTRAP_DATA_FILE || 'data/bootstrap-peers.json';

const srv = createBootstrapServer({ bindHost, port, dataFile });
await srv.start();

// eslint-disable-next-line no-console
console.log(`a2a-bootstrap listening on http://${bindHost}:${port}`);
