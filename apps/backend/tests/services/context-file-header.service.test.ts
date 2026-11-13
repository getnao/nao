import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
	process.env.MODE = 'test';
	process.env.NAO_MODE = 'self-hosted';
	process.env.NAO_DEFAULT_PROJECT_PATH = '';
	process.env.NAO_CONTEXT_SOURCE = 'local';
});

const mocks = vi.hoisted(() => ({
	listUsersWithProjectAccess: vi.fn(),
}));

vi.mock('../../src/queries/project.queries', () => ({
	listUsersWithProjectAccess: mocks.listUsersWithProjectAccess,
}));

vi.mock('../../src/services/nao-draft.service', () => ({
	hasContextRepository: async () => true,
	getNaoDraftFileTree: async () => [],
}));

import type { ContextExplorerFileAccess } from '../../src/services/context-explorer.service';
import { listContextFileHeaderProblems, listContextFileOwners } from '../../src/services/context-file-header.service';
import { createContextGitFixture, fileAccess, writeFiles } from '../helpers/context-git-fixture';
import { useTemporaryFolders } from '../helpers/temporary-folders';

describe('context file headers', () => {
	const createTemporaryFolder = useTemporaryFolders();
	let access: ContextExplorerFileAccess;

	beforeEach(async () => {
		mocks.listUsersWithProjectAccess.mockResolvedValue([
			{ id: 'u2', name: 'Zoe', email: 'zoe@example.com', role: 'user', status: 'active' },
			{ id: 'u1', name: 'Ada', email: 'Ada@Example.com', role: 'admin', status: 'active' },
		]);
		const files = {
			'nao_config.yaml': 'name: project\n',
			'owned.md': '---\nowner: ada@example.com\n---\nbody\n',
			'docs/orphan.md': '---\ntitle: Orphan\nowner: gone@example.com\n---\nbody\n',
			'docs/broken.md': '---\ntitle: [unclosed\n---\nbody\n',
			'docs/long.md': `---\ndescription: ${'x'.repeat(10_000)}\nowner: gone@example.com\n---\nbody\n`,
			'plain.md': 'no header\n',
			'notes.txt': '---\nowner: gone@example.com\n---\n',
		};
		const fixture = createContextGitFixture(createTemporaryFolder('nao-context-header-'), files);
		writeFiles(fixture.live, files);
		access = await fileAccess(fixture.context);
	});

	it('lists the users of the project as owners, sorted by name', async () => {
		expect(await listContextFileOwners('project')).toEqual([
			{ id: 'u1', name: 'Ada', email: 'Ada@Example.com' },
			{ id: 'u2', name: 'Zoe', email: 'zoe@example.com' },
		]);
	});

	it('reports the Markdown files with a broken header or an unknown owner', async () => {
		const problems = await listContextFileHeaderProblems('project', access);

		expect(
			problems.map(({ path, problems: fileProblems }) => [path, fileProblems.map((problem) => problem.kind)]),
		).toEqual([
			['/docs/broken.md', ['invalid-header']],
			['/docs/long.md', ['unknown-owner']],
			['/docs/orphan.md', ['unknown-owner']],
		]);
	});
});
