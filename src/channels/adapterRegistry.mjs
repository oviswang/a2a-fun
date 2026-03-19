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

export function getAdapter(channel) {
  const ch = String(channel || '').trim().toLowerCase();
  return adapters[ch] || null;
}

export function listAdapters() {
  return Object.keys(adapters).sort();
}
