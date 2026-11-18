import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface MonitoringQueryState<T> {
	data: T | undefined;
	isPending: boolean;
	isError: boolean;
	error: { message: string } | null;
	refetch: () => unknown;
}

interface MonitoringCardProps<T> {
	title?: ReactNode;
	subtitle?: ReactNode;
	action?: ReactNode;
	query: MonitoringQueryState<T>;
	isEmpty?: (data: T) => boolean;
	emptyMessage?: string;
	className?: string;
	contentClassName?: string;
	children: (data: T) => ReactNode;
}

/** A dashboard card that owns its loading, error and empty states, so one failing section never breaks the page. */
export function MonitoringCard<T>({
	title,
	subtitle,
	action,
	query,
	isEmpty,
	emptyMessage = 'Nothing to show for this period.',
	className,
	contentClassName,
	children,
}: MonitoringCardProps<T>) {
	return (
		<section
			className={cn('flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-background p-4', className)}
		>
			{(title || action) && <CardHeading title={title} subtitle={subtitle} action={action} />}
			<div className={cn('min-w-0', contentClassName)}>
				<QueryContent query={query} isEmpty={isEmpty} emptyMessage={emptyMessage}>
					{children}
				</QueryContent>
			</div>
		</section>
	);
}

export function QueryContent<T>({
	query,
	isEmpty,
	emptyMessage = 'Nothing to show for this period.',
	children,
}: Pick<MonitoringCardProps<T>, 'query' | 'isEmpty' | 'emptyMessage' | 'children'>) {
	if (query.isPending) {
		return <LoadingPlaceholder />;
	}
	if (query.isError || query.data === undefined) {
		return <InlineQueryError message={query.error?.message} onRetry={query.refetch} />;
	}
	if (isEmpty?.(query.data)) {
		return <p className='py-6 text-center text-sm text-muted-foreground'>{emptyMessage}</p>;
	}
	return <>{children(query.data)}</>;
}

export function InlineQueryError({ message, onRetry }: { message?: string; onRetry: () => unknown }) {
	return (
		<div
			role='alert'
			className='flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive'
		>
			<span className='min-w-0 truncate' title={message}>
				Couldn't load this section{message ? `: ${message}` : '.'}
			</span>
			<Button variant='ghost' size='sm' onClick={() => onRetry()} className='shrink-0'>
				<RotateCw />
				Retry
			</Button>
		</div>
	);
}

function CardHeading({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
	return (
		<div className='flex items-start justify-between gap-2'>
			<h3 className='text-sm font-semibold text-foreground'>
				{title}
				{subtitle && <span className='ml-2 text-xs font-normal text-muted-foreground'>{subtitle}</span>}
			</h3>
			{action && <div className='shrink-0'>{action}</div>}
		</div>
	);
}

function LoadingPlaceholder() {
	return (
		<div className='flex flex-col gap-2 py-1' aria-busy='true' aria-label='Loading'>
			<Skeleton className='h-4 w-2/3' />
			<Skeleton className='h-4 w-full' />
			<Skeleton className='h-4 w-5/6' />
		</div>
	);
}
