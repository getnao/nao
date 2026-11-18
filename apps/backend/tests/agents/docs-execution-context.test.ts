import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/queries/image.queries', () => ({ getImagesByChatId: vi.fn() }));
vi.mock('../../src/services/query-result.service', () => ({ getQueryResult: vi.fn() }));
vi.mock('../../src/services/storage/user-files', () => ({
	readUserFileBytes: vi.fn(),
	writeUserFileBytes: vi.fn(),
}));

import { refreshProjectContextInSandbox } from '../../src/agents/tools/execute-sandboxed-code';
import { useTemporaryFolders } from '../helpers/temporary-folders';
import { createToolContext } from '../helpers/tool-context';

let projectFolder: string;
const createTemporaryFolder = useTemporaryFolders();

beforeEach(() => {
	projectFolder = createTemporaryFolder('nao-docs-execution-');
	fs.mkdirSync(path.join(projectFolder, 'docs', 'finance'), { recursive: true });
	fs.mkdirSync(path.join(projectFolder, 'docs', 'legal'), { recursive: true });
	fs.writeFileSync(path.join(projectFolder, 'docs', 'finance', 'kpis.md'), 'kpis');
	fs.writeFileSync(path.join(projectFolder, 'docs', 'legal', 'terms.md'), 'terms');
	fs.writeFileSync(path.join(projectFolder, 'RULES.md'), 'rules');
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('docs execution context filtering', () => {
	it('refreshes reused sandbox context for policy changes and future folder files', async () => {
		const sandbox = new FakeContextSandbox();
		const folderAccess = contextWithDocs([{ kind: 'folder', path: 'finance' }]);

		await refreshProjectContextInSandbox(sandbox, folderAccess, createTemporaryFolder('nao-docs-execution-'));
		expect(sandbox.paths()).toEqual(['/root/context/RULES.md', '/root/context/docs/finance/kpis.md']);

		fs.writeFileSync(path.join(projectFolder, 'docs', 'finance', 'future.md'), 'future');
		await refreshProjectContextInSandbox(sandbox, folderAccess, createTemporaryFolder('nao-docs-execution-'));
		expect(sandbox.paths()).toEqual([
			'/root/context/RULES.md',
			'/root/context/docs/finance/future.md',
			'/root/context/docs/finance/kpis.md',
		]);

		await refreshProjectContextInSandbox(
			sandbox,
			contextWithDocs([{ kind: 'file', path: 'legal/terms.md' }]),
			createTemporaryFolder('nao-docs-execution-'),
		);
		expect(sandbox.paths()).toEqual(['/root/context/RULES.md', '/root/context/docs/legal/terms.md']);
	});

	it('refreshes sandbox rules for group changes and omits malformed rules', async () => {
		const sandbox = new FakeContextSandbox();
		const tmpDir = createTemporaryFolder('nao-docs-execution-');
		fs.writeFileSync(
			path.join(projectFolder, 'RULES.md'),
			'Public\n{% if group("finance") %}\nFinance\n{% endif %}\n',
		);

		await refreshProjectContextInSandbox(sandbox, contextWithDocs([], ['finance']), tmpDir);
		expect(sandbox.content('/root/context/RULES.md')).toBe('Public\nFinance\n');

		await refreshProjectContextInSandbox(sandbox, contextWithDocs([], ['support']), tmpDir);
		expect(sandbox.content('/root/context/RULES.md')).toBe('Public\n');

		fs.writeFileSync(path.join(projectFolder, 'RULES.md'), 'Public\n{% if group("finance") %}\nFinance\n');
		await refreshProjectContextInSandbox(sandbox, contextWithDocs([], ['finance']), tmpDir);
		expect(sandbox.paths()).not.toContain('/root/context/RULES.md');
	});
});

function contextWithDocs(grants: Array<{ kind: 'folder' | 'file'; path: string }>, groupNames: string[] | null = null) {
	return createToolContext({
		projectFolder,
		docsContextAccess: { enforced: true, access: { mode: 'restricted', grants } },
		userRulesGroupAccess: groupNames === null ? { enforced: false } : { enforced: true, groupNames },
	});
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

	content(path: string): string | undefined {
		return this.files.get(path);
	}
}
