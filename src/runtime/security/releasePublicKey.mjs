// A2A signed releases (v0.3.3)
// Public key used to verify release.json signatures.
// NOTE: private key is NOT stored in repo.

// NOTE: Rotated to match the currently used release signing private key.
// This is a trust-root change: nodes with the old embedded public key will reject new release.json signatures.
export const RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAxCoqi5TavuZKN6DWC2Z+mADYxdb22lq6aTItKdaKa/o=
-----END PUBLIC KEY-----
`;
