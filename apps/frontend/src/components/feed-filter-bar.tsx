import { ListFilter, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS } from '@nao/shared/types';
import type { NotificationCategory } from '@nao/shared/types';
import type { ReactNode } from 'react';

import type { AutomationFeedItem } from '@/components/automations-feed';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { getActiveProjectId } from '@/lib/active-project';
import { cn } from '@/lib/utils';

export type FeedTypeKey = 'automation' | NotificationCategory;
export type FeedReadStatus = 'all' | 'unread';
export type FeedSort = 'newest' | 'oldest';

export type FeedFilters = {
	types: FeedTypeKey[];
	readStatus: FeedReadStatus;
	sort: FeedSort;
};

const DEFAULT_FILTERS: FeedFilters = { types: [], readStatus: 'all', sort: 'newest' };

const AUTOMATION_TYPE_LABEL = 'Automations';

const SORT_LABELS: Record<FeedSort, string> = {
	newest: 'Newest first',
	oldest: 'Oldest first',
};

const FEED_FILTERS_KEY_PREFIX = 'nao.feed-filters:';

export function FeedFilterBar({
	filters,
	onChange,
	items,
	showAutomations,
}: {
	filters: FeedFilters;
	onChange: (filters: FeedFilters) => void;
	items: AutomationFeedItem[];
	showAutomations: boolean;
}) {
	const typeOptions = buildTypeOptions(showAutomations);
	const typeCounts = useMemo(() => countByType(items), [items]);
	const unreadCount = useMemo(() => items.filter(isFeedItemUnread).length, [items]);
	const hasActiveFilters = filters.types.length > 0 || filters.readStatus !== 'all';

	function toggleType(type: FeedTypeKey) {
		const next = filters.types.includes(type)
			? filters.types.filter((value) => value !== type)
			: [...filters.types, type];
		onChange({ ...filters, types: next });
	}

	function clearFilters() {
		onChange({ ...filters, types: [], readStatus: 'all' });
	}

	return (
		<div className='flex items-center gap-1'>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='ghost'
						className={cn(
							'relative h-8 px-2',
							hasActiveFilters ? 'text-foreground' : 'text-muted-foreground',
						)}
						aria-label='Filter'
					>
						<span className='relative'>
							<ListFilter className='size-4' />
							{hasActiveFilters && (
								<span className='absolute -right-0.5 top-0 size-1.5 rounded-full bg-primary' />
							)}
						</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-56'>
					<DropdownMenuLabel>Type</DropdownMenuLabel>
					{typeOptions.map((option) => (
						<ToolbarOption
							key={option.key}
							selected={filters.types.includes(option.key)}
							onSelect={() => toggleType(option.key)}
							count={typeCounts.get(option.key) ?? 0}
						>
							{option.label}
						</ToolbarOption>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuLabel>Status</DropdownMenuLabel>
					<ToolbarOption
						selected={filters.readStatus === 'all'}
						onSelect={() => onChange({ ...filters, readStatus: 'all' })}
					>
						All
					</ToolbarOption>
					<ToolbarOption
						selected={filters.readStatus === 'unread'}
						onSelect={() => onChange({ ...filters, readStatus: 'unread' })}
						count={unreadCount}
					>
						Unread only
					</ToolbarOption>
					{hasActiveFilters && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={clearFilters}>
								<X className='size-3.5' />
								Clear filters
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			<SimpleTooltip content={SORT_LABELS[filters.sort]}>
				<Button
					variant='ghost'
					className='h-8 px-2'
					aria-label={SORT_LABELS[filters.sort]}
					onClick={() => onChange({ ...filters, sort: filters.sort === 'newest' ? 'oldest' : 'newest' })}
				>
					<SortArrows sort={filters.sort} className='size-4' />
				</Button>
			</SimpleTooltip>
		</div>
	);
}

export function useFeedFilters(): [FeedFilters, (filters: FeedFilters) => void] {
	const [filters, setFilters] = useState<FeedFilters>(() => readFilters());

	useEffect(() => {
		setFilters(readFilters());
	}, []);

	const updateFilters = useCallback((next: FeedFilters) => {
		setFilters(next);
		writeFilters(next);
	}, []);

	return [filters, updateFilters];
}

export function applyFeedFilters(items: AutomationFeedItem[], filters: FeedFilters): AutomationFeedItem[] {
	const selectedTypes = new Set(filters.types);
	const filtered = items.filter((item) => {
		if (selectedTypes.size > 0 && !selectedTypes.has(getFeedItemTypeKey(item))) {
			return false;
		}
		if (filters.readStatus === 'unread' && !isFeedItemUnread(item)) {
			return false;
		}
		return true;
	});
	return [...filtered].sort((a, b) => {
		const diff = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
		return filters.sort === 'newest' ? -diff : diff;
	});
}

function getFeedItemTypeKey(item: AutomationFeedItem): FeedTypeKey {
	return item.kind === 'automation' ? 'automation' : item.notification.category;
}

function isFeedItemUnread(item: AutomationFeedItem): boolean {
	return item.kind === 'automation' ? !item.run.readAt : !item.notification.readAt;
}

function SortArrows({ sort, className }: { sort: FeedSort; className?: string }) {
	const downActive = sort === 'newest';
	return (
		<svg
			viewBox='0 0 24 24'
			fill='none'
			stroke='currentColor'
			strokeWidth={2}
			strokeLinecap='round'
			strokeLinejoin='round'
			className={className}
			aria-hidden
		>
			<g className={downActive ? 'text-foreground' : 'text-muted-foreground'}>
				<path d='m3 16 4 4 4-4' />
				<path d='M7 20V4' />
			</g>
			<g className={downActive ? 'text-muted-foreground' : 'text-foreground'}>
				<path d='m21 8-4-4-4 4' />
				<path d='M17 4v16' />
			</g>
		</svg>
	);
}

function ToolbarOption({
	selected,
	onSelect,
	count,
	children,
}: {
	selected: boolean;
	onSelect: () => void;
	count?: number;
	children: ReactNode;
}) {
	return (
		<DropdownMenuItem
			onSelect={(event) => {
				event.preventDefault();
				onSelect();
			}}
			className='justify-between gap-4 pr-2'
		>
			<span>
				{children}
				{count !== undefined && <span className='ml-3 text-muted-foreground'>{count}</span>}
			</span>
			<span className={cn('size-1.5 shrink-0 rounded-full bg-primary', !selected && 'invisible')} aria-hidden />
		</DropdownMenuItem>
	);
}

function buildTypeOptions(showAutomations: boolean): { key: FeedTypeKey; label: string }[] {
	const notificationOptions = NOTIFICATION_CATEGORIES.map((category) => ({
		key: category,
		label: NOTIFICATION_CATEGORY_LABELS[category],
	}));
	if (!showAutomations) {
		return notificationOptions;
	}
	return [{ key: 'automation', label: AUTOMATION_TYPE_LABEL }, ...notificationOptions];
}

function countByType(items: AutomationFeedItem[]): Map<FeedTypeKey, number> {
	const counts = new Map<FeedTypeKey, number>();
	for (const item of items) {
		const key = getFeedItemTypeKey(item);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return counts;
}

function getFeedFiltersKey(): string | null {
	const projectId = getActiveProjectId();
	return projectId ? `${FEED_FILTERS_KEY_PREFIX}${projectId}` : null;
}

function readFilters(): FeedFilters {
	if (typeof window === 'undefined') {
		return DEFAULT_FILTERS;
	}
	const key = getFeedFiltersKey();
	if (!key) {
		return DEFAULT_FILTERS;
	}
	try {
		const stored = window.localStorage.getItem(key);
		if (!stored) {
			return DEFAULT_FILTERS;
		}
		const parsed = JSON.parse(stored) as Partial<FeedFilters>;
		return {
			types: Array.isArray(parsed.types) ? parsed.types : [],
			readStatus: parsed.readStatus === 'unread' ? 'unread' : 'all',
			sort: parsed.sort === 'oldest' ? 'oldest' : 'newest',
		};
	} catch {
		return DEFAULT_FILTERS;
	}
}

function writeFilters(filters: FeedFilters): void {
	if (typeof window === 'undefined') {
		return;
	}
	const key = getFeedFiltersKey();
	if (!key) {
		return;
	}
	window.localStorage.setItem(key, JSON.stringify(filters));
}
