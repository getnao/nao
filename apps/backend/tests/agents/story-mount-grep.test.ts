import type { Tool } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import grepTool from '../../src/agents/tools/grep';
import { __reloadEnvForTesting } from '../../src/env';
import { storyLibraryFileBatchesToGrep } from '../../src/services/story-library';
import { useTemporaryFolders } from '../helpers/temporary-folders';
import { createToolContext, executeTool } from '../helpers/tool-context';

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/services/story-mount', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/services/story-mount')>()),
	isCustomStoriesEnabled: () => true,
	listStoryMountFilesToGrep: async () => [
		{ virtualPath: '/stories/revenue/app.jsx', content: 'const title = "Revenue";\nexport default App;' },
		{ virtualPath: '/stories/revenue/lib/format.js', content: 'export const a = 1;\n' + 'a'.repeat(5_000) + '!' },
	],
}));
vi.mock('../../src/services/story-library', () => ({
	storyLibraryFileBatchesToGrep: vi.fn(async function* () {
		yield [
			{
				virtualPath: '/story-library/story-1/queries.sql',
				content: '-- query_id: q1\nselect sum(revenue) from orders',
			},
		];
	}),
}));

let projectFolder: string;
const createTemporaryFolder = useTemporaryFolders();

beforeEach(() => {
	projectFolder = createTemporaryFolder('nao-story-grep-test-');
	__reloadEnvForTesting();
});

describe('grep over custom story drafts', () => {
	it('returns matches with their /stories virtual path', async () => {
		const output = await run({ pattern: 'Revenue', path: '/stories/revenue' });

		expect(output.matches).toEqual([
			{ path: '/stories/revenue/app.jsx', line_number: 1, line_content: 'const title = "Revenue";' },
		]);
	});

	it('accepts ripgrep-only syntax on a pathless search', async () => {
		const output = await run({ pattern: '(?i)revenue' });

		expect(output.matches.map((match) => match.path)).toContain('/stories/revenue/app.jsx');
	});

	it('does not block on catastrophic-backtracking patterns', async () => {
		const startedAt = Date.now();
		await run({ pattern: '(a+)+$', path: '/stories/revenue' });

		expect(Date.now() - startedAt).toBeLessThan(5_000);
	});
});

describe('grep over the story library', () => {
	it('searches the library when the path targets it', async () => {
		const output = await run({ pattern: 'revenue', path: '/story-library', glob: '*.sql' });

		expect(storyLibraryFileBatchesToGrep).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'project-1', userId: 'user-1' }),
			'/story-library',
			'*.sql',
		);
		expect(output.matches).toEqual([
			{
				path: '/story-library/story-1/queries.sql',
				line_number: 2,
				line_content: 'select sum(revenue) from orders',
			},
		]);
	});

	it('leaves the library out of a pathless search', async () => {
		vi.mocked(storyLibraryFileBatchesToGrep).mockClear();

		const output = await run({ pattern: 'revenue' });

		expect(storyLibraryFileBatchesToGrep).not.toHaveBeenCalled();
		expect(output.matches.map((match) => match.path)).not.toContain('/story-library/story-1/queries.sql');
	});
});

function run(input: { pattern: string; path?: string; glob?: string }) {
	const tool = grepTool as Tool<
		typeof input,
		{ matches: { path: string; line_number: number; line_content: string }[] }
	>;
	return executeTool(tool, input, createToolContext({ projectFolder }));
}
