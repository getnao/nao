import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

import type { ContextExplorerFileAccess } from '../../src/services/context-explorer.service';
import { listRecentContextChanges, parseRecentContextChanges } from '../../src/services/context-recent-changes.service';
import { commitAll, createContextGitFixture, fileAccess, writeFiles } from '../helpers/context-git-fixture';
import { useTemporaryFolders } from '../helpers/temporary-folders';

describe('listRecentContextChanges', () => {
	const createTemporaryFolder = useTemporaryFolders();
	let access: ContextExplorerFileAccess;

	beforeEach(async () => {
		const files = { 'nao_config.yaml': 'name: project\n', 'RULES.md': '# Rules\n', 'docs/orders.md': 'orders\n' };
		const fixture = createContextGitFixture(createTemporaryFolder('nao-context-recent-'), files);
		writeFiles(fixture.live, files);
		access = await fileAccess(fixture.context);
	});

	it('lists the files of the last commits, the latest change of each first', () => {
		if (access.git.status !== 'available') {
			throw new Error('The fixture has no Git repository.');
		}
		writeFiles(access.git.repo.worktreeRoot, { 'RULES.md': '# Rules\n\nAnswer in English.\n' });
		commitAll(access.git.repo.worktreeRoot, 'Answer in English');

		const changes = listRecentContextChanges(access);

		expect(changes?.map(({ path, author, message }) => ({ path, author, message }))).toEqual([
			{ path: '/RULES.md', author: 'Test', message: 'Answer in English' },
			{ path: '/docs/orders.md', author: 'Test', message: 'initial' },
			{ path: '/nao_config.yaml', author: 'Test', message: 'initial' },
		]);
	});

	it('shows nothing without a Git repository', () => {
		const withoutGit: ContextExplorerFileAccess = {
			...access,
			git: { status: 'unavailable', reason: 'git-unavailable', message: 'No Git', repo: null },
		};

		expect(listRecentContextChanges(withoutGit)).toBeNull();
	});
});

describe('parseRecentContextChanges', () => {
	it('keeps the files of the project folder of the repository, without its prefix', () => {
		const output = [
			'\u001e2026-11-14T10:00:00+01:00\u001fAda\u001fEdit orders\u0000\nproject/docs/orders.md\u0000other/readme.md\u0000',
			'\u001e2026-11-13T10:00:00+01:00\u001fZoe\u001fFirst\u0000\nproject/docs/orders.md\u0000project/ notes\t1.md\u0000',
		].join('');

		expect(parseRecentContextChanges(output, { projectPrefix: 'project' })).toEqual([
			{ path: '/docs/orders.md', changedAt: '2026-11-14T10:00:00+01:00', author: 'Ada', message: 'Edit orders' },
			{ path: '/ notes\t1.md', changedAt: '2026-11-13T10:00:00+01:00', author: 'Zoe', message: 'First' },
		]);
	});
});
