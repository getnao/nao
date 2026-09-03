import {
	Activity,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Ellipsis,
	Eye,
	Globe,
	Loader2,
	Maximize2,
	Pencil,
	RefreshCw,
	RotateCcw,
	Save,
	ScanText,
	Star,
	Upload,
	X,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StorySummary } from '@/lib/story.utils';
import type { StoryViewMode } from './story-viewer.types';
import type { StoryRefreshFailure } from '@/components/story-page-header';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useToggleFavorite } from '@/hooks/use-toggle-favorite';
import { StoryDownload } from '@/components/story-download';
import { EditableStoryTitle } from '@/components/editable-story-title';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SwitchIndicator } from '@/components/ui/switch';
import { LiveStoryTimestamp, StoryRefreshFailureBanner } from '@/components/story-page-header';
import { cn } from '@/lib/utils';

export interface StoryHeaderProps {
	title: string;
	chatId: string;
	storySlug: string;
	storyId?: string | null;
	shareId?: string | null;
	shareType?: 'chat' | 'story' | null;
	allStories: StorySummary[];
	onSwitchStory: (id: string) => void;
	viewMode: StoryViewMode;
	onViewModeChange: (mode: StoryViewMode) => void;
	currentVersion: number;
	totalVersions: number;
	versionNumber?: number;
	onPreviousVersion: () => void;
	onNextVersion: () => void;
	isViewingLatest: boolean;
	onRestore: () => void;
	onSave: () => void;
	onCancel: () => void;
	onShare: () => void;
	onOpenAnalytics: () => void;
	onEnlarge: () => void;
	isShared: boolean;
	isAgentRunning: boolean;
	isStoryUpdating: boolean;
	isSaving?: boolean;
	isReadonlyMode: boolean;
	isLive: boolean;
	isRefreshing: boolean;
	onRefreshData: () => void;
	onOpenLiveSettings: () => void;
	onClose: () => void;
	isCodeDirty?: boolean;
	isCodeValid?: boolean;
	cachedAt?: string | Date | null;
	lastRefreshFailure?: StoryRefreshFailure | null;
}

function mergeStorySummaries(
	messageStories: StorySummary[],
	persistedStories: { storySlug: string; title: string }[],
): StorySummary[] {
	const storiesBySlug = new Map(messageStories.map((story) => [story.id, story]));

	for (const story of persistedStories) {
		storiesBySlug.set(story.storySlug, { id: story.storySlug, title: story.title });
	}

	return Array.from(storiesBySlug.values());
}

export const StoryHeader = memo(function StoryHeader({
	title,
	chatId,
	storySlug,
	storyId,
	shareId,
	shareType,
	allStories,
	onSwitchStory,
	viewMode,
	onViewModeChange,
	currentVersion,
	totalVersions,
	versionNumber,
	onPreviousVersion,
	onNextVersion,
	isViewingLatest,
	onRestore,
	onSave,
	onCancel,
	onShare,
	onOpenAnalytics,
	onEnlarge,
	isShared,
	isAgentRunning,
	isStoryUpdating,
	isSaving = false,
	isReadonlyMode,
	isLive,
	isRefreshing,
	onRefreshData,
	onOpenLiveSettings,
	onClose,
	isCodeDirty = false,
	isCodeValid = true,
	cachedAt,
	lastRefreshFailure,
}: StoryHeaderProps) {
	const isMobile = useIsMobile();
	const { toggle: toggleFavorite, isPending: isFavoritePending } = useToggleFavorite('story');
	const { data: favorites } = useQuery({ ...trpc.favorite.list.queryOptions(), enabled: !!storyId });
	const isFavorited = !!storyId && (favorites?.storyIds.includes(storyId) ?? false);
	const { data: persistedStories = [] } = useQuery({
		...trpc.story.listStories.queryOptions({ chatId }),
		enabled: !isReadonlyMode,
	});
	const stories = useMemo(() => mergeStorySummaries(allStories, persistedStories), [allStories, persistedStories]);
	const otherStories = useMemo(() => stories.filter((story) => story.id !== storySlug), [stories, storySlug]);
	const hasMultiple = otherStories.length > 0;
	const isEditingCode = viewMode === 'code' && isCodeDirty && !isReadonlyMode;
	const showSubHeader = viewMode === 'edit' || isEditingCode || !isViewingLatest;

	const titleElement = hasMultiple ? (
		<div className='flex min-w-0 flex-1 items-center gap-1'>
			<EditableStoryTitle
				storyId={storyId}
				title={title}
				canEdit={!isReadonlyMode}
				heading='h3'
				className='min-w-0 truncate text-sm font-medium'
				inputClassName='text-sm font-medium'
			/>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button type='button' variant='ghost-muted' size='icon-sm' aria-label='Switch story'>
						<ChevronDown className='size-3.5' strokeWidth={2.25} />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='start'>
					{otherStories.map((story) => (
						<DropdownMenuItem key={story.id} onClick={() => onSwitchStory(story.id)}>
							<span className='truncate'>{story.title}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	) : (
		<div className='min-w-0 flex-1'>
			<EditableStoryTitle
				storyId={storyId}
				title={title}
				canEdit={!isReadonlyMode}
				heading='h3'
				className='truncate text-sm font-medium'
				inputClassName='text-sm font-medium'
			/>
		</div>
	);

	const updatingIndicator = isStoryUpdating && (
		<div className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground' role='status'>
			<Loader2 className='size-3 animate-spin' strokeWidth={2.25} />
			<span>Updating…</span>
		</div>
	);

	const versionNav = totalVersions > 1 && (
		<div className='flex items-center gap-1'>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				className='hover:rounded-full'
				onClick={onPreviousVersion}
				disabled={currentVersion <= 1}
			>
				<ChevronLeft className='size-3' strokeWidth={2.25} />
			</Button>
			<span className='text-xs text-muted-foreground tabular-nums min-w-6 text-center'>
				{currentVersion}/{totalVersions}
			</span>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				className='hover:rounded-full'
				onClick={onNextVersion}
				disabled={currentVersion >= totalVersions}
			>
				<ChevronRight className='size-3' strokeWidth={2.25} />
			</Button>
		</div>
	);

	const viewModeToggle = (
		<div className='flex items-center rounded-full border p-0.5 gap-1.5'>
			<Button
				variant='ghost'
				className={cn(viewMode === 'preview' && 'bg-accent rounded-full', 'hover:rounded-full')}
				size='icon-xs'
				onClick={() => onViewModeChange('preview')}
				disabled={isSaving}
			>
				<Eye className='size-3' strokeWidth={2.25} />
			</Button>
			{!isReadonlyMode && (
				<Button
					variant='ghost'
					className={cn(viewMode === 'edit' && 'bg-accent rounded-full', 'hover:rounded-full')}
					size='icon-xs'
					onClick={() => onViewModeChange('edit')}
					disabled={isAgentRunning || isSaving}
				>
					<Pencil className='size-3' strokeWidth={2.25} />
				</Button>
			)}
			<Button
				variant='ghost'
				className={cn(viewMode === 'code' && 'bg-accent rounded-full', 'hover:rounded-full')}
				size='icon-xs'
				onClick={() => onViewModeChange('code')}
				disabled={isSaving}
			>
				<Code className='size-3' strokeWidth={2.25} />
			</Button>
		</div>
	);

	const downloadButton = (
		<StoryDownload
			iconOnly
			chatId={chatId}
			storySlug={storySlug}
			shareId={shareId ?? undefined}
			shareType={shareType ?? undefined}
			isOwner={!isReadonlyMode}
			isAgentRunning={isAgentRunning}
			isSaving={isSaving}
			versionNumber={versionNumber}
		/>
	);

	const starButton = storyId && (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={() => toggleFavorite(storyId)}
					disabled={isFavoritePending}
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

	const liveControls = !isReadonlyMode && (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type='button'
						onClick={onOpenLiveSettings}
						disabled={isAgentRunning}
						className='flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 border hover:bg-secondary rounded-full px-2 py-0.75'
					>
						<Activity className='size-3.5 text-foreground' strokeWidth={2.25} />
						<span className='text-xs font-medium'>Live story</span>
						<SwitchIndicator checked={isLive} />
					</button>
				</TooltipTrigger>
				<TooltipContent>{isLive ? 'Live story settings' : 'Enable live mode'}</TooltipContent>
			</Tooltip>
			{isLive && (
				<>
					{cachedAt && <LiveStoryTimestamp cachedAt={cachedAt} />}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant='ghost'
								size='icon-sm'
								className='hover:rounded-full'
								onClick={onRefreshData}
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
				</>
			)}
		</>
	);

	const actionButtons = !isReadonlyMode && (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='ghost' size='icon-sm' className='hover:rounded-full' aria-label='More actions'>
					<Ellipsis className='size-3.5' strokeWidth={2.25} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-auto min-w-20'>
				<DropdownMenuItem onSelect={onShare} disabled={isAgentRunning}>
					{isShared ? <Globe className='text-primary' strokeWidth={2.25} /> : <Upload strokeWidth={2.25} />}
					<span>Share</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onOpenAnalytics}>
					<ScanText className='size-3' />
					<span>Analytics</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onEnlarge}>
					<Maximize2 strokeWidth={2.25} />
					<span>Expand</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<div className='shrink-0' data-selection-ignore>
			{isMobile ? (
				<>
					<div className='flex items-center gap-2 border-b px-3 py-2'>
						<Button
							variant='ghost'
							size='icon-md'
							className='hover:rounded-full'
							onClick={onClose}
							aria-label='Close'
						>
							<X className='size-4' strokeWidth={2.25} />
						</Button>
						<div className='flex-1' />
						{viewModeToggle}
						{liveControls}
						{downloadButton}
						{starButton}
						{actionButtons}
					</div>
					<div className='flex items-center gap-2 border-b px-4 py-2'>
						{titleElement}
						{updatingIndicator}
						{versionNav}
					</div>
				</>
			) : (
				<div className='flex items-center gap-2 border-b px-4 py-2'>
					<Button
						variant='ghost'
						size='icon-sm'
						className='mr-2 hover:rounded-full'
						onClick={onClose}
						aria-label='Close'
					>
						<X className='size-3.5' strokeWidth={2.25} />
					</Button>
					{titleElement}
					{updatingIndicator}
					{versionNav}
					{viewModeToggle}
					{liveControls}
					{downloadButton}
					{starButton}
					{actionButtons}
				</div>
			)}

			{lastRefreshFailure && <StoryRefreshFailureBanner failure={lastRefreshFailure} />}
			{showSubHeader && (
				<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2'>
					{viewMode === 'edit' ? (
						<>
							<span className='text-xs text-muted-foreground'>Editing</span>
							<div className='flex items-center gap-2'>
								<Button variant='outline' size='sm' onClick={onCancel} disabled={isSaving}>
									Cancel
								</Button>
								<Button
									variant='primary-gradient'
									size='sm'
									onClick={onSave}
									disabled={isSaving}
									isLoading={isSaving}
									className='gap-1.5'
								>
									<Save className='size-3' strokeWidth={2.25} />
									<span>Save</span>
									<kbd className='text-[10px] opacity-60 font-sans'>⌘S</kbd>
								</Button>
							</div>
						</>
					) : isEditingCode ? (
						<>
							<span className='text-xs text-muted-foreground'>
								{isCodeValid ? 'Editing code' : 'Fix validation errors to save'}
							</span>
							<div className='flex items-center gap-2'>
								<Button variant='outline' size='sm' onClick={onCancel} disabled={isSaving}>
									Cancel
								</Button>
								<Button
									variant='primary-gradient'
									size='sm'
									onClick={onSave}
									disabled={isSaving || !isCodeValid}
									isLoading={isSaving}
									className='gap-1.5'
								>
									<Save className='size-3' strokeWidth={2.25} />
									<span>Save</span>
									<kbd className='text-[10px] opacity-60 font-sans'>⌘S</kbd>
								</Button>
							</div>
						</>
					) : (
						<>
							<span className='text-xs text-muted-foreground'>
								Viewing v{currentVersion} of {totalVersions}
							</span>
							<Button
								variant='outline'
								size='sm'
								onClick={onRestore}
								disabled={isSaving}
								className='gap-1.5'
							>
								<RotateCcw className='size-3' strokeWidth={2.25} />
								<span>Restore</span>
							</Button>
						</>
					)}
				</div>
			)}
		</div>
	);
});
