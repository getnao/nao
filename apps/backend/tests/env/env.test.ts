import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TEST_STRIPE_CONFIG, TEST_STRIPE_ENV } from '../helpers/stripe-config';

const contextSources = ['local', 'git', 'api'] as const;
const cloudCompatibleContextSources = ['local', 'api'] as const;
const gitCloudError = 'NAO_CONTEXT_SOURCE=git cannot be set when NAO_MODE=cloud.';
const envModuleUrl = new URL('../../src/env.ts', import.meta.url).href;

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

describe('NAO_PROJECT_PATHS', () => {
	const cloudError = 'NAO_PROJECT_PATHS and NAO_MODE=cloud cannot be set at the same time.';

	it.each([
		{ mode: 'cloud', status: 1 },
		{ mode: 'self-hosted', status: 0 },
	])('exits with $status in $mode mode', ({ mode, status }) => {
		const result = loadEnvWithOverrides({
			NAO_MODE: mode,
			NAO_PROJECT_PATHS: '/app/projects/sales, /app/projects/finance',
		});

		expect(result.status).toBe(status);
		expect(result.stderr.includes(cloudError)).toBe(status === 1);
	});
});

describe('cloud billing environment', () => {
	it('is disabled by default', () => {
		expect(loadEnvWithOverrides({ NAO_MODE: 'cloud' }).status).toBe(0);
	});

	it('requires Stripe configuration when enabled in cloud mode', () => {
		const result = loadEnvWithOverrides({
			CLOUD_BILLING_ENABLED: 'true',
			NAO_MODE: 'cloud',
		});

		expect(result.status).toBe(1);
		for (const variable of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONFIG']) {
			expect(result.stderr).toContain(`${variable} is required when cloud billing is enabled`);
		}
	});

	it.each([
		{ config: '{not json', error: 'STRIPE_CONFIG must be valid JSON' },
		{
			config: JSON.stringify({
				...TEST_STRIPE_CONFIG,
				products: { ...TEST_STRIPE_CONFIG.products, team: undefined },
			}),
			error: 'STRIPE_CONFIG.products.team:',
		},
	])('rejects an invalid STRIPE_CONFIG with "$error"', ({ config, error }) => {
		const result = loadEnvWithOverrides({ NAO_MODE: 'cloud', STRIPE_CONFIG: config });

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(error);
	});

	it('remains inactive in self-hosted mode', () => {
		const result = loadEnvWithOverrides({
			CLOUD_BILLING_ENABLED: 'true',
			NAO_MODE: 'self-hosted',
		});

		expect(result.status).toBe(0);
	});

	it('accepts the minimal Stripe configuration', () => {
		const result = loadEnvWithOverrides({
			CLOUD_BILLING_ENABLED: 'true',
			NAO_MODE: 'cloud',
			...TEST_STRIPE_ENV,
		});

		expect(result.status).toBe(0);
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
