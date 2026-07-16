import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/public')({
	component: PublicLayout,
});

function PublicLayout() {
	return (
		<div className='flex min-h-screen min-w-0 flex-col bg-background text-foreground antialiased'>
			<Outlet />
		</div>
	);
}
