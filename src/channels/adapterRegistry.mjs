import { openclawAdapter } from './adapters/openclaw.mjs';
import { telegramAdapter } from './adapters/telegram.mjs';
import { discordAdapter } from './adapters/discord.mjs';
import { whatsappAdapter } from './adapters/whatsapp.mjs';
import { larkAdapter } from './adapters/lark.mjs';
import { wechatAdapter } from './adapters/wechat.mjs';
import { qqAdapter } from './adapters/qq.mjs';
import { matrixAdapter } from './adapters/matrix.mjs';

const adapters = {
  openclaw: openclawAdapter,
  telegram: telegramAdapter,
  discord: discordAdapter,
  whatsapp: whatsappAdapter,
  lark: larkAdapter,
  wechat: wechatAdapter,
  qq: qqAdapter,
  matrix: matrixAdapter
};

function assertCap(adapter, name) {
  const required = ['normalize', 'bindIdentity', 'execute', 'formatResponse', 'health'];
  for (const k of required) {
    if (typeof adapter?.[k] !== 'function') {
      throw new Error(`adapterRegistry: non-compliant adapter ${name}: missing ${k}()`);
    }
  }
  if (typeof adapter?.channel !== 'string' || !adapter.channel) {
    throw new Error(`adapterRegistry: non-compliant adapter ${name}: missing channel`);
  }
}

export function getAdapter(channel) {
  const ch = String(channel || '').trim().toLowerCase();
  const a = adapters[ch] || null;
  if (a) assertCap(a, ch);
  return a;
}

export function listAdapters() {
  // Validate all at listing time as well.
  for (const [name, a] of Object.entries(adapters)) assertCap(a, name);
  return Object.keys(adapters).sort();
}
