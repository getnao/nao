import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ChatFilterType, ChatGroupBy } from '@nao/shared/types';

import { useLastSeen } from '@/hooks/use-last-seen';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export function useGroupedChats(groupBy: ChatGroupBy, filters: ChatFilterType[]) {
	const { data: session } = useSession();
	const chats = useQuery({
		...trpc.chat.listGrouped.queryOptions({ groupBy, filters }),
		placeholderData: keepPreviousData,
	});
	const freshChats = chats.isPlaceholderData ? undefined : chats.data;
	const lastSeenChats = useLastSeen(
		'sidebar-chats',
		JSON.stringify([session?.user.id, groupBy, filters]),
		freshChats,
	);
	return chats.data ?? lastSeenChats;
}
