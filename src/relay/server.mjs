import { createRelayServerV2 } from './relayServerV2.mjs';

const port = Number(process.env.RELAY_PORT || 3110);
const bindHost = process.env.RELAY_BIND || '127.0.0.1';

const srv = createRelayServerV2({ bindHost, port, wsPath: '/relay' });
await srv.start();

// eslint-disable-next-line no-console
console.log(`a2a-relay listening on ws://${bindHost}:${port}/relay`);
