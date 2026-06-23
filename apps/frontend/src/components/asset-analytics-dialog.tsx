import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, Dot, FileDown, GitFork, Loader2, MousePointerClick, RefreshCw, Search, Star, X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

import type { AnalyticsEventType, AnalyticsAssetType } from '@nao/shared/types';
import type { ActorGroup, AnalyticsEventEntry, EventRow } from '@/lib/analytics-events.utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
	buildViewers,
	countActiveFavorites,
	filterRows,
	formatDate,
	formatDuration,
	getBadge,
	getDownloadTitle,
	getVersionNumber,
	groupRowsByActor,
	isCurrentlyFavorited,
} from '@/lib/analytics-events.utils';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';

interface AssetAnalyticsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	assetType: AnalyticsAssetType;
	chatId?: string;
	storyId?: string;
}

interface TabDef {
	id: AnalyticsEventType;
	icon: ReactNode;
	label: string;
	emptyLabel: string;
	assetTypes: AnalyticsAssetType[];
}

const TAB_DEFS: TabDef[] = [
	{
		id: 'page_view',
		icon: <MousePointerClick className='size-3.5' />,
		label: 'Views',
		emptyLabel: 'view',
		assetTypes: ['chat', 'story'],
	},
	{
		id: 'download',
		icon: <FileDown className='size-3.5' />,
		label: 'Downloads',
		emptyLabel: 'download',
		assetTypes: ['chat', 'story'],
	},
	{
		id: 'fork',
		icon: <GitFork className='size-3.5' />,
		label: 'Forks',
		emptyLabel: 'fork',
		assetTypes: ['chat', 'story'],
	},
	{
		id: 'favorite',
		icon: <Star className='size-3.5' />,
		label: 'Favorites',
		emptyLabel: 'favorite',
		assetTypes: ['story'],
	},
	{
		id: 'refresh',
		icon: <RefreshCw className='size-3.5' />,
		label: 'Refreshes',
		emptyLabel: 'refresh',
		assetTypes: ['story'],
	},
];

export function AssetAnalyticsDialog({ open, onOpenChange, assetType, chatId, storyId }: AssetAnalyticsDialogProps) {
	const tabs = TAB_DEFS.filter((tab) => tab.assetTypes.includes(assetType));
	const [activeTab, setActiveTab] = useState<AnalyticsEventType>('page_view');
	const [search, setSearch] = useState('');

	const query = useQuery({
		...trpc.analyticsEvent.listForAsset.queryOptions({ assetType, chatId, storyId }),
		enabled: open,
		staleTime: 0,
		refetchOnMount: 'always',
	});

	const events = query.data ?? [];

	const rowsByType = (type: AnalyticsEventType): EventRow[] =>
		events
			.filter((r) => r.event.type === type)
			.map((r) => ({
				actor: r.actorName,
				actorKey: r.actorName ?? 'anonymous',
				createdAt: new Date(r.event.createdAt),
				badge: getBadge(r.event.metadata),
				versionNumber: getVersionNumber(r.event.metadata),
				title: getDownloadTitle(r.event.metadata),
			}));

	const activeTabDef = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-2xl'>
				<DialogHeader className='flex-row items-center justify-between gap-2 pr-8'>
					<DialogTitle>Analytics events</DialogTitle>
					<AnalyticsSearchInput value={search} onChange={setSearch} />
				</DialogHeader>

				{query.isLoading ? (
					<div className='flex items-center justify-center py-8'>
						<Loader2 className='size-5 animate-spin text-muted-foreground' />
					</div>
				) : (
					<div className='flex flex-col gap-2'>
						<div className='flex border-b'>
							{tabs.map((tab) => {
								const isActive = activeTabDef.id === tab.id;
								const tabRows = rowsByType(tab.id);
								const count = tab.id === 'favorite' ? countActiveFavorites(tabRows) : tabRows.length;
								return (
									<button
										key={tab.id}
										type='button'
										onClick={() => setActiveTab(tab.id)}
										className={cn(
											'flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm transition-colors border-b-2 -mb-px w-full',
											isActive
												? 'border-primary text-foreground font-medium'
												: 'border-transparent text-muted-foreground hover:text-foreground',
										)}
									>
										{tab.icon}
										<span>{tab.label}</span>
										<span
											className={isActive ? 'text-muted-foreground' : 'text-muted-foreground/60'}
										>
											{count}
										</span>
									</button>
								);
							})}
						</div>

						{activeTabDef.id === 'page_view' ? (
							<ViewsTabContent events={events} search={search} />
						) : activeTabDef.id === 'favorite' ? (
							<FavoritesTabContent rows={rowsByType('favorite')} search={search} />
						) : (
							<ActorEventTabContent
								rows={rowsByType(activeTabDef.id)}
								label={activeTabDef.emptyLabel}
								search={search}
							/>
						)}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function AnalyticsSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	const [open, setOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			inputRef.current?.focus();
		}
	}, [open]);

	function handleClose() {
		setOpen(false);
		onChange('');
	}

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Escape') {
			handleClose();
		}
	}

	if (!open) {
		return (
			<Button
				variant='ghost'
				size='icon-xs'
				className='rounded-full -mt-1 text-muted-foreground hover:text-foreground hover:bg-transparent'
				onClick={() => setOpen(true)}
				aria-label='Search'
			>
				<Search className='size-3.5' />
			</Button>
		);
	}

	return (
		<div className='flex items-center gap-1.5 rounded-full border px-2 py-1 -mt-1.5'>
			<Search className='size-3.5 shrink-0 text-foreground' />
			<input
				ref={inputRef}
				type='text'
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={handleKeyDown}
				placeholder='Search…'
				className='w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground'
			/>
			<button type='button' onClick={handleClose} className='text-muted-foreground hover:text-foreground'>
				<X className='size-3.5' />
			</button>
		</div>
	);
}

function RowMiddle({ versionNumber, title }: { versionNumber?: number | null; title?: string | null }) {
	if (!title && versionNumber == null) {
		return <span aria-hidden className='flex-1' />;
	}
	return (
		<span className='flex min-w-0 flex-1 items-center justify-center gap-1 text-muted-foreground/70'>
			{title && <span className='min-w-0 truncate'>{title}</span>}
			{versionNumber != null && <span className='shrink-0 tabular-nums'>v.{versionNumber}</span>}
		</span>
	);
}

function ViewsTabContent({ events, search }: { events: AnalyticsEventEntry[]; search: string }) {
	const viewers = buildViewers(events);

	if (viewers.length === 0) {
		return <p className='py-6 text-center text-xs text-muted-foreground'>No views yet.</p>;
	}

	const query = search.trim().toLowerCase();
	const filteredViewers = viewers
		.map((v) => {
			const items = filterRows(
				[v.actorName ?? 'Anonymous'],
				v.items,
				(session) => [
					session.durationMs != null ? formatDuration(session.durationMs) : null,
					session.versionNumber != null ? `v.${session.versionNumber}` : null,
					formatDate(session.timestamp),
				],
				query,
			);
			const totalDurationMs = items.reduce((sum, session) => sum + (session.durationMs ?? 0), 0);
			return { ...v, items, totalDurationMs };
		})
		.filter((v) => v.items.length > 0);

	return (
		<MasterDetailPanel
			groups={filteredViewers}
			entityLabel='viewer'
			renderSidebarMeta={(viewer) => <span className='shrink-0'>{viewer.items.length}</span>}
			renderItems={(viewer) =>
				viewer.items.map((session, i) => (
					<li key={i} className='flex items-center gap-2 px-3 py-2'>
						{session.durationMs != null && (
							<span className='flex shrink-0 items-center gap-1 text-muted-foreground'>
								<Clock className='size-3' />
								<span>{formatDuration(session.durationMs)}</span>
							</span>
						)}
						<RowMiddle versionNumber={session.versionNumber} />
						<span className='shrink-0 text-muted-foreground'>{formatDate(session.timestamp)}</span>
					</li>
				))
			}
			renderFooter={(viewer) => (
				<div className='flex items-center gap-2 border-t bg-muted/30 px-3 py-2 text-xs'>
					<span className='flex items-center gap-1 font-medium text-foreground'>
						<Clock className='size-3' />
						<span>{formatDuration(viewer.totalDurationMs)}</span>
					</span>
					<Dot className='size-3' />
					<span className='text-foreground'>
						{viewer.items.length} view{viewer.items.length > 1 ? 's' : ''}
					</span>
				</div>
			)}
		/>
	);
}

function ActorEventTabContent({ rows, label, search }: { rows: EventRow[]; label: string; search: string }) {
	const groups = groupRowsByActor(rows);

	if (groups.length === 0) {
		return <p className='py-6 text-center text-xs text-muted-foreground'>No {label} yet.</p>;
	}

	const query = search.trim().toLowerCase();
	const filteredGroups = groups
		.map((g) => ({
			...g,
			items: filterRows(
				[g.actorName ?? 'Anonymous', label],
				g.items,
				(row) => [
					row.badge,
					row.versionNumber != null ? `v.${row.versionNumber}` : null,
					row.title,
					formatDate(row.createdAt),
				],
				query,
			),
		}))
		.filter((g) => g.items.length > 0);

	return (
		<MasterDetailPanel
			groups={filteredGroups}
			entityLabel='actor'
			renderSidebarMeta={(group) => <span className='shrink-0'>{group.items.length}</span>}
			renderItems={(group) =>
				group.items.map((row, i) => (
					<li key={i} className='flex items-center gap-2 px-3 py-2'>
						{row.badge && (
							<Badge
								variant='secondary'
								className='shrink-0 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide'
							>
								{row.badge}
							</Badge>
						)}
						<RowMiddle versionNumber={row.versionNumber} title={row.title} />
						<span className='shrink-0 text-muted-foreground'>{formatDate(row.createdAt)}</span>
					</li>
				))
			}
			renderFooter={(group) => (
				<div className='flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2 text-xs'>
					<span className='text-foreground'>
						{group.items.length} {label}
						{group.items.length > 1 ? (label === 'refresh' ? 'es' : 's') : ''}
					</span>
				</div>
			)}
		/>
	);
}

function FavoritesTabContent({ rows, search }: { rows: EventRow[]; search: string }) {
	const groups = groupRowsByActor(rows);

	if (groups.length === 0) {
		return <p className='py-6 text-center text-xs text-muted-foreground'>No favorites yet.</p>;
	}

	const query = search.trim().toLowerCase();
	const filteredGroups = groups
		.map((g) => ({
			...g,
			items: filterRows(
				[g.actorName ?? 'Anonymous'],
				g.items,
				(row) => [
					row.badge === 'added' ? 'added favorited' : 'removed not favorited',
					formatDate(row.createdAt),
				],
				query,
			),
		}))
		.filter((g) => g.items.length > 0);

	return (
		<MasterDetailPanel
			groups={filteredGroups}
			entityLabel='actor'
			renderSidebarMeta={(group, isSelected) => (
				<Star
					className={cn(
						'size-3 shrink-0',
						isCurrentlyFavorited(group) && 'fill-current',
						isSelected ? 'text-foreground' : 'text-muted-foreground/40',
					)}
				/>
			)}
			renderItems={(group) =>
				group.items.map((row, i) => {
					const added = row.badge === 'added';
					return (
						<li key={i} className='flex items-center justify-between gap-2 px-3 py-2'>
							<span className='font-mono text-muted-foreground'>{added ? '+ added' : '− removed'}</span>
							<span className='text-muted-foreground'>{formatDate(row.createdAt)}</span>
						</li>
					);
				})
			}
			renderFooter={(group) => {
				const favorited = isCurrentlyFavorited(group);
				return (
					<div className='flex items-center gap-1.5 border-t bg-muted/30 px-3 py-2 text-xs'>
						<Star
							className={cn(
								'relative bottom-px size-3 shrink-0 text-foreground',
								favorited && 'fill-current',
							)}
						/>
						<span className='text-foreground'>{favorited ? 'Favorited' : 'Not favorited'}</span>
					</div>
				);
			}}
		/>
	);
}

interface MasterDetailPanelProps<TGroup extends ActorGroup<unknown>> {
	groups: TGroup[];
	entityLabel: string;
	renderSidebarMeta: (group: TGroup, isSelected: boolean) => ReactNode;
	renderItems: (group: TGroup) => ReactNode;
	renderFooter: (group: TGroup) => ReactNode;
}

function MasterDetailPanel<TGroup extends ActorGroup<unknown>>({
	groups,
	entityLabel,
	renderSidebarMeta,
	renderItems,
	renderFooter,
}: MasterDetailPanelProps<TGroup>) {
	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	const selected = groups.find((group) => group.actorKey === selectedKey) ?? groups[0];

	return (
		<div className='flex h-80'>
			<div className='flex w-44 shrink-0 flex-col border-r'>
				{groups.length === 0 ? (
					<p className='px-3 py-6 text-center text-xs text-muted-foreground'>No {entityLabel} matches.</p>
				) : (
					<ul className='flex-1 overflow-y-auto'>
						{groups.map((group) => {
							const isSelected = selected?.actorKey === group.actorKey;
							return (
								<li key={group.actorKey}>
									<button
										type='button'
										onClick={() => setSelectedKey(group.actorKey)}
										className={sidebarButtonClass(isSelected)}
									>
										<span className='truncate'>{group.actorName ?? 'Anonymous'}</span>
										{renderSidebarMeta(group, isSelected)}
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>

			<div className='flex min-w-0 flex-1 flex-col'>
				{selected ? (
					<>
						<ul className='flex-1 divide-y divide-border overflow-y-auto text-xs'>
							{renderItems(selected)}
						</ul>
						{renderFooter(selected)}
					</>
				) : (
					<p className='py-6 text-center text-xs text-muted-foreground'>No {entityLabel} selected.</p>
				)}
			</div>
		</div>
	);
}

const SIDEBAR_BUTTON_BASE =
	'flex w-full items-center justify-between gap-2 border-l-2 px-3 py-2 text-left text-xs transition-colors';

function sidebarButtonClass(isSelected: boolean): string {
	return cn(
		SIDEBAR_BUTTON_BASE,
		isSelected
			? 'border-primary bg-muted/50 font-medium text-foreground'
			: 'border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground',
	);
}
