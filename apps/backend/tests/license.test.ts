import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { getLicense, hasFeature, LICENSE_FEATURES, resetLicenseCache } from '../src/services/license.service';

const DEFAULT_CLAIMS = {
	subscriptionId: 'sub_test_01',
	companyName: 'Acme Corp',
	isTrial: false,
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
		resetLicenseCache();
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

	it('treats an expired license as unlicensed for feature checks', async () => {
		const { licensePath, publicKeyPem } = await createSignedLicenseFile(DEFAULT_CLAIMS, {
			expiresInSeconds: -60,
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
	isTrial: boolean;
	features: string[];
}

async function createSignedLicenseFile(
	claims: LicenseClaims,
	options: { expiresInSeconds?: number } = {},
): Promise<{ licensePath: string; publicKeyPem: string }> {
	const { privateKey, publicKeyPem } = await generateKeypairPem();
	const expiresIn = options.expiresInSeconds ?? 3600;
	const now = Math.floor(Date.now() / 1000);

	const token = await new SignJWT({
		subscriptionId: claims.subscriptionId,
		companyName: claims.companyName,
		isTrial: claims.isTrial,
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

	return { licensePath, publicKeyPem };
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
