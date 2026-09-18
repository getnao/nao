import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { SubagentReplayPanel } from '@/components/settings/subagent-replay-panel';
import { validateUsageSearch } from '@/components/settings/usage-route-search';
import { useReplayOrigin } from '@/hooks/use-replay-origin';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/usage/replay/$chatId_/subagent/$toolCallId')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateUsageSearch,
	component: SubagentReplayRoute,
});

function SubagentReplayRoute() {
	const { chatId, toolCallId } = Route.useParams();
	const usageSearch = Route.useSearch();
	const navigate = useNavigate();
	const origin = useReplayOrigin(usageSearch);

	return (
		<SubagentReplayPanel
			chatId={chatId}
			toolCallId={toolCallId}
			origin={{ label: origin.label, onClick: origin.goBack }}
			onBackToChat={() => {
				navigate({
					to: '/settings/usage/replay/$chatId',
					params: { chatId },
					search: { ...usageSearch, highlight: undefined, targetId: toolCallId },
					replace: true,
				});
			}}
		/>
	);
}
