import { useMutation, useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useSandboxSecretsQuery() {
	return useQuery(trpc.sandboxSecret.list.queryOptions());
}

export function useSandboxSecretMutations() {
	const setMutation = useMutation(
		trpc.sandboxSecret.set.mutationOptions({
			onSuccess: (saved, _, __, ctx) => {
				ctx.client.setQueryData(trpc.sandboxSecret.list.queryKey(), (prev = []) => {
					const others = prev.filter((secret) => secret.id !== saved.id);
					return [...others, saved].sort((a, b) => a.name.localeCompare(b.name));
				});
			},
		}),
	);

	const updateDescriptionMutation = useMutation(
		trpc.sandboxSecret.updateDescription.mutationOptions({
			onSuccess: (updated, _, __, ctx) => {
				ctx.client.setQueryData(trpc.sandboxSecret.list.queryKey(), (prev = []) =>
					prev.map((secret) => (secret.id === updated.id ? updated : secret)),
				);
			},
		}),
	);

	const deleteMutation = useMutation(
		trpc.sandboxSecret.delete.mutationOptions({
			onSuccess: (_, variables, __, ctx) => {
				ctx.client.setQueryData(trpc.sandboxSecret.list.queryKey(), (prev = []) =>
					prev.filter((secret) => secret.id !== variables.secretId),
				);
			},
		}),
	);

	return { setMutation, updateDescriptionMutation, deleteMutation };
}
