import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { extractConfiguredRepos, extractRequiredEnvVars, extractRequiredSyncEnvVars } from '../../src/utils/nao-config';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';

vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const createTemporaryFolder = useTemporaryFolders();

restoreProcessEnvAfterEach();

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

describe('extractRequiredSyncEnvVars', () => {
	it('includes only active sync and rendered-template variables', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'databases:',
				'  - name: warehouse',
				'    type: postgres',
				'    host: "{{ env(\'DB_HOST\') }}"',
				'    password: "{{ env(\'DB_PASSWORD\') }}"',
				'repos:',
				'  - name: app',
				'    url: "{{ env(\'REPO_URL\') }}"',
				'llm:',
				'  provider: anthropic',
				'  api_key: "{{ env(\'ANTHROPIC_API_KEY\') }}"',
				'slack:',
				'  bot_token: "{{ env(\'SLACK_BOT_TOKEN\') }}"',
			],
			mcpServers: { dbt: { env: { DBT_TOKEN: '${DBT_TOKEN}' } } },
		});
		fs.mkdirSync(path.join(dir, 'reports'));
		fs.writeFileSync(path.join(dir, 'reports', 'summary.md.j2'), "{{ env('TEMPLATE_VALUE') }}");

		expect(extractRequiredSyncEnvVars(dir)).toEqual(['DB_HOST', 'DB_PASSWORD', 'REPO_URL', 'TEMPLATE_VALUE']);
	});

	it('includes ambient provider credentials only when the active sync needs them', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'databases:',
				'  - name: warehouse',
				'    type: athena',
				'    templates: [columns, ai_summary]',
				'    password: "{{ aws(\'warehouse/password\') }}"',
				'llm:',
				'  provider: vertex',
				'  service_account_json: "{{ env(\'VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON\') }}"',
			],
		});

		expect(extractRequiredSyncEnvVars(dir)).toEqual(
			expect.arrayContaining([
				'AWS_ACCESS_KEY_ID',
				'AWS_SECRET_ACCESS_KEY',
				'AWS_SESSION_TOKEN',
				'GOOGLE_VERTEX_PROJECT',
				'VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON',
			]),
		);
	});

	it('includes LLM credentials when a selected template override calls prompt', () => {
		const dir = createSelectedTemplateProject();
		const templateDirectory = path.join(dir, 'templates', 'databases');
		fs.mkdirSync(templateDirectory, { recursive: true });
		fs.writeFileSync(path.join(templateDirectory, 'columns.md.j2'), "{{ prompt('Summarize these columns') }}");

		expect(extractRequiredSyncEnvVars(dir)).toContain('ANTHROPIC_API_KEY');
	});

	it('rejects a selected template override that is a symbolic link', () => {
		const dir = createSelectedTemplateProject();
		const templateDirectory = path.join(dir, 'templates', 'databases');
		fs.mkdirSync(templateDirectory, { recursive: true });
		fs.symlinkSync('/dev/zero', path.join(templateDirectory, 'columns.md.j2'));

		expect(() => extractRequiredSyncEnvVars(dir)).toThrow('cannot contain symbolic links');
	});

	it('rejects symbolic links in a selected template override path', () => {
		const dir = createSelectedTemplateProject();
		const linkedDirectory = path.join(dir, 'linked-templates');
		fs.mkdirSync(path.join(linkedDirectory, 'databases'), { recursive: true });
		fs.writeFileSync(path.join(linkedDirectory, 'databases', 'columns.md.j2'), "{{ prompt('Summarize') }}");
		fs.symlinkSync(linkedDirectory, path.join(dir, 'templates'));

		expect(() => extractRequiredSyncEnvVars(dir)).toThrow('cannot contain symbolic links');
	});

	it('rejects an oversized selected template override', () => {
		const dir = createSelectedTemplateProject();
		const templateDirectory = path.join(dir, 'templates', 'databases');
		fs.mkdirSync(templateDirectory, { recursive: true });
		fs.writeFileSync(path.join(templateDirectory, 'columns.md.j2'), Buffer.alloc(1024 * 1024 + 1));

		expect(() => extractRequiredSyncEnvVars(dir)).toThrow('exceeds the 1 MB size limit');
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

	it.each([
		{ envVars: undefined, url: "https://x:{{ env('REPO_TOKEN') }}@github.com/nao/dbt-models.git" },
		{ envVars: { REPO_TOKEN: 'project-token' }, url: 'https://x:project-token@github.com/nao/dbt-models.git' },
	])('resolves env references in repo URLs only with project variables ($envVars)', ({ envVars, url }) => {
		process.env.REPO_TOKEN = 'server-token';
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: dbt-models',
				`    url: "https://x:{{ env('REPO_TOKEN') }}@github.com/nao/dbt-models.git"`,
			],
		});

		expect(extractConfiguredRepos(dir, envVars)[0]?.url).toBe(url);
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

function createSelectedTemplateProject(): string {
	return createProject({
		naoConfig: [
			'project_name: demo',
			'databases:',
			'  - name: warehouse',
			'    type: duckdb',
			'    templates: [columns]',
			'llm:',
			'  provider: anthropic',
			'  api_key: "{{ env(\'ANTHROPIC_API_KEY\') }}"',
		],
	});
}
