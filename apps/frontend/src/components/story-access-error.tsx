import { useQueryErrorResetBoundary } from '@tanstack/react-query';
import { Link, useRouter } from '@tanstack/react-router';
import { Lock, SearchX, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { isForbiddenError, isNotFoundError } from '@/lib/trpc-error';

export function StoryRouteError({ error }: { error?: unknown }) {
	const router = useRouter();
	const { reset } = useQueryErrorResetBoundary();
	return (
		<StoryAccessError
			error={error}
			onRetry={() => {
				reset();
				router.invalidate();
			}}
		/>
	);
}

export function StoryAccessError({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
	const forbidden = isForbiddenError(error);
	const notFound = isNotFoundError(error);

	if (!forbidden && !notFound) {
		return (
			<StoryErrorLayout
				icon={<TriangleAlert className='size-4' aria-hidden />}
				title='Something went wrong'
				description="We couldn't load this story. This is likely a temporary problem, so please try again."
			>
				{onRetry ? <Button onClick={onRetry}>Try again</Button> : null}
				<Button asChild variant='secondary'>
					<Link to='/'>Go home</Link>
				</Button>
			</StoryErrorLayout>
		);
	}

	const title = forbidden ? "You don't have access to this story" : 'Story not found';
	const description = forbidden
		? 'This story has not been shared with you. Ask the owner to share it if you need access.'
		: 'This story may have been deleted or moved.';

	return (
		<StoryErrorLayout
			icon={forbidden ? <Lock className='size-4' aria-hidden /> : <SearchX className='size-4' aria-hidden />}
			title={title}
			description={description}
		>
			<Button asChild variant='secondary'>
				<Link to='/'>Go home</Link>
			</Button>
		</StoryErrorLayout>
	);
}

function StoryErrorLayout({
	icon,
	title,
	description,
	children,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<div className='flex h-full flex-1 flex-col min-w-0 overflow-hidden justify-center bg-background'>
			<div className='flex flex-1 items-center justify-center p-6'>
				<div className='flex max-w-sm flex-col items-center gap-4 text-center'>
					<div className='flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground'>
						{icon}
					</div>
					<div className='space-y-2'>
						<h1 className='text-lg font-medium tracking-tight'>{title}</h1>
						<p className='text-sm text-muted-foreground'>{description}</p>
					</div>
					<div className='flex items-center gap-2'>{children}</div>
				</div>
			</div>
		</div>
	);
}
