import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import listTool from '../src/agents/tools/list';
import readTool from '../src/agents/tools/read';
import type { ToolContext } from '../src/types/tools';
import { clearNaoignoreCache } from '../src/utils/tools';

let root: string;
let projectFolder: string;
let outside: string;

const TABLE_FOLDER = 'databases/type=bigquery/database=analytics/schema=warehouse/table=trips';

beforeEach(async () => {
	root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nao-path-errors-')));
	projectFolder = path.join(root, 'project');
	outside = path.join(root, 'outside');
	await fs.mkdir(path.join(projectFolder, 'docs', 'notion'), { recursive: true });
	await fs.mkdir(path.join(projectFolder, TABLE_FOLDER), { recursive: true });
	await fs.mkdir(outside);
	await fs.writeFile(path.join(projectFolder, 'docs', 'notion', 'glossary.md'), '# Glossary');
	await fs.writeFile(path.join(projectFolder, TABLE_FOLDER, 'columns.md'), '# Columns');
	await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
	clearNaoignoreCache();
});

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe('read tool missing paths', () => {
	it('never exposes the host filesystem path', async () => {
		const error = await captureError(() => runRead('/docs/notion/missing.md'));

		expect(error.message).not.toContain(projectFolder);
		expect(error.message).not.toContain('ENOENT');
		expect(error.message).toContain("'/docs/notion/missing.md'");
	});

	it('explains that paths are relative to the project root', async () => {
		const error = await captureError(() => runRead('/docs/notion/missing.md'));

		expect(error.message).toContain('relative to the project root');
	});

	it('suggests the path without an invented /project/ prefix', async () => {
		const error = await captureError(() => runRead('/project/docs/notion/glossary.md'));

		expect(error.message).toContain("Did you mean '/docs/notion/glossary.md'?");
	});

	it('suggests the prefixed database layout for bare table names', async () => {
		const error = await captureError(() => runRead('/databases/bigquery/analytics/warehouse/trips/columns.md'));

		expect(error.message).toContain(`Did you mean '/${TABLE_FOLDER}/columns.md'?`);
	});

	it('does not suggest a path the user is not allowed to read', async () => {
		const context = {
			docsContextAccess: { enforced: true, access: { mode: 'restricted', grants: [] } },
		} as unknown as Partial<ToolContext>;
		const error = await captureError(() => runRead('/project/docs/notion/glossary.md', context));

		expect(error.message).not.toContain('Did you mean');
	});

	it('does not suggest a path that does not exist either', async () => {
		const error = await captureError(() => runRead('/project/docs/notion/missing.md'));

		expect(error.message).not.toContain('Did you mean');
	});
});

describe('list tool missing paths', () => {
	it('never exposes the host filesystem path', async () => {
		const error = await captureError(() => runList('/docs/missing'));

		expect(error.message).not.toContain(projectFolder);
		expect(error.message).toContain("'/docs/missing'");
		expect(error.message).toContain('relative to the project root');
	});

	it('suggests the path without an invented /project/ prefix', async () => {
		const error = await captureError(() => runList('/project/docs/notion'));

		expect(error.message).toContain("Did you mean '/docs/notion'?");
	});
});

describe('sandbox checks stay intact', () => {
	it('still rejects traversal out of the project folder', async () => {
		await expect(runRead('/../outside/secret.txt')).rejects.toThrow(/outside the project folder/);
		await expect(runList('/../outside')).rejects.toThrow(/outside the project folder/);
	});

	it('keeps a normalised /project/.. path inside the project and does not leak the host path', async () => {
		const error = await captureError(() => runRead('/project/../outside/secret.txt'));

		expect(error.message).not.toContain(root);
		expect(error.message).toContain('Not found');
	});

	it('still rejects a symlink escaping the project folder', async () => {
		await fs.symlink(path.join(outside, 'secret.txt'), path.join(projectFolder, 'link.txt'));
		await fs.symlink(outside, path.join(projectFolder, 'linked-dir'));

		await expect(runRead('/link.txt')).rejects.toThrow(/outside the project folder/);
		await expect(runList('/linked-dir')).rejects.toThrow(/outside the project folder/);
	});

	it('still reads and lists existing project paths', async () => {
		await expect(runRead('/docs/notion/glossary.md')).resolves.toMatchObject({ content: '# Glossary' });
		await expect(runList('/docs/notion')).resolves.toMatchObject({
			entries: [expect.objectContaining({ name: 'glossary.md' })],
		});
	});
});

async function captureError(run: () => Promise<unknown>): Promise<Error> {
	try {
		await run();
	} catch (error) {
		return error as Error;
	}
	throw new Error('Expected the tool to fail');
}

function buildContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		projectFolder,
		chatId: 'chat',
		warehouseTableAccess: { enforced: false },
		docsContextAccess: { enforced: false },
		filesContextAccess: { enforced: false },
		mcpAccess: { mode: 'all' },
		...overrides,
	} as unknown as ToolContext;
}

function runRead(filePath: string, overrides?: Partial<ToolContext>): Promise<unknown> {
	return readTool.execute!({ file_path: filePath }, { experimental_context: buildContext(overrides) } as Parameters<
		NonNullable<typeof readTool.execute>
	>[1]) as Promise<unknown>;
}

function runList(listPath: string, overrides?: Partial<ToolContext>): Promise<unknown> {
	return listTool.execute!({ path: listPath }, { experimental_context: buildContext(overrides) } as Parameters<
		NonNullable<typeof listTool.execute>
	>[1]) as Promise<unknown>;
}
