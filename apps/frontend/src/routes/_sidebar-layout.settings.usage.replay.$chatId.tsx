import { createFileRoute } from '@tanstack/react-router';

import { ChatsReplayPanel } from '@/components/settings/chats-replay-panel';
import { validateUsageSearch } from '@/components/settings/usage-route-search';
import { useReplayOrigin } from '@/hooks/use-replay-origin';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/usage/replay/$chatId')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateUsageSearch,
	component: ChatReplayRoute,
});

function ChatReplayRoute() {
	const { chatId } = Route.useParams();
	const usageSearch = Route.useSearch();
	const origin = useReplayOrigin(usageSearch);

	return (
		<ChatsReplayPanel
			chatId={chatId}
			origin={{ label: origin.label, onClick: origin.goBack }}
			highlightOnLoad={usageSearch.highlight}
			targetId={usageSearch.targetId}
		/>
	);
}
