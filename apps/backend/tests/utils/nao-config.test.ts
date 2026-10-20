import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { extractConfiguredRepos, extractRequiredEnvVars } from '../../src/utils/nao-config';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const createTemporaryFolder = useTemporaryFolders();

describe('extractRequiredEnvVars', () => {
	it('returns env vars declared in nao_config.yaml', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'databases:',
				'  - name: warehouse',
				'    type: postgres',
				'    password: "{{ env(\'DB_PASSWORD\') }}"',
			],
		});

		expect(extractRequiredEnvVars(dir)).toEqual(['DB_PASSWORD']);
	});

	it('returns env vars declared in mcp.json', () => {
		const dir = createProject({
			mcpServers: {
				dbt: {
					command: 'npx',
					args: ['-y', '@example/dbt-mcp'],
					env: {
						DBT_TOKEN: '${DBT_TOKEN}',
					},
				},
			},
		});

		expect(extractRequiredEnvVars(dir)).toEqual(['DBT_TOKEN']);
	});

	it('deduplicates env vars across nao_config.yaml and mcp.json', () => {
		const dir = createProject({
			naoConfig: ['password: "{{ env(\'DB_PASSWORD\') }}"', ''],
			mcpServers: {
				warehouse: {
					command: 'npx',
					env: {
						DB_PASSWORD: '${DB_PASSWORD}',
						DBT_TOKEN: '${DBT_TOKEN}',
					},
				},
			},
		});

		expect(extractRequiredEnvVars(dir)).toEqual(['DB_PASSWORD', 'DBT_TOKEN']);
	});

	it('skips config files that cannot be read', () => {
		const dir = createProject({});
		fs.mkdirSync(path.join(dir, 'agent', 'mcps', 'mcp.json'), { recursive: true });

		expect(extractRequiredEnvVars(dir)).toEqual([]);
	});
});

describe('extractConfiguredRepos', () => {
	it('returns repos declared in nao_config.yaml with GitHub metadata', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				'    url: https://github.com/nao/dbt-models.git',
				'    branch: main',
				'  - name: local-docs',
				'    local_path: ../docs',
			],
		});

		expect(extractConfiguredRepos(dir)).toEqual([
			{
				branch: 'main',
				contextPath: 'repos/dbt-models',
				localPath: null,
				name: 'dbt-models',
				provider: 'github',
				repoFullName: 'nao/dbt-models',
				url: 'https://github.com/nao/dbt-models.git',
			},
			{
				branch: null,
				contextPath: 'repos/local-docs',
				localPath: '../docs',
				name: 'local-docs',
				provider: null,
				repoFullName: null,
				url: null,
			},
		]);
	});

	it('returns repos declared in nao_config.yaml with GitLab metadata', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				'    url: https://gitlab.com/nao/dbt-models.git',
				'    branch: main',
			],
		});

		expect(extractConfiguredRepos(dir)).toEqual([
			{
				branch: 'main',
				contextPath: 'repos/dbt-models',
				localPath: null,
				name: 'dbt-models',
				provider: 'gitlab',
				repoFullName: 'nao/dbt-models',
				url: 'https://gitlab.com/nao/dbt-models.git',
			},
		]);
	});

	it('leaves provider null when the repo url does not match a recognized host', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				'    url: https://bitbucket.org/nao/dbt-models.git',
			],
		});

		expect(extractConfiguredRepos(dir)).toEqual([
			{
				branch: null,
				contextPath: 'repos/dbt-models',
				localPath: null,
				name: 'dbt-models',
				provider: null,
				repoFullName: null,
				url: 'https://bitbucket.org/nao/dbt-models.git',
			},
		]);
	});
});

function createProject({ naoConfig, mcpServers }: { naoConfig?: string[]; mcpServers?: Record<string, unknown> }) {
	const dir = createTemporaryFolder('nao-config-');
	if (naoConfig) {
		fs.writeFileSync(path.join(dir, 'nao_config.yaml'), naoConfig.join('\n'));
	}
	if (mcpServers) {
		const mcpDir = path.join(dir, 'agent', 'mcps');
		fs.mkdirSync(mcpDir, { recursive: true });
		fs.writeFileSync(path.join(mcpDir, 'mcp.json'), JSON.stringify({ mcpServers }));
	}
	return dir;
}
