import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { trpc } from '@/main';

/** Attaches a chat to a standalone story of the user and opens the story inside it. */
export function useOpenStandaloneStoryInChat(storyId: string, storySlug: string | undefined) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const mutation = useMutation(
		trpc.chatFork.openStandalone.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.resolve.queryKey({ storyId }) });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: storySlug } });
			},
		}),
	);

	return { open: () => mutation.mutate({ storyId }), isOpening: mutation.isPending };
}
