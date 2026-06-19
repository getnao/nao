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
	Star,
	Upload,
	X,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StorySummary } from '@/lib/story.utils';
import type { StoryViewMode } from './story-viewer.types';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useToggleFavorite } from '@/hooks/use-toggle-favorite';
import { StoryDownload } from '@/components/story-download';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface StoryHeaderProps {
	title: string;
	chatId: string;
	storySlug: string;
	storyId?: string | null;
	shareId?: string | null;
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
	onShare: () => void;
	onEnlarge: () => void;
	isShared: boolean;
	isAgentRunning: boolean;
	isReadonlyMode: boolean;
	isLive: boolean;
	isRefreshing: boolean;
	onRefreshData: () => void;
	onOpenLiveSettings: () => void;
	onClose: () => void;
	isCodeDirty?: boolean;
	isCodeValid?: boolean;
}

export const StoryHeader = memo(function StoryHeader({
	title,
	chatId,
	storySlug,
	storyId,
	shareId,
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
	onShare,
	onEnlarge,
	isShared,
	isAgentRunning,
	isReadonlyMode,
	isLive,
	isRefreshing,
	onRefreshData,
	onOpenLiveSettings,
	onClose,
	isCodeDirty = false,
	isCodeValid = true,
}: StoryHeaderProps) {
	const isMobile = useIsMobile();
	const { toggle: toggleFavorite, isPending: isFavoritePending } = useToggleFavorite('story');
	const { data: favorites } = useQuery({ ...trpc.favorite.list.queryOptions(), enabled: !!storyId });
	const isFavorited = !!storyId && (favorites?.storyIds.includes(storyId) ?? false);
	const otherStories = useMemo(() => allStories.filter((s) => s.id !== storySlug), [allStories, storySlug]);
	const hasMultiple = otherStories.length > 0;
	const isEditingCode = viewMode === 'code' && isCodeDirty && !isReadonlyMode;
	const showSubHeader = viewMode === 'edit' || isEditingCode || !isViewingLatest;

	const titleElement = hasMultiple ? (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					className='flex items-center gap-1 min-w-0 flex-1 cursor-pointer hover:text-foreground/80 transition-colors focus:outline-none'
				>
					<h3 className='text-sm font-medium truncate'>{title}</h3>
					<ChevronDown className='size-3 shrink-0 text-muted-foreground' strokeWidth={2.25} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start'>
				{otherStories.map((story) => (
					<DropdownMenuItem key={story.id} onClick={() => onSwitchStory(story.id)}>
						<span className='truncate'>{story.title}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	) : (
		<h3 className='text-sm font-medium truncate flex-1'>{title}</h3>
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
			>
				<Eye className='size-3' strokeWidth={2.25} />
			</Button>
			{!isReadonlyMode && (
				<Button
					variant='ghost'
					className={cn(viewMode === 'edit' && 'bg-accent rounded-full', 'hover:rounded-full')}
					size='icon-xs'
					onClick={() => onViewModeChange('edit')}
					disabled={isAgentRunning}
				>
					<Pencil className='size-3' strokeWidth={2.25} />
				</Button>
			)}
			<Button
				variant='ghost'
				className={cn(viewMode === 'code' && 'bg-accent rounded-full', 'hover:rounded-full')}
				size='icon-xs'
				onClick={() => onViewModeChange('code')}
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
			isOwner={!isReadonlyMode}
			isAgentRunning={isAgentRunning}
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
			{isLive && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant='ghost'
							size='icon-sm'
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
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<div className='flex items-center gap-2'>
						<Activity className='size-3.5 text-foreground' strokeWidth={2.25} />
						<span className='text-xs font-medium'>Live story</span>
						<Switch checked={isLive} onCheckedChange={onOpenLiveSettings} disabled={isAgentRunning} />
					</div>
				</TooltipTrigger>
				<TooltipContent>{isLive ? 'Live story settings' : 'Enable live mode'}</TooltipContent>
			</Tooltip>
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
				<DropdownMenuItem onSelect={onEnlarge}>
					<Maximize2 strokeWidth={2.25} />
					<span>Expand</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<div className='shrink-0'>
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
					{versionNav}
					{viewModeToggle}
					{liveControls}
					{downloadButton}
					{starButton}
					{actionButtons}
				</div>
			)}

			{showSubHeader && (
				<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2'>
					{viewMode === 'edit' ? (
						<>
							<span className='text-xs text-muted-foreground'>Editing</span>
							<div className='flex items-center gap-2'>
								<Button variant='outline' size='sm' onClick={() => onViewModeChange('preview')}>
									Cancel
								</Button>
								<Button variant='primary-gradient' size='sm' onClick={onSave} className='gap-1.5'>
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
								<Button variant='outline' size='sm' onClick={() => onViewModeChange('preview')}>
									Cancel
								</Button>
								<Button
									variant='primary-gradient'
									size='sm'
									onClick={onSave}
									disabled={!isCodeValid}
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
							<Button variant='outline' size='sm' onClick={onRestore} className='gap-1.5'>
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
