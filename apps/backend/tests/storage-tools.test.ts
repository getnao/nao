import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Tool } from 'ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import grepTool from '../src/agents/tools/grep';
import listTool from '../src/agents/tools/list';
import readTool from '../src/agents/tools/read';
import searchTool from '../src/agents/tools/search';
import writeTool from '../src/agents/tools/write';
import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting } from '../src/services/storage';
import type { ToolContext } from '../src/types/tools';

let storageRoot: string;
let projectFolder: string;
let originalEnv: typeof process.env;

const context = () => ({ projectFolder, projectId: 'proj-1', userId: 'user-1' }) as unknown as ToolContext;

beforeEach(async () => {
	originalEnv = { ...process.env };
	storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-storage-tools-'));
	projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-project-tools-'));

	useBackend('local');
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await fs.rm(storageRoot, { recursive: true, force: true });
	await fs.rm(projectFolder, { recursive: true, force: true });
});

describe('write', () => {
	it('saves under /home and returns the path in the tree', async () => {
		const output = await run(writeTool, { file_path: '/home/reports/q1.csv', content: 'week,customers\n' });

		expect(output).toEqual({ _version: '1', path: '/home/reports/q1.csv', size: 15 });
		expect(await readStorageFile('reports/q1.csv')).toBe('week,customers\n');
	});

	it('accepts a path without the leading slash', async () => {
		const output = await run(writeTool, { file_path: 'home/notes.md', content: 'kept' });

		expect(output).toMatchObject({ path: '/home/notes.md' });
	});

	it('accepts the ~ shorthand and answers with the real path', async () => {
		const output = await run(writeTool, { file_path: '~/notes.md', content: 'kept' });

		expect(output).toMatchObject({ path: '/home/notes.md' });
		expect(await readStorageFile('notes.md')).toBe('kept');
	});

	it('refuses to write anywhere else in the tree', async () => {
		await expect(run(writeTool, { file_path: '/RULES.md', content: 'nope' })).rejects.toThrow(
			'only files under /home can be written',
		);
		await expect(fs.readdir(projectFolder)).resolves.toEqual([]);
	});

	it('refuses a path escaping the user space', async () => {
		await expect(run(writeTool, { file_path: '/home/../user-2/x.csv', content: 'x' })).rejects.toThrow(
			"may not contain '..'",
		);
	});

	it('refuses a file above the configured size limit', async () => {
		process.env.NAO_STORAGE_MAX_FILE_SIZE_MB = '1';
		__reloadEnvForTesting();

		await expect(
			run(writeTool, { file_path: '/home/big.csv', content: 'x'.repeat(1024 * 1024 + 1) }),
		).rejects.toThrow('above the 1 MB limit');
	});
});

describe('read', () => {
	it('reads a saved file', async () => {
		await run(writeTool, { file_path: '/home/notes.md', content: 'line one\nline two' });

		expect(await run(readTool, { file_path: '/home/notes.md' })).toEqual({
			_version: '1',
			content: 'line one\nline two',
			numberOfTotalLines: 2,
		});
	});

	it('still reads a project file', async () => {
		await fs.writeFile(path.join(projectFolder, 'RULES.md'), 'project rules');

		expect(await run(readTool, { file_path: '/RULES.md' })).toMatchObject({ content: 'project rules' });
	});
});

describe('list', () => {
	it('shows /home as a folder at the root of the tree', async () => {
		await fs.writeFile(path.join(projectFolder, 'RULES.md'), 'rules');
		await run(writeTool, { file_path: '/home/reports/q1.csv', content: 'q1' });

		expect(await run(listTool, { path: '/' })).toEqual({
			_version: '1',
			entries: [
				{ path: '/RULES.md', name: 'RULES.md', type: 'file', size: '5', itemCount: undefined },
				{ path: '/home', name: 'home', type: 'directory' },
			],
		});
	});

	it('omits /home when storage is disabled', async () => {
		useBackend('none');

		expect(await run(listTool, { path: '/' })).toEqual({ _version: '1', entries: [] });
	});

	it('hides a project folder called home', async () => {
		await fs.mkdir(path.join(projectFolder, 'home'));
		await fs.writeFile(path.join(projectFolder, 'home/decoy.md'), 'decoy');

		const output = (await run(listTool, { path: '/' })) as { entries: { name: string; itemCount?: number }[] };

		expect(output.entries).toEqual([{ path: '/home', name: 'home', type: 'directory' }]);
	});

	it('lists a folder inside /home', async () => {
		await run(writeTool, { file_path: '/home/reports/q1.csv', content: 'q1' });
		await run(writeTool, { file_path: '/home/reports/2025/q2.csv', content: 'q2' });

		expect(await run(listTool, { path: '/home/reports' })).toMatchObject({
			entries: [
				{ path: '/home/reports/2025', name: '2025', type: 'directory', itemCount: 1 },
				{ path: '/home/reports/q1.csv', name: 'q1.csv', type: 'file' },
			],
		});
	});

	it('still lists the project folder', async () => {
		await fs.mkdir(path.join(projectFolder, 'databases'));

		expect(await run(listTool, { path: '/databases' })).toEqual({ _version: '1', entries: [] });
	});
});

describe('search', () => {
	it('matches project files and saved files in one pass', async () => {
		await fs.writeFile(path.join(projectFolder, 'columns.csv'), 'a,b');
		await run(writeTool, { file_path: '/home/reports/2025/q2.csv', content: 'q2' });
		await run(writeTool, { file_path: '/home/notes.md', content: 'notes' });

		expect(await run(searchTool, { pattern: '*.csv' })).toEqual({
			_version: '1',
			files: [
				{ path: '/columns.csv', dir: '/', size: '3' },
				{ path: '/home/reports/2025/q2.csv', dir: '/home/reports/2025', size: '2' },
			],
		});
	});

	it('can be scoped to saved files by naming the folder', async () => {
		await fs.writeFile(path.join(projectFolder, 'columns.csv'), 'a,b');
		await run(writeTool, { file_path: '/home/q2.csv', content: 'q2' });

		expect(await run(searchTool, { pattern: 'home/**/*.csv' })).toMatchObject({
			files: [{ path: '/home/q2.csv' }],
		});
	});

	it('leaves saved files out when storage is disabled', async () => {
		await run(writeTool, { file_path: '/home/q2.csv', content: 'q2' });
		useBackend('none');

		expect(await run(searchTool, { pattern: '*.csv' })).toEqual({ _version: '1', files: [] });
	});

	it('refuses traversal in a pattern', async () => {
		await expect(run(searchTool, { pattern: '../**' })).rejects.toThrow("'..' is not allowed");
	});
});

describe('grep', () => {
	beforeEach(async () => {
		await fs.writeFile(path.join(projectFolder, 'RULES.md'), 'revenue is net of refunds');
		await run(writeTool, { file_path: '/home/exports/q1.csv', content: 'quarter,revenue\nQ1,42' });
	});

	const pathsMatching = async (input: { pattern: string; path?: string }) => {
		const output = (await run(grepTool, input)) as { matches: { path: string }[] };
		return output.matches.map((match) => match.path);
	};

	it('searches the project and saved files together', async () => {
		expect(await pathsMatching({ pattern: 'revenue' })).toEqual(['/RULES.md', '/home/exports/q1.csv']);
	});

	it('can be scoped to /home', async () => {
		expect(await pathsMatching({ pattern: 'revenue', path: '/home' })).toEqual(['/home/exports/q1.csv']);
	});

	it('keeps valid names that merely start with two dots', async () => {
		await run(writeTool, { file_path: '/home/..config', content: 'revenue setting' });

		expect(await pathsMatching({ pattern: 'revenue setting', path: '/home' })).toEqual(['/home/..config']);
	});

	it('can be scoped to the project', async () => {
		expect(await pathsMatching({ pattern: 'revenue', path: '/' })).toEqual(['/RULES.md']);
	});

	it('leaves saved files out when storage is disabled', async () => {
		useBackend('none');
		expect(await pathsMatching({ pattern: 'revenue' })).toEqual(['/RULES.md']);
	});

	it('searches the project only on a bucket backend, and explains why when scoped to /home', async () => {
		useBackend('s3');

		expect(await pathsMatching({ pattern: 'revenue' })).toEqual(['/RULES.md']);
		await expect(pathsMatching({ pattern: 'revenue', path: '/home' })).rejects.toThrow(
			'requires the `local` storage backend',
		);
	});
});

describe('when permanent storage is disabled', () => {
	beforeEach(() => {
		useBackend('none');
	});

	it('rejects a storage path with an actionable message', async () => {
		await expect(run(readTool, { file_path: '/home/notes.md' })).rejects.toThrow('Permanent storage is disabled');
		await expect(run(listTool, { path: '/home' })).rejects.toThrow('Permanent storage is disabled');
		await expect(run(writeTool, { file_path: '/home/notes.md', content: 'x' })).rejects.toThrow(
			'Permanent storage is disabled',
		);
	});
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<TInput>(tool: Tool<TInput, any>, input: TInput) {
	return tool.execute!(input, {
		experimental_context: context(),
	} as Parameters<NonNullable<typeof tool.execute>>[1]);
}

function readStorageFile(relativePath: string): Promise<string> {
	return fs.readFile(path.join(storageRoot, 'projects/proj-1/users/user-1', relativePath), 'utf-8');
}

function useBackend(backend: 'none' | 'local' | 's3'): void {
	process.env.NAO_STORAGE_BACKEND = backend;
	process.env.NAO_STORAGE_LOCAL_PATH = storageRoot;
	process.env.NAO_STORAGE_S3_BUCKET = 'test-bucket';
	__reloadEnvForTesting();
	__resetStorageForTesting();
}
