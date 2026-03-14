// Capability Sharing Layer (primitive): capability discovery (minimal)
//
// Hard constraints:
// - friendship-gated context only
// - deterministic, machine-safe output only
// - no invocation, no persistence, no networking
// - no scoring/ranking

function err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

function assertNonEmptyString(v, name) {
  if (typeof v !== 'string' || v.trim() === '') throw err('INVALID_INPUT', `missing ${name}`);
}

function assertFriendshipRecord(fr) {
  if (!fr || typeof fr !== 'object' || Array.isArray(fr)) throw err('INVALID_INPUT', 'friendship_record must be object');
  assertNonEmptyString(fr.friendship_id, 'friendship_record.friendship_id');
  if (fr.established !== true) throw err('INVALID_FRIENDSHIP', 'friendship_record.established must be true');
}

function assertAdvertisement(ad, i) {
  if (!ad || typeof ad !== 'object' || Array.isArray(ad)) throw err('INVALID_INPUT', `advertisements[${i}] must be object`);
  assertNonEmptyString(ad.capability_id, `advertisements[${i}].capability_id`);
  assertNonEmptyString(ad.friendship_id, `advertisements[${i}].friendship_id`);
  assertNonEmptyString(ad.name, `advertisements[${i}].name`);
  assertNonEmptyString(ad.summary, `advertisements[${i}].summary`);
}

/**
 * Deterministic capability discovery within a friendship-gated context.
 *
 * Shape:
 * {
 *   friendship_id,
 *   capabilities: [ { capability_id, name, summary }, ... ]
 * }
 */
export function discoverCapabilities({ friendship_record, advertisements } = {}) {
  assertFriendshipRecord(friendship_record);

  if (!Array.isArray(advertisements)) throw err('INVALID_INPUT', 'advertisements must be array');

  const capabilities = [];
  for (let i = 0; i < advertisements.length; i++) {
    const ad = advertisements[i];
    assertAdvertisement(ad, i);

    // Deterministic rule: exclude mismatched friendship_id advertisements.
    if (ad.friendship_id !== friendship_record.friendship_id) continue;

    capabilities.push({
      capability_id: ad.capability_id,
      name: ad.name,
      summary: ad.summary
    });
  }

  return {
    friendship_id: friendship_record.friendship_id,
    capabilities
  };
}
