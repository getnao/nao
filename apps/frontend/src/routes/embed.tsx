import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';

export const Route = createFileRoute('/embed')({
	component: EmbedLayout,
});

function EmbedLayout() {
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.add('nao-embed');
		return () => {
			root.classList.remove('nao-embed');
		};
	}, []);

	return (
		<div className='flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground antialiased'>
			<Outlet />
		</div>
	);
}
