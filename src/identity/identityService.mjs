import { createOutboundLint } from './outboundLint.mjs';
import {
  normalizeProvider,
  normalizeAccount,
  makeCanon,
  deriveActorIdFromCanon,
  deriveActorId
} from './canonicalize.mjs';
import { FileIdentityKeyStore, fingerprintPublicKeyPem } from './keyStore.mjs';

/**
 * IdentityService façade (Phase 1)
 *
 * Goal: provide a single internal entry-point for identity-related capabilities:
 * - canonicalization + actor_id derivation
 * - identity keypair management + key fingerprint
 * - recursive no-raw-handle outbound lint
 * - probe-safe agent_label helper
 *
 * Non-goals (Phase 1):
 * - transport / handshake
 * - signing / verification APIs
 * - peer key management (beyond fingerprint helper)
 */

const DEFAULT_AGENT_LABEL = 'Local Agent';
export const MAX_AGENT_LABEL_LEN = 32;

function clampString(s, maxLen) {
  const t = String(s);
  return t.length <= maxLen ? t : t.slice(0, maxLen);
}

export class IdentityService {
  /**
   * @param {{
   *   keyStore?: any,
   *   keyPath?: string,
   *   outboundLint?: ReturnType<typeof createOutboundLint>
   * }} opts
   */
  constructor(opts = {}) {
    this.outboundLint = opts.outboundLint ?? createOutboundLint();

    // Allow injecting a keystore for tests/alt backends.
    if (opts.keyStore) {
      this.keyStore = opts.keyStore;
    } else {
      if (!opts.keyPath) throw new Error('IdentityService requires keyPath (or keyStore)');
      this.keyStore = new FileIdentityKeyStore({ keyPath: opts.keyPath });
    }
  }

  // -------- canonicalization / actor_id --------

  normalizeProvider(provider) {
    return normalizeProvider(provider);
  }

  normalizeAccount(provider, accountRaw) {
    return normalizeAccount(provider, accountRaw);
  }

  /**
   * Internal-only: return canon (sensitive) only when explicitly requested.
   * @param {{provider: string, account: string, includeCanon?: boolean}} input
   */
  deriveActorId(input) {
    const { provider, account, includeSensitive = false } = input;
    const r = deriveActorId(provider, account);

    if (!includeSensitive) {
      // Default: do not return any locally-sensitive derivation material.
      return { actor_id: r.actor_id, provider: r.provider };
    }

    // Internal/testing only.
    return {
      actor_id: r.actor_id,
      provider: r.provider,
      normalized_account: r.normalized_account,
      canon: r.canon
    };
  }

  deriveActorIdFromCanon(canon) {
    return deriveActorIdFromCanon(canon);
  }

  makeCanon(provider, normalizedAccount) {
    return makeCanon(provider, normalizedAccount);
  }

  // -------- keys --------

  getOrCreateIdentityKeypair() {
    return this.keyStore.getOrCreateIdentityKeypair();
  }

  fingerprintPublicKeyPem(pem) {
    return fingerprintPublicKeyPem(pem);
  }

  // -------- outbound lint --------

  assertOutboundSafe(value) {
    return this.outboundLint.assertNoRawHandle(value);
  }

  // -------- agent_label helper --------

  /**
   * agent_label:
   * - optional
   * - short
   * - probe-safe
   * - MUST pass no-raw-handle lint
   * - SHOULD default to "Local Agent"
   */
  makeAgentLabel(agentLabelMaybe) {
    let s = agentLabelMaybe;
    if (s == null || s === '') s = DEFAULT_AGENT_LABEL;
    s = clampString(s, MAX_AGENT_LABEL_LEN);
    this.assertOutboundSafe(s);
    return s;
  }
}
