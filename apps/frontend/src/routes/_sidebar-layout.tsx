import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Sidebar } from '@/components/sidebar';
import { CommandMenu } from '@/components/command-menu';
import { SidebarProvider } from '@/contexts/sidebar';
import { CommandMenuCallbackProvider } from '@/contexts/command-menu-callback';

export const Route = createFileRoute('/_sidebar-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<CommandMenuCallbackProvider>
			<SidebarProvider>
				<Sidebar />
				<CommandMenu />
				<Outlet />
			</SidebarProvider>
		</CommandMenuCallbackProvider>
	);
}
