#!/usr/bin/env node

import { loadMarketState } from '../src/market/taskDecision.mjs';
import { getLoadState } from '../src/market/taskDecision.mjs';

const st = loadMarketState();
const load = getLoadState();

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      inflight: load.inflight,
      market_state_path: st.path,
      market_state: st.state
    },
    null,
    2
  ) + '\n'
);
