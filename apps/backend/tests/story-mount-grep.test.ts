import os from 'node:os';
import path from 'node:path';

import type { Tool } from 'ai';
import fs from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import grepTool from '../src/agents/tools/grep';
import { __reloadEnvForTesting } from '../src/env';
import type { ToolContext } from '../src/types/tools';

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/services/story-mount', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/services/story-mount')>()),
	isCustomStoriesEnabled: () => true,
	listStoryMountFilesToGrep: async () => [
		{ virtualPath: '/stories/revenue/app.jsx', content: 'const title = "Revenue";\nexport default App;' },
		{ virtualPath: '/stories/revenue/lib/format.js', content: 'export const a = 1;\n' + 'a'.repeat(5_000) + '!' },
	],
}));

let projectFolder: string;

beforeEach(async () => {
	projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nao-story-grep-test-'));
	__reloadEnvForTesting();
});

afterEach(async () => {
	await fs.rm(projectFolder, { recursive: true, force: true });
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

async function run(input: { pattern: string; path?: string }) {
	const tool = grepTool as Tool<typeof input, { matches: { path: string }[] }>;
	return tool.execute!(input, {
		experimental_context: {
			projectFolder,
			projectId: 'proj-1',
			userId: 'user-1',
			chatId: 'chat-1',
			warehouseTableAccess: { enforced: false },
			warehouseRowSecurity: { enforced: false },
			docsContextAccess: { enforced: false },
			userGroupFeatures: [],
			userRulesGroupAccess: { enforced: false },
		} as unknown as ToolContext,
	} as Parameters<NonNullable<typeof tool.execute>>[1]) as Promise<{
		matches: { path: string; line_number: number; line_content: string }[];
	}>;
}
