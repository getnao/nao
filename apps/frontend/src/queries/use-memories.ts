import { useMutation, useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useMemorySettingsQuery() {
	return useQuery(trpc.user.getMemorySettings.queryOptions());
}

export function useMemoriesQuery(enabled: boolean) {
	return useQuery({
		...trpc.user.getMemories.queryOptions(),
		enabled,
		staleTime: 5 * 1000,
	});
}

export function useMemoryMutations() {
	const updateMemorySettingsMutation = useMutation(
		trpc.memory.setEnabled.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.user.getMemorySettings.queryKey(), data);
			},
		}),
	);

	const updateMutation = useMutation(
		trpc.memory.edit.mutationOptions({
			onSuccess: (updated, _, __, ctx) => {
				ctx.client.setQueryData(trpc.user.getMemories.queryKey(), (prev = []) =>
					prev.map((memory) => (memory.id === updated.id ? updated : memory)),
				);
			},
		}),
	);

	const deleteMutation = useMutation(
		trpc.memory.delete.mutationOptions({
			onSuccess: (_, variables, __, ctx) => {
				ctx.client.setQueryData(trpc.user.getMemories.queryKey(), (prev = []) =>
					prev.filter((memory) => memory.id !== variables.memoryId),
				);
			},
		}),
	);

	return { updateMemorySettingsMutation, updateMutation, deleteMutation };
}
