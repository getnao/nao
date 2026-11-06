// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useModelSelection } from './use-model-selection';

const mocks = vi.hoisted(() => ({
	queries: [] as Array<{ queryKey: string[]; enabled?: boolean }>,
	currentProjectQuery: { data: null as unknown, isPending: false, isError: false },
	availableModels: [{ provider: 'nao', modelId: 'gpt-6-sol' }] as Array<{
		provider: 'nao' | 'openai';
		modelId: string;
		llmConfigId?: string;
	}>,
	selectedModel: null as { provider: 'nao' | 'openai'; modelId: string; llmConfigId?: string } | null,
	usesDefaultModel: true,
	setSelectedModel: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
		mocks.queries.push(options);
		if (options.queryKey[0] === 'current-project') {
			return mocks.currentProjectQuery;
		}
		return {
			data: options.queryKey[0] === 'available-models' ? mocks.availableModels : null,
			isPending: false,
			isError: false,
		};
	},
}));

vi.mock('@/contexts/agent.provider', () => ({
	useAgentContext: () => ({
		selectedModel: mocks.selectedModel,
		usesDefaultModel: mocks.usesDefaultModel,
		setSelectedModel: mocks.setSelectedModel,
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
	mocks.availableModels = [{ provider: 'nao', modelId: 'gpt-6-sol' }];
	mocks.selectedModel = null;
	mocks.usesDefaultModel = true;
	mocks.setSelectedModel.mockReset();
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
	expect(result.current.availableModels).toEqual([{ provider: 'nao', modelId: 'gpt-6-sol' }]);
	expect(result.current.hasProject).toBe(true);
});

it('falls back to the project default when a stored credential is no longer authorized', async () => {
	mocks.currentProjectQuery = { data: { id: 'project-1' }, isPending: false, isError: false };
	mocks.availableModels = [{ provider: 'openai', modelId: 'gpt-5-mini', llmConfigId: 'authorized-config' }];
	mocks.selectedModel = {
		provider: 'openai',
		modelId: 'gpt-5-mini',
		llmConfigId: 'removed-config',
	};
	mocks.usesDefaultModel = false;

	renderHook(() => useModelSelection());

	await waitFor(() => expect(mocks.setSelectedModel).toHaveBeenCalledWith(null));
});
