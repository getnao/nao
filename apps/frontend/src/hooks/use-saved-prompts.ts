import { useMutation, useQuery } from '@tanstack/react-query';
import type { SavedPrompt } from '@nao/backend/saved-prompts';
import { trpc } from '@/main';

/** Saved prompts of `projectId`, or of the current project when it is omitted. */
export function useSavedPromptsQuery(projectId?: string) {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const savedPromptsQuery = useQuery({
		...trpc.project.getSavedPrompts.queryOptions(),
		enabled: !projectId && (project.isError || project.data != null),
	});
	const projectSavedPromptsQuery = useQuery({
		...trpc.project.getProjectSavedPrompts.queryOptions({ projectId: projectId ?? '' }),
		enabled: !!projectId,
	});
	if (projectId) {
		return projectSavedPromptsQuery;
	}
	return {
		...savedPromptsQuery,
		data: project.data === null ? undefined : savedPromptsQuery.data,
		isLoading: project.isPending || savedPromptsQuery.isLoading,
	};
}

/** CRUD mutations for saved prompts */
export function useSavedPromptMutations() {
	const createMutation = useMutation(
		trpc.project.createSavedPrompt.mutationOptions({
			onSuccess: (newPrompt, _, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getSavedPrompts.queryKey(), (prev: SavedPrompt[] = []) => [
					...prev,
					newPrompt,
				]);
			},
		}),
	);

	const updateMutation = useMutation(
		trpc.project.updateSavedPrompt.mutationOptions({
			onSuccess: (updatedPrompt, _, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getSavedPrompts.queryKey(), (prev: SavedPrompt[] = []) =>
					prev.map((p) => (p.id === updatedPrompt.id ? updatedPrompt : p)),
				);
			},
		}),
	);

	const deleteMutation = useMutation(
		trpc.project.deleteSavedPrompt.mutationOptions({
			onSuccess: (_, variables, __, ctx) => {
				ctx.client.setQueryData(trpc.project.getSavedPrompts.queryKey(), (prev: SavedPrompt[] = []) =>
					prev.filter((p) => p.id !== variables.promptId),
				);
			},
		}),
	);

	return { createMutation, updateMutation, deleteMutation };
}
