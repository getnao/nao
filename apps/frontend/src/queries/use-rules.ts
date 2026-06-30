import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import { trpc } from '@/main';

type RouterOutputs = inferRouterOutputs<TrpcRouter>;
export type UserRule = RouterOutputs['rule']['list'][number];

export function useRulesQuery() {
	return useQuery(trpc.rule.list.queryOptions());
}

export function useRuleMutations() {
	const createMutation = useMutation(
		trpc.rule.create.mutationOptions({
			onSuccess: (created, _, __, ctx) => {
				ctx.client.setQueryData(trpc.rule.list.queryKey(), (prev = []) => [created, ...prev]);
			},
		}),
	);

	const updateMutation = useMutation(
		trpc.rule.update.mutationOptions({
			onSuccess: (updated, _, __, ctx) => {
				ctx.client.setQueryData(trpc.rule.list.queryKey(), (prev = []) =>
					prev.map((rule) => (rule.id === updated.id ? updated : rule)),
				);
			},
		}),
	);

	const deleteMutation = useMutation(
		trpc.rule.delete.mutationOptions({
			onSuccess: (_, variables, __, ctx) => {
				ctx.client.setQueryData(trpc.rule.list.queryKey(), (prev = []) =>
					prev.filter((rule) => rule.id !== variables.ruleId),
				);
			},
		}),
	);

	return { createMutation, updateMutation, deleteMutation };
}
