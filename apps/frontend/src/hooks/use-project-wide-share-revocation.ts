import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectSharingSettings } from '@/lib/project-sharing-policy';
import { findProjectWideSharesToRevoke, getCustomGroupMemberships } from '@/lib/project-sharing-policy';
import { trpc } from '@/main';

export interface ProjectWideSharesToRevoke {
	chatShareIds: string[];
	storyIds: string[];
}

export const NO_SHARES_TO_REVOKE: ProjectWideSharesToRevoke = { chatShareIds: [], storyIds: [] };

export function useProjectWideShareRevocation() {
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const projectId = project.data?.id ?? '';
	const overview = useQuery(trpc.userGroup.overview.queryOptions());
	const sharedChats = useQuery(trpc.sharedChat.list.queryOptions());
	const sharedStories = useQuery({ ...trpc.storyShare.list.queryOptions({ projectId }), enabled: !!projectId });
	const deleteChatShare = useMutation(trpc.sharedChat.delete.mutationOptions());
	const deleteStoryShare = useMutation(trpc.storyShare.delete.mutationOptions());

	const findSharesToRevoke = useCallback(
		(settings: ProjectSharingSettings): ProjectWideSharesToRevoke => {
			if (!overview.data) {
				return NO_SHARES_TO_REVOKE;
			}
			const memberships = getCustomGroupMemberships(overview.data);
			const projectChats = (sharedChats.data ?? []).filter((chat) => chat.projectId === projectId);
			return {
				chatShareIds: findProjectWideSharesToRevoke(projectChats, settings, memberships).map((chat) => chat.id),
				storyIds: findProjectWideSharesToRevoke(sharedStories.data ?? [], settings, memberships).map(
					(story) => story.storyId,
				),
			};
		},
		[overview.data, projectId, sharedChats.data, sharedStories.data],
	);

	const revokeShares = useCallback(
		async ({ chatShareIds, storyIds }: ProjectWideSharesToRevoke) => {
			await Promise.all([
				...chatShareIds.map((shareId) => deleteChatShare.mutateAsync({ shareId })),
				...storyIds.map((storyId) => deleteStoryShare.mutateAsync({ storyId })),
			]);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: [['sharedChat']] }),
				queryClient.invalidateQueries({ queryKey: [['storyShare']] }),
			]);
		},
		[deleteChatShare, deleteStoryShare, queryClient],
	);

	return { findSharesToRevoke, revokeShares };
}

export function countSharesToRevoke({ chatShareIds, storyIds }: ProjectWideSharesToRevoke): number {
	return chatShareIds.length + storyIds.length;
}
