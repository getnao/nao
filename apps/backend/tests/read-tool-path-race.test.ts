import actualFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsControls = vi.hoisted(() => ({
	actualOpen: undefined as unknown as typeof import('fs/promises').open,
	openMock: vi.fn(),
}));
const windowsPathControls = vi.hoisted(() => ({
	resolveMock: vi.fn(),
}));

vi.mock('fs/promises', async () => {
	const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
	fsControls.actualOpen = actual.open.bind(actual);
	return {
		...actual,
		default: { ...actual.default, open: fsControls.openMock },
	};
});
vi.mock('../src/agents/tools/windows-descriptor-path', () => ({
	resolveWindowsDescriptorPath: windowsPathControls.resolveMock,
}));

import readTool from '../src/agents/tools/read';
import type { ToolContext } from '../src/types/tools';

let root: string;
let projectFolder: string;
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

beforeEach(async () => {
	root = await actualFs.mkdtemp(path.join(os.tmpdir(), 'nao-read-race-'));
	projectFolder = path.join(root, 'project');
	await actualFs.mkdir(projectFolder);
	fsControls.openMock.mockImplementation(fsControls.actualOpen);
	windowsPathControls.resolveMock.mockRejectedValue(new Error('Windows path resolver was not configured'));
});

afterEach(async () => {
	Object.defineProperty(process, 'platform', originalPlatform);
	fsControls.openMock.mockReset();
	windowsPathControls.resolveMock.mockReset();
	await actualFs.rm(root, { recursive: true, force: true });
});

describe('read project file path safety', () => {
	it('rejects bytes opened through a swapped ancestor', async () => {
		await arrangeSwappedAncestor();

		await expect(runRead('/context/notes.md')).rejects.toThrow('changed while being read');
	});

	it('reads ordinary project files on Windows', async () => {
		const filePath = path.join(projectFolder, 'notes.md');
		await actualFs.writeFile(filePath, 'safe');
		windowsPathControls.resolveMock.mockResolvedValue(await actualFs.realpath(filePath));
		Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });

		await expect(runRead('/notes.md')).resolves.toMatchObject({ content: 'safe' });
	});

	it('rejects bytes opened through a swapped ancestor on Windows', async () => {
		const outsideFile = await arrangeSwappedAncestor();
		windowsPathControls.resolveMock.mockResolvedValue(outsideFile);
		Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });

		await expect(runRead('/context/notes.md')).rejects.toThrow('changed while being read');
	});

	it('reads an existing file whose name ends with the Linux deletion marker', async () => {
		await actualFs.writeFile(path.join(projectFolder, 'report (deleted)'), 'still here');

		await expect(runRead('/report (deleted)')).resolves.toMatchObject({ content: 'still here' });
	});

	it('rejects a descriptor unlinked after its initial validation', async () => {
		const filePath = path.join(projectFolder, 'notes.md');
		await actualFs.writeFile(filePath, 'removed');
		const descriptorPath = await actualFs.realpath(filePath);
		windowsPathControls.resolveMock.mockImplementation(async () => {
			await actualFs.unlink(filePath);
			return descriptorPath;
		});
		Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' });

		await expect(runRead('/notes.md')).rejects.toThrow('unable to verify opened file');
	});

	it('fails closed when descriptor-bound paths are unavailable', async () => {
		await actualFs.writeFile(path.join(projectFolder, 'notes.md'), 'safe');
		Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'aix' });

		await expect(runRead('/notes.md')).rejects.toThrow(
			"Access denied: descriptor-bound file verification is unavailable on 'aix'",
		);
	});
});

async function arrangeSwappedAncestor(): Promise<string> {
	const directory = path.join(projectFolder, 'context');
	const movedDirectory = path.join(projectFolder, 'context-safe');
	const outsideDirectory = path.join(root, 'outside');
	const filePath = path.join(directory, 'notes.md');
	const outsideFile = path.join(outsideDirectory, 'notes.md');
	await actualFs.mkdir(directory);
	await actualFs.mkdir(outsideDirectory);
	await actualFs.writeFile(filePath, 'safe');
	await actualFs.writeFile(outsideFile, 'secret');

	fsControls.openMock.mockImplementation(async (openedPath, flags, mode) => {
		await actualFs.rename(directory, movedDirectory);
		await actualFs.symlink(outsideDirectory, directory, 'dir');
		const handle = await fsControls.actualOpen(openedPath, flags, mode);
		await actualFs.unlink(directory);
		await actualFs.rename(movedDirectory, directory);
		return handle;
	});
	return outsideFile;
}

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
