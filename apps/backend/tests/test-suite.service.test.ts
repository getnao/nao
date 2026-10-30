import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discoverTests, filterTests } from '../src/services/test-suite.service';
import { extractConfiguredTestSettings } from '../src/utils/nao-config';

let projectFolder: string;

beforeEach(() => {
	projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-test-suite-'));
});

afterEach(() => {
	fs.rmSync(projectFolder, { recursive: true, force: true });
});

describe('discoverTests', () => {
	it('returns an empty suite when the project has no tests folder', () => {
		expect(discoverTests(projectFolder)).toEqual({ tests: [], invalidFiles: [] });
	});

	it('parses test files recursively, sorted by path, skipping outputs', () => {
		writeTestFile(
			'revenue.yml',
			'name: Revenue\nprompt: What is the revenue?\nsql: select 1\ntags: [finance, finance]',
		);
		writeTestFile('sales/orders.yaml', 'prompt: How many orders?\ndatabase: warehouse\nowner: ana@example.com');
		writeTestFile('outputs/results_1.yml', 'prompt: ignored');
		writeTestFile('notes.md', 'prompt: ignored');

		const suite = discoverTests(projectFolder);

		expect(suite.invalidFiles).toEqual([]);
		expect(suite.tests.map((test) => test.path)).toEqual(['revenue.yml', 'sales/orders.yaml']);
		expect(suite.tests[0]).toMatchObject({
			name: 'Revenue',
			prompt: 'What is the revenue?',
			sql: 'select 1',
			databaseId: null,
			assertions: [],
			tags: ['finance'],
			owner: null,
		});
		expect(suite.tests[1]).toMatchObject({
			name: 'orders',
			sql: null,
			databaseId: 'warehouse',
			owner: 'ana@example.com',
		});
		expect(suite.tests[0].hash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('parses tool call assertions with their defaults', () => {
		writeTestFile(
			'assertions.yml',
			'prompt: Use the metric\nassertions:\n  - type: tool_call\n    tool: query_metrics\n    args:\n      metric: revenue',
		);

		const [test] = discoverTests(projectFolder).tests;

		expect(test.assertions).toEqual([
			{ type: 'tool_call', tool: 'query_metrics', args: { metric: 'revenue' }, min_count: 1 },
		]);
	});

	it('reports invalid files instead of skipping them silently', () => {
		writeTestFile('broken.yml', 'prompt: [unclosed');
		writeTestFile('no-prompt.yml', 'name: Missing prompt');
		writeTestFile('valid.yml', 'prompt: Fine');

		const suite = discoverTests(projectFolder);

		expect(suite.tests.map((test) => test.path)).toEqual(['valid.yml']);
		expect(suite.invalidFiles.map((file) => file.path)).toEqual(['broken.yml', 'no-prompt.yml']);
		expect(suite.invalidFiles[0].error).toContain('Invalid YAML');
	});

	it('keeps unquoted dates of assertion args as strings, as the agent sends them', () => {
		writeTestFile(
			'dates.yml',
			'prompt: Revenue since January\nassertions:\n  - type: tool_call\n    tool: query_metrics\n    args:\n      start_date: 2025-01-01',
		);

		const [test] = discoverTests(projectFolder).tests;

		expect(test.assertions[0].args).toEqual({ start_date: '2025-01-01' });
	});

	it('changes the hash when the file content changes', () => {
		writeTestFile('revenue.yml', 'prompt: What is the revenue?');
		const [before] = discoverTests(projectFolder).tests;
		writeTestFile('revenue.yml', 'prompt: What is the revenue in 2025?');
		const [after] = discoverTests(projectFolder).tests;

		expect(after.hash).not.toBe(before.hash);
	});
});

describe('filterTests', () => {
	it('keeps tests matching the selected paths and any of the selected tags', () => {
		writeTestFile('a.yml', 'prompt: A\ntags: [finance]');
		writeTestFile('b.yml', 'prompt: B\ntags: [sales]');
		writeTestFile('c.yml', 'prompt: C');
		const { tests } = discoverTests(projectFolder);

		expect(filterTests(tests, {}).map((test) => test.path)).toEqual(['a.yml', 'b.yml', 'c.yml']);
		expect(filterTests(tests, { tags: ['finance', 'sales'] }).map((test) => test.path)).toEqual(['a.yml', 'b.yml']);
		expect(filterTests(tests, { paths: ['b.yml', 'c.yml'], tags: ['sales'] }).map((test) => test.path)).toEqual([
			'b.yml',
		]);
	});
});

describe('extractConfiguredTestSettings', () => {
	it('uses the nao test defaults without a test section', () => {
		expect(extractConfiguredTestSettings(projectFolder)).toEqual({
			models: null,
			attempts: 1,
			tolerances: { rtol: 1e-5, atol: 1e-8, decimals: 2 },
			errors: [],
		});
	});

	it('reads models, k and comparison tolerances', () => {
		fs.writeFileSync(
			path.join(projectFolder, 'nao_config.yaml'),
			'test:\n  models: [openai:gpt-4.1, anthropic:claude-sonnet-4-5]\n  k: 3\n  comparison:\n    decimals: 4',
		);

		expect(extractConfiguredTestSettings(projectFolder)).toEqual({
			models: [
				{ provider: 'openai', modelId: 'gpt-4.1' },
				{ provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
			],
			attempts: 3,
			tolerances: { rtol: 1e-5, atol: 1e-8, decimals: 4 },
			errors: [],
		});
	});

	it('reports invalid values instead of falling back to the defaults', () => {
		fs.writeFileSync(
			path.join(projectFolder, 'nao_config.yaml'),
			'test:\n  models: [openai:gpt-4.1, unknown:model, nocolon]\n  k: 0\n  comparison:\n    decimals: -1',
		);

		const settings = extractConfiguredTestSettings(projectFolder);

		expect(settings.models).toEqual([{ provider: 'openai', modelId: 'gpt-4.1' }]);
		expect(settings.errors).toEqual([
			'test.models has an invalid entry "unknown:model", expected \'provider:model_id\'.',
			'test.models has an invalid entry "nocolon", expected \'provider:model_id\'.',
			'test.k must be an integer of at least 1, got 0.',
			expect.stringContaining('test.comparison is invalid'),
		]);
	});
});

function writeTestFile(relativePath: string, content: string) {
	const filePath = path.join(projectFolder, 'tests', relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
}
