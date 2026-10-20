import fs from 'node:fs';
import path from 'node:path';

import type { Tool } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';

import grepTool from '../../src/agents/tools/grep';
import listTool from '../../src/agents/tools/list';
import readTool from '../../src/agents/tools/read';
import { restoreStorageEnvAfterEach, useStorageBackendWithoutStories } from '../helpers/storage-backend';
import { useTemporaryFolders } from '../helpers/temporary-folders';
import { createToolContext, executeTool } from '../helpers/tool-context';

const SECRET = 'sk-live-do-not-leak';

let projectFolder: string;

restoreStorageEnvAfterEach();
const createTemporaryFolder = useTemporaryFolders();

beforeEach(() => {
	useStorageBackendWithoutStories('none');
	projectFolder = createTemporaryFolder('nao-config-tools-');
	fs.writeFileSync(path.join(projectFolder, 'nao_config.yaml'), `llm:\n  api_key: ${SECRET}\n`);
	fs.writeFileSync(path.join(projectFolder, 'RULES.md'), 'Rules\n');
	fs.mkdirSync(path.join(projectFolder, 'repos', 'other'), { recursive: true });
	fs.writeFileSync(path.join(projectFolder, 'repos', 'other', 'nao_config.yaml'), `api_key: ${SECRET}\n`);
	fs.symlinkSync(path.join(projectFolder, 'nao_config.yaml'), path.join(projectFolder, 'alias.yaml'));
});

describe('nao_config.yaml is hidden from the agent file tools', () => {
	it.each(['/nao_config.yaml', 'nao_config.yaml', '/repos/other/nao_config.yaml', '/alias.yaml'])(
		'read denies %s',
		async (filePath) => {
			await expect(run(readTool, { file_path: filePath })).rejects.toThrow('Access denied');
		},
	);

	it('list omits it', async () => {
		const output = await run(listTool, { path: '/' });

		expect(output.entries.map((entry) => entry.name)).toContain('RULES.md');
		expect(output.entries.map((entry) => entry.name)).not.toContain('nao_config.yaml');
	});

	it('grep never matches inside it', async () => {
		const wholeProject = await run(grepTool, { pattern: SECRET });
		expect(wholeProject).toMatchObject({ matches: [], total_matches: 0 });

		await expect(run(grepTool, { pattern: SECRET, path: '/nao_config.yaml' })).rejects.toThrow('Access denied');
	});
});

function run<TInput, TOutput>(tool: Tool<TInput, TOutput>, input: TInput): Promise<TOutput> {
	return executeTool(tool, input, createToolContext({ projectFolder }));
}
