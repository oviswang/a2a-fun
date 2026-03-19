function num(x, dflt) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

let inflight = 0;

export function getLoadState() {
  return { inflight };
}

export function withInflight(fn) {
  inflight++;
  const done = () => {
    inflight = Math.max(0, inflight - 1);
  };

  return Promise.resolve()
    .then(() => fn())
    .finally(done);
}

export function shouldAcceptTask({ expected_value }, { node_id } = {}) {
  const min = num(process.env.A2A_MIN_EXPECTED_VALUE, 1);
  const maxInflight = num(process.env.A2A_MAX_INFLIGHT, 3);

  const ev = num(expected_value, 1);

  if (ev < min) {
    return { accepted: false, reason: 'low_value', detail: { expected_value: ev, min_threshold: min, node_id: node_id || null } };
  }

  if (inflight >= maxInflight) {
    return { accepted: false, reason: 'overloaded', detail: { inflight, maxInflight, node_id: node_id || null } };
  }

  return { accepted: true, reason: 'ok', detail: { expected_value: ev, inflight, maxInflight, node_id: node_id || null } };
}
