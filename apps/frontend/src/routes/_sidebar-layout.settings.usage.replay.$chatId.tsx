import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { ChatsReplayPanel } from '@/components/settings/chats-replay-panel';
import { validateUsageSearch } from '@/components/settings/usage-route-search';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/usage/replay/$chatId')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateUsageSearch,
	component: ChatReplayRoute,
});

function ChatReplayRoute() {
	const { chatId } = Route.useParams();
	const usageSearch = Route.useSearch();
	const navigate = useNavigate();

	return (
		<ChatsReplayPanel
			chatId={chatId}
			onBack={() => {
				navigate({
					to: '/settings/usage',
					search: usageSearch,
					replace: true,
				});
			}}
		/>
	);
}
