import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { invalidateStoriesCaches } from '@/lib/stories-cache';
import { trpc } from '@/main';

/** Copies a story into a new standalone story of the user, in the story's project, and opens the copy. */
export function useDuplicateStory(storyProjectId?: string | null) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: currentProject } = useQuery(trpc.project.getCurrent.queryOptions());
	const switchProject = useProjectSwitch(currentProject?.id);

	const mutation = useMutation(
		trpc.chatFork.duplicateStory.mutationOptions({
			onSuccess: async ({ storyId }) => {
				if (storyProjectId) {
					await switchProject(storyProjectId);
				}
				invalidateStoriesCaches(queryClient);
				navigate({ to: '/stories/$storyId', params: { storyId } });
			},
		}),
	);

	function duplicate(storyId: string, versionNumber?: number) {
		mutation.mutate({ storyId, versionNumber });
	}

	return { duplicate, isPending: mutation.isPending, error: mutation.error };
}
