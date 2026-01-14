import { useQuery } from '@tanstack/react-query';
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
