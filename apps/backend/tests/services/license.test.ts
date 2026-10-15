import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../../src/env';
import {
	getLicense,
	hasFeature,
	LICENSE_ALL_FEATURES,
	LICENSE_FEATURES,
	refreshLicenseOnline,
	resetLicenseCache,
	startLicenseHeartbeat,
	stopLicenseHeartbeat,
} from '../../src/services/license.service';
import { pingLicensesServer } from '../../src/services/ping';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';

const DEFAULT_CLAIMS: LicenseClaims = {
	subscriptionId: 'sub_test_01',
	companyName: 'Acme Corp',
	features: [LICENSE_FEATURES.sso],
};

const EIGHT_DAYS_AGO_SECONDS = -8 * 24 * 60 * 60;

const createTemporaryFolder = useTemporaryFolders();

describe('license.service', () => {
	restoreProcessEnvAfterEach({ afterRestore: __reloadEnvForTesting });

	afterEach(() => {
		stopLicenseHeartbeat();
		resetLicenseCache();
		vi.unstubAllGlobals();
	});

	it('returns null when NAO_LICENSE is not set', async () => {
		setLicenseEnv({ licensePath: undefined });
		expect(await getLicense()).toBeNull();
		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});

	it('returns null when license file does not exist', async () => {
		setLicenseEnv({ licensePath: '/tmp/nao-license-that-does-not-exist' });
		expect(await getLicense()).toBeNull();
	});

	it('verifies a valid signed license', async () => {
		await installSignedLicense();

		const license = await getLicense();
		expect(license).not.toBeNull();
		expect(license?.subscriptionId).toBe('sub_test_01');
		expect(license?.companyName).toBe('Acme Corp');
		expect(license?.isOffline).toBe(false);
		expect(license?.features).toEqual(['sso']);
		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
	});

	it('rejects a license signed with a different key', async () => {
		const { licensePath } = await createSignedLicenseFile();
		const { publicKeyPem: unrelatedPublicKey } = await generateKeypairPem();

		setLicenseEnv({ licensePath, publicKeyPem: unrelatedPublicKey });

		expect(await getLicense()).toBeNull();
		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});

	it('rejects a license whose payload was tampered with', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile();
		const tampered = alterMiddleSegment(licensePath);
		writeFileSync(licensePath, tampered);

		setLicenseEnv({ licensePath, publicKeyPem });

		expect(await getLicense()).toBeNull();
	});

	it('keeps features enabled within the 7-day grace past expiry', async () => {
		await installSignedLicense({}, { expiresInSeconds: -60 });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
	});

	it('disables features once the 7-day grace has elapsed past expiry', async () => {
		await installSignedLicense({}, { expiresInSeconds: EIGHT_DAYS_AGO_SECONDS });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});

	it('only exposes known features from the license payload', async () => {
		await installSignedLicense({
			features: [
				LICENSE_FEATURES.sso,
				LICENSE_FEATURES.excludeColumns,
				LICENSE_FEATURES.rowLevelSecurity,
				'unknown-future-feature',
			],
		});

		const license = await getLicense();
		expect(license?.features).toEqual([
			LICENSE_FEATURES.sso,
			LICENSE_FEATURES.excludeColumns,
			LICENSE_FEATURES.rowLevelSecurity,
		]);
	});

	it('grants every known feature when the license carries the "*" wildcard', async () => {
		await installSignedLicense({ features: [LICENSE_ALL_FEATURES] });

		const allFeatures = Object.values(LICENSE_FEATURES);
		expect((await getLicense())?.features).toEqual(allFeatures);
		for (const feature of allFeatures) {
			expect(await hasFeature(feature)).toBe(true);
		}
	});

	it('expands the "*" wildcard even when listed alongside explicit or unknown features', async () => {
		await installSignedLicense({
			features: [LICENSE_FEATURES.sso, 'unknown-future-feature', LICENSE_ALL_FEATURES],
		});

		expect((await getLicense())?.features).toEqual(Object.values(LICENSE_FEATURES));
	});

	it('expands the "*" wildcard from a signed online verdict', async () => {
		const { privateKey } = await installSignedLicense({ features: [] });
		stubValidVerdict(privateKey, { features: [LICENSE_ALL_FEATURES] });

		expect(await hasFeature(LICENSE_FEATURES.userBudget)).toBe(false);

		await refreshLicenseOnline();

		expect((await getLicense())?.features).toEqual(Object.values(LICENSE_FEATURES));
		expect(await hasFeature(LICENSE_FEATURES.userBudget)).toBe(true);
	});

	it('updates cached features from signed online validation', async () => {
		const { privateKey } = await installSignedLicense({ features: [] });
		stubValidVerdict(privateKey, { features: [LICENSE_FEATURES.sso] });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);

		await refreshLicenseOnline();

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
		expect((await getLicense())?.features).toEqual([LICENSE_FEATURES.sso]);
	});

	it('extends an expired license when the renewal is verified online', async () => {
		const { privateKey } = await installSignedLicense({}, { expiresInSeconds: EIGHT_DAYS_AGO_SECONDS });
		const renewedExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
		stubValidVerdict(privateKey, { expiresAt: renewedExpiry.toISOString(), features: [LICENSE_FEATURES.sso] });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);

		await refreshLicenseOnline();

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
		expect((await getLicense())?.expiresAt).toEqual(renewedExpiry);
	});

	it('never shortens the license expiry from an online verdict', async () => {
		const { privateKey } = await installSignedLicense();
		const originalExpiry = (await getLicense())?.expiresAt;
		stubValidVerdict(privateKey, {
			expiresAt: new Date(Date.now() - 60_000).toISOString(),
			features: [LICENSE_FEATURES.sso],
		});

		await refreshLicenseOnline();

		expect((await getLicense())?.expiresAt).toEqual(originalExpiry);
		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
	});

	it('never checks online for offline licenses', async () => {
		await installSignedLicense({ isOffline: true });
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);

		await startLicenseHeartbeat();
		await refreshLicenseOnline();

		expect(fetch).not.toHaveBeenCalled();
	});

	it('skips the startup ping for offline licenses', async () => {
		process.env.MODE = 'prod';
		await installSignedLicense({ isOffline: true });
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);

		await pingLicensesServer();

		expect(fetch).not.toHaveBeenCalled();
	});

	it('includes instance configuration in the startup ping additional info', async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 201 }));
		process.env.MODE = 'prod';
		process.env.BETTER_AUTH_URL = 'https://chat.example.com';
		process.env.APP_VERSION = '1.2.3';
		process.env.NAO_MODE = 'self-hosted';
		process.env.BETA_AUTOMATIONS_ENABLED = 'false';
		process.env.BETA_CONTEXT_RECOMMENDATIONS_ENABLED = 'true';
		process.env.BETA_STORY_FILTERS_ENABLED = 'true';
		process.env.BETA_CUSTOM_STORIES_ENABLED = 'true';
		process.env.SMTP_HOST = 'smtp.example.com';
		process.env.SMTP_MAIL_FROM = 'hello@example.com';
		process.env.SMTP_PASSWORD = 'secret';
		process.env.GITHUB_SSO = 'true';
		process.env.GITHUB_CLIENT_ID = 'github-client';
		process.env.GITHUB_CLIENT_SECRET = 'github-secret';
		process.env.AZURE_AD_CLIENT_ID = 'azure-client';
		process.env.AZURE_AD_CLIENT_SECRET = 'azure-secret';
		process.env.AZURE_AD_TENANT_ID = 'azure-tenant';
		process.env.OIDC_CLIENT_ID = 'oidc-client';
		process.env.OIDC_CLIENT_SECRET = 'oidc-secret';
		process.env.OIDC_DISCOVERY_URL = 'https://oidc.example.com/.well-known/openid-configuration';
		setLicenseEnv({ licensePath: undefined });
		vi.stubGlobal('fetch', fetch);

		await pingLicensesServer();

		const [, init] = fetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body));
		expect(body).toEqual({
			betterAuthUrl: 'https://chat.example.com',
			naoVersion: '1.2.3',
			additionalInfo: expect.objectContaining({
				betaAutomationsEnabled: false,
				betaContextRecommendationsEnabled: true,
				betaStoryFiltersEnabled: true,
				betaCustomStoriesEnabled: true,
				smtpConfigured: true,
				loginModesConfigured: {
					google: false,
					github: true,
					azure: true,
					oidc: true,
				},
			}),
		});
		expect(body.additionalInfo.userCount === null || typeof body.additionalInfo.userCount === 'number').toBe(true);
	});

	it('expires offline licenses strictly at expiresAt', async () => {
		await installSignedLicense({ isOffline: true }, { expiresInSeconds: -60 });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});
});

interface LicenseEnv {
	licensePath?: string;
	publicKeyPem?: string;
}

interface LicenseClaims {
	subscriptionId: string;
	companyName: string;
	isOffline?: boolean;
	features: string[];
}

interface LicenseFileOptions {
	expiresInSeconds?: number;
}

interface SignedLicenseFile {
	licensePath: string;
	privateKey: CryptoKey;
	publicKeyPem: string;
}

interface ValidateClaims {
	subscriptionId: string;
	valid: boolean;
	isActive: boolean;
	expiresAt?: string;
	features: string[];
}

async function installSignedLicense(
	claims: Partial<LicenseClaims> = {},
	options: LicenseFileOptions = {},
): Promise<SignedLicenseFile> {
	const licenseFile = await createSignedLicenseFile(claims, options);
	setLicenseEnv(licenseFile);
	return licenseFile;
}

function setLicenseEnv({ licensePath, publicKeyPem }: LicenseEnv): void {
	if (licensePath === undefined) {
		delete process.env.NAO_LICENSE;
	} else {
		process.env.NAO_LICENSE = licensePath;
	}
	if (publicKeyPem !== undefined) {
		process.env.NAO_LICENSE_PUBLIC_KEY = publicKeyPem;
	}
	__reloadEnvForTesting();
}

async function createSignedLicenseFile(
	claimOverrides: Partial<LicenseClaims> = {},
	options: LicenseFileOptions = {},
): Promise<SignedLicenseFile> {
	const claims = { ...DEFAULT_CLAIMS, ...claimOverrides };
	const { privateKey, publicKeyPem } = await generateKeypairPem();
	const expiresIn = options.expiresInSeconds ?? 3600;
	const now = Math.floor(Date.now() / 1000);

	const token = await new SignJWT({
		subscriptionId: claims.subscriptionId,
		companyName: claims.companyName,
		isOffline: Boolean(claims.isOffline),
		features: claims.features,
	})
		.setProtectedHeader({ alg: 'EdDSA' })
		.setIssuer('getnao')
		.setIssuedAt(now)
		.setExpirationTime(now + expiresIn)
		.sign(privateKey);

	const licensePath = path.join(createTemporaryFolder('nao-license-'), 'license.key');
	writeFileSync(licensePath, token);

	return { licensePath, privateKey, publicKeyPem };
}

/** Stubs `fetch` with a positive verdict bound to the default license subscription. */
function stubValidVerdict(privateKey: CryptoKey, claims: Pick<ValidateClaims, 'expiresAt' | 'features'>): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			const token = await createSignedValidateToken(privateKey, {
				subscriptionId: DEFAULT_CLAIMS.subscriptionId,
				valid: true,
				isActive: true,
				...claims,
			});
			return new Response(JSON.stringify({ token }));
		}),
	);
}

async function createSignedValidateToken(privateKey: CryptoKey, claims: ValidateClaims): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({ ...claims })
		.setProtectedHeader({ alg: 'EdDSA' })
		.setIssuer('getnao')
		.setIssuedAt(now)
		.setExpirationTime(now + 300)
		.sign(privateKey);
}

async function generateKeypairPem(): Promise<{
	privateKey: CryptoKey;
	publicKeyPem: string;
}> {
	const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
	const publicKeyPem = await exportSPKI(publicKey);
	return { privateKey, publicKeyPem };
}

function alterMiddleSegment(filePath: string): string {
	const token = readFileSync(filePath, 'utf-8').trim();
	const [header, payload, signature] = token.split('.');
	const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as Record<string, unknown>;
	decoded.companyName = 'Attacker Inc';
	const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url').replace(/=+$/, '');
	return `${header}.${tamperedPayload}.${signature}`;
}
