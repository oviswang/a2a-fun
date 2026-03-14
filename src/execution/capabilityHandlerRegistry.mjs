// Execution Runtime Layer (primitive): Capability Handler Registry (minimal)
//
// Hard constraints:
// - no execution
// - no invocation handling
// - no persistence / networking
// - must not affect frozen protocol/runtime semantics

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw err('INVALID_INPUT', 'registry must be object');
  if (!(registry._handlers instanceof Map)) throw err('INVALID_INPUT', 'registry invalid');
}

/**
 * createCapabilityHandlerRegistry()
 *
 * Returns a registry object that maps capability_id -> handler function.
 */
export function createCapabilityHandlerRegistry() {
  return { _handlers: new Map() };
}

/**
 * registerCapabilityHandler({ registry, capability_id, handler })
 *
 * Validates inputs and registers the handler.
 */
export function registerCapabilityHandler({ registry, capability_id, handler } = {}) {
  assertRegistry(registry);
  assertNonEmptyString(capability_id, 'capability_id');
  if (typeof handler !== 'function') throw err('INVALID_HANDLER', 'handler must be function');

  registry._handlers.set(capability_id, handler);

  return { ok: true };
}

/**
 * getCapabilityHandler({ registry, capability_id })
 *
 * Returns handler function or null if not found.
 */
export function getCapabilityHandler({ registry, capability_id } = {}) {
  assertRegistry(registry);
  assertNonEmptyString(capability_id, 'capability_id');
  return registry._handlers.get(capability_id) ?? null;
}
