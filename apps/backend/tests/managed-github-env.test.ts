import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';

const MANAGED_GITHUB_FIELDS = [
	'CLOUD_GITHUB_PROJECT_ORG',
	'CLOUD_GITHUB_PROJECT_APP_ID',
	'CLOUD_GITHUB_PROJECT_INSTALLATION_ID',
	'CLOUD_GITHUB_PROJECT_PRIVATE_KEY',
] as const;

describe('managed GitHub environment', () => {
	let originalEnv: typeof process.env;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
		__reloadEnvForTesting();
	});

	it('requires managed GitHub configuration in cloud mode', () => {
		process.env.NAO_MODE = 'cloud';
		clearManagedGithubEnv();

		expect(() => __reloadEnvForTesting()).toThrow(/CLOUD_GITHUB_PROJECT_ORG.*NAO_MODE=cloud/s);
	});

	it('rejects partial managed GitHub configuration in self-hosted mode', () => {
		process.env.NAO_MODE = 'self-hosted';
		clearManagedGithubEnv();
		process.env.CLOUD_GITHUB_PROJECT_ORG = 'nao-org';

		expect(() => __reloadEnvForTesting()).toThrow(/CLOUD_GITHUB_PROJECT_APP_ID.*managed GitHub/s);
	});

	it('allows self-hosted mode without managed GitHub configuration', () => {
		process.env.NAO_MODE = 'self-hosted';
		clearManagedGithubEnv();

		expect(() => __reloadEnvForTesting()).not.toThrow();
	});
});

function clearManagedGithubEnv(): void {
	for (const field of MANAGED_GITHUB_FIELDS) {
		delete process.env[field];
	}
}
