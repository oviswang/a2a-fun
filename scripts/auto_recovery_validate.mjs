#!/usr/bin/env node
import { runAutoRecoveryCheck } from '../src/runtime/autoRecovery.mjs';

function mkExecMock({
  daemonCount = 1,
  pluginsListOk = true,
  pluginsHasA2a = true,
  pluginsLoaded = true,
  httpRoutes = 1
} = {}) {
  return async function execImpl(cmd, args) {
    if (cmd === 'openclaw' && args[0] === 'plugins' && args[1] === 'list') {
      if (!pluginsListOk) throw new Error('openclaw cli unavailable');
      const plugins = [];
      if (pluginsHasA2a) {
        plugins.push({
          id: 'a2a-send',
          enabled: true,
          status: pluginsLoaded ? 'loaded' : 'disabled',
          httpRoutes
        });
      }
      return { stdout: JSON.stringify({ plugins }), stderr: '' };
    }

    if (cmd === 'bash' && String(args[0]) === '-lc' && String(args[1]).includes('node scripts/run_agent_loop.mjs --daemon') && String(args[1]).includes('wc -l')) {
      return { stdout: String(daemonCount) + '\n', stderr: '' };
    }

    // restart commands (detached) should be accepted
    return { stdout: '', stderr: '' };
  };
}

function mkFetchMock({ status = 200 } = {}) {
  return async function fetchImpl() {
    return { status };
  };
}

async function runCase(name, opts) {
  const state = {
    last_recovery_check_at: null,
    last_recovery_action_at: null,
    last_recovery_action: null,
    last_recovery_error: null
  };

  const logs = [];
  const orig = console.log;
  console.log = (s) => logs.push(String(s));
  try {
    await runAutoRecoveryCheck({
      workspace_path: process.cwd(),
      holder: 'TEST-HOLDER',
      state,
      state_path: '/dev/null',
      checkEveryMinutes: 0,
      fetchImpl: opts.fetchImpl,
      execImpl: opts.execImpl
    });
  } finally {
    console.log = orig;
  }

  return { name, state, logs };
}

const cases = [];

// 1) simulate daemon stopped
cases.push(
  await runCase('daemon_missing', {
    execImpl: mkExecMock({ daemonCount: 0, pluginsListOk: true, pluginsHasA2a: true, pluginsLoaded: true, httpRoutes: 1 }),
    fetchImpl: mkFetchMock({ status: 200 })
  })
);

// 2) simulate plugin missing/not loaded (CLI OK, plugin not found)
cases.push(
  await runCase('plugin_missing', {
    execImpl: mkExecMock({ daemonCount: 1, pluginsListOk: true, pluginsHasA2a: false, pluginsLoaded: false, httpRoutes: 0 }),
    fetchImpl: mkFetchMock({ status: 200 })
  })
);

// 2b) simulate CLI failure should SKIP (not recover)
cases.push(
  await runCase('cli_failure_skip', {
    execImpl: mkExecMock({ daemonCount: 1, pluginsListOk: false }),
    fetchImpl: mkFetchMock({ status: 200 })
  })
);

// 3) simulate gateway route unavailable
cases.push(
  await runCase('gateway_route_down', {
    execImpl: mkExecMock({ daemonCount: 1, pluginsListOk: true, pluginsHasA2a: true, pluginsLoaded: true, httpRoutes: 1 }),
    fetchImpl: mkFetchMock({ status: 500 })
  })
);

// 4) simulate multiple daemons detected
cases.push(
  await runCase('multiple_daemons', {
    execImpl: mkExecMock({ daemonCount: 2, pluginsListOk: true, pluginsHasA2a: true, pluginsLoaded: true, httpRoutes: 1 }),
    fetchImpl: mkFetchMock({ status: 200 })
  })
);

const summary = cases.map((c) => ({
  case: c.name,
  last_recovery_action: c.state.last_recovery_action || null,
  last_recovery_error: c.state.last_recovery_error || null,
  emitted: c.logs
    .map((x) => {
      try {
        return JSON.parse(x).event;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
}));

console.log(JSON.stringify({ ok: true, summary }, null, 2));
