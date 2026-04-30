/* @license Enterprise */

/**
 * Feature flags that can be declared inside a signed NAO_LICENSE payload.
 * Keep the identifiers short, stable and lowercase — they are part of the
 * license wire format and cannot change without re-issuing every license.
 */
export const LICENSE_FEATURES = {
	sso: 'sso',
} as const;

export type LicenseFeature = (typeof LICENSE_FEATURES)[keyof typeof LICENSE_FEATURES];

/**
 * Result states surfaced by `license.getStatus`. Shared across backend and
 * frontend so the status-derived UI stays in sync with what the verifier can
 * emit.
 *
 * - `active`      — signed & within expiry, EE features enabled.
 * - `expired`     — signature valid but expiry is in the past.
 * - `invalid`     — NAO_LICENSE is set but verification failed (bad signature,
 *                   malformed token, key mismatch, etc).
 * - `unlicensed`  — NAO_LICENSE is not configured; running in OSS mode.
 */
export const LICENSE_STATUSES = ['active', 'expired', 'invalid', 'unlicensed'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface NaoLicense {
	subscriptionId: string;
	companyName: string;
	isTrial: boolean;
	expiresAt: Date;
	issuedAt: Date;
	features: LicenseFeature[];
}
