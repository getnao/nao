import { useQuery } from '@tanstack/react-query';
import { createQuerySetter } from './create-query-setter';
import { getChatQueryRetryDelay, shouldRetryChatQuery } from '@/lib/chat-query-retry';
import { trpc } from '@/main';

export const useChatQuery = ({ chatId }: { chatId?: string }) => {
	return useQuery(
		trpc.chat.get.queryOptions(
			{ chatId: chatId ?? '' },
			{
				enabled: !!chatId,
				refetchInterval: (query) => (query.state.data?.automationRun?.status === 'running' ? 1_500 : false),
				retry: shouldRetryChatQuery,
				retryDelay: getChatQueryRetryDelay,
			},
		),
	);
};

export const useSetChat = createQuerySetter(() => trpc.chat.get);
