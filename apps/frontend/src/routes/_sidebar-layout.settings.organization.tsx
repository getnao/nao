import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_sidebar-layout/settings/organization')({
	component: RouteComponent,
});

function RouteComponent() {
	return <div>Hello "/_sidebar-layout-settings/organization"!</div>;
}
