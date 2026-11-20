// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_TEST_RUN_MODELS, useTestRunSettings } from '@/hooks/use-test-run-settings';

const mocks = vi.hoisted(() => ({
	configuredModels: [] as { provider: string; modelId: string }[],
	availableModels: [] as { provider: string; modelId: string; llmConfigId: string }[],
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['project'] }) },
			getDefaultChatModel: { queryOptions: () => ({ queryKey: ['default-model'] }) },
			listAvailableTranscribeModels: { queryOptions: () => ({ queryKey: ['available-models'] }) },
		},
		testRun: {
			listTests: { queryOptions: () => ({ queryKey: ['tests'] }) },
			listUpstreamRepos: { queryOptions: () => ({ queryKey: ['upstream-repos'], queryFn: () => [] }) },
		},
	},
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: ({ queryKey: [key] }: { queryKey: string[] }) => ({ data: queryData(key), isPending: false }),
}));

describe('useTestRunSettings', () => {
	afterEach(() => {
		cleanup();
		mocks.availableModels = [];
	});

	it('runs no more models than a run accepts when nao_config.yaml lists more', () => {
		mocks.configuredModels = Array.from({ length: MAX_TEST_RUN_MODELS + 2 }, (_, index) => ({
			provider: 'openai',
			modelId: `model-${index}`,
		}));

		const { result } = renderHook(() => useTestRunSettings());

		expect(result.current.models).toEqual(mocks.configuredModels.slice(0, MAX_TEST_RUN_MODELS));
	});

	it('pins a nao_config.yaml model to the credential serving it', () => {
		mocks.configuredModels = [{ provider: 'openai', modelId: 'gpt-5' }];
		mocks.availableModels = [{ provider: 'openai', modelId: 'gpt-5', llmConfigId: 'credential-a' }];

		const { result } = renderHook(() => useTestRunSettings());

		expect(result.current.models).toEqual([{ provider: 'openai', modelId: 'gpt-5', llmConfigId: 'credential-a' }]);
	});
});

function queryData(key: string): unknown {
	switch (key) {
		case 'project':
			return { id: 'project-1' };
		case 'tests':
			return { settings: { models: mocks.configuredModels } };
		case 'available-models':
			return mocks.availableModels;
		default:
			return undefined;
	}
}
