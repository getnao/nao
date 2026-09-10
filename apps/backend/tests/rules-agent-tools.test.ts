import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Tool } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import grepTool from '../src/agents/tools/grep';
import readTool from '../src/agents/tools/read';
import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting } from '../src/services/storage';
import type { ToolContext } from '../src/types/tools';

let projectFolder: string;
let originalEnv: typeof process.env;

beforeEach(() => {
	originalEnv = { ...process.env };
	process.env.NAO_STORAGE_BACKEND = 'none';
	__reloadEnvForTesting();
	__resetStorageForTesting();
	projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-rules-tools-'));
	fs.mkdirSync(path.join(projectFolder, 'docs'), { recursive: true });
	fs.writeFileSync(path.join(projectFolder, 'docs', 'RULES.md'), 'Nested secret marker\n');
});

afterEach(() => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	fs.rmSync(projectFolder, { recursive: true, force: true });
});

describe('read RULES.md', () => {
	it('returns only public and matching content without directives', async () => {
		writeRules(rulesSource());

		const member = await run(readTool, { file_path: '/RULES.md' }, context(['finance']));
		expect(member.content).toBe('Public\nFinance secret\nShared secret\nDone\n');

		const nonMember = await run(readTool, { file_path: 'RULES.md' }, context(['support']));
		expect(nonMember.content).toBe('Public\nDone\n');
	});

	it('includes all valid block content when enforcement is unlicensed', async () => {
		writeRules(rulesSource());

		const output = await run(readTool, { file_path: '/RULES.md' }, context(null));
		expect(output.content).toBe('Public\nFinance secret\nShared secret\nDone\n');
		expect(output.content).not.toContain('{%');
	});

	it('fails closed for malformed rules', async () => {
		writeRules('Public\n{% if group("finance") %}\nSecret\n');

		await expect(run(readTool, { file_path: '/RULES.md' }, context(['finance']))).rejects.toThrow(
			'could not be rendered safely',
		);
	});

	it('leaves nested RULES.md unchanged', async () => {
		const output = await run(readTool, { file_path: '/docs/RULES.md' }, context([]));

		expect(output.content).toBe('Nested secret marker\n');
	});
});

describe('grep RULES.md', () => {
	it('suppresses excluded and directive matches while retaining allowed matches', async () => {
		writeRules(rulesSource());

		const excluded = await run(grepTool, { pattern: 'Finance secret|group', path: '/RULES.md' }, context([]));
		expect(excluded).toMatchObject({ matches: [], total_matches: 0, truncated: false });

		const allowed = await run(
			grepTool,
			{ pattern: 'Finance secret|Done', path: '/RULES.md', max_results: 1 },
			context([]),
		);
		expect(allowed.matches).toHaveLength(1);
		expect(allowed.matches[0]).toMatchObject({ line_content: 'Done', line_number: 8 });
		expect(allowed.total_matches).toBe(1);
	});

	it('supports multi-group OR conditions for direct and whole-project searches', async () => {
		writeRules(rulesSource());

		const direct = await run(grepTool, { pattern: 'Shared secret', path: 'RULES.md' }, context(['marketing']));
		expect(direct.matches).toHaveLength(1);

		const wholeProject = await run(grepTool, { pattern: 'Shared secret' }, context(['finance']));
		expect(wholeProject.matches).toHaveLength(1);
		expect(wholeProject.matches[0].path).toBe('/RULES.md');
	});

	it('builds context only from the rendered view', async () => {
		writeRules(rulesSource());

		const output = await run(grepTool, { pattern: 'Done', path: '/', context_lines: 10 }, context(['support']));
		expect(output.matches).toHaveLength(1);
		expect(output.matches[0].context_before).toEqual(['Public']);
		expect(JSON.stringify(output.matches[0])).not.toContain('secret');
		expect(JSON.stringify(output.matches[0])).not.toContain('{%');
	});

	it('fails closed for malformed root rules without affecting nested files', async () => {
		writeRules('Public\n{% if group("finance") %}\nSecret marker\n');

		const direct = await run(grepTool, { pattern: 'marker|Public', path: '/RULES.md' }, context(['finance']));
		expect(direct).toMatchObject({ matches: [], total_matches: 0 });

		const wholeProject = await run(grepTool, { pattern: 'marker|Public' }, context(['finance']));
		expect(wholeProject.matches).toHaveLength(1);
		expect(wholeProject.matches[0].path).toBe('/docs/RULES.md');
	});

	it('searches all block content without directives when enforcement is unlicensed', async () => {
		writeRules(rulesSource());

		const content = await run(grepTool, { pattern: 'secret', path: '/RULES.md' }, context(null));
		expect(content.matches.map((match) => match.line_content)).toEqual(['Finance secret', 'Shared secret']);

		const directives = await run(grepTool, { pattern: 'group', path: '/RULES.md' }, context(null));
		expect(directives.matches).toEqual([]);
	});
});

function rulesSource(): string {
	return [
		'Public',
		'{% if group("finance") %}',
		'Finance secret',
		'{% endif %}',
		'{% if group("finance", "marketing") %}',
		'Shared secret',
		'{% endif %}',
		'Done',
		'',
	].join('\n');
}

function writeRules(content: string): void {
	fs.writeFileSync(path.join(projectFolder, 'RULES.md'), content);
}

function context(groupNames: string[] | null): ToolContext {
	return {
		projectFolder,
		warehouseTableAccess: { enforced: false },
		docsContextAccess: { enforced: false },
		userRulesGroupAccess: groupNames === null ? { enforced: false } : { enforced: true, groupNames },
	} as ToolContext;
}

async function run<TInput, TOutput>(
	tool: Tool<TInput, TOutput>,
	input: TInput,
	toolContext: ToolContext,
): Promise<TOutput> {
	return tool.execute!(input, {
		experimental_context: toolContext,
	} as Parameters<NonNullable<typeof tool.execute>>[1]) as Promise<TOutput>;
}
