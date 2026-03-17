import { createRelayCoreV0_1 } from './relayCoreV0_1.mjs';

const port = Number(process.env.RELAY_PORT || 18884);
// IMPORTANT: externally reachable by default
const bindHost = process.env.RELAY_BIND || '0.0.0.0';
const wsPath = process.env.RELAY_WS_PATH || '/relay';

const srv = createRelayCoreV0_1({ bindHost, port, wsPath });
await srv.start();

// eslint-disable-next-line no-console
console.log(`a2a-relay listening on ws://${bindHost}:${port}${wsPath}`);
