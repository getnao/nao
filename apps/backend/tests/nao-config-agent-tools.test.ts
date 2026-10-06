import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Tool } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import grepTool from '../src/agents/tools/grep';
import listTool from '../src/agents/tools/list';
import readTool from '../src/agents/tools/read';
import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting } from '../src/services/storage';
import type { ToolContext } from '../src/types/tools';

const SECRET = 'sk-live-do-not-leak';

let projectFolder: string;
let originalEnv: typeof process.env;

beforeEach(() => {
	originalEnv = { ...process.env };
	process.env.NAO_STORAGE_BACKEND = 'none';
	process.env.BETA_CUSTOM_STORIES_ENABLED = 'false';
	__reloadEnvForTesting();
	__resetStorageForTesting();
	projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-config-tools-'));
	fs.writeFileSync(path.join(projectFolder, 'nao_config.yaml'), `llm:\n  api_key: ${SECRET}\n`);
	fs.writeFileSync(path.join(projectFolder, 'RULES.md'), 'Rules\n');
	fs.mkdirSync(path.join(projectFolder, 'repos', 'other'), { recursive: true });
	fs.writeFileSync(path.join(projectFolder, 'repos', 'other', 'nao_config.yaml'), `api_key: ${SECRET}\n`);
	fs.symlinkSync(path.join(projectFolder, 'nao_config.yaml'), path.join(projectFolder, 'alias.yaml'));
});

afterEach(() => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	fs.rmSync(projectFolder, { recursive: true, force: true });
});

describe('nao_config.yaml is hidden from the agent file tools', () => {
	it.each(['/nao_config.yaml', 'nao_config.yaml', '/repos/other/nao_config.yaml', '/alias.yaml'])(
		'read denies %s',
		async (filePath) => {
			await expect(run(readTool, { file_path: filePath }, context())).rejects.toThrow('Access denied');
		},
	);

	it('list omits it', async () => {
		const output = await run(listTool, { path: '/' }, context());

		expect(output.entries.map((entry) => entry.name)).toContain('RULES.md');
		expect(output.entries.map((entry) => entry.name)).not.toContain('nao_config.yaml');
	});

	it('grep never matches inside it', async () => {
		const wholeProject = await run(grepTool, { pattern: SECRET }, context());
		expect(wholeProject).toMatchObject({ matches: [], total_matches: 0 });

		await expect(run(grepTool, { pattern: SECRET, path: '/nao_config.yaml' }, context())).rejects.toThrow(
			'Access denied',
		);
	});
});

function context(): ToolContext {
	return {
		projectFolder,
		warehouseTableAccess: { enforced: false },
		docsContextAccess: { enforced: false },
		filesContextAccess: { enforced: false },
		userRulesGroupAccess: { enforced: false },
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
