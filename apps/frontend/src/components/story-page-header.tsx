import {
	Activity,
	ChevronLeft,
	ChevronRight,
	Code,
	Ellipsis,
	Eye,
	Globe,
	Loader2,
	MessageSquare,
	Pencil,
	RefreshCw,
	RotateCcw,
	Save,
	ScanText,
	Star,
	Upload,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import { StoryDownload } from '@/components/story-download';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToggleFavorite } from '@/hooks/use-toggle-favorite';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface LiveControls {
	isLive: boolean;
	isRefreshing?: boolean;
	onRefresh?: () => void;
	/** When provided, the live state can be toggled (owner). Otherwise the badge is read-only. */
	onOpenSettings?: () => void;
}

interface DownloadConfig {
	chatId?: string;
	storySlug?: string;
	storyId?: string;
	shareId?: string;
	isOwner?: boolean;
	versionNumber?: number;
}

interface ViewModeControls {
	viewMode: StoryViewMode;
	onViewModeChange: (mode: StoryViewMode) => void;
	canEdit?: boolean;
	isAgentRunning?: boolean;
	isCodeDirty?: boolean;
	isCodeValid?: boolean;
	onSave?: () => void;
}

interface VersionControls {
	currentVersion: number;
	totalVersions: number;
	isViewingLatest: boolean;
	onPrevious: () => void;
	onNext: () => void;
	onRestore: () => void;
}

export interface StoryPageHeaderProps {
	title: string;
	authorName?: string;
	openChatLabel?: string;
	onOpenChat?: () => void;
	isOpeningChat?: boolean;
	live?: LiveControls;
	download?: DownloadConfig;
	storyId?: string | null;
	isShared?: boolean;
	onShare?: () => void;
	onOpenAnalytics?: () => void;
	viewModeControls?: ViewModeControls;
	versionControls?: VersionControls;
}

export function StoryPageHeader({
	title,
	authorName,
	openChatLabel = 'Open chat',
	onOpenChat,
	isOpeningChat = false,
	live,
	download,
	storyId,
	isShared = false,
	onShare,
	onOpenAnalytics,
	viewModeControls,
	versionControls,
}: StoryPageHeaderProps) {
	return (
		<div className='shrink-0'>
			<header className='flex items-center gap-2 border-b bg-background px-4 py-2.5 md:px-6'>
				<h1 className='min-w-0 truncate text-base font-medium'>{title}</h1>
				{authorName && <span className='shrink-0 text-sm text-muted-foreground'>by {authorName}</span>}

				{versionControls && <VersionNav controls={versionControls} />}

				<div className='ml-auto flex shrink-0 items-center gap-2'>
					{viewModeControls && <ViewModeToggle controls={viewModeControls} />}

					{onOpenChat && (
						<Button
							variant='outline'
							size='sm'
							className='gap-1.5 rounded-full text-xs'
							onClick={onOpenChat}
							disabled={isOpeningChat}
						>
							{isOpeningChat ? (
								<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
							) : (
								<MessageSquare className='size-3.5' strokeWidth={2.25} />
							)}
							<span>{openChatLabel}</span>
						</Button>
					)}

					{live && <LiveStoryControls live={live} />}

					<div>
						{download && <StoryDownload iconOnly {...download} />}

						{storyId && <FavoriteButton storyId={storyId} />}

						{(onShare || onOpenAnalytics) && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant='ghost'
										size='icon-sm'
										className='hover:rounded-full'
										aria-label='More actions'
									>
										<Ellipsis className='size-3.5' strokeWidth={2.25} />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align='end' className='w-auto min-w-20'>
									{onShare && (
										<DropdownMenuItem onSelect={onShare}>
											{isShared ? (
												<Globe className='text-primary' strokeWidth={2.25} />
											) : (
												<Upload strokeWidth={2.25} />
											)}
											<span>Share</span>
										</DropdownMenuItem>
									)}
									{onOpenAnalytics && (
										<DropdownMenuItem onSelect={onOpenAnalytics}>
											<ScanText className='size-3' />
											<span>Analytics</span>
										</DropdownMenuItem>
									)}
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</div>
			</header>

			<StorySubHeader viewModeControls={viewModeControls} versionControls={versionControls} />
		</div>
	);
}

function VersionNav({ controls }: { controls: VersionControls }) {
	if (controls.totalVersions <= 1) {
		return null;
	}

	return (
		<div className='flex shrink-0 items-center gap-1'>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				className='hover:rounded-full'
				onClick={controls.onPrevious}
				disabled={controls.currentVersion <= 1}
				aria-label='Previous version'
			>
				<ChevronLeft className='size-3' strokeWidth={2.25} />
			</Button>
			<span className='min-w-6 text-center text-xs text-muted-foreground tabular-nums'>
				{controls.currentVersion}/{controls.totalVersions}
			</span>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				className='hover:rounded-full'
				onClick={controls.onNext}
				disabled={controls.currentVersion >= controls.totalVersions}
				aria-label='Next version'
			>
				<ChevronRight className='size-3' strokeWidth={2.25} />
			</Button>
		</div>
	);
}

function ViewModeToggle({ controls }: { controls: ViewModeControls }) {
	const { viewMode, onViewModeChange, canEdit = false, isAgentRunning = false } = controls;

	return (
		<div className='flex items-center gap-1.5 rounded-full border p-0.5'>
			<Button
				variant='ghost'
				size='icon-xs'
				className={cn(viewMode === 'preview' && 'bg-accent rounded-full', 'hover:rounded-full')}
				onClick={() => onViewModeChange('preview')}
				aria-label='Preview'
			>
				<Eye className='size-3' strokeWidth={2.25} />
			</Button>
			{canEdit && (
				<Button
					variant='ghost'
					size='icon-xs'
					className={cn(viewMode === 'edit' && 'bg-accent rounded-full', 'hover:rounded-full')}
					onClick={() => onViewModeChange('edit')}
					disabled={isAgentRunning}
					aria-label='Edit'
				>
					<Pencil className='size-3' strokeWidth={2.25} />
				</Button>
			)}
			<Button
				variant='ghost'
				size='icon-xs'
				className={cn(viewMode === 'code' && 'bg-accent rounded-full', 'hover:rounded-full')}
				onClick={() => onViewModeChange('code')}
				aria-label='Code'
			>
				<Code className='size-3' strokeWidth={2.25} />
			</Button>
		</div>
	);
}

function StorySubHeader({
	viewModeControls,
	versionControls,
}: {
	viewModeControls?: ViewModeControls;
	versionControls?: VersionControls;
}) {
	const viewMode = viewModeControls?.viewMode ?? 'preview';
	const isCodeDirty = viewModeControls?.isCodeDirty ?? false;
	const isEditing = viewMode === 'edit' || (viewMode === 'code' && isCodeDirty);

	if (viewModeControls && isEditing) {
		const { onViewModeChange, isCodeValid = true, onSave } = viewModeControls;
		const isEditingCode = viewMode === 'code' && isCodeDirty;
		return (
			<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2 md:px-6'>
				<span className='text-xs text-muted-foreground'>
					{viewMode === 'edit' ? 'Editing' : isCodeValid ? 'Editing code' : 'Fix validation errors to save'}
				</span>
				<div className='flex items-center gap-2'>
					<Button variant='outline' size='sm' onClick={() => onViewModeChange('preview')}>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						size='sm'
						onClick={onSave}
						disabled={isEditingCode && !isCodeValid}
						className='gap-1.5'
					>
						<Save className='size-3' strokeWidth={2.25} />
						<span>Save</span>
						<kbd className='text-[10px] opacity-60 font-sans'>⌘S</kbd>
					</Button>
				</div>
			</div>
		);
	}

	if (versionControls && !versionControls.isViewingLatest) {
		return (
			<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2 md:px-6'>
				<span className='text-xs text-muted-foreground'>
					Viewing v{versionControls.currentVersion} of {versionControls.totalVersions}
				</span>
				<Button variant='outline' size='sm' onClick={versionControls.onRestore} className='gap-1.5'>
					<RotateCcw className='size-3' strokeWidth={2.25} />
					<span>Restore</span>
				</Button>
			</div>
		);
	}

	return null;
}

function LiveStoryControls({ live }: { live: LiveControls }) {
	const { isLive, isRefreshing = false, onRefresh, onOpenSettings } = live;

	if (!onOpenSettings) {
		if (!isLive) {
			return null;
		}
		return (
			<>
				<Tooltip>
					<TooltipTrigger asChild>
						<div className='flex items-center gap-2 border rounded-full px-2 py-0.75'>
							<Activity className='size-3.5 text-foreground' strokeWidth={2.25} />
							<span className='text-xs font-medium'>Live story</span>
							<Switch checked={isLive} onCheckedChange={() => {}} disabled />
						</div>
					</TooltipTrigger>
					<TooltipContent>Live story</TooltipContent>
				</Tooltip>
				{onRefresh && <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />}
			</>
		);
	}

	return (
		<>
			{isLive && onRefresh && <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />}
			<Tooltip>
				<TooltipTrigger asChild>
					<div className='flex items-center gap-2 border rounded-full px-2 py-0.75'>
						<Activity className='size-3.5 text-foreground' strokeWidth={2.25} />
						<span className='text-xs font-medium'>Live story</span>
						<Switch checked={isLive} onCheckedChange={onOpenSettings} />
					</div>
				</TooltipTrigger>
				<TooltipContent>{isLive ? 'Live story settings' : 'Enable live mode'}</TooltipContent>
			</Tooltip>
		</>
	);
}

function RefreshButton({ isRefreshing, onRefresh }: { isRefreshing: boolean; onRefresh: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={onRefresh}
					disabled={isRefreshing}
					aria-label='Refresh data'
				>
					{isRefreshing ? (
						<Loader2 className='size-3 animate-spin' strokeWidth={2.25} />
					) : (
						<RefreshCw className='size-3' strokeWidth={2.25} />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>Refresh data</TooltipContent>
		</Tooltip>
	);
}

function FavoriteButton({ storyId }: { storyId: string }) {
	const { toggle: toggleFavorite, isPending } = useToggleFavorite('story');
	const { data: favorites } = useQuery(trpc.favorite.list.queryOptions());
	const isFavorited = favorites?.storyIds.includes(storyId) ?? false;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={() => toggleFavorite(storyId)}
					disabled={isPending}
					aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
				>
					<Star
						className={cn('size-3.5', isFavorited && 'fill-foreground text-foreground')}
						strokeWidth={2.25}
					/>
				</Button>
			</TooltipTrigger>
			<TooltipContent>{isFavorited ? 'Remove from favorites' : 'Add to favorites'}</TooltipContent>
		</Tooltip>
	);
}
