import {
	Activity,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Eye,
	Globe,
	Loader2,
	Maximize2,
	Pencil,
	RefreshCw,
	RotateCcw,
	Save,
	Share,
	X,
} from 'lucide-react';
import { memo, useMemo } from 'react';
import type { StorySummary } from '@/lib/story.utils';
import type { StoryViewMode } from './story-viewer.types';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface StoryHeaderProps {
	title: string;
	storyId: string;
	allStories: StorySummary[];
	onSwitchStory: (id: string) => void;
	viewMode: StoryViewMode;
	onViewModeChange: (mode: StoryViewMode) => void;
	currentVersion: number;
	totalVersions: number;
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
}

export const StoryHeader = memo(function StoryHeader({
	title,
	storyId,
	allStories,
	onSwitchStory,
	viewMode,
	onViewModeChange,
	currentVersion,
	totalVersions,
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
}: StoryHeaderProps) {
	const isMobile = useIsMobile();
	const otherStories = useMemo(() => allStories.filter((s) => s.id !== storyId), [allStories, storyId]);
	const hasMultiple = otherStories.length > 0;
	const showSubHeader = viewMode === 'edit' || !isViewingLatest;

	const titleElement = hasMultiple ? (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					className='flex items-center gap-1 min-w-0 flex-1 cursor-pointer hover:text-foreground/80 transition-colors focus:outline-none'
				>
					<h3 className='text-sm font-medium truncate'>{title}</h3>
					<ChevronDown className='size-3 shrink-0 text-muted-foreground' />
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
			<Button variant='ghost-muted' size='icon-xs' onClick={onPreviousVersion} disabled={currentVersion <= 1}>
				<ChevronLeft className='size-3' />
			</Button>
			<span className='text-xs text-muted-foreground tabular-nums min-w-6 text-center'>
				{currentVersion}/{totalVersions}
			</span>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				onClick={onNextVersion}
				disabled={currentVersion >= totalVersions}
			>
				<ChevronRight className='size-3' />
			</Button>
		</div>
	);

	const viewModeToggle = !isReadonlyMode && (
		<div className='flex items-center rounded-lg border p-0.5 gap-0.5'>
			<Button
				variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
				size='icon-xs'
				onClick={() => onViewModeChange('preview')}
			>
				<Eye className='size-3' />
			</Button>
			<Button
				variant={viewMode === 'edit' ? 'secondary' : 'ghost'}
				size='icon-xs'
				onClick={() => onViewModeChange('edit')}
				disabled={isAgentRunning}
			>
				<Pencil className='size-3' />
			</Button>
			<Button
				variant={viewMode === 'code' ? 'secondary' : 'ghost'}
				size='icon-xs'
				onClick={() => onViewModeChange('code')}
			>
				<Code className='size-3' />
			</Button>
		</div>
	);

	const actionButtons = !isReadonlyMode && (
		<>
			{isLive && (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant='ghost-muted'
								size='icon-xs'
								onClick={onRefreshData}
								disabled={isRefreshing}
								aria-label='Refresh data'
							>
								{isRefreshing ? (
									<Loader2 className='size-3 animate-spin' />
								) : (
									<RefreshCw className='size-3' />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>Refresh data</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							onClick={onOpenLiveSettings}
							disabled={isAgentRunning}
							aria-label='Live settings'
						>
							{isLive ? (
								<Activity className='size-3 text-emerald-600' />
							) : (
								<Activity className='size-3' />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{isLive ? 'Live story settings' : 'Enable live mode'}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<Button variant='ghost-muted' size='icon-xs' onClick={onEnlarge} aria-label='Enlarge Story'>
				<Maximize2 className='size-3' />
			</Button>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				onClick={onShare}
				disabled={isAgentRunning}
				aria-label='Share Story'
			>
				{isShared ? <Globe className='size-3 text-emerald-600' /> : <Share className='size-3' />}
			</Button>
		</>
	);

	return (
		<div className='shrink-0'>
			{isMobile ? (
				<>
					<div className='flex items-center gap-2 border-b px-3 py-2'>
						<Button variant='ghost' size='icon-md' onClick={onClose} aria-label='Close'>
							<X className='size-4' strokeWidth={1.5} />
						</Button>
						<div className='flex-1' />
						{viewModeToggle}
						{actionButtons}
					</div>
					<div className='flex items-center gap-2 border-b px-4 py-2'>
						{titleElement}
						{versionNav}
					</div>
				</>
			) : (
				<div className='flex items-center gap-2 border-b px-4 py-3'>
					{titleElement}
					{versionNav}
					{viewModeToggle}
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
								<Button variant='default' size='sm' onClick={onSave} className='gap-1.5'>
									<Save className='size-3' />
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
								<RotateCcw className='size-3' />
								<span>Restore</span>
							</Button>
						</>
					)}
				</div>
			)}
		</div>
	);
});
