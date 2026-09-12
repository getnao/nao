import actualFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsControls = vi.hoisted(() => ({
	actualOpen: undefined as unknown as typeof import('fs/promises').open,
	openMock: vi.fn(),
}));

vi.mock('fs/promises', async () => {
	const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
	fsControls.actualOpen = actual.open.bind(actual);
	return {
		...actual,
		default: { ...actual.default, open: fsControls.openMock },
	};
});

import readTool from '../src/agents/tools/read';
import type { ToolContext } from '../src/types/tools';

let root: string;
let projectFolder: string;

beforeEach(async () => {
	root = await actualFs.mkdtemp(path.join(os.tmpdir(), 'nao-read-race-'));
	projectFolder = path.join(root, 'project');
	await actualFs.mkdir(projectFolder);
	fsControls.openMock.mockImplementation(fsControls.actualOpen);
});

afterEach(async () => {
	fsControls.openMock.mockReset();
	await actualFs.rm(root, { recursive: true, force: true });
});

describe('read project file path safety', () => {
	it('rejects bytes opened through a swapped ancestor', async () => {
		const directory = path.join(projectFolder, 'context');
		const movedDirectory = path.join(projectFolder, 'context-safe');
		const outsideDirectory = path.join(root, 'outside');
		const filePath = path.join(directory, 'notes.md');
		await actualFs.mkdir(directory);
		await actualFs.mkdir(outsideDirectory);
		await actualFs.writeFile(filePath, 'safe');
		await actualFs.writeFile(path.join(outsideDirectory, 'notes.md'), 'secret');

		fsControls.openMock.mockImplementation(async (openedPath, flags, mode) => {
			await actualFs.rename(directory, movedDirectory);
			await actualFs.symlink(outsideDirectory, directory, 'dir');
			const handle = await fsControls.actualOpen(openedPath, flags, mode);
			await actualFs.unlink(directory);
			await actualFs.rename(movedDirectory, directory);
			return handle;
		});

		await expect(runRead('/context/notes.md')).rejects.toThrow('changed while being read');
	});
});

function runRead(filePath: string): Promise<unknown> {
	const context = {
		projectFolder,
		warehouseTableAccess: { enforced: false },
		docsContextAccess: { enforced: false },
	} as ToolContext;
	return readTool.execute!({ file_path: filePath }, { experimental_context: context } as Parameters<
		NonNullable<typeof readTool.execute>
	>[1]);
}
