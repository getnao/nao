import { createFileRoute } from '@tanstack/react-router';

import { ContextHub } from '@/components/context-hub/context-hub';
import { validateContextExplorerSearch } from '@/lib/context-explorer-search';
import { requireContextHubAccess } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings/context-explorer')({
	beforeLoad: requireContextHubAccess,
	validateSearch: validateContextExplorerSearch,
	component: ContextExplorerPage,
});

function ContextExplorerPage() {
	return <ContextHub search={Route.useSearch()} />;
}
