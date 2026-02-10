import { createFileRoute } from '@tanstack/react-router';
import { useAuth } from '@/hooks/useAuth';

export const Route = createFileRoute('/_sidebar-layout/settings/organization')({
	component: RouteComponent,
});

function RouteComponent() {
	const { isOrgAdmin } = useAuth();

	console.log(`Am I admin? ${isOrgAdmin}`);

	if (isOrgAdmin) {
		return <div>you are special!</div>;
	}
	return <div>Hello "/_sidebar-layout-settings/organization"!</div>;
}
