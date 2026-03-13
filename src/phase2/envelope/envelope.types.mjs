// PHASE 2 FROZEN
// Behavior must remain stable unless fixing a critical bug.

/**
 * Phase 2: Envelope types (documentation-only JSDoc shapes).
 *
 * No runtime exports required; this file exists to keep the module boundaries clear.
 */

/**
 * @typedef {object} PartyRef
 * @property {string} actor_id
 * @property {string} [agent_label]
 * @property {string} key_fpr
 */

/**
 * @typedef {object} CryptoParams
 * @property {string} enc
 * @property {string} kdf
 * @property {string} nonce
 */

/**
 * @typedef {object} CipherBody
 * @property {string} ciphertext
 * @property {string} content_type
 */

/**
 * @typedef {object} Envelope
 * @property {string} v
 * @property {string} type
 * @property {string} msg_id
 * @property {string} session_id
 * @property {string} ts
 * @property {PartyRef} from
 * @property {PartyRef} to
 * @property {CryptoParams} crypto
 * @property {CipherBody} body
 * @property {string} sig
 */
