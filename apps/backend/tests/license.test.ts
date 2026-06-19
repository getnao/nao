import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import {
	getLicense,
	hasFeature,
	LICENSE_FEATURES,
	refreshLicenseOnline,
	resetLicenseCache,
	startLicenseHeartbeat,
	stopLicenseHeartbeat,
} from '../src/services/license.service';
import { pingLicensesServer } from '../src/services/ping';

const DEFAULT_CLAIMS = {
	subscriptionId: 'sub_test_01',
	companyName: 'Acme Corp',
	features: [LICENSE_FEATURES.sso],
};

describe('license.service', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
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
		const { licensePath, publicKeyPem } = await createSignedLicenseFile(DEFAULT_CLAIMS);
		setLicenseEnv({ licensePath, publicKeyPem });

		const license = await getLicense();
		expect(license).not.toBeNull();
		expect(license?.subscriptionId).toBe('sub_test_01');
		expect(license?.companyName).toBe('Acme Corp');
		expect(license?.isOffline).toBe(false);
		expect(license?.features).toEqual(['sso']);
		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
	});

	it('rejects a license signed with a different key', async () => {
		const { licensePath } = await createSignedLicenseFile(DEFAULT_CLAIMS);
		const { publicKeyPem: unrelatedPublicKey } = await generateKeypairPem();

		setLicenseEnv({ licensePath, publicKeyPem: unrelatedPublicKey });

		expect(await getLicense()).toBeNull();
		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});

	it('rejects a license whose payload was tampered with', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile(DEFAULT_CLAIMS);
		const tampered = alterMiddleSegment(licensePath);
		writeFileSync(licensePath, tampered);

		setLicenseEnv({ licensePath, publicKeyPem });

		expect(await getLicense()).toBeNull();
	});

	it('keeps features enabled within the 7-day grace past expiry', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile(DEFAULT_CLAIMS, {
			expiresInSeconds: -60,
		});
		setLicenseEnv({ licensePath, publicKeyPem });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
	});

	it('disables features once the 7-day grace has elapsed past expiry', async () => {
		const eightDaysAgoSeconds = -8 * 24 * 60 * 60;
		const { licensePath, publicKeyPem } = await createSignedLicenseFile(DEFAULT_CLAIMS, {
			expiresInSeconds: eightDaysAgoSeconds,
		});
		setLicenseEnv({ licensePath, publicKeyPem });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});

	it('only exposes known features from the license payload', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile({
			...DEFAULT_CLAIMS,
			features: ['sso', 'unknown-future-feature'],
		});
		setLicenseEnv({ licensePath, publicKeyPem });

		const license = await getLicense();
		expect(license?.features).toEqual(['sso']);
	});

	it('updates cached features from signed online validation', async () => {
		const { licensePath, privateKey, publicKeyPem } = await createSignedLicenseFile({
			...DEFAULT_CLAIMS,
			features: [],
		});
		setLicenseEnv({ licensePath, publicKeyPem });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const token = await createSignedValidateToken(privateKey, {
					subscriptionId: DEFAULT_CLAIMS.subscriptionId,
					valid: true,
					isActive: true,
					features: [LICENSE_FEATURES.sso],
				});
				return new Response(JSON.stringify({ token }));
			}),
		);

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);

		await refreshLicenseOnline();

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(true);
		expect((await getLicense())?.features).toEqual([LICENSE_FEATURES.sso]);
	});

	it('never checks online for offline licenses', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile({
			...DEFAULT_CLAIMS,
			isOffline: true,
		});
		const fetch = vi.fn();
		setLicenseEnv({ licensePath, publicKeyPem });
		vi.stubGlobal('fetch', fetch);

		await startLicenseHeartbeat();
		await refreshLicenseOnline();

		expect(fetch).not.toHaveBeenCalled();
	});

	it('skips the startup ping for offline licenses', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile({
			...DEFAULT_CLAIMS,
			isOffline: true,
		});
		const fetch = vi.fn();
		process.env.MODE = 'prod';
		setLicenseEnv({ licensePath, publicKeyPem });
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
		const { licensePath, publicKeyPem } = await createSignedLicenseFile(
			{
				...DEFAULT_CLAIMS,
				isOffline: true,
			},
			{ expiresInSeconds: -60 },
		);
		setLicenseEnv({ licensePath, publicKeyPem });

		expect(await hasFeature(LICENSE_FEATURES.sso)).toBe(false);
	});
});

interface LicenseEnv {
	licensePath?: string;
	publicKeyPem?: string;
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

interface LicenseClaims {
	subscriptionId: string;
	companyName: string;
	isOffline?: boolean;
	features: string[];
}

async function createSignedLicenseFile(
	claims: LicenseClaims,
	options: { expiresInSeconds?: number } = {},
): Promise<{ licensePath: string; privateKey: CryptoKey; publicKeyPem: string }> {
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

	const dir = mkdtempSync(path.join(tmpdir(), 'nao-license-'));
	const licensePath = path.join(dir, 'license.key');
	writeFileSync(licensePath, token);

	return { licensePath, privateKey, publicKeyPem };
}

async function createSignedValidateToken(
	privateKey: CryptoKey,
	claims: {
		subscriptionId: string;
		valid: boolean;
		isActive: boolean;
		features: string[];
	},
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT(claims)
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
