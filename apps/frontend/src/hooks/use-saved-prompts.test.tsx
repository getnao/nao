// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { useSavedPromptsQuery } from './use-saved-prompts';

const mocks = vi.hoisted(() => ({
	queries: [] as Array<{ queryKey: string[]; enabled?: boolean }>,
	projectQuery: { data: undefined as unknown, isPending: true, isError: false, isLoading: true },
	savedPromptsData: [{ id: 'prompt-id' }],
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
		mocks.queries.push(options);
		return options.queryKey[0] === 'current-project'
			? mocks.projectQuery
			: { data: mocks.savedPromptsData, isPending: false, isError: false, isLoading: false };
	},
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['current-project'] }) },
			getSavedPrompts: { queryOptions: () => ({ queryKey: ['saved-prompts'] }) },
			getProjectSavedPrompts: { queryOptions: () => ({ queryKey: ['project-saved-prompts'] }) },
		},
	},
}));

afterEach(() => {
	cleanup();
	mocks.queries = [];
	mocks.projectQuery = { data: undefined, isPending: true, isError: false, isLoading: true };
	mocks.savedPromptsData = [{ id: 'prompt-id' }];
});

it('stays loading while the current project is pending', () => {
	const { result } = renderHook(() => useSavedPromptsQuery());

	expect(mocks.queries.find((query) => query.queryKey[0] === 'saved-prompts')?.enabled).toBe(false);
	expect(result.current.isLoading).toBe(true);
});

it('requests saved prompts when the current project query fails', () => {
	mocks.projectQuery = { data: undefined, isPending: false, isError: true, isLoading: false };

	renderHook(() => useSavedPromptsQuery());

	expect(mocks.queries.find((query) => query.queryKey[0] === 'saved-prompts')?.enabled).toBe(true);
});

it('hides cached saved prompts when there is no current project', () => {
	mocks.projectQuery = { data: null, isPending: false, isError: false, isLoading: false };

	const { result } = renderHook(() => useSavedPromptsQuery());

	expect(result.current.data).toBeUndefined();
});

it('reads the given project saved prompts without a current project', () => {
	mocks.projectQuery = { data: null, isPending: false, isError: false, isLoading: false };

	const { result } = renderHook(() => useSavedPromptsQuery('example-project'));

	expect(mocks.queries.find((query) => query.queryKey[0] === 'saved-prompts')?.enabled).toBe(false);
	expect(mocks.queries.find((query) => query.queryKey[0] === 'project-saved-prompts')?.enabled).toBe(true);
	expect(result.current.data).toEqual([{ id: 'prompt-id' }]);
});
