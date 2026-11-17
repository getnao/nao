import { createFileRoute } from '@tanstack/react-router';

import { ContextHub } from '@/components/context-hub/context-hub';
import { MobileHeader } from '@/components/mobile-header';
import { GoToFileDialog } from '@/components/settings/go-to-file-dialog';
import { OpenContextFileCallbackProvider } from '@/contexts/open-context-file-callback';
import { validateContextExplorerSearch } from '@/lib/context-explorer-search';
import { requireContextHubAccess } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/context-hub')({
	beforeLoad: requireContextHubAccess,
	validateSearch: validateContextExplorerSearch,
	component: ContextHubPage,
});

function ContextHubPage() {
	return (
		<OpenContextFileCallbackProvider>
			<div className='flex min-w-0 flex-1 flex-col overflow-hidden bg-panel'>
				<MobileHeader />
				<ContextHub search={Route.useSearch()} />
			</div>
			<GoToFileDialog />
		</OpenContextFileCallbackProvider>
	);
}
