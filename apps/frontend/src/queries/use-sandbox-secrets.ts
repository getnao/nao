import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useSandboxSecretsQuery() {
	return useQuery(trpc.sandboxSecret.list.queryOptions());
}

/**
 * Every mutation refetches the list instead of patching the cache: the list is scoped to the active
 * project on the server, so a patch could land in another project's entry after a switch.
 */
export function useSandboxSecretMutations() {
	const queryClient = useQueryClient();
	const invalidateList = () => queryClient.invalidateQueries({ queryKey: trpc.sandboxSecret.list.queryKey() });

	const setMutation = useMutation(trpc.sandboxSecret.set.mutationOptions({ onSuccess: invalidateList }));
	const updateDescriptionMutation = useMutation(
		trpc.sandboxSecret.updateDescription.mutationOptions({ onSuccess: invalidateList }),
	);
	const deleteMutation = useMutation(trpc.sandboxSecret.delete.mutationOptions({ onSuccess: invalidateList }));

	return { setMutation, updateDescriptionMutation, deleteMutation };
}
