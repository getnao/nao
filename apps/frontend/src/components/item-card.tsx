import { Activity, Dot, Globe, Lock, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StoryPanelDisplayMode, Visibility } from '@nao/shared/types';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { formatRelativeDate } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

export const GRID_CARD_CLASS =
	'group relative h-[150px] rounded-lg border bg-background dark:bg-background overflow-hidden';

export const LINES_CARD_CLASS = 'group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-sidebar-accent';

export const GRID_THUMBNAIL_CLASS =
	'absolute top-0 left-0 right-0 bottom-12 pointer-events-none overflow-hidden bg-sidebar dark:bg-background mx-1 mt-1 mb-2 rounded-lg';

export function CardsSection({
	title,
	className,
	action,
	children,
}: {
	title: string;
	className?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className={className}>
			<div className='flex items-center justify-between mb-4'>
				<h2 className='text-sm font-medium text-muted-foreground'>{title}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

export function CardsGrid({ displayMode, children }: { displayMode: StoryPanelDisplayMode; children: ReactNode }) {
	return (
		<div
			className={cn(
				displayMode === 'grid' &&
					'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3',
				displayMode === 'lines' && 'flex flex-col gap-1',
			)}
		>
			{children}
		</div>
	);
}

export function GridCardFooter({ title, subtitle }: { title: string; subtitle: ReactNode }) {
	return (
		<div className='flex-1 min-w-0 transition-transform duration-200 ease-out group-hover:-translate-y-0.5'>
			<span className='block text-xs font-medium truncate mb-2'>{title}</span>
			<span className='flex items-center text-[10px] font-medium text-muted-foreground/60 truncate'>
				{subtitle}
			</span>
		</div>
	);
}

export function AuthorDateLabel({ author, createdAt }: { author: string; createdAt: Date }) {
	return (
		<>
			{author}
			<Dot className='size-5 -my-2 shrink-0' />
			{formatRelativeDate(createdAt)}
		</>
	);
}

export function NoResults({ query }: { query: string }) {
	return (
		<p className='text-muted-foreground text-sm py-12 text-center'>
			No results matching &ldquo;{query.trim()}&rdquo;
		</p>
	);
}

export function LiveBadge() {
	return (
		<SimpleTooltip content='Live story'>
			<span className='inline-flex items-center text-primary gap-1'>
				<Activity className='size-3' />
				<span className='text-[11px] font-medium truncate'>Live</span>
			</span>
		</SimpleTooltip>
	);
}

export function PrivateBadge({ label = 'Private story' }: { label?: string }) {
	return (
		<SimpleTooltip content={label}>
			<span className='inline-flex items-center text-muted-foreground'>
				<Lock className='size-3' />
			</span>
		</SimpleTooltip>
	);
}

export function SharingBadge({ visibility, sharedWithCount }: { visibility: Visibility; sharedWithCount?: number }) {
	const tooltip =
		visibility === 'project'
			? 'Shared with the project'
			: sharedWithCount != null
				? `Shared with ${sharedWithCount} user${sharedWithCount !== 1 ? 's' : ''}`
				: 'Shared with specific people';

	return (
		<SimpleTooltip content={tooltip}>
			<span className='inline-flex items-center text-primary'>
				{visibility === 'project' ? <Globe className='size-3' /> : <Users className='size-3' />}
			</span>
		</SimpleTooltip>
	);
}
