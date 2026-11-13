import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MobileHeader } from '@/components/mobile-header';
import { GoToFileDialog } from '@/components/settings/go-to-file-dialog';
import { OpenContextFileCallbackProvider } from '@/contexts/open-context-file-callback';
import { usePermissions } from '@/hooks/use-permissions';
import { requireAdvancedSettingsAccess } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	beforeLoad: ({ location }) => requireAdvancedSettingsAccess(location.pathname),
	component: SettingsLayout,
});

function SettingsLayout() {
	const { canExploreContext } = usePermissions();

	return (
		<OpenContextFileCallbackProvider>
			<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-hidden'>
				<MobileHeader />
				<Outlet />
			</div>
			{canExploreContext && <GoToFileDialog />}
		</OpenContextFileCallbackProvider>
	);
}
