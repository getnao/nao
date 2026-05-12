/* @license Enterprise */

import { existsSync, readFileSync } from 'node:fs';

import { errors as joseErrors, importSPKI, jwtVerify, type KeyObject } from 'jose';

import { env } from '../env';
import { LICENSE_FEATURES, type LicenseFeature, type NaoLicense } from '../types/license';
import { LICENSES_BASE_URL } from './license-endpoints';
import { getBundledPublicKey } from './license-public-key';

export type { LicenseFeature, LicenseStatus, NaoLicense } from '../types/license';
export { LICENSE_FEATURES, LICENSE_STATUSES } from '../types/license';

const LICENSE_ISSUER = 'getnao';
const LICENSE_ALGORITHM = 'EdDSA';

const ONLINE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ONLINE_CHECK_TIMEOUT_MS = 10_000;

/**
 * Hard cutoff for enterprise features past the license's own `exp` claim.
 * Anchoring the grace to the (signed, untamperable) license expiry — rather
 * than to a "last successful check" timestamp — means a server restart or a
 * tampered DB cannot extend the window. The license JWT itself carries the
 * end-of-grace timestamp.
 */
const POST_EXPIRY_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

type OnlineVerdict = 'active' | 'inactive';

let licensePromise: Promise<NaoLicense | null> | null = null;
let publicKeyPromise: Promise<KeyObject | CryptoKey> | null = null;
let publicKeyPem: string | null = null;
let onlineVerdict: OnlineVerdict | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
	if (isLicenseExpiredForFeatureChecks(license)) {
		return false;
	}
	if (onlineVerdict === 'inactive') {
		return false;
	}
	return license.features.includes(feature);
}

/**
 * Start the in-process online verification heartbeat. Kicks off an immediate
 * check then schedules one every 12h. Independent of the generic scheduler so
 * a customer cannot disable license verification by tampering with the
 * `scheduled_job` table.
 *
 * Does nothing when `NAO_LICENSE` is absent or the signed license is offline —
 * OSS installs and offline enterprise licenses should never phone home.
 */
export async function startLicenseHeartbeat(): Promise<void> {
	if (heartbeatTimer || !env.NAO_LICENSE) {
		return;
	}
	const license = await getLicense();
	if (!license || license.isOffline) {
		return;
	}
	void refreshLicenseOnline();
	heartbeatTimer = setInterval(() => void refreshLicenseOnline(), ONLINE_CHECK_INTERVAL_MS);
	heartbeatTimer.unref?.();
}

export function stopLicenseHeartbeat(): void {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

export function resetLicenseCache(): void {
	licensePromise = null;
	onlineVerdict = null;
}

/**
 * Hit the licenses server and update the in-memory verdict on success. The
 * server's response is a signed JWT (EdDSA, same key as the license token),
 * so a customer who blackholes `licenses.getnao.io` to a fake server cannot
 * forge a positive verdict — they would need the private key. On any
 * verification failure (signature, expiry, issuer, subscription binding) we
 * leave the cached verdict untouched: revocation is sticky, and a transient
 * outage can never silently re-activate a previously revoked license.
 */
export async function refreshLicenseOnline(): Promise<void> {
	const license = await getLicense();
	if (!license || license.isOffline) {
		return;
	}

	const url = `${LICENSES_BASE_URL}/api/licenses/${license.subscriptionId}/validate/`;
	let response: Response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(ONLINE_CHECK_TIMEOUT_MS) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[license] online verification request failed: ${message}`);
		return;
	}

	let token: string | undefined;
	try {
		const body = (await response.json()) as { token?: unknown };
		token = typeof body.token === 'string' ? body.token : undefined;
	} catch {
		console.warn(`[license] online verification: malformed response (HTTP ${response.status})`);
		return;
	}

	if (!token) {
		console.warn(`[license] online verification: response missing signed token (HTTP ${response.status})`);
		return;
	}

	const verdict = await verifyValidateToken(token, license.subscriptionId);
	if (!verdict) {
		return;
	}

	onlineVerdict = verdict.valid && verdict.isActive ? 'active' : 'inactive';

	if (onlineVerdict === 'inactive') {
		const reason = verdict.reason ?? 'revoked or expired';
		console.warn(`[license] ${license.subscriptionId} reported as inactive (${reason})`);
	} else {
		updateCachedLicenseFromOnlineVerdict(license, verdict);
		console.log(`[license] ${license.subscriptionId} verified online: active`);
	}
}

interface ValidateVerdict {
	valid: boolean;
	isActive: boolean;
	features?: LicenseFeature[];
	reason?: string;
}

async function verifyValidateToken(token: string, expectedSubscriptionId: string): Promise<ValidateVerdict | null> {
	try {
		const payload = await verifySignedToken(token);

		// CRITICAL: reject a verdict bound to a different subscription. Without
		// this, an attacker holding any valid positive response (e.g. captured
		// from a public test instance, or their own legitimate license) could
		// replay it as the customer's verdict.
		if (typeof payload.subscriptionId !== 'string' || payload.subscriptionId !== expectedSubscriptionId) {
			console.warn(`[license] online verification: subscriptionId mismatch (expected ${expectedSubscriptionId})`);
			return null;
		}

		return {
			valid: payload.valid === true,
			isActive: payload.isActive === true,
			features: parseOptionalFeatures(payload.features),
			reason: typeof payload.reason === 'string' ? payload.reason : undefined,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[license] online verification: token verification failed: ${message}`);
		return null;
	}
}

function updateCachedLicenseFromOnlineVerdict(license: NaoLicense, verdict: ValidateVerdict): void {
	if (!verdict.features) {
		return;
	}

	licensePromise = Promise.resolve({
		...license,
		features: verdict.features,
	});
}

async function loadAndVerifyLicense(): Promise<NaoLicense | null> {
	const token = readLicenseToken();
	if (!token) {
		return null;
	}

	try {
		const payload = await verifySignedToken(token);

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
	const pem = getBundledPublicKey();
	if (!publicKeyPromise || publicKeyPem !== pem) {
		publicKeyPem = pem;
		publicKeyPromise = importSPKI(pem, LICENSE_ALGORITHM);
	}
	return publicKeyPromise;
}

async function verifySignedToken(token: string): Promise<Record<string, unknown>> {
	const publicKey = await importLicensePublicKey();
	const { payload } = await jwtVerify(token, publicKey, {
		issuer: LICENSE_ISSUER,
		algorithms: [LICENSE_ALGORITHM],
	});
	return payload;
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
		isOffline: Boolean(payload.isOffline),
		expiresAt: new Date(exp * 1000),
		issuedAt: new Date(iat * 1000),
		features: parseFeatures(payload.features),
	};
}

function isLicenseExpiredForFeatureChecks(license: NaoLicense): boolean {
	const graceMs = license.isOffline ? 0 : POST_EXPIRY_GRACE_MS;
	return Date.now() > license.expiresAt.getTime() + graceMs;
}

function parseFeatures(value: unknown): LicenseFeature[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const known = new Set<string>(Object.values(LICENSE_FEATURES));
	return value.filter((item): item is LicenseFeature => typeof item === 'string' && known.has(item));
}

function parseOptionalFeatures(value: unknown): LicenseFeature[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return parseFeatures(value);
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
