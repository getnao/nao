import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MobileHeader } from '@/components/mobile-header';
import { requireAdvancedSettingsAccess } from '@/lib/route-guards';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	beforeLoad: ({ location }) => requireAdvancedSettingsAccess(location.pathname),
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-hidden'>
			<MobileHeader />
			<Outlet />
		</div>
	);
}
