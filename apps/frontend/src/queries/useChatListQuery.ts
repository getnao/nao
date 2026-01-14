import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export const useChatListQuery = () => {
	return useQuery(trpc.chat.list.queryOptions());
};
