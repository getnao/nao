import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { extractConfiguredDatabases, extractConfiguredRepos } from '../src/utils/nao-config';

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

describe('extractConfiguredDatabases', () => {
	it('returns an empty list when nao_config.yaml is missing', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			expect(extractConfiguredDatabases(dir)).toEqual([]);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns an empty list when databases is absent', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(path.join(dir, 'nao_config.yaml'), 'project_name: demo\n');

			expect(extractConfiguredDatabases(dir)).toEqual([]);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('skips databases without a valid name', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - type: duckdb',
					'    path: ./missing-name.duckdb',
					'  - name: "  "',
					'    type: postgres',
					'  - name: 123',
					'    type: bigquery',
					'  - name: valid-database',
					'    type: duckdb',
				].join('\n'),
			);

			expect(extractConfiguredDatabases(dir)).toEqual([{ id: 'valid-database', type: 'duckdb' }]);
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('returns ids, types, and identifying fields without secret-bearing fields', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - name: duckdb-jaffle-shop',
					'    type: duckdb',
					'    path: ./jaffle_shop.duckdb',
					'  - name: bigquery-prod',
					'    type: bigquery',
					'    project_id: nao-corp',
					'    dataset_id: nao-corp.movies_silver',
					'    credentials_path: ./credentials.json',
				].join('\n'),
			);

			const databases = extractConfiguredDatabases(dir);

			expect(databases).toEqual([
				{
					id: 'duckdb-jaffle-shop',
					type: 'duckdb',
					database: 'jaffle_shop',
				},
				{
					id: 'bigquery-prod',
					type: 'bigquery',
					project_id: 'nao-corp',
					dataset_id: 'nao-corp.movies_silver',
				},
			]);
			expect(databases[1]).not.toHaveProperty('credentials_path');
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});

	it('derives safe database names from DuckDB paths', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-'));
		try {
			fs.writeFileSync(
				path.join(dir, 'nao_config.yaml'),
				[
					'databases:',
					'  - name: in-memory',
					'    type: duckdb',
					'    path: ":memory:"',
					'  - name: motherduck-analytics',
					'    type: duckdb',
					'    path: "md:analytics?motherduck_token=secret123"',
					'  - name: motherduck-default',
					'    type: duckdb',
					'    path: "md:"',
					'  - name: explicit-database',
					'    type: duckdb',
					'    path: ./ignored.duckdb',
					'    database: configured_name',
				].join('\n'),
			);

			const databases = extractConfiguredDatabases(dir);

			expect(databases).toEqual([
				{ id: 'in-memory', type: 'duckdb', database: 'memory' },
				{ id: 'motherduck-analytics', type: 'duckdb', database: 'analytics' },
				{ id: 'motherduck-default', type: 'duckdb', database: 'motherduck' },
				{ id: 'explicit-database', type: 'duckdb', database: 'configured_name' },
			]);
			expect(JSON.stringify(databases)).not.toContain('secret123');
			expect(JSON.stringify(databases)).not.toContain('motherduck_token');
		} finally {
			fs.rmSync(dir, { force: true, recursive: true });
		}
	});
});
