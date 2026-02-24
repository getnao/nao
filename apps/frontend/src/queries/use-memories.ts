import { useMutation, useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export function useMemorySettingsQuery() {
	return useQuery(trpc.user.getMemorySettings.queryOptions());
}

export function useUpdateMemorySettingsMutation() {
	return useMutation(
		trpc.user.updateMemorySettings.mutationOptions({
			onSuccess: (data, _, __, ctx) => {
				ctx.client.setQueryData(trpc.user.getMemorySettings.queryKey(), data);
			},
		}),
	);
}

export function useMemoriesQuery(enabled: boolean) {
	return useQuery({
		...trpc.user.getMemories.queryOptions(),
		enabled,
	});
}

export function useMemoryMutations() {
	const updateMutation = useMutation(
		trpc.user.updateMemory.mutationOptions({
			onSuccess: (updated, _, __, ctx) => {
				ctx.client.setQueryData(trpc.user.getMemories.queryKey(), (prev = []) =>
					prev.map((memory) => (memory.id === updated.id ? updated : memory)),
				);
			},
		}),
	);

	const deleteMutation = useMutation(
		trpc.user.deleteMemory.mutationOptions({
			onSuccess: (_, variables, __, ctx) => {
				ctx.client.setQueryData(trpc.user.getMemories.queryKey(), (prev = []) =>
					prev.filter((memory) => memory.id !== variables.memoryId),
				);
			},
		}),
	);

	return { updateMutation, deleteMutation };
}
