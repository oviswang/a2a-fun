function safeStr(s) { 
 return typeof s === 'string' ? s.trim() : ''; 
} 
 
function safeJsonParse(s) { 
 try { 
 return JSON.parse(String(s)); 
 } catch { 
 return null; 
 } 
} 
 
/** 
 * createOpenClawCliSend() 
 * 
 * NOTE: Despite the name, this is now an HTTP adapter. 
 * It sends via OpenClaw gateway local HTTP endpoint: 
 * POST {OPENCLAW_GATEWAY_URL}/__a2a__/send 
 * Payload: { channel, target, message } 
 */ 
export function createOpenClawCliSend() { 
 return async function send({ gateway, channel_id, message } = {}) { 
 const channel = safeStr(gateway).toLowerCase(); 
 const target = channel_id == null ? '' : String(channel_id).trim(); 
 const text = typeof message === 'string' ? message : ''; 
 
 if (!channel) throw Object.assign(new Error('missing gateway/channel'), { code: 'MISSING_CHANNEL' }); 
 if (!target) throw Object.assign(new Error('missing channel_id/target'), { code: 'MISSING_TARGET' }); 
 if (!safeStr(text)) throw Object.assign(new Error('missing message'), { code: 'MISSING_MESSAGE' }); 
 
 const base = safeStr(process.env.OPENCLAW_GATEWAY_URL) || 'http://127.0.0.1:18789'; 
 const url = base.replace(/\/$/, '') + '/__a2a__/send'; 
 
 // Read gateway bearer token from ~/.openclaw/openclaw.json (gateway.auth.token) 
 let token = ''; 
 try { 
 const fs = await import('node:fs/promises'); 
 const os = await import('node:os'); 
 const path = await import('node:path'); 
 const p = path.join(os.homedir(), '.openclaw', 'openclaw.json'); 
 const raw = await fs.readFile(p, 'utf8'); 
 const cfg = JSON.parse(raw); 
 token = (cfg?.gateway?.auth?.token && String(cfg.gateway.auth.token).trim()) || ''; 
 } catch {} 
 
 const headers = { 'content-type': 'application/json' }; 
 if (token) headers.authorization = `Bearer ${token}`; 
 
 const res = await fetch(url, { 
 method: 'POST', 
 headers, 
 body: JSON.stringify({ channel, target, message: text }) 
 }).catch((e) => { 
 const err = new Error('openclaw gateway send failed (fetch)'); 
 err.code = 'OPENCLAW_GATEWAY_FETCH_FAILED'; 
 err.details = { message: safeStr(e?.message), url }; 
 throw err; 
 }); 
 
 const raw = await res.text().catch(() => ''); 
 const json = safeJsonParse(raw); 
 
 if (res.ok && json && json.ok === true) return json; 
 
 const err = new Error(`openclaw gateway send failed (http ${res.status})`); 
 err.code = 'OPENCLAW_GATEWAY_SEND_FAILED'; 
 err.details = { http_status: res.status, body: safeStr(raw).slice(0, 2000), url }; 
 throw err; 
 }; 
}
