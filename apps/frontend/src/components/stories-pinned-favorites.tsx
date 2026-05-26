import { useState } from 'react';
import { ChevronDown, ChevronRight, Pin, Star } from 'lucide-react';
import type { DisplayMode, StoryItem } from '@/lib/stories-page';
import { StoryCard } from '@/components/stories-groups';
import { cn } from '@/lib/utils';

const PINNED_COLLAPSED_KEY = 'stories-pinned-collapsed';
const FAVORITES_COLLAPSED_KEY = 'stories-favorites-collapsed';

function getCollapsedState(key: string): boolean {
	return localStorage.getItem(key) === 'true';
}

function setCollapsedState(key: string, value: boolean): void {
	localStorage.setItem(key, String(value));
}

export function PinnedSection({
	items,
	displayMode,
	className,
}: {
	items: StoryItem[];
	displayMode: DisplayMode;
	className?: string;
}) {
	const [collapsed, setCollapsed] = useState(() => getCollapsedState(PINNED_COLLAPSED_KEY));

	function toggle() {
		const next = !collapsed;
		setCollapsed(next);
		setCollapsedState(PINNED_COLLAPSED_KEY, next);
	}

	return (
		<PromotedSection
			icon={<Pin className='size-3.5 fill-current' />}
			label='Pinned'
			count={items.length}
			collapsed={collapsed}
			onToggle={toggle}
			items={items}
			displayMode={displayMode}
			className={className}
		/>
	);
}

export function FavoritesSection({
	items,
	displayMode,
	className,
}: {
	items: StoryItem[];
	displayMode: DisplayMode;
	className?: string;
}) {
	const [collapsed, setCollapsed] = useState(() => getCollapsedState(FAVORITES_COLLAPSED_KEY));

	function toggle() {
		const next = !collapsed;
		setCollapsed(next);
		setCollapsedState(FAVORITES_COLLAPSED_KEY, next);
	}

	return (
		<PromotedSection
			icon={<Star className='size-3.5 fill-current' />}
			label='Favorites'
			count={items.length}
			collapsed={collapsed}
			onToggle={toggle}
			items={items}
			displayMode={displayMode}
			className={className}
		/>
	);
}

function PromotedSection({
	icon,
	label,
	count,
	collapsed,
	onToggle,
	items,
	displayMode,
	className,
}: {
	icon: React.ReactNode;
	label: string;
	count: number;
	collapsed: boolean;
	onToggle: () => void;
	items: StoryItem[];
	displayMode: DisplayMode;
	className?: string;
}) {
	return (
		<section className={className}>
			<button
				type='button'
				className='flex items-center gap-1.5 mb-3 cursor-pointer'
				onClick={onToggle}
			>
				{collapsed ? (
					<ChevronRight className='size-3.5 text-muted-foreground' />
				) : (
					<ChevronDown className='size-3.5 text-muted-foreground' />
				)}
				{icon}
				<span className='text-sm font-medium text-muted-foreground'>{label}</span>
				<span className='text-xs text-muted-foreground/60 ml-1'>({count})</span>
			</button>
			{!collapsed && (
				<div
					className={cn(
						displayMode === 'grid' &&
							'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3',
						displayMode === 'lines' && 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1',
					)}
				>
					{items.map((item) => (
						<StoryCard key={item.id} item={item} displayMode={displayMode} showArchived={false} />
					))}
				</div>
			)}
		</section>
	);
}
