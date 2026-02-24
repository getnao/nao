import { createFileRoute, Outlet } from '@tanstack/react-router';
import { UserPageProvider } from '@/contexts/user.provider';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<UserPageProvider>
			<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-auto'>
				<div className='flex flex-col w-full max-w-4xl mx-auto p-8 gap-12 h-full'>
					<Outlet />
				</div>
			</div>
		</UserPageProvider>
	);
}
