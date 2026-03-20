import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function getPaths({ dataDir } = {}) {
  const dir = dataDir || path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'data');
  return {
    dataDir: dir,
    ledger: path.join(dir, 'reward_ledger.jsonl'),
    balance: path.join(dir, 'reward_balance.json')
  };
}

function appendJsonlLine(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
}

function logEvent(obj) {
  try {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  } catch {}
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function loadBalance(balancePath) {
  const j = safeReadJson(balancePath);
  if (j && isPlainObject(j) && isPlainObject(j.balances)) return j;
  return { ok: true, updated_at: null, balances: {} };
}

function saveBalance(balancePath, balances) {
  atomicWriteJson(balancePath, { ok: true, updated_at: nowIso(), balances });
}

function tailLines(filePath, maxLines = 5000) {
  try {
    const s = fs.readFileSync(filePath, 'utf8');
    const lines = s.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

function alreadyCredited({ ledgerPath, offer_id, winner_sid, value_event_id } = {}) {
  const lines = tailLines(ledgerPath, 8000);
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e?.event_type !== 'reward_credit') continue;
    if (e?.super_identity_id !== winner_sid) continue;
    const ctx = e?.context || {};
    if (value_event_id && ctx?.value_event_id === value_event_id) return true;
    if (offer_id && ctx?.offer_id === offer_id) return true;
  }
  return false;
}

export function creditReward({ super_identity_id, amount, context }, { dataDir } = {}) {
  const sid = String(super_identity_id || '').trim();
  if (!sid.startsWith('sid-')) return { ok: false, error: { code: 'INVALID_SUPER_ID' } };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: true, credited: false, reason: 'non_positive_amount' };
  }

  const { ledger: ledgerPath, balance: balancePath } = getPaths({ dataDir });
  const ctx = isPlainObject(context) ? context : {};

  const offer_id = typeof ctx.offer_id === 'string' ? ctx.offer_id : null;
  const value_event_id = typeof ctx.value_event_id === 'string' ? ctx.value_event_id : null;
  const task_id = typeof ctx.task_id === 'string' ? ctx.task_id : null;

  // Forward trace completeness (v0.6.9): required keys must be present on reward write.
  // Never block crediting (no economic behavior change), but never be silent.
  const missingTraceKeys = [];
  if (!offer_id) missingTraceKeys.push('offer_id');
  if (!task_id) missingTraceKeys.push('task_id');
  if (!value_event_id) missingTraceKeys.push('value_event_id');
  if (missingTraceKeys.length) {
    logEvent({
      ok: true,
      event: 'TRACE_KEY_MISSING_ON_WRITE',
      ts: nowIso(),
      stage: 'reward_credit',
      offer_id: offer_id || null,
      task_id: task_id || null,
      winner_super_identity_id: sid,
      source_super_identity_id: typeof ctx.source_super_identity_id === 'string' ? ctx.source_super_identity_id : null,
      value_event_id: value_event_id || null,
      missing: missingTraceKeys
    });
  }

  if (alreadyCredited({ ledgerPath, offer_id, winner_sid: sid, value_event_id })) {
    logEvent({
      ok: true,
      event: 'VALUE_TO_REWARD_MISSING',
      ts: nowIso(),
      offer_id: offer_id || null,
      task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
      winner_sid: sid,
      amount: amt,
      reason: 'duplicate_credit_suppressed',
      stage: 'reward',
      value_event_id: value_event_id || null
    });
    return { ok: true, credited: false, reason: 'duplicate_credit' };
  }

  const ev = {
    event_id: `evt-${crypto.randomUUID()}`,
    ts: nowIso(),
    super_identity_id: sid,
    event_type: 'reward_credit',
    amount: amt,
    context: {
      offer_id: offer_id || null,
      task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
      value_event_id: value_event_id || null,
      source_super_identity_id: typeof ctx.source_super_identity_id === 'string' ? ctx.source_super_identity_id : null,
      metadata: isPlainObject(ctx.metadata) ? ctx.metadata : {}
    }
  };

  appendJsonlLine(ledgerPath, ev);

  // Value→reward traceability (integrity): reward credits must reference a value_event_id.
  if (value_event_id) {
    logEvent({
      ok: true,
      event: 'VALUE_TO_REWARD_LINKED',
      ts: nowIso(),
      offer_id: offer_id || null,
      task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
      winner_sid: sid,
      amount: amt,
      reason: 'reward_credit',
      stage: 'reward',
      value_event_id
    });
  } else {
    logEvent({
      ok: true,
      event: 'VALUE_TO_REWARD_MISSING',
      ts: nowIso(),
      offer_id: offer_id || null,
      task_id: typeof ctx.task_id === 'string' ? ctx.task_id : null,
      winner_sid: sid,
      amount: amt,
      reason: 'missing_value_event_id',
      stage: 'reward',
      value_event_id: null
    });
  }

  const doc = loadBalance(balancePath);
  const balances = isPlainObject(doc.balances) ? doc.balances : {};
  if (!balances[sid]) balances[sid] = { balance: 0, credited_events: 0, last_updated: null };

  balances[sid].balance = Number(balances[sid].balance || 0) + amt;
  balances[sid].credited_events = Number(balances[sid].credited_events || 0) + 1;
  balances[sid].last_updated = nowIso();

  saveBalance(balancePath, balances);

  return { ok: true, credited: true, event: ev };
}

export function getRewardBalance(super_identity_id, { dataDir } = {}) {
  const { balance: balancePath } = getPaths({ dataDir });
  const sid = String(super_identity_id || '').trim();
  const doc = loadBalance(balancePath);
  const balances = isPlainObject(doc.balances) ? doc.balances : {};
  return { ok: true, super_identity_id: sid, balance: balances[sid] || null };
}

export function rebuildRewardBalance({ dataDir } = {}) {
  const { ledger: ledgerPath, balance: balancePath } = getPaths({ dataDir });
  const lines = tailLines(ledgerPath, 1_000_000);

  const balances = {};
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.event_type !== 'reward_credit') continue;
    const sid = String(e?.super_identity_id || '').trim();
    if (!sid.startsWith('sid-')) continue;
    const amt = Number(e?.amount);
    if (!Number.isFinite(amt)) continue;

    if (!balances[sid]) balances[sid] = { balance: 0, credited_events: 0, last_updated: null };
    balances[sid].balance += amt;
    balances[sid].credited_events += 1;
    balances[sid].last_updated = nowIso();
  }

  saveBalance(balancePath, balances);
  return { ok: true, rebuilt: true, sids: Object.keys(balances).length };
}

export function getRecentRewardCredits(super_identity_id, { limit = 20, dataDir } = {}) {
  const { ledger: ledgerPath } = getPaths({ dataDir });
  const sid = String(super_identity_id || '').trim();
  const lines = tailLines(ledgerPath, 8000);
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (e?.super_identity_id !== sid) continue;
    if (e?.event_type !== 'reward_credit') continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return { ok: true, super_identity_id: sid, events: out };
}
