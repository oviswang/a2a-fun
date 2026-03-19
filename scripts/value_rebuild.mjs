#!/usr/bin/env node

import { rebuildValueIndex } from '../src/value/value.mjs';

process.stdout.write(JSON.stringify(rebuildValueIndex(), null, 2) + '\n');
