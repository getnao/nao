import { useQuery } from '@tanstack/react-query';
import { createQuerySetter } from './create-query-setter';
import { trpc } from '@/main';

export const useChatQuery = ({ chatId }: { chatId?: string }) => {
	return useQuery(
		trpc.chat.get.queryOptions(
			{ chatId: chatId ?? '' },
			{
				enabled: !!chatId,
			},
		),
	);
};

export const useSetChat = createQuerySetter(() => trpc.chat.get);
