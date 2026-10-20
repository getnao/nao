import type { Tool } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import grepTool from '../../src/agents/tools/grep';
import { __reloadEnvForTesting } from '../../src/env';
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

function run(input: { pattern: string; path?: string }) {
	const tool = grepTool as Tool<
		typeof input,
		{ matches: { path: string; line_number: number; line_content: string }[] }
	>;
	return executeTool(tool, input, createToolContext({ projectFolder }));
}
