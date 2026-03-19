#!/usr/bin/env node

import { rebuildReputationIndex } from '../src/reputation/reputation.mjs';

const out = rebuildReputationIndex();
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
