// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_TEST_RUN_MODELS, useTestRunSettings } from '@/hooks/use-test-run-settings';

const mocks = vi.hoisted(() => ({ configuredModels: [] as { provider: string; modelId: string }[] }));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['project'] }) },
			getDefaultChatModel: { queryOptions: () => ({ queryKey: ['default-model'] }) },
			listAvailableTranscribeModels: { queryOptions: () => ({ queryKey: ['available-models'] }) },
		},
		testRun: { listTests: { queryOptions: () => ({ queryKey: ['tests'] }) } },
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: ({ queryKey: [key] }: { queryKey: string[] }) => ({ data: queryData(key), isPending: false }),
}));

describe('useTestRunSettings', () => {
	afterEach(cleanup);

	it('runs no more models than a run accepts when nao_config.yaml lists more', () => {
		mocks.configuredModels = Array.from({ length: MAX_TEST_RUN_MODELS + 2 }, (_, index) => ({
			provider: 'openai',
			modelId: `model-${index}`,
		}));

		const { result } = renderHook(() => useTestRunSettings());

		expect(result.current.models).toEqual(mocks.configuredModels.slice(0, MAX_TEST_RUN_MODELS));
	});
});

function queryData(key: string): unknown {
	switch (key) {
		case 'project':
			return { id: 'project-1' };
		case 'tests':
			return { settings: { models: mocks.configuredModels } };
		default:
			return undefined;
	}
}
