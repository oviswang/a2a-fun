#!/usr/bin/env node

import { loadMarketState } from '../src/market/taskDecision.mjs';
import { getLoadState } from '../src/market/taskDecision.mjs';
import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';

const st = loadMarketState();
const load = getLoadState();
const metrics = rebuildMarketMetrics();

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      inflight: load.inflight,
      market_state_path: st.path,
      market_state: st.state,
      market_metrics: metrics.metrics
    },
    null,
    2
  ) + '\n'
);
