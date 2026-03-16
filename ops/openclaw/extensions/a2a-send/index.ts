import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

function safeStr(x: any) {
  return typeof x === 'string' ? x.trim() : '';
}

function isLoopback(addr?: string | null) {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

async function readJson(req: any, maxBytes = 64_000): Promise<any> {
  return await new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('body_too_large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const s = Buffer.concat(chunks).toString('utf8');
        resolve(s ? JSON.parse(s) : {});
      } catch { reject(new Error('bad_json')); }
    });
    req.on('error', (e: any) => reject(e));
  });
}

function pickSender(rt: any, channel: string) {
  const ch = (rt?.channel && typeof rt.channel === 'object') ? rt.channel : {};

  if (channel === 'whatsapp') {
    return async (to: string, msg: string) => {
      const fn = ch?.whatsapp?.sendMessageWhatsApp;
      if (typeof fn !== 'function') throw new Error('whatsapp_send_not_available');
      return await fn(to, msg, { verbose: false });
    };
  }

  if (channel === 'telegram') {
    return async (chatId: string, msg: string) => {
      const fn = ch?.telegram?.sendMessageTelegram;
      if (typeof fn !== 'function') throw new Error('telegram_send_not_available');
      // sendMessageTelegram(chatId, text, opts)
      return await fn(chatId, msg, { verbose: false });
    };
  }

  return null;
}

export default {
  id: "a2a-send",
  name: "a2a-send",
  description: "Expose a minimal A2A delivery endpoint for OpenClaw gateway channels.",
  version: "0.1.0",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    api.registerHttpRoute({
      path: "/__a2a__/send",
      auth: "gateway",
      handler: async (req: any, res: any) => {
        try {
          // Defense-in-depth: only accept loopback callers.
          if (!isLoopback(req?.socket?.remoteAddress)) {
            res.statusCode = 403;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'FORBIDDEN' } }));
            return;
          }

          if ((req.method || 'GET').toUpperCase() !== 'POST') {
            res.statusCode = 405;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } }));
            return;
          }

          const body = await readJson(req);
          const channel = safeStr(body?.channel).toLowerCase();
          const target = safeStr(body?.target);
          const message = typeof body?.message === 'string' ? body.message : '';

          if (!channel) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'MISSING_CHANNEL' } }));
            return;
          }
          if (!target) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'MISSING_TARGET' } }));
            return;
          }
          if (!safeStr(message)) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'MISSING_MESSAGE' } }));
            return;
          }

          const rt: any = (api as any).runtime;
          const send = pickSender(rt, channel);
          if (!send) {
            res.statusCode = 400;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: { code: 'CHANNEL_UNSUPPORTED', channel } }));
            return;
          }

          const result = await send(target, message);

          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, kind: 'A2A_SEND_V1', send_ok: true, result }));
        } catch (e: any) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: { code: 'A2A_SEND_FAILED', message: String(e?.message || e) } }));
        }
      }
    });
  }
};
