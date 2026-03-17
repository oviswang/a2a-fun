import { createBootstrapServer } from './bootstrapServer.mjs';

const port = Number(process.env.BOOTSTRAP_PORT || 3100);
const bindHost = process.env.BOOTSTRAP_BIND || '127.0.0.1';

// Persistent node registry state (machine-safe JSON file).
const registryFile = process.env.BOOTSTRAP_REGISTRY_FILE || 'data/bootstrap-registry.json';

// Public relay list (bootstrap returns configured relays; bootstrap itself does not implement relay logic).
const relaysEnv = String(process.env.BOOTSTRAP_RELAYS || '').trim();
const relays = relaysEnv ? relaysEnv.split(',').map((s) => s.trim()).filter(Boolean) : [];

const srv = createBootstrapServer({ bindHost, port, registryFile, relays });
await srv.start();

// eslint-disable-next-line no-console
console.log(`a2a-bootstrap listening on http://${bindHost}:${port}`);
