import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
	extractConfiguredRepos,
	extractConfiguredTemplates,
	extractContextPresence,
	readProjectContext,
} from '../src/utils/nao-config';

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('extractConfiguredRepos', () => {
	it('returns repos declared in nao_config.yaml with GitHub metadata', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'project_name: demo',
					'repos:',
					'  - name: dbt-models',
					'    url: https://github.com/nao/dbt-models.git',
					'    branch: main',
					'  - name: local-docs',
					'    local_path: ../docs',
				].join('\n'),
			);

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
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns repos declared in nao_config.yaml with GitLab metadata', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'project_name: demo',
					'repos:',
					'  - name: dbt-models',
					'    url: https://gitlab.com/nao/dbt-models.git',
					'    branch: main',
				].join('\n'),
			);

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
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('leaves provider null when the repo url does not match a recognized host', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'project_name: demo',
					'repos:',
					'  - name: dbt-models',
					'    url: https://bitbucket.org/nao/dbt-models.git',
				].join('\n'),
			);

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
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe('extractConfiguredTemplates', () => {
	it('uses the default templates when a database omits templates', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    name: demo',
					'    profiling:',
					'      refresh_policy: always',
					'    ai_summary:',
					'      refresh_policy: once',
				].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('uses the default templates when templates is empty', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				['databases:', '  - type: duckdb', '    name: demo', '    templates: []'].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('uses the default templates when migration removes every template', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				['databases:', '  - type: duckdb', '    name: demo', '    templates: [description]'].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns the stable union across databases', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    name: first',
					'    templates: [ai_summary, columns]',
					'  - type: postgres',
					'    name: second',
					'    templates: [profiling, preview, columns]',
				].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview', 'profiling', 'ai_summary']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('migrates how_to_use and drops description', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    name: demo',
					'    templates: [description, how_to_use, unknown]',
				].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['query_history']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('accepts accessors as a legacy templates alias', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				['databases:', '  - type: duckdb', '    name: demo', '    accessors: [columns, profiling]'].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'profiling']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('uses the default templates for missing or invalid config', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview']);

			fs.writeFileSync(path.join(dir, 'nao_config.yaml'), 'databases: [');
			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('uses the default templates for a lone database with malformed templates', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				['databases:', '  - type: duckdb', '    name: demo', '    templates: "columns"'].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('includes defaults when one database has malformed templates', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    name: malformed',
					'    templates: [123]',
					'  - type: postgres',
					'    name: configured',
					'    templates: [profiling]',
				].join('\n'),
			);

			expect(extractConfiguredTemplates(dir)).toEqual(['columns', 'preview', 'profiling']);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe('extractContextPresence', () => {
	it('reports missing context as absent', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			expect(extractContextPresence(dir)).toEqual({
				rules: false,
				semantics: false,
				docs: false,
				notionDocs: false,
				databases: false,
			});
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('reports empty context folders as absent', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			for (const folder of ['semantics', 'docs', 'databases']) {
				fs.mkdirSync(path.join(dir, folder));
			}
			fs.mkdirSync(path.join(dir, 'docs', 'notion'));

			expect(extractContextPresence(dir)).toEqual({
				rules: false,
				semantics: false,
				docs: false,
				notionDocs: false,
				databases: false,
			});
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('reports non-empty context as present', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(path.join(dir, 'RULES.md'), '# Rules');
			for (const [folder, file] of [
				['semantics', 'metrics.md'],
				['docs/notion', 'workspace.md'],
				['databases/type=duckdb', 'context.md'],
			]) {
				const folderPath = path.join(dir, folder);
				fs.mkdirSync(folderPath, { recursive: true });
				fs.writeFileSync(path.join(folderPath, file), 'context');
			}

			expect(extractContextPresence(dir)).toEqual({
				rules: true,
				semantics: true,
				docs: true,
				notionDocs: true,
				databases: true,
			});
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe('readProjectContext', () => {
	it('returns the same project context as the individual extractors', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    name: demo',
					'    templates: [columns, profiling]',
					'repos:',
					'  - name: dbt',
					'    url: https://github.com/nao/dbt-models.git',
				].join('\n'),
			);
			fs.writeFileSync(path.join(dir, 'RULES.md'), '# Rules');
			fs.mkdirSync(path.join(dir, 'docs'));
			fs.writeFileSync(path.join(dir, 'docs', 'overview.md'), '# Overview');

			expect(readProjectContext(dir)).toEqual({
				repos: extractConfiguredRepos(dir),
				templates: extractConfiguredTemplates(dir),
				presence: extractContextPresence(dir),
			});
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns defaults and absent presence when config is missing', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			expect(readProjectContext(dir)).toEqual({
				repos: [],
				templates: ['columns', 'preview'],
				presence: {
					rules: false,
					semantics: false,
					docs: false,
					notionDocs: false,
					databases: false,
				},
			});
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});
