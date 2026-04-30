/* @license Enterprise */

/**
 * Ed25519 public key matching the private key held by the nao license server
 * (https://github.com/getnao/licenses).
 *
 * The constant below is the source of truth in source control. Production
 * Docker images run `docker/lock-license-key.mjs` at build time, which
 * rewrites this file with a locked-down version that has no env override
 * branch — so `NAO_LICENSE_PUBLIC_KEY` cannot be used to forge a license
 * against a production image.
 */
const BUNDLED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAaQkpvD/FV2XFKzJuIxF0zWTLDfLExVHnPHsFOLc8kTM=
-----END PUBLIC KEY-----
`;

let testOverride: string | null = null;

export function getBundledPublicKey(): string {
	if (testOverride) {
		return testOverride;
	}

	const devOverride = process.env.NAO_LICENSE_PUBLIC_KEY?.trim();
	if (devOverride) {
		return devOverride;
	}

	return BUNDLED_PUBLIC_KEY_PEM;
}

/**
 * TEST ONLY — swap the bundled key for the duration of a test so a freshly
 * generated keypair can verify against it. Pass `null` to restore the default.
 */
export function __setBundledPublicKeyForTesting(pem: string | null): void {
	testOverride = pem;
}
