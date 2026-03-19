#!/usr/bin/env node

import { rebuildMarketMetrics } from '../src/market/offerFeed.mjs';

const m = rebuildMarketMetrics();
const x = m.metrics;

function pct(p) {
  return `${Math.round(p * 100)}%`;
}

const lines = [
  'Market Summary',
  `- total_offers: ${x.total_offers}`,
  `- accepted_offers: ${x.accepted_offers}`,
  `- rejected_offers: ${x.rejected_offers}`,
  `- expired_offers: ${x.expired_offers}`,
  `- executed_offers: ${x.executed_offers}`,
  `- accept_rate: ${pct(x.accept_rate)}`,
  `- avg_expected_value: ${x.avg_expected_value.toFixed(2)}`,
  `- avg_expected_value_accepted: ${x.avg_expected_value_accepted.toFixed(2)}`,
  '- top_rejection_reasons:',
  ...Object.entries(x.top_rejection_reasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `  - ${k}: ${v}`),
  '- task_type_breakdown:',
  ...Object.entries(x.task_type_breakdown).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `  - ${k}: ${v}`)
];

process.stdout.write(lines.join('\n') + '\n');
