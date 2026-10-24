import { Link } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RouteErrorPage({ fullScreen = false }: { fullScreen?: boolean }) {
	const isHomePage = window.location.pathname === '/';

	return (
		<div
			className={cn(
				'flex items-center justify-center bg-background p-6',
				fullScreen ? 'min-h-screen' : 'h-full min-h-0 min-w-0 flex-1',
			)}
		>
			<div className='flex max-w-sm flex-col items-center gap-6 text-center'>
				<TriangleAlert className='size-10 stroke-[1.25] text-primary' aria-hidden />
				<div className='space-y-2'>
					<h1 className='text-lg font-medium tracking-tight'>Something went wrong</h1>
					<p className='text-sm text-muted-foreground'>
						We couldn't load this page.{' '}
						{isHomePage ? 'Reload the app and try again.' : 'Return home and try again.'}
					</p>
				</div>
				<div className='flex flex-col items-center gap-3'>
					{isHomePage ? (
						<Button onClick={() => window.location.reload()}>Reload app</Button>
					) : (
						<Button asChild>
							{fullScreen ? <a href='/'>Return to home</a> : <Link to='/'>Return to home</Link>}
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
