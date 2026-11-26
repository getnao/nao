// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '../../helpers/query-client';
import { deferred } from '../../helpers/deferred';
import type { ReactNode } from 'react';
import { useSaveChartSettings } from '@/components/custom-story/custom-story-block-edit';

const mocks = vi.hoisted(() => ({ editCustomStoryBlock: vi.fn() }));

vi.mock('@/main', () => ({
	trpc: {
		story: {
			editCustomStoryBlock: {
				mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.editCustomStoryBlock }),
			},
			listVersions: { queryKey: (input: object) => ['listVersions', input] },
			getCustomVersion: { queryKey: (input: object) => ['getCustomVersion', input] },
			listAll: { queryKey: () => ['listAll'] },
		},
	},
}));
vi.mock('@/components/tool-calls/display-chart-edit-dialog', () => ({ ChartConfigEditDialog: () => null }));
vi.mock('@/components/tool-calls/display-table-edit-dialog', () => ({ TableFormatEditDialog: () => null }));

const TARGET = { chatId: 'chat-1', storySlug: 'revenue', versionNumber: 3 };
const BLOCK = { component: 'Chart' as const, props: { queryId: 'q1', type: 'waterfall' } };

afterEach(() => {
	cleanup();
	mocks.editCustomStoryBlock.mockReset();
});

describe('useSaveChartSettings', () => {
	it('resolves once the block is saved, before the refresh replaces the story frame', async () => {
		const queryClient = createTestQueryClient();
		const refresh = deferred<void>();
		const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(refresh.promise);
		mocks.editCustomStoryBlock.mockResolvedValue({ versionNumber: 4 });
		const { result } = renderHook(() => useSaveChartSettings(TARGET), { wrapper: providerOf(queryClient) });

		await result.current({ block: BLOCK, settings: { palette: 'warm' } });

		expect(mocks.editCustomStoryBlock.mock.calls[0][0]).toEqual({
			...TARGET,
			block: BLOCK,
			change: { set: { settings: { palette: 'warm' } }, unset: [] },
		});
		expect(invalidate).toHaveBeenCalledWith({
			queryKey: ['getCustomVersion', { chatId: 'chat-1', storySlug: 'revenue' }],
		});
		refresh.resolve();
	});
});

function providerOf(queryClient: ReturnType<typeof createTestQueryClient>) {
	return function Provider({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}
