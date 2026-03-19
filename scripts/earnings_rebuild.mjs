#!/usr/bin/env node

import { rebuildEarningsAnalytics } from '../src/analytics/earnings.mjs';

process.stdout.write(JSON.stringify(rebuildEarningsAnalytics(), null, 2) + '\n');
