#!/usr/bin/env node

import { loadNodeId, loadLocalAgentId } from '../src/identity/identityBinding.mjs';
import { inspectIdentityState } from '../src/identity/superIdentity.mjs';

const node_id = loadNodeId();
const local_agent_id = loadLocalAgentId();
const state = inspectIdentityState();

const superIdentities = state?.registry?.super_identities || [];
const links = state?.links?.links || {};

const out = {
  ok: true,
  node_id,
  local_agent_id,
  super_identity_count: Array.isArray(superIdentities) ? superIdentities.length : 0,
  linked_channel_identities_count: links && typeof links === 'object' ? Object.keys(links).length : 0,
  super_identities: superIdentities
};

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
