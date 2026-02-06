import { useQuery } from '@tanstack/react-query';
import { createQuerySetter } from './create-query-setter';
import { trpc } from '@/main';

export const useChatListQuery = () => {
	return useQuery(trpc.chat.list.queryOptions());
};

export const useSetChatList = createQuerySetter(() => trpc.chat.list);
