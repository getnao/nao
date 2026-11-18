// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStoryBlockEdit } from '@/contexts/use-story-block-edit';

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
	useQueryClient: () => ({}),
}));
vi.mock('@/main', () => ({
	trpc: {
		story: {
			getLatest: { queryKey: (input: unknown) => ['getLatest', input] },
			createVersion: { mutationOptions: (options: unknown) => options },
		},
	},
}));

const CHART_TAG = '<chart query_id="q1" chart_type="bar" />';
const TABLE_TAG = '<table query_id="q2" />';
const STORY = { chatId: 'chat-1', storySlug: 'revenue', storyTitle: 'Revenue', storyVersion: 4 };

describe('useStoryBlockEdit', () => {
	it('saves a chart then a table edited right after it on top of each other, whichever editor saves', async () => {
		let finishChartSave: (value: { version: number }) => void = () => {};
		mocks.mutateAsync
			.mockImplementationOnce(() => new Promise((resolve) => (finishChartSave = resolve)))
			.mockResolvedValueOnce({ version: 6 });
		const storyCode = `# Revenue\n\n${CHART_TAG}\n\n${TABLE_TAG}\n`;
		const chartEditor = renderHook(() => useStoryBlockEdit({ ...STORY, storyCode })).result.current;
		const tableEditor = renderHook(() => useStoryBlockEdit({ ...STORY, storyCode })).result.current;

		const chartSave = chartEditor.replaceBlock(CHART_TAG, '<chart query_id="q1" chart_type="line" />');
		const tableSave = tableEditor.replaceBlock(TABLE_TAG, '<table query_id="q2" title="Totals" />');
		await Promise.resolve();
		expect(mocks.mutateAsync).toHaveBeenCalledOnce();

		finishChartSave({ version: 5 });
		await Promise.all([chartSave, tableSave]);

		const [chartInput, tableInput] = mocks.mutateAsync.mock.calls.map(([input]) => input);
		expect(chartInput.basedOnVersion).toBe(4);
		expect(tableInput.basedOnVersion).toBe(5);
		expect(tableInput.code).toContain('chart_type="line"');
		expect(tableInput.code).toContain('title="Totals"');
	});
});
