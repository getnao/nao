import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useToggleStoryCertification() {
	const queryClient = useQueryClient();

	const mutation = useMutation(
		trpc.story.toggleCertification.mutationOptions({
			onSuccess: (_data, { storyId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.getCertification.queryKey({ storyId }) });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandaloneArchived.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listSharedArchived.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
			},
		}),
	);

	function toggle(storyId: string) {
		mutation.mutate({ storyId });
	}

	return { toggle, isPending: mutation.isPending };
}
