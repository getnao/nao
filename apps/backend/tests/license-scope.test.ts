import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	isCloud: true,
	getOrganizationLicenseToken: vi.fn(),
	getProjectOrganizationLicenseToken: vi.fn(),
}));

vi.mock('../src/env', async (importOriginal) => {
	const original = await importOriginal<typeof import('../src/env')>();
	return {
		...original,
		env: { ...original.env, NAO_LICENSE: undefined },
		get isCloud() {
			return mocks.isCloud;
		},
	};
});
vi.mock('../src/queries/organization.queries', () => ({
	getOrganizationLicenseToken: mocks.getOrganizationLicenseToken,
	getProjectOrganizationLicenseToken: mocks.getProjectOrganizationLicenseToken,
}));

import {
	getFeatureAvailability,
	hasFeature,
	LICENSE_FEATURES,
	resetLicenseCache,
	verifyOrganizationLicense,
} from '../src/services/license.service';
import { __setBundledPublicKeyForTesting } from '../src/services/license-public-key';

let privateKey: CryptoKey;

describe('organization licenses', () => {
	beforeAll(async () => {
		const keyPair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
		privateKey = keyPair.privateKey;
		__setBundledPublicKeyForTesting(await exportSPKI(keyPair.publicKey));
	});

	afterAll(() => {
		__setBundledPublicKeyForTesting(null);
	});

	beforeEach(() => {
		vi.clearAllMocks();
		resetLicenseCache();
		mocks.isCloud = true;
	});

	it('grants the licensed features to the organization it was issued for', async () => {
		storeLicense('org-1', await signLicense({ orgId: 'org-1', features: ['row-level-security'] }));

		await expect(hasFeature(LICENSE_FEATURES.rowLevelSecurity, { orgId: 'org-1' })).resolves.toBe(true);
		await expect(hasFeature(LICENSE_FEATURES.userBudget, { orgId: 'org-1' })).resolves.toBe(false);
	});

	it('resolves the organization license of a project', async () => {
		const license = await signLicense({ orgId: 'org-1', features: ['*'] });
		mocks.getProjectOrganizationLicenseToken.mockResolvedValue({ orgId: 'org-1', license });

		await expect(hasFeature(LICENSE_FEATURES.userGroups, { projectId: 'project-1' })).resolves.toBe(true);
		expect(mocks.getProjectOrganizationLicenseToken).toHaveBeenCalledWith('project-1');
	});

	it('refuses a license copied onto another organization', async () => {
		storeLicense('org-2', await signLicense({ orgId: 'org-1', features: ['*'] }));

		await expect(hasFeature(LICENSE_FEATURES.excludeColumns, { orgId: 'org-2' })).resolves.toBe(false);
	});

	it('refuses an instance license stored on an organization', async () => {
		storeLicense('org-1', await signLicense({ features: ['*'] }));

		await expect(hasFeature(LICENSE_FEATURES.excludeColumns, { orgId: 'org-1' })).resolves.toBe(false);
	});

	it('refuses a token signed with another key', async () => {
		const { privateKey: foreignKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
		storeLicense('org-1', await signLicense({ orgId: 'org-1', features: ['*'] }, { key: foreignKey }));

		await expect(hasFeature(LICENSE_FEATURES.userGroups, { orgId: 'org-1' })).resolves.toBe(false);
	});

	it('stops granting features once the license expires', async () => {
		const license = await signLicense({ orgId: 'org-1', features: ['*'] }, { expiresInSeconds: -60 });
		storeLicense('org-1', license);

		await expect(hasFeature(LICENSE_FEATURES.userGroups, { orgId: 'org-1' })).resolves.toBe(false);
		await expect(verifyOrganizationLicense('org-1', license)).resolves.toMatchObject({ orgId: 'org-1' });
	});

	it('ignores organization licenses for unscoped, instance-wide checks', async () => {
		storeLicense('org-1', await signLicense({ orgId: 'org-1', features: ['*'] }));

		await expect(hasFeature(LICENSE_FEATURES.sso)).resolves.toBe(false);
		expect(mocks.getOrganizationLicenseToken).not.toHaveBeenCalled();
	});

	it('ignores organization licenses on self-hosted deployments', async () => {
		mocks.isCloud = false;
		storeLicense('org-1', await signLicense({ orgId: 'org-1', features: ['*'] }));

		await expect(hasFeature(LICENSE_FEATURES.userGroups, { orgId: 'org-1' })).resolves.toBe(false);
		expect(mocks.getOrganizationLicenseToken).not.toHaveBeenCalled();
	});

	it('reports every feature of a wildcard organization license as available', async () => {
		storeLicense('org-1', await signLicense({ orgId: 'org-1', features: ['*'] }));

		const availability = await getFeatureAvailability({ orgId: 'org-1' });

		expect(Object.values(availability).every(Boolean)).toBe(true);
		expect(Object.keys(availability)).toEqual(Object.values(LICENSE_FEATURES));
	});
});

function storeLicense(orgId: string, license: string): void {
	mocks.getOrganizationLicenseToken.mockImplementation(async (requestedOrgId: string) =>
		requestedOrgId === orgId ? { orgId, license } : null,
	);
}

async function signLicense(
	claims: { orgId?: string; features: string[] },
	options: { expiresInSeconds?: number; key?: CryptoKey } = {},
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({ subscriptionId: 'sub-1', companyName: 'Acme Corp', isOffline: true, ...claims })
		.setProtectedHeader({ alg: 'EdDSA' })
		.setIssuer('getnao')
		.setIssuedAt(now)
		.setExpirationTime(now + (options.expiresInSeconds ?? 3600))
		.sign(options.key ?? privateKey);
}
