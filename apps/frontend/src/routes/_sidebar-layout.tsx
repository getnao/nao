import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Sidebar } from '@/components/sidebar';
import { CommandMenu } from '@/components/command-menu';
import { SidebarProvider } from '@/contexts/sidebar';

export const Route = createFileRoute('/_sidebar-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<SidebarProvider>
			<Sidebar />
			<CommandMenu />
			<Outlet />
		</SidebarProvider>
	);
}
