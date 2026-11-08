// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useShareAudience, useShareCandidates } from './use-share-dialog';

const mocks = vi.hoisted(() => ({
	activeProjectId: null as string | null,
	isFetching: false,
	project: null as { id: string } | null,
	queries: [] as Array<{ queryKey: string[]; enabled?: boolean }>,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[]; enabled?: boolean }) => {
		mocks.queries.push(options);
		switch (options.queryKey[0]) {
			case 'project':
				return { data: mocks.project };
			case 'sharing-access':
				return { data: { canShareToProject: true }, isFetching: mocks.isFetching };
			case 'members':
				return {
					data: [{ id: 'old-member', name: 'Old member', email: 'old@example.com' }],
					isFetching: mocks.isFetching,
				};
			default:
				return { data: undefined, isFetching: false };
		}
	},
}));

vi.mock('@/lib/active-project', () => ({
	useActiveProjectId: () => mocks.activeProjectId,
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['project'] }) },
			getProjectMembersByChatId: { queryOptions: () => ({ queryKey: ['members'] }) },
		},
		storyShare: {
			listShareableGroups: { queryOptions: () => ({ queryKey: ['groups'] }) },
		},
		userGroup: {
			projectSharingAccess: { queryOptions: () => ({ queryKey: ['sharing-access'] }) },
		},
	},
}));

beforeEach(() => {
	mocks.activeProjectId = null;
	mocks.isFetching = false;
	mocks.project = null;
	mocks.queries = [];
});

it('hides cached sharing access and members when no project is active', () => {
	const { result } = renderHook(() => ({
		audience: useShareAudience(),
		candidates: useShareCandidates({
			chatId: 'chat-id',
			withGroups: false,
			excludedKeys: new Set(),
			enabled: true,
		}),
	}));

	expect(result.current.audience.canShareToProject).toBe(false);
	expect(result.current.candidates.candidates).toEqual([]);
	expect(mocks.queries.find((query) => query.queryKey[0] === 'sharing-access')?.enabled).toBe(false);
	expect(mocks.queries.find((query) => query.queryKey[0] === 'members')?.enabled).toBe(false);
});

it('hides previous project sharing data while the selected project refetches', () => {
	mocks.activeProjectId = 'new-project';
	mocks.isFetching = true;
	mocks.project = { id: 'new-project' };

	const { result } = renderHook(() => ({
		audience: useShareAudience(),
		candidates: useShareCandidates({
			chatId: 'chat-id',
			withGroups: false,
			excludedKeys: new Set(),
			enabled: true,
		}),
	}));

	expect(result.current.audience.canShareToProject).toBe(false);
	expect(result.current.candidates.candidates).toEqual([]);
	expect(result.current.candidates.isLoading).toBe(true);
});
