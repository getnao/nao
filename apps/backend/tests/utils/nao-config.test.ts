import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
	extractConfiguredRepos,
	extractContextPresence,
	extractRequiredEnvVars,
	extractRulesFile,
	resolveEnvReferences,
} from '../../src/utils/nao-config';
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

describe('resolveEnvReferences', () => {
	it.each([
		['leaves an aws reference to the CLI', "{{ aws('prod/git/token') }}", "{{ aws('prod/git/token') }}"],
		[
			'fills in a reference written with spaces',
			"https://{{ env( 'GIT_TOKEN' ) }}@git.example/repo.git",
			'https://abc@git.example/repo.git',
		],
		[
			'empties a reference to an unknown variable',
			"https://{{ env('MISSING_GIT_TOKEN') }}@git.example/repo.git",
			'https://@git.example/repo.git',
		],
	])('%s', (_name, url, expected) => {
		expect(resolveEnvReferences({ url }, { GIT_TOKEN: 'abc' })).toEqual({ url: expected });
	});
});

describe('extractConfiguredRepos', () => {
	it('reads the repos that nao_config.yaml takes from another file through from_file', () => {
		const dir = createProject({ naoConfig: ['project_name: demo', 'repos:', '  from_file: repos.yml'] });
		fs.writeFileSync(path.join(dir, 'repos.yml'), '- name: local-docs\n  local_path: ../docs\n');

		expect(extractConfiguredRepos(dir).map((repo) => repo.name)).toEqual(['local-docs']);
	});

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
				targets: [],
				localPath: null,
				name: 'dbt-models',
				provider: 'github',
				repoFullName: 'nao/dbt-models',
				url: 'https://github.com/nao/dbt-models.git',
			},
			{
				branch: null,
				contextPath: 'repos/local-docs',
				targets: [],
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

	it('keeps the targets nao sync accepts, normalized, and drops those that could leave their folder', () => {
		const targets = [
			{ source: './nao/tests/', target: 'tests/analytics/' },
			{ source: 'nao/tests', target: 'tests' },
			{ source: 'nao/tests', target: 'repos/analytics' },
			{ source: 'nao/tests', target: 'databases/analytics' },
			{ source: 'nao/tests', target: 'tests/../../etc' },
			{ source: 'nao/tests', target: '/tmp/tests' },
			{ source: '../secrets', target: 'tests/secrets' },
			{ source: 'nao\\tests', target: 'tests/windows' },
		];
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: analytics',
				'    url: https://github.com/nao/analytics.git',
				`    targets: ${JSON.stringify(targets)}`,
			],
		});

		expect(extractConfiguredRepos(dir)[0]?.targets).toEqual([{ source: 'nao/tests', target: 'tests/analytics' }]);
	});

	it('resolves env references in targets like nao sync does', () => {
		const dir = createProject({
			naoConfig: [
				'project_name: demo',
				'repos:',
				'  - name: analytics',
				'    url: https://github.com/nao/analytics.git',
				`    targets: [{ source: nao/tests, target: "tests/{{ env('TEAM') }}" }]`,
			],
		});

		expect(extractConfiguredRepos(dir, { TEAM: 'sales' })[0]?.targets).toEqual([
			{ source: 'nao/tests', target: 'tests/sales' },
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
				targets: [],
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
				targets: [],
				localPath: null,
				name: 'dbt-models',
				provider: null,
				repoFullName: null,
				url: 'https://bitbucket.org/nao/dbt-models.git',
			},
		]);
	});
});

describe('extractRulesFile', () => {
	const syncedRulesFile = 'repos/business_context/nao/RULES.md';

	it('returns the file rules_file names, such as one of a synced repository', () => {
		const dir = createProject({ naoConfig: ['project_name: demo', `rules_file: " ${syncedRulesFile} "`] });
		writeProjectFile(dir, syncedRulesFile);

		expect(extractRulesFile(dir)).toBe(syncedRulesFile);
		expect(extractContextPresence(dir)).toMatchObject({ rules: true, rulesFile: syncedRulesFile });
	});

	it.each([
		{ reason: 'is not synced yet', rulesFile: syncedRulesFile },
		{ reason: 'leads outside the project', rulesFile: '../RULES.md' },
		{ reason: 'is a dotfile', rulesFile: '.env' },
		{ reason: 'is a folder', rulesFile: 'docs' },
	])('falls back to RULES.md when the configured file $reason', ({ rulesFile }) => {
		const dir = createProject({ naoConfig: ['project_name: demo', `rules_file: ${rulesFile}`] });
		writeProjectFile(dir, '.env');
		writeProjectFile(dir, 'docs/glossary.md');

		expect(extractRulesFile(dir)).toBe('RULES.md');
	});

	it('picks up the configured file once its repository is synced', () => {
		const dir = createProject({ naoConfig: ['project_name: demo', `rules_file: ${syncedRulesFile}`] });
		expect(extractRulesFile(dir)).toBe('RULES.md');

		writeProjectFile(dir, syncedRulesFile);

		expect(extractRulesFile(dir)).toBe(syncedRulesFile);
	});
});

function writeProjectFile(dir: string, file: string) {
	fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
	fs.writeFileSync(path.join(dir, file), 'content\n');
}

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
