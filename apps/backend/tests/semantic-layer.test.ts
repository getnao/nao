import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { SemanticLayerMode } from '@nao/shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SystemPrompt } from '../src/components/ai/system-prompt';
import { renderToMarkdown } from '../src/lib/markdown';
import { isSemanticQueryToolEnabled, resolveSemanticLayerMode } from '../src/services/semantic-layer.service';
import { extractConfiguredSemanticLayer } from '../src/utils/nao-config';

vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/db/db', () => ({ db: {} }));

const dirs: string[] = [];

function writeProject(configLines: string[] | null): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-semantic-layer-'));
	dirs.push(dir);
	if (configLines) {
		fs.writeFileSync(path.join(dir, 'nao_config.yaml'), configLines.join('\n'));
	}
	return dir;
}

const projectWithSemanticLayer = () =>
	writeProject([
		'project_name: demo',
		'databases:',
		'  - name: warehouse',
		'    type: duckdb',
		'    path: ./warehouse.duckdb',
		'semantic_layer:',
		'  type: metricflow',
		'  manifest_path: dbt/target/semantic_manifest.json',
		'  database: warehouse',
	]);

afterEach(() => {
	while (dirs.length > 0) {
		fs.rmSync(dirs.pop() as string, { force: true, recursive: true });
	}
});

describe('extractConfiguredSemanticLayer', () => {
	it('reads the semantic_layer section', () => {
		expect(extractConfiguredSemanticLayer(projectWithSemanticLayer())).toEqual({
			type: 'metricflow',
			manifestPath: 'dbt/target/semantic_manifest.json',
			database: 'warehouse',
		});
	});

	it('returns null without a section or a config file', () => {
		expect(extractConfiguredSemanticLayer(writeProject(['project_name: demo']))).toBeNull();
		expect(extractConfiguredSemanticLayer(writeProject(null))).toBeNull();
	});

	it('ignores a section without a manifest path', () => {
		const project = writeProject(['project_name: demo', 'semantic_layer:', '  type: metricflow']);
		expect(extractConfiguredSemanticLayer(project)).toBeNull();
	});
});

describe('resolveSemanticLayerMode', () => {
	it('is null when the project declares no semantic layer, whatever the settings say', () => {
		const dir = writeProject(['project_name: demo']);
		expect(resolveSemanticLayerMode(dir, { semanticLayer: { mode: 'exclusive' } })).toBeNull();
	});

	it('defaults to prioritized and follows the admin setting', () => {
		const dir = projectWithSemanticLayer();
		expect(resolveSemanticLayerMode(dir, null)).toBe('prioritized');
		expect(resolveSemanticLayerMode(dir, {})).toBe('prioritized');
		expect(resolveSemanticLayerMode(dir, { semanticLayer: { mode: 'exclusive' } })).toBe('exclusive');
		expect(resolveSemanticLayerMode(dir, { semanticLayer: { mode: 'disabled' } })).toBe('disabled');
	});
});

describe('execute_semantic_query exposure', () => {
	it('is only enabled for the querying modes', () => {
		expect(isSemanticQueryToolEnabled('prioritized')).toBe(true);
		expect(isSemanticQueryToolEnabled('exclusive')).toBe(true);
		expect(isSemanticQueryToolEnabled('disabled')).toBe(false);
		expect(isSemanticQueryToolEnabled(null)).toBe(false);
		expect(isSemanticQueryToolEnabled(undefined)).toBe(false);
	});

	it('is registered by getTools according to the mode', async () => {
		const { getTools } = await import('../src/agents/tools');
		const toolNames = (mode?: SemanticLayerMode | null) =>
			Object.keys(getTools(null, {}, { semanticLayerMode: mode }));

		expect(toolNames()).not.toContain('execute_semantic_query');
		expect(toolNames('disabled')).not.toContain('execute_semantic_query');
		expect(toolNames('prioritized')).toContain('execute_semantic_query');
		expect(toolNames('exclusive')).toContain('execute_semantic_query');
	});

	it('restricts execute_sql to the local database in semantics-only mode', async () => {
		const { getTools } = await import('../src/agents/tools');
		const sqlDescription = (mode?: SemanticLayerMode | null) =>
			getTools(null, {}, { semanticLayerMode: mode }).execute_sql.description ?? '';

		expect(sqlDescription()).toContain('against the connected database');
		expect(sqlDescription('prioritized')).toContain('against the connected database');
		expect(sqlDescription('exclusive')).toContain('the only accepted database_id');
		expect(sqlDescription('exclusive')).toContain('including semantic ones');
	});

	it('refuses warehouse SQL in semantics-only mode but keeps the local database', async () => {
		const { executeQuery } = await import('../src/agents/tools/execute-sql');
		const context = {
			semanticLayerMode: 'exclusive',
			projectFolder: writeProject(['project_name: demo']),
			queryResults: new Map(),
			envVars: {},
		} as unknown as import('../src/types/tools').ToolContext;
		const run = (databaseId?: string) => executeQuery({ sql_query: 'SELECT 1', database_id: databaseId }, context);

		await expect(run('warehouse')).rejects.toThrow('query metrics with execute_semantic_query');
		await expect(run()).rejects.toThrow('query metrics with execute_semantic_query');
		await expect(run('duckdb_local')).resolves.toMatchObject({ columns: ['1'], row_count: 1 });
		const compiledError = await executeQuery({ sql_query: 'SELECT 1', database_id: 'warehouse' }, context, {
			compiledBySemanticLayer: true,
		}).catch((error: Error) => error.message);
		expect(compiledError).not.toContain('query metrics with execute_semantic_query');
	});
});

describe('SystemPrompt semantic layer block', () => {
	const render = (mode: SemanticLayerMode, toolNames: string[]) =>
		renderToMarkdown(SystemPrompt({ semanticLayerMode: mode, toolNames }));

	it('says nothing without a semantic layer', () => {
		expect(renderToMarkdown(SystemPrompt({}))).not.toContain('Semantic layer');
	});

	it('prefers the layer and allows a fallback in prioritized mode', () => {
		const markdown = render('prioritized', ['execute_sql', 'execute_semantic_query']);
		expect(markdown).toContain('## Semantic layer');
		expect(markdown).toContain('answer with **execute_semantic_query**');
		expect(markdown).toContain('Fall back to execute_sql only when');
		expect(markdown).toContain('no semantic metric or dimension covers the question, use the execute_sql tool');
		expect(markdown).not.toContain('**must** go through');
	});

	it('forbids warehouse SQL but keeps the local database in exclusive mode', () => {
		const markdown = render('exclusive', ['execute_sql', 'execute_semantic_query']);
		expect(markdown).toContain('Every warehouse question **must** go through execute_semantic_query');
		expect(markdown).not.toContain('Fall back to execute_sql only when');
		expect(markdown).not.toContain('use the execute_sql tool for it');
		expect(markdown).toContain('## The local database');
		expect(markdown).toContain('the only database_id execute_sql accepts');
		expect(markdown).toContain('execute_sql and execute_semantic_query result in this chat');
		expect(markdown).toContain('shown in the execute_sql or execute_semantic_query tool output');
	});

	it('keeps the definitions as context only when the tool is absent', () => {
		const markdown = render('disabled', ['execute_sql']);
		expect(markdown).toContain('## Semantic layer');
		expect(markdown).toContain('querying the layer is not available here');
		expect(markdown).not.toContain('answer with **execute_semantic_query**');
	});
});
