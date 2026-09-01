import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const contextSources = ['local', 'git', 'api'] as const;
const backendDirectory = fileURLToPath(new URL('..', import.meta.url));
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

function loadEnv(mode: 'cloud' | 'self-hosted', contextSource: (typeof contextSources)[number]) {
	return spawnSync('bun', ['--eval', `await import(${JSON.stringify(envModuleUrl)})`], {
		cwd: backendDirectory,
		encoding: 'utf8',
		env: {
			...process.env,
			NAO_CONTEXT_SOURCE: contextSource,
			NAO_DEFAULT_PROJECT_PATH: '',
			NAO_MODE: mode,
		},
	});
}
