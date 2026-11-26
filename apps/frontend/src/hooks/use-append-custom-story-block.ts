import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useAppendCustomStoryBlock() {
	const queryClient = useQueryClient();
	return useMutation(
		trpc.story.appendCustomStoryBlock.mutationOptions({
			onSuccess: (_data, { chatId, storySlug }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }) });
				queryClient.invalidateQueries({
					queryKey: trpc.story.getCustomVersion.queryKey({ chatId, storySlug }),
				});
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
			},
		}),
	);
}
