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

function loadEnv(mode: 'cloud' | 'self-hosted', contextSource: (typeof contextSources)[number]) {
	const { backendDirectory, temporaryDirectory } = createIsolatedBackendDirectory();

	try {
		return spawnSync('bun', ['--eval', `await import(${JSON.stringify(envModuleUrl)})`], {
			cwd: backendDirectory,
			encoding: 'utf8',
			env: {
				PATH: process.env.PATH,
				NAO_CONTEXT_SOURCE: contextSource,
				NAO_DEFAULT_PROJECT_PATH: '',
				NAO_MODE: mode,
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
