import { Link } from '@tanstack/react-router';
import { Lock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { isForbiddenError } from '@/lib/trpc-error';

export function StoryAccessError({ error }: { error?: unknown }) {
	const forbidden = isForbiddenError(error);
	const title = forbidden ? "You don't have access to this story" : 'Story not found';
	const description = forbidden
		? 'This story has not been shared with you. Ask the owner to share it if you need access.'
		: 'This story may have been deleted, moved, or you may not have access to it.';

	return (
		<div className='flex h-full flex-1 flex-col min-w-0 overflow-hidden justify-center bg-background'>
			<div className='flex flex-1 items-center justify-center p-6'>
				<div className='flex max-w-sm flex-col items-center gap-4 text-center'>
					<div className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
						<Lock className='size-4' aria-hidden />
					</div>
					<div className='space-y-2'>
						<h1 className='text-lg font-medium tracking-tight'>{title}</h1>
						<p className='text-sm text-muted-foreground'>{description}</p>
					</div>
					<Button asChild variant='secondary'>
						<Link to='/'>Go home</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
