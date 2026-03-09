import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { MobileHeader } from '@/components/mobile-header';
import { UserPageProvider } from '@/contexts/user.provider';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_sidebar-layout/settings')({
	component: SettingsLayout,
});

function SettingsLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const isChatsReplay = pathname === '/settings/chats-replay';

	return (
		<UserPageProvider>
			<div
				className={cn(
					'flex flex-1 flex-col bg-panel min-w-0',
					isChatsReplay ? 'overflow-hidden' : 'overflow-auto',
				)}
			>
				<MobileHeader />
				<div
					className={cn(
						isChatsReplay
							? 'flex flex-col flex-1 min-h-0 w-full max-w-none mx-0 p-0'
							: 'flex flex-col w-full px-4 py-6 md:p-8 gap-8 md:gap-12 max-w-4xl mx-auto',
					)}
				>
					<Outlet />
				</div>
			</div>
		</UserPageProvider>
	);
}
