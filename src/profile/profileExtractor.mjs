import { IdentityService } from '../identity/identityService.mjs';

export const ALLOWED_LOCAL_PROBE_PROFILE_INPUT_FIELDS = [
  'agent_label',
  'languages',
  'conversation_mode',
  'no_sensitive_topics',
  'protocols',
  'transports'
];

export const ALLOWED_PEER_PROBE_PROFILE_INPUT_FIELDS = [
  'languages',
  'protocols',
  'transports'
];

export const ALLOWED_LOCAL_PROBE_PROFILE_OUTPUT_FIELDS = [
  'agent_label',
  'languages',
  'conversation_prefs',
  'safety_prefs',
  'capabilities',
  'redaction_report'
];

export const ALLOWED_PEER_PROBE_PROFILE_OUTPUT_FIELDS = [
  'languages',
  'capabilities',
  'redaction_report'
];

function uniq(arr) {
  return [...new Set(arr)];
}

function isLangCode(x) {
  return typeof x === 'string' && /^[a-z]{2}(-[a-z0-9]{2,8})?$/i.test(x);
}

/**
 * Phase 1 ProfileExtractor
 *
 * Goal:
 * - Produce probe-safe profile summaries
 * - Route ALL outbound safety, label sanitization, and no-raw-handle lint through IdentityService façade
 *
 * Non-goals (Phase 1):
 * - probe engine
 * - transport
 * - handshake
 */
export class ProfileExtractor {
  /**
   * @param {{ identityService: IdentityService, strictLocalProfileLint?: boolean }} opts
   */
  constructor(opts) {
    if (!opts?.identityService) throw new Error('ProfileExtractor requires identityService');
    this.identity = opts.identityService;

    // Optional strategy toggle. Default: false.
    // When true, lint the raw localContext (keys + values + nesting) before drop.
    this.STRICT_LOCAL_PROFILE_LINT = !!opts.strictLocalProfileLint;
  }

  /**
   * Extract local probe-safe profile.
   * @param {object} localContext
   */
  extractLocalProbeProfile(localContext = {}) {
    // Optional local strict lint (default off).
    // Default behavior remains: sanitize + output whitelist + lint on the *output* object.
    if (this.STRICT_LOCAL_PROFILE_LINT) {
      this.identity.assertOutboundSafe(localContext);
    }

    const redaction = this._buildRedactionReport(localContext, ALLOWED_LOCAL_PROBE_PROFILE_INPUT_FIELDS);

    const agent_label = this.identity.makeAgentLabel(localContext.agent_label);

    const languages = Array.isArray(localContext.languages)
      ? uniq(localContext.languages.filter(isLangCode).map(x => x.toLowerCase())).slice(0, 8)
      : [];

    const mode = localContext.conversation_mode;
    const conversation_prefs = {
      mode: mode === 'sync' || mode === 'async' ? mode : 'async'
    };

    const safety_prefs = {
      no_sensitive_topics: !!localContext.no_sensitive_topics,
      no_files: true
    };

    const capabilities = {
      protocols: Array.isArray(localContext.protocols) ? localContext.protocols.slice(0, 8) : [],
      transports: Array.isArray(localContext.transports) ? localContext.transports.slice(0, 8) : []
    };

    const safe = {
      agent_label,
      languages,
      conversation_prefs,
      safety_prefs,
      capabilities,
      redaction_report: redaction
    };

    // Enforce output whitelist + stability.
    this._assertOutputWhitelist(safe, ALLOWED_LOCAL_PROBE_PROFILE_OUTPUT_FIELDS);

    // MUST pass recursive lint via façade.
    this.identity.assertOutboundSafe(safe);
    return safe;
  }

  /**
   * Extract peer probe-safe profile (sanitized).
   * @param {object} peerBody
   */
  extractPeerProbeProfile(peerBody = {}) {
    // Treat peer input as hostile: lint the raw input object (keys + values + nesting) before any dropping.
    // Hard rule: lint failure MUST fail closed (no warning/continue).
    this.identity.assertOutboundSafe(peerBody);

    const redaction = this._buildRedactionReport(peerBody, ALLOWED_PEER_PROBE_PROFILE_INPUT_FIELDS);

    const languages = Array.isArray(peerBody.languages)
      ? uniq(peerBody.languages.filter(isLangCode).map(x => x.toLowerCase())).slice(0, 8)
      : [];

    const capabilities = {
      protocols: Array.isArray(peerBody.protocols) ? peerBody.protocols.slice(0, 8) : [],
      transports: Array.isArray(peerBody.transports) ? peerBody.transports.slice(0, 8) : []
    };

    const safe = {
      languages,
      capabilities,
      redaction_report: redaction
    };

    this._assertOutputWhitelist(safe, ALLOWED_PEER_PROBE_PROFILE_OUTPUT_FIELDS);
    this.identity.assertOutboundSafe(safe);
    return safe;
  }

  _assertOutputWhitelist(outputObj, allowedFields) {
    const keys = Object.keys(outputObj);
    const expected = allowedFields;

    // Require exact match and stable ordering.
    if (keys.length !== expected.length) {
      throw new Error(`ProfileExtractor output whitelist mismatch: got ${keys.join(',')} expected ${expected.join(',')}`);
    }
    for (let i = 0; i < expected.length; i++) {
      if (keys[i] !== expected[i]) {
        throw new Error(`ProfileExtractor output key order mismatch at ${i}: got ${keys[i]} expected ${expected[i]}`);
      }
    }
  }

  _buildRedactionReport(inputObj, allowedInputKeys) {
    const dropped = [];
    const allowed = new Set(allowedInputKeys);

    if (inputObj && typeof inputObj === 'object') {
      for (const k of Object.keys(inputObj)) {
        if (!allowed.has(k)) dropped.push(k);
      }
    }

    dropped.sort();
    return {
      dropped_fields: dropped,
      notes: []
    };
  }
}
