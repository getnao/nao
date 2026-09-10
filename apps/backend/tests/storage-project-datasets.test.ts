import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { __resetStorageForTesting } from '../src/services/storage';
import {
	listProjectDatasetDirectory,
	openProjectDatasetFiles,
	readProjectDataset,
	writeProjectDataset,
} from '../src/services/storage/project-datasets';

let root: string;
let originalEnv: typeof process.env;

beforeEach(async () => {
	originalEnv = { ...process.env };
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-project-datasets-test-'));
	process.env.NAO_STORAGE_BACKEND = 'local';
	process.env.NAO_STORAGE_LOCAL_PATH = root;
	__reloadEnvForTesting();
	__resetStorageForTesting();
});

afterEach(async () => {
	process.env = originalEnv;
	__reloadEnvForTesting();
	__resetStorageForTesting();
	await fs.rm(root, { recursive: true, force: true });
});

describe('project dataset storage', () => {
	it('writes, reads, and lists generated dataset files', async () => {
		await writeProjectDataset('proj-1', 'deublin/latest/README.md', '# Deublin products\n');
		await writeProjectDataset('proj-1', 'deublin/latest/products.jsonl', '{"sku":"A-1"}\n');
		await writeProjectDataset('proj-1', 'other/latest/products.jsonl', '{"sku":"B-2"}\n');

		expect(await readProjectDataset('proj-1', 'deublin/latest/README.md')).toBe('# Deublin products\n');
		expect(await listProjectDatasetDirectory('proj-1', '')).toEqual([
			{ name: 'deublin', relativePath: 'deublin', type: 'directory', itemCount: 1 },
			{ name: 'other', relativePath: 'other', type: 'directory', itemCount: 1 },
		]);
		expect(await listProjectDatasetDirectory('proj-1', 'deublin/latest')).toEqual([
			{ name: 'products.jsonl', relativePath: 'deublin/latest/products.jsonl', type: 'file', size: 14 },
			{ name: 'README.md', relativePath: 'deublin/latest/README.md', type: 'file', size: 19 },
		]);
	});

	it('maps generated files to local paths for DuckDB', async () => {
		await writeProjectDataset('proj-1', 'catalog/latest/products.parquet', Buffer.from('PAR1 test'));
		const access = await openProjectDatasetFiles('proj-1', ['catalog/latest/products.parquet']);

		try {
			const realPath = access.realPathOf('catalog/latest/products.parquet');
			expect(realPath).toContain(path.join('projects', 'proj-1', 'datasets'));
			await expect(fs.readFile(realPath)).resolves.toEqual(Buffer.from('PAR1 test'));
		} finally {
			await access.release();
		}
	});

	it('keeps project spaces isolated', async () => {
		await writeProjectDataset('proj-1', 'catalog/README.md', 'project 1');

		await expect(readProjectDataset('proj-2', 'catalog/README.md')).rejects.toThrow('No such project dataset file');
	});
});
