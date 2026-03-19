#!/usr/bin/env node

import { rebuildRewardBalance } from '../src/reward/reward.mjs';

process.stdout.write(JSON.stringify(rebuildRewardBalance(), null, 2) + '\n');
