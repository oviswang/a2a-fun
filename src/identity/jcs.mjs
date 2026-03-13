/**
 * Minimal RFC 8785-style canonical JSON for Phase 1.
 *
 * This implementation:
 * - Sorts object keys lexicographically
 * - Uses JSON.stringify for primitives
 * - Recurses arrays/objects
 *
 * Limitations:
 * - Does not implement full RFC 8785 number formatting edge-cases.
 *   (Good enough for Phase 1 where we mostly hash strings.)
 */

function isPlainObject(x) {
  return !!x && typeof x === 'object' && (x.constructor === Object || Object.getPrototypeOf(x) === null);
}

export function jcsStringify(value) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(jcsStringify).join(',') + ']';
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + jcsStringify(value[k])).join(',') + '}';
  }
  // Fall back: stringify as string.
  return JSON.stringify(String(value));
}
