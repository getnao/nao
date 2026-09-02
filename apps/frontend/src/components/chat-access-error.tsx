import { Link } from '@tanstack/react-router';
import { Lock, SearchX, TriangleAlert, WifiOff } from 'lucide-react';

import { MobileHeader } from '@/components/mobile-header';
import { Button } from '@/components/ui/button';
import { getSafeRedirectPath } from '@/lib/safe-redirect';
import { isForbiddenError, isInternalServerError, isNotFoundError, isUnauthorizedError } from '@/lib/trpc-error';

export function ChatAccessError({
	error,
	onRetry,
	chatId,
}: {
	error?: unknown;
	onRetry?: () => void;
	chatId?: string;
}) {
	if (isNotFoundError(error)) {
		return (
			<ChatErrorLayout
				icon={<SearchX className='size-4' aria-hidden />}
				title='Chat not found'
				description='This chat may have been deleted, moved, or you may not have access to it.'
			>
				<Button asChild variant='secondary'>
					<Link to='/'>Start a new chat</Link>
				</Button>
			</ChatErrorLayout>
		);
	}

	if (isUnauthorizedError(error)) {
		const redirect = getSafeRedirectPath(chatId ? `/${chatId}` : undefined) ?? undefined;
		return (
			<ChatErrorLayout
				icon={<Lock className='size-4' aria-hidden />}
				title='Session expired'
				description='Sign in again to continue where you left off.'
			>
				<Button asChild>
					<Link to='/login' search={{ error: undefined, redirect }}>
						Sign in
					</Link>
				</Button>
			</ChatErrorLayout>
		);
	}

	if (isForbiddenError(error)) {
		return (
			<ChatErrorLayout
				icon={<Lock className='size-4' aria-hidden />}
				title="You don't have access to this chat"
				description='Ask the owner to share it with you if you need access.'
			>
				<Button asChild variant='secondary'>
					<Link to='/'>Go home</Link>
				</Button>
			</ChatErrorLayout>
		);
	}

	if (isInternalServerError(error)) {
		return (
			<ChatErrorLayout
				icon={<TriangleAlert className='size-4' aria-hidden />}
				title='Something went wrong'
				description="We couldn't load this chat. This is likely a temporary problem, so please try again."
			>
				{onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
			</ChatErrorLayout>
		);
	}

	return (
		<ChatErrorLayout
			icon={<WifiOff className='size-4' aria-hidden />}
			title="Can't reach nao"
			description='Check your connection and try again.'
		>
			{onRetry ? <Button onClick={onRetry}>Retry</Button> : null}
		</ChatErrorLayout>
	);
}

function ChatErrorLayout({
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
		<div className='flex h-full flex-1 flex-col min-w-0 overflow-hidden justify-center bg-panel'>
			<MobileHeader />
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
