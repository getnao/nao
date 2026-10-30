import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const contextSources = ['local', 'git', 'api'] as const;
const cloudCompatibleContextSources = ['local', 'api'] as const;
const gitCloudError = 'NAO_CONTEXT_SOURCE=git cannot be set when NAO_MODE=cloud.';
const envModuleUrl = new URL('../src/env.ts', import.meta.url).href;

describe('NAO_CONTEXT_SOURCE', () => {
	it('rejects git in cloud mode', () => {
		const result = loadEnv('cloud', 'git');

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(gitCloudError);
	});

	it.each(cloudCompatibleContextSources)('accepts %s in cloud mode', (contextSource) => {
		const result = loadEnv('cloud', contextSource);

		expect(result.status).toBe(0);
		expect(result.stderr).not.toContain(gitCloudError);
	});

	it.each(contextSources)('accepts %s in self-hosted mode', (contextSource) => {
		const result = loadEnv('self-hosted', contextSource);

		expect(result.status).toBe(0);
		expect(result.stderr).not.toContain(gitCloudError);
	});
});

describe('cloud billing environment', () => {
	it('is disabled by default', () => {
		expect(loadEnvWithOverrides({ NAO_MODE: 'cloud' }).status).toBe(0);
	});

	it('requires Stripe configuration when enabled in cloud mode', () => {
		const result = loadEnvWithOverrides({ CLOUD_BILLING_ENABLED: 'true', NAO_MODE: 'cloud' });

		expect(result.status).toBe(1);
		for (const variable of [
			'STRIPE_SECRET_KEY',
			'STRIPE_WEBHOOK_SECRET',
			'STRIPE_CLOUD_LEGACY_PRODUCT_ID',
			'STRIPE_CLOUD_TEAM_PRODUCT_ID',
			'STRIPE_CLOUD_UNLIMITED_PRODUCT_ID',
			'STRIPE_CLOUD_TRIAL_PRODUCT_ID',
			'STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY',
			'STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY',
			'STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY',
			'STRIPE_CLOUD_TEAM_MONTHLY_PRICE_LOOKUP_KEY',
			'STRIPE_CLOUD_TEAM_YEARLY_PRICE_LOOKUP_KEY',
			'STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY',
			'STRIPE_CLOUD_UNLIMITED_YEARLY_PRICE_LOOKUP_KEY',
			'STRIPE_CREDIT_PRODUCT_ID',
			'STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID',
		]) {
			expect(result.stderr).toContain(`${variable} is required when cloud billing is enabled`);
		}
	});

	it('remains inactive in self-hosted mode', () => {
		const result = loadEnvWithOverrides({
			CLOUD_BILLING_ENABLED: 'true',
			NAO_MODE: 'self-hosted',
		});

		expect(result.status).toBe(0);
	});

	it.each(['true', 'false'] as const)('accepts an explicit free-tier flag of %s', (flag) => {
		const result = loadEnvWithOverrides(validCloudBillingEnv({ CLOUD_FREE_TIER_ENABLED: flag }));

		expect(result.status).toBe(0);
	});

	it.each([
		'STRIPE_SECRET_KEY',
		'STRIPE_WEBHOOK_SECRET',
		'STRIPE_CLOUD_LEGACY_PRODUCT_ID',
		'STRIPE_CLOUD_TEAM_PRODUCT_ID',
		'STRIPE_CLOUD_UNLIMITED_PRODUCT_ID',
		'STRIPE_CLOUD_TRIAL_PRODUCT_ID',
		'STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY',
		'STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY',
		'STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY',
		'STRIPE_CLOUD_TEAM_MONTHLY_PRICE_LOOKUP_KEY',
		'STRIPE_CLOUD_TEAM_YEARLY_PRICE_LOOKUP_KEY',
		'STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY',
		'STRIPE_CLOUD_UNLIMITED_YEARLY_PRICE_LOOKUP_KEY',
		'STRIPE_CREDIT_PRODUCT_ID',
		'STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID',
	] as const)('rejects missing %s while the flag is off', (variable) => {
		const configured = validCloudBillingEnv();
		delete configured[variable];
		const result = loadEnvWithOverrides(configured);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`${variable} is required when cloud billing is enabled`);
	});

	it.each(['STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY', 'STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY'] as const)(
		'allows missing legacy lookup key %s while the flag is on',
		(variable) => {
			const configured = validCloudBillingEnv({ CLOUD_FREE_TIER_ENABLED: 'true' });
			delete configured[variable];

			expect(loadEnvWithOverrides(configured).status).toBe(0);
		},
	);

	it.each([
		['STRIPE_CLOUD_TEAM_PRODUCT_ID', 'STRIPE_CLOUD_UNLIMITED_PRODUCT_ID'],
		['STRIPE_CLOUD_LEGACY_PRODUCT_ID', 'STRIPE_CLOUD_TRIAL_PRODUCT_ID'],
	] as const)('rejects duplicate Product ids in %s and %s', (first, second) => {
		const configured = validCloudBillingEnv();
		configured[second] = configured[first];
		const result = loadEnvWithOverrides(configured);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Stripe Product ids must be distinct');
	});

	it('rejects duplicate lookup keys across current and legacy Prices', () => {
		const result = loadEnvWithOverrides(
			validCloudBillingEnv({
				STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY: 'legacy_monthly',
			}),
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Stripe cloud Price lookup keys must be distinct');
	});

	it('rejects the deprecated cloud Product variable', () => {
		const result = loadEnvWithOverrides(
			validCloudBillingEnv({
				STRIPE_CLOUD_PRODUCT_ID: 'prod_deprecated',
			}),
		);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('STRIPE_CLOUD_PRODUCT_ID is deprecated; use STRIPE_CLOUD_LEGACY_PRODUCT_ID');
	});
});

describe('cloud SMTP environment', () => {
	it('allows cloud mode without SMTP configuration', () => {
		expect(
			loadEnvWithOverrides({
				NAO_MODE: 'cloud',
				SMTP_HOST: '',
				SMTP_MAIL_FROM: '',
				SMTP_PASSWORD: '',
			}).status,
		).toBe(0);
	});

	it('treats blank SMTP_PORT and SMTP_SSL as their defaults', () => {
		expect(loadEnvWithOverrides({ NAO_MODE: 'cloud', SMTP_PORT: '', SMTP_SSL: '' }).status).toBe(0);
	});

	it('allows self-hosted mode without SMTP configuration', () => {
		expect(
			loadEnvWithOverrides({
				NAO_MODE: 'self-hosted',
				SMTP_HOST: '',
				SMTP_MAIL_FROM: '',
				SMTP_PASSWORD: '',
			}).status,
		).toBe(0);
	});
});

function loadEnv(mode: 'cloud' | 'self-hosted', contextSource: (typeof contextSources)[number]) {
	return loadEnvWithOverrides({
		NAO_CONTEXT_SOURCE: contextSource,
		NAO_DEFAULT_PROJECT_PATH: '',
		NAO_MODE: mode,
	});
}

function validCloudBillingEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
	return {
		CLOUD_BILLING_ENABLED: 'true',
		CLOUD_FREE_TIER_ENABLED: 'false',
		NAO_MODE: 'cloud',
		STRIPE_CLOUD_LEGACY_PRODUCT_ID: 'prod_legacy',
		STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY: 'legacy_monthly',
		STRIPE_CLOUD_TEAM_MONTHLY_PRICE_LOOKUP_KEY: 'team_monthly',
		STRIPE_CLOUD_TEAM_PRODUCT_ID: 'prod_team',
		STRIPE_CLOUD_TEAM_YEARLY_PRICE_LOOKUP_KEY: 'team_yearly',
		STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY: 'trial',
		STRIPE_CLOUD_TRIAL_PRODUCT_ID: 'prod_trial',
		STRIPE_CLOUD_UNLIMITED_MONTHLY_PRICE_LOOKUP_KEY: 'unlimited_monthly',
		STRIPE_CLOUD_UNLIMITED_PRODUCT_ID: 'prod_unlimited',
		STRIPE_CLOUD_UNLIMITED_YEARLY_PRICE_LOOKUP_KEY: 'unlimited_yearly',
		STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY: 'legacy_yearly',
		STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID: 'prod_platform_fee',
		STRIPE_CREDIT_PRODUCT_ID: 'prod_credits',
		STRIPE_SECRET_KEY: 'sk_test_sandbox',
		STRIPE_WEBHOOK_SECRET: 'whsec_sandbox',
		...overrides,
	};
}

function loadEnvWithOverrides(overrides: NodeJS.ProcessEnv) {
	const { backendDirectory, temporaryDirectory } = createIsolatedBackendDirectory();

	try {
		return spawnSync('bun', ['--eval', `await import(${JSON.stringify(envModuleUrl)})`], {
			cwd: backendDirectory,
			encoding: 'utf8',
			env: {
				PATH: process.env.PATH,
				...(overrides.NAO_MODE === 'cloud' && {
					CLOUD_GITHUB_PROJECT_ORG: 'test-org',
					CLOUD_GITHUB_PROJECT_APP_ID: '123',
					CLOUD_GITHUB_PROJECT_INSTALLATION_ID: '456',
					CLOUD_GITHUB_PROJECT_PRIVATE_KEY: 'test-private-key',
					SMTP_HOST: 'smtp.example.com',
					SMTP_MAIL_FROM: 'hello@example.com',
					SMTP_PASSWORD: 'secret',
				}),
				...overrides,
			},
		});
	} finally {
		rmSync(temporaryDirectory, { force: true, recursive: true });
	}
}

function createIsolatedBackendDirectory() {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), 'nao-env-test-'));
	const backendDirectory = join(temporaryDirectory, 'apps', 'backend');
	mkdirSync(backendDirectory, { recursive: true });

	return { backendDirectory, temporaryDirectory };
}
