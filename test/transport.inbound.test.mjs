import test from 'node:test';
import assert from 'node:assert/strict';

import { handleDirectInbound, _test as directTest } from '../src/runtime/inbound/directInbound.mjs';
import { handleRelayInbound } from '../src/runtime/inbound/relayInbound.mjs';

test('inbound: direct inbound forwards payload', async () => {
  let got;
  const req = directTest.makeReqFromString(JSON.stringify({ payload: { a: 1 } }));
  await handleDirectInbound(req, {
    onInbound: (p) => {
      got = p;
      return { ok: true };
    }
  });
  assert.deepEqual(got, { a: 1 });
});

test('inbound: relay inbound forwards payload', async () => {
  let got;
  await handleRelayInbound(
    { from: 'nodeA', payload: { envelope: { x: 'y' } } },
    {
      onInbound: (p) => {
        got = p;
      }
    }
  );
  assert.deepEqual(got, { envelope: { x: 'y' } });
});

test('inbound: invalid direct payload fails closed', async () => {
  const req = directTest.makeReqFromString(JSON.stringify({ nope: 1 }));
  await assert.rejects(
    () => handleDirectInbound(req, { onInbound: () => {} }),
    (e) => e && e.code === 'MISSING_PAYLOAD'
  );
});

test('inbound: invalid relay message fails closed', async () => {
  await assert.rejects(
    () => handleRelayInbound({ payload: { a: 1 } }, { onInbound: () => {} }),
    (e) => e && e.code === 'INVALID_MESSAGE'
  );
});
