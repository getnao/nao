import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/main';

export const useSearchChatsQuery = (query: string, options?: { enabled?: boolean }) => {
	return useQuery({
		...trpc.chat.search.queryOptions({ query }),
		enabled: query.length > 0 && (options?.enabled ?? true),
	});
};
