import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMostReadContextFiles, toExplorerPath } from '../../src/services/context-file-reads.service';

const mocks = vi.hoisted(() => ({ getContextFileReads: vi.fn() }));

vi.mock('../../src/queries/context-file-reads.queries', () => ({
	getContextFileReads: mocks.getContextFileReads,
}));

describe('getMostReadContextFiles', () => {
	beforeEach(() => {
		mocks.getContextFileReads.mockReset();
	});

	it('merges the ways the agent wrote a path and reads from the last 30 days', async () => {
		mocks.getContextFileReads.mockResolvedValue([
			{ filePath: '/docs/orders.md', readCount: 4 },
			{ filePath: 'RULES.md', readCount: 3 },
			{ filePath: './RULES.md', readCount: 2 },
			{ filePath: '../secrets.md', readCount: 9 },
		]);

		const result = await getMostReadContextFiles('project', new Date('2026-11-14T00:00:00Z'));

		expect(result).toEqual({
			windowDays: 30,
			files: [
				{ path: '/RULES.md', readCount: 5 },
				{ path: '/docs/orders.md', readCount: 4 },
			],
		});
		expect(mocks.getContextFileReads).toHaveBeenCalledWith('project', new Date('2026-10-15T00:00:00Z'), 5_000);
	});
});

describe('toExplorerPath', () => {
	it.each([
		{ agentPath: 'RULES.md', expected: '/RULES.md' },
		{ agentPath: '/docs/orders.md', expected: '/docs/orders.md' },
		{ agentPath: ' ./docs//orders.md ', expected: '/docs/orders.md' },
		{ agentPath: 'docs/../RULES.md', expected: '/RULES.md' },
		{ agentPath: 'docs/', expected: '/docs' },
		{ agentPath: '../outside.md', expected: null },
		{ agentPath: '/', expected: null },
	])('maps $agentPath to $expected', ({ agentPath, expected }) => {
		expect(toExplorerPath(agentPath)).toBe(expected);
	});
});
