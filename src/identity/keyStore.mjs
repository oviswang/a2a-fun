import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function fingerprintPublicKeyPem(pem) {
  return `sha256:${sha256Hex(Buffer.from(pem, 'utf8'))}`;
}

/**
 * Minimal local keystore for Phase 1.
 * Stores PEM in a local file with 0600.
 */
export class FileIdentityKeyStore {
  /**
   * @param {{keyPath: string}} opts
   */
  constructor(opts) {
    this.keyPath = resolve(opts.keyPath);
  }

  getOrCreateIdentityKeypair() {
    if (existsSync(this.keyPath)) {
      const raw = JSON.parse(readFileSync(this.keyPath, 'utf8'));
      if (!raw.publicKeyPem || !raw.privateKeyPem) throw new Error('invalid keystore file');
      return {
        publicKeyPem: raw.publicKeyPem,
        privateKeyRef: this.keyPath,
        keyFpr: fingerprintPublicKeyPem(raw.publicKeyPem)
      };
    }

    mkdirSync(dirname(this.keyPath), { recursive: true });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
    const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });

    writeFileSync(this.keyPath, JSON.stringify({ publicKeyPem, privateKeyPem }, null, 2), { mode: 0o600 });
    try { chmodSync(this.keyPath, 0o600); } catch {}

    return {
      publicKeyPem,
      privateKeyRef: this.keyPath,
      keyFpr: fingerprintPublicKeyPem(publicKeyPem)
    };
  }
}
