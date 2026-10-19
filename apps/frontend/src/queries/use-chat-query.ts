import { useQuery } from '@tanstack/react-query';
import { createQuerySetter } from './create-query-setter';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import { isRetryableTrpcError } from '@/lib/trpc-error';
import { trpc } from '@/main';

export type Chat = inferRouterOutputs<TrpcRouter>['chat']['get'];

/**
 * The chat cache is rewritten on every streamed chunk, so components that only need a few
 * fields should pass a `select` to avoid re-rendering for each chunk.
 */
export const useChatQuery = <TSelected = Chat>({
	chatId,
	select,
}: {
	chatId?: string;
	select?: (chat: Chat) => TSelected;
}) => {
	return useQuery({
		...trpc.chat.get.queryOptions(
			{ chatId: chatId ?? '' },
			{
				enabled: !!chatId,
				refetchInterval: (query) => (query.state.data?.automationRun?.status === 'running' ? 1_500 : false),
				retry: (failureCount, error) => failureCount < 3 && isRetryableTrpcError(error),
				retryDelay: 500,
			},
		),
		select,
	});
};

export const useSetChat = createQuerySetter(() => trpc.chat.get);
