import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MobileHeader } from '@/components/mobile-header';
import { UserPageProvider } from '@/contexts/user.provider';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<UserPageProvider>
			<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-auto'>
				<MobileHeader />
				<div className='flex flex-col w-full max-w-4xl mx-auto px-4 py-6 md:p-8 gap-8 md:gap-12 h-full'>
					<Outlet />
				</div>
			</div>
		</UserPageProvider>
	);
}
