import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const contextSources = ['local', 'git', 'api'] as const;
const envModuleUrl = new URL('../src/env.ts', import.meta.url).href;

describe.each(contextSources)('NAO_CONTEXT_SOURCE=%s', (contextSource) => {
	it('rejects the source in cloud mode', () => {
		const result = loadEnv('cloud', contextSource);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('NAO_CONTEXT_SOURCE cannot be set when NAO_MODE=cloud.');
	});

	it('accepts the source in self-hosted mode', () => {
		const result = loadEnv('self-hosted', contextSource);

		expect(result.status).toBe(0);
		expect(result.stderr).not.toContain('NAO_CONTEXT_SOURCE cannot be set when NAO_MODE=cloud.');
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
		expect(result.stderr).toContain('STRIPE_SECRET_KEY is required when cloud billing is enabled');
		expect(result.stderr).toContain(
			'STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY is required when cloud billing is enabled',
		);
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
			STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY: 'nao_cloud_monthly_v1',
			STRIPE_SECRET_KEY: 'sk_test_sandbox',
		});

		expect(result.status).toBe(0);
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
