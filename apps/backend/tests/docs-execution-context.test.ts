import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/queries/image.queries', () => ({ getImagesByChatId: vi.fn() }));
vi.mock('../src/services/query-result.service', () => ({ getQueryResult: vi.fn() }));
vi.mock('../src/services/storage/user-files', () => ({
	readUserFileBytes: vi.fn(),
	writeUserFileBytes: vi.fn(),
}));

import { createVirtualFS } from '../src/agents/tools/execute-python';
import { refreshProjectContextInSandbox } from '../src/agents/tools/execute-sandboxed-code';
import type { ToolContext } from '../src/types/tools';

let projectFolder: string;
const temporaryFolders: string[] = [];

beforeEach(() => {
	projectFolder = createTemporaryFolder();
	fs.mkdirSync(path.join(projectFolder, 'docs', 'finance'), { recursive: true });
	fs.mkdirSync(path.join(projectFolder, 'docs', 'legal'), { recursive: true });
	fs.writeFileSync(path.join(projectFolder, 'docs', 'finance', 'kpis.md'), 'kpis');
	fs.writeFileSync(path.join(projectFolder, 'docs', 'legal', 'terms.md'), 'terms');
	fs.writeFileSync(path.join(projectFolder, 'RULES.md'), 'rules');
});

afterEach(() => {
	for (const folder of temporaryFolders.splice(0)) {
		fs.rmSync(folder, { recursive: true, force: true });
	}
});

describe('docs execution context filtering', () => {
	it('filters denied docs from the Python virtual filesystem', () => {
		const files = createVirtualFS(contextWithDocs([{ kind: 'file', path: 'legal/terms.md' }]));
		expect([...files.keys()].sort()).toEqual(['/RULES.md', '/docs/legal/terms.md']);
	});

	it('refreshes reused sandbox context for policy changes and future folder files', async () => {
		const sandbox = new FakeContextSandbox();
		const folderAccess = contextWithDocs([{ kind: 'folder', path: 'finance' }]);

		await refreshProjectContextInSandbox(sandbox, folderAccess, createTemporaryFolder());
		expect(sandbox.paths()).toEqual(['/root/context/RULES.md', '/root/context/docs/finance/kpis.md']);

		fs.writeFileSync(path.join(projectFolder, 'docs', 'finance', 'future.md'), 'future');
		await refreshProjectContextInSandbox(sandbox, folderAccess, createTemporaryFolder());
		expect(sandbox.paths()).toEqual([
			'/root/context/RULES.md',
			'/root/context/docs/finance/future.md',
			'/root/context/docs/finance/kpis.md',
		]);

		await refreshProjectContextInSandbox(
			sandbox,
			contextWithDocs([{ kind: 'file', path: 'legal/terms.md' }]),
			createTemporaryFolder(),
		);
		expect(sandbox.paths()).toEqual(['/root/context/RULES.md', '/root/context/docs/legal/terms.md']);
	});
});

function contextWithDocs(grants: Array<{ kind: 'folder' | 'file'; path: string }>): ToolContext {
	return {
		projectFolder,
		warehouseTableAccess: { enforced: false },
		docsContextAccess: { enforced: true, access: { mode: 'restricted', grants } },
	} as ToolContext;
}

function createTemporaryFolder(): string {
	const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-docs-execution-'));
	temporaryFolders.push(folder);
	return folder;
}

class FakeContextSandbox {
	private files = new Map<string, string>();

	async exec(...args: string[]): Promise<void> {
		if (args.join(' ').includes('rm -rf /root/context')) {
			this.files.clear();
		}
	}

	async copyIn(source: string, destination: string): Promise<void> {
		this.files.set(destination, fs.readFileSync(source, 'utf-8'));
	}

	paths(): string[] {
		return [...this.files.keys()].sort();
	}
}
