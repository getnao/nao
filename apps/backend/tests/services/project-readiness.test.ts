import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/project-runtime-env', () => ({
	getProjectRuntimeEnvVars: vi.fn(),
}));

import { assessProjectReadiness, getProjectReadiness } from '../../src/services/project-readiness.service';
import { getProjectRuntimeEnvVars } from '../../src/services/project-runtime-env';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';

describe('assessProjectReadiness', () => {
	const createTemporaryFolder = useTemporaryFolders();
	restoreProcessEnvAfterEach();

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects a directory at the nao config path', () => {
		const projectPath = createTemporaryFolder('nao-readiness-');
		fs.mkdirSync(path.join(projectPath, 'nao_config.yaml'));

		expect(assessProjectReadiness({ path: projectPath, envVars: {} })).toMatchObject({
			ready: false,
			naoConfigExists: false,
		});
	});

	it('rejects a nao config that cannot be read', () => {
		const projectPath = createTemporaryFolder('nao-readiness-');
		fs.writeFileSync(path.join(projectPath, 'nao_config.yaml'), 'project_name: test');
		vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
			throw new Error('EACCES');
		});

		expect(assessProjectReadiness({ path: projectPath, envVars: {} })).toMatchObject({
			ready: false,
			naoConfigExists: false,
		});
	});

	it('reports missing MCP variables without a nao config', () => {
		const projectPath = createTemporaryFolder('nao-readiness-');
		const mcpDirectory = path.join(projectPath, 'agent', 'mcps');
		fs.mkdirSync(mcpDirectory, { recursive: true });
		fs.writeFileSync(
			path.join(mcpDirectory, 'mcp.json'),
			JSON.stringify({ mcpServers: { dbt: { env: { DBT_TOKEN: '${DBT_TOKEN}' } } } }),
		);

		expect(assessProjectReadiness({ path: projectPath, envVars: {} })).toMatchObject({
			ready: false,
			directoryExists: true,
			naoConfigExists: false,
			requiredEnvVars: ['DBT_TOKEN'],
			missingEnvVars: ['DBT_TOKEN'],
		});
	});

	it('accepts required variables supplied by the server environment', async () => {
		const projectPath = createTemporaryFolder('nao-readiness-');
		process.env.DATABASE_URL = 'postgres://server';
		vi.mocked(getProjectRuntimeEnvVars).mockResolvedValue({});
		fs.writeFileSync(
			path.join(projectPath, 'nao_config.yaml'),
			'databases:\n  - name: warehouse\n    url: {{ env("DATABASE_URL") }}\n',
		);

		await expect(getProjectReadiness({ id: 'project-id', path: projectPath })).resolves.toMatchObject({
			ready: true,
			missingEnvVars: [],
		});
	});
});
