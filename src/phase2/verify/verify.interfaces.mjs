// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

/**
 * Phase 2: verification interfaces (PURE INTERFACE DEFINITIONS).
 *
 * This file intentionally contains NO stub implementations.
 * Use dependency injection to provide concrete implementations in tests and later phases.
 *
 * Hard rules:
 * - Verification failures MUST fail closed (throw).
 * - Missing peer key material MUST fail closed.
 * - Do not decrypt before signature verification.
 */

/**
 * @typedef {object} VerifyContext
 * @property {string} peer_actor_id
 * @property {string} key_fpr
 */

/**
 * IKeyResolver
 * @typedef {object} IKeyResolver
 * @property {(ctx: VerifyContext) => (Promise<string|null>|string|null)} resolvePeerPublicKey
 */

/**
 * IVerifier
 * @typedef {object} IVerifier
 * @property {(envelope: object, peerPublicKeyPem: string) => (Promise<void>|void)} verifyEnvelopeSignature
 */

/**
 * ISigner (not used by inbound pipeline yet)
 * @typedef {object} ISigner
 * @property {(envelopeWithoutSig: object, privateKeyRef: string) => (Promise<string>|string)} signEnvelope
 */
