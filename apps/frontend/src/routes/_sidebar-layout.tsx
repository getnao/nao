import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Sidebar } from '@/components/sidebar';

export const Route = createFileRoute('/_sidebar-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<>
			<Sidebar />
			<Outlet />
		</>
	);
}
