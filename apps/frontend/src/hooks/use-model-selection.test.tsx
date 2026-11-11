// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useModelSelection } from './use-model-selection';

const mocks = vi.hoisted(() => ({
	queries: [] as Array<{ queryKey: string[]; enabled?: boolean }>,
	currentProjectQuery: { data: null as unknown, isPending: false, isError: false },
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
		mocks.queries.push(options);
		return options.queryKey[0] === 'current-project'
			? mocks.currentProjectQuery
			: { data: [{ provider: 'nao' }], isPending: false, isError: false };
	},
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		selectedModel: null,
		usesDefaultModel: true,
		setSelectedModel: vi.fn(),
	}),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['current-project'] }) },
			getDefaultChatModel: { queryOptions: () => ({ queryKey: ['default-model'] }) },
			listAvailableTranscribeModels: { queryOptions: () => ({ queryKey: ['available-models'] }) },
		},
	},
}));

afterEach(() => {
	cleanup();
	mocks.queries = [];
	mocks.currentProjectQuery = { data: null, isPending: false, isError: false };
});

it('does not request project models when the user has no project', () => {
	const { result } = renderHook(() => useModelSelection());

	expect(mocks.queries.find((query) => query.queryKey[0] === 'available-models')?.enabled).toBe(false);
	expect(mocks.queries.find((query) => query.queryKey[0] === 'default-model')?.enabled).toBe(false);
	expect(result.current.availableModels).toBeUndefined();
	expect(result.current.hasProject).toBe(false);
});

it('requests project models when the current project query fails', () => {
	mocks.currentProjectQuery = { data: undefined, isPending: false, isError: true };

	const { result } = renderHook(() => useModelSelection());

	expect(mocks.queries.find((query) => query.queryKey[0] === 'available-models')?.enabled).toBe(true);
	expect(mocks.queries.find((query) => query.queryKey[0] === 'default-model')?.enabled).toBe(true);
	expect(result.current.availableModels).toEqual([{ provider: 'nao' }]);
	expect(result.current.hasProject).toBe(true);
});
