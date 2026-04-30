/* @license Enterprise */

import { existsSync, readFileSync } from 'node:fs';

import { errors as joseErrors, importSPKI, jwtVerify, type KeyObject } from 'jose';

import { env } from '../env';
import { LICENSE_FEATURES, type LicenseFeature, type NaoLicense } from '../types/license';
import { getBundledPublicKey } from './license-public-key';

export type { LicenseFeature, LicenseStatus, NaoLicense } from '../types/license';
export { LICENSE_FEATURES, LICENSE_STATUSES } from '../types/license';

const LICENSE_ISSUER = 'getnao';
const LICENSE_ALGORITHM = 'EdDSA';

let licensePromise: Promise<NaoLicense | null> | null = null;

export function getLicense(): Promise<NaoLicense | null> {
	if (!licensePromise) {
		licensePromise = loadAndVerifyLicense();
	}
	return licensePromise;
}

export async function hasFeature(feature: LicenseFeature): Promise<boolean> {
	const license = await getLicense();
	if (!license) {
		return false;
	}
	if (license.expiresAt.getTime() <= Date.now()) {
		return false;
	}
	return license.features.includes(feature);
}

export function resetLicenseCache(): void {
	licensePromise = null;
}

async function loadAndVerifyLicense(): Promise<NaoLicense | null> {
	const token = readLicenseToken();
	if (!token) {
		return null;
	}

	try {
		const publicKey = await importLicensePublicKey();
		const { payload } = await jwtVerify(token, publicKey, {
			issuer: LICENSE_ISSUER,
			algorithms: [LICENSE_ALGORITHM],
		});

		return parseLicensePayload(payload);
	} catch (err) {
		logLicenseError(err);
		// jose validates the JWS signature before checking claims, so on JWTExpired
		// the payload is already trusted. Surface it so callers can distinguish an
		// expired license (signature OK, exp passed) from a truly invalid one
		// (bad signature, tampered, missing claims, key mismatch).
		if (err instanceof joseErrors.JWTExpired) {
			return parseLicensePayload(err.payload);
		}
		return null;
	}
}

/** Matches a compact JWS: three base64url segments separated by dots. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function readLicenseToken(): string | null {
	const value = env.NAO_LICENSE;
	if (!value) {
		return null;
	}

	if (JWT_SHAPE.test(value)) {
		return value;
	}

	if (!existsSync(value)) {
		console.error(`[license] NAO_LICENSE file not found: ${value}`);
		return null;
	}

	const token = readFileSync(value, 'utf-8').trim();
	return token.length > 0 ? token : null;
}

async function importLicensePublicKey(): Promise<KeyObject | CryptoKey> {
	return importSPKI(getBundledPublicKey(), LICENSE_ALGORITHM);
}

function parseLicensePayload(payload: Record<string, unknown>): NaoLicense | null {
	const subscriptionId = typeof payload.subscriptionId === 'string' ? payload.subscriptionId : null;
	const companyName = typeof payload.companyName === 'string' ? payload.companyName : null;
	const exp = typeof payload.exp === 'number' ? payload.exp : null;
	const iat = typeof payload.iat === 'number' ? payload.iat : null;

	if (!subscriptionId || !companyName || exp === null || iat === null) {
		console.error('[license] NAO_LICENSE is missing required claims');
		return null;
	}

	return {
		subscriptionId,
		companyName,
		isTrial: Boolean(payload.isTrial),
		expiresAt: new Date(exp * 1000),
		issuedAt: new Date(iat * 1000),
		features: parseFeatures(payload.features),
	};
}

function parseFeatures(value: unknown): LicenseFeature[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const known = new Set<string>(Object.values(LICENSE_FEATURES));
	return value.filter((item): item is LicenseFeature => typeof item === 'string' && known.has(item));
}

function logLicenseError(err: unknown): void {
	if (err instanceof joseErrors.JWTExpired) {
		console.error('[license] NAO_LICENSE has expired.');
		return;
	}
	if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
		console.error('[license] NAO_LICENSE signature verification failed — the file has been altered.');
		return;
	}
	if (err instanceof joseErrors.JWTClaimValidationFailed) {
		console.error(`[license] NAO_LICENSE claim invalid: ${err.message}`);
		return;
	}
	const message = err instanceof Error ? err.message : String(err);
	console.error(`[license] Failed to verify NAO_LICENSE: ${message}`);
}
