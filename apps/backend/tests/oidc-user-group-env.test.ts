import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting, env } from '../src/env';

describe('OIDC_GROUP_NAO_GROUP_MAPPING', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('accepts valid wildcard and project-specific entries', () => {
		process.env.OIDC_GROUP_NAO_GROUP_MAPPING = 'finance:*:Analysts,leaders:project-1:Managers';
		__reloadEnvForTesting();
		expect(env.OIDC_GROUP_NAO_GROUP_MAPPING).toBe('finance:*:Analysts,leaders:project-1:Managers');
	});

	it.each(['finance', 'finance:*', 'finance:*:Analysts:Extra', 'finance:*:Analysts,finance:*:Managers'])(
		'rejects malformed or ambiguous value %s',
		(value) => {
			process.env.OIDC_GROUP_NAO_GROUP_MAPPING = value;
			expect(() => __reloadEnvForTesting()).toThrow(/OIDC_GROUP_NAO_GROUP_MAPPING/);
		},
	);
});

describe('Microsoft Entra group environment mappings', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('accepts wildcard, project-specific, and organization-role mappings', () => {
		process.env.AZURE_AD_GROUP_NAO_GROUP_MAPPING =
			'A0B1C2D3-E4F5-6789-ABCD-EF0123456789:*:Analysts,11111111-2222-3333-4444-555555555555:project-1:Managers';
		process.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING =
			'A0B1C2D3-E4F5-6789-ABCD-EF0123456789:admin,11111111-2222-3333-4444-555555555555:viewer';

		__reloadEnvForTesting();

		expect(env.AZURE_AD_GROUP_NAO_GROUP_MAPPING).toContain('*:Analysts');
		expect(env.AZURE_AD_GROUP_NAO_ROLE_MAPPING).toContain(':admin');
	});

	it.each([
		'not-a-guid:*:Analysts',
		'a0b1c2d3-e4f5-6789-abcd-ef0123456789:*',
		'a0b1c2d3-e4f5-6789-abcd-ef0123456789:*:Analysts:Extra',
		'a0b1c2d3-e4f5-6789-abcd-ef0123456789:*:Analysts,a0b1c2d3-e4f5-6789-abcd-ef0123456789:*:Managers',
	])('rejects invalid User Group mapping %s', (value) => {
		process.env.AZURE_AD_GROUP_NAO_GROUP_MAPPING = value;
		expect(() => __reloadEnvForTesting()).toThrow(/AZURE_AD_GROUP_NAO_GROUP_MAPPING/);
	});

	it.each([
		'not-a-guid:admin',
		'a0b1c2d3-e4f5-6789-abcd-ef0123456789:context_admin',
		'a0b1c2d3-e4f5-6789-abcd-ef0123456789',
		'a0b1c2d3-e4f5-6789-abcd-ef0123456789:admin,a0b1c2d3-e4f5-6789-abcd-ef0123456789:viewer',
	])('rejects invalid organization-role mapping %s', (value) => {
		process.env.AZURE_AD_GROUP_NAO_ROLE_MAPPING = value;
		expect(() => __reloadEnvForTesting()).toThrow(/AZURE_AD_GROUP_NAO_ROLE_MAPPING/);
	});
});
