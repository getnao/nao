import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<div className='flex flex-1 flex-col bg-panel min-w-0 overflow-auto'>
			<div className='flex flex-col w-full max-w-4xl mx-auto p-8 gap-8'>
				<Outlet />
			</div>
		</div>
	);
}
