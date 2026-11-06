import { useQueries, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { MentionedStoryArtifact } from '@/lib/chat-artifacts';
import { useSidePanel } from '@/contexts/side-panel';
import { trpc } from '@/main';

export type ResolvedStory = inferRouterOutputs<TrpcRouter>['story']['resolve'];

/**
 * The existing stories a conversation references that the user can still open. Stories of the
 * conversation itself are already listed with its own stories, and archived ones cannot be referenced.
 */
export function useMentionedStories(chatId: string | undefined, references: MentionedStoryArtifact[]) {
	const keepOpenable = useCallback(
		(results: { data?: ResolvedStory }[]) =>
			results.flatMap(({ data }) => (data && !data.isArchived && data.chatId !== chatId ? [data] : [])),
		[chatId],
	);
	return useQueries({
		queries: references.map(({ storyId }) => ({ ...trpc.story.resolve.queryOptions({ storyId }), retry: false })),
		combine: keepOpenable,
	});
}

export function useResolvedStory(storyId: string) {
	return useQuery({ ...trpc.story.resolve.queryOptions({ storyId }), retry: false });
}

/** The owner opens the story beside the conversation; anyone else opens its page. */
export function useOpenMentionedStory(openInSidePanel: (story: ResolvedStory & { chatId: string }) => void) {
	const sidePanel = useSidePanel();
	const navigate = useNavigate();
	const canOpenInSidePanel = Boolean(sidePanel.chatId) && !sidePanel.isReadonlyMode && !sidePanel.isReplay;

	return useCallback(
		(story: ResolvedStory) => {
			if (canOpenInSidePanel && story.isOwner && story.chatId) {
				openInSidePanel({ ...story, chatId: story.chatId });
				return;
			}
			navigate({ to: '/stories/$storyId', params: { storyId: story.storyId } });
		},
		[canOpenInSidePanel, navigate, openInSidePanel],
	);
}
