export function createWsCollector(ws) {
  const queue = [];
  const waiters = [];

  function push(msg) {
    if (waiters.length) {
      const w = waiters.shift();
      w.resolve(msg);
      return;
    }
    queue.push(msg);
  }

  ws.addEventListener('message', (ev) => {
    try {
      push(JSON.parse(String(ev.data)));
    } catch {
      // ignore non-JSON frames in tests
    }
  });

  async function next(timeoutMs = 2000) {
    if (queue.length) return queue.shift();
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        // remove waiter if still pending
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error('timeout waiting ws message'));
      }, timeoutMs);
      waiters.push({
        resolve: (msg) => {
          clearTimeout(t);
          resolve(msg);
        }
      });
    });
  }

  return { next };
}
