import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MobileHeader } from '@/components/mobile-header';
import { UserPageProvider } from '@/contexts/user.provider';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<UserPageProvider>
			<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-hidden'>
				<MobileHeader />
				<Outlet />
			</div>
		</UserPageProvider>
	);
}
