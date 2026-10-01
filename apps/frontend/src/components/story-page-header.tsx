import {
	Activity,
	CircleAlert,
	Code,
	Ellipsis,
	Eye,
	Info,
	Loader2,
	MessageSquare,
	Pencil,
	RefreshCw,
	RotateCcw,
	Save,
} from 'lucide-react';

import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import type { StoryDownloadOptions } from '@/components/story-download';
import type { CustomStoryViewModeControls } from '@/components/custom-story/custom-story-view-mode';
import { CustomStoryViewModeToggle, isCustomStoryViewMode } from '@/components/custom-story/custom-story-view-mode';
import { EditableStoryTitle } from '@/components/editable-story-title';
import { StoryDownloadMenu, canDownloadStory } from '@/components/story-download';
import {
	ShareButton,
	StoryCertifyMenuItem,
	StoryFavoriteMenuItem,
	StoryFavoritedButton,
} from '@/components/story-header-actions';
import { describeViewedVersion, StoryVersionNav } from '@/components/story-version-nav';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SwitchIndicator } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

interface LiveControls {
	isLive: boolean;
	cachedAt?: string | Date | null;
	lastRefreshFailure?: StoryRefreshFailure | null;
	isRefreshing?: boolean;
	canRefresh?: boolean;
	isUpdating?: boolean;
	onRefresh?: () => void;
	/** When provided, clicking the badge opens settings. Otherwise the badge is read-only. */
	onOpenSettings?: () => void;
	/** Overrides the tooltip shown on the clickable badge (e.g. for viewers managing notifications). */
	isDialogNotifManager?: boolean;
}

export interface StoryRefreshFailure {
	errorMessage: string;
	failedAt: string | Date;
}

interface DownloadConfig extends Pick<StoryDownloadOptions, 'onDownload'> {
	chatId?: string;
	storySlug?: string;
	storyId?: string;
	shareId?: string;
	isOwner?: boolean;
	versionNumber?: number;
}

interface ClassicViewModeControls {
	viewMode: StoryViewMode;
	onViewModeChange: (mode: StoryViewMode) => void;
	canEdit?: boolean;
	isAgentRunning?: boolean;
	isCodeDirty?: boolean;
	isCodeValid?: boolean;
	onSave?: () => void;
	onCancel?: () => void;
	isSaving?: boolean;
}

type ViewModeControls = ClassicViewModeControls | CustomStoryViewModeControls;

interface VersionControls {
	currentVersion: number;
	versionDates: (string | Date)[];
	versionDate?: string | Date | null;
	isViewingLatest: boolean;
	onSelectVersion: (version: number) => void;
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
	canRename?: boolean;
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
	canRename = false,
	isShared = false,
	onShare,
	onOpenAnalytics,
	viewModeControls,
	versionControls,
}: StoryPageHeaderProps) {
	useKeyboardShortcuts({
		'toggle-story-chat': onOpenChat && !isOpeningChat ? onOpenChat : undefined,
	});

	const showActionsMenu = (download && canDownloadStory(download)) || !!storyId || !!onOpenAnalytics;

	return (
		<div className='shrink-0'>
			<header className='flex items-center gap-2 border-b bg-background px-4 py-2.5 md:px-6'>
				<EditableStoryTitle
					storyId={storyId}
					title={title}
					canEdit={canRename}
					heading='h1'
					className='min-w-20 max-w-full truncate text-base font-medium'
					inputClassName='text-base font-medium'
				/>
				{authorName && (
					<span className='hidden shrink-0 text-sm text-muted-foreground sm:inline'>by {authorName}</span>
				)}

				<div className='ml-auto flex shrink-0 items-center gap-2'>
					{versionControls && (
						<StoryVersionNav
							currentVersion={versionControls.currentVersion}
							versionDates={versionControls.versionDates}
							onSelectVersion={versionControls.onSelectVersion}
						/>
					)}
					{viewModeControls && <ViewModeToggle controls={viewModeControls} />}

					{onOpenChat && (
						<Tooltip>
							<TooltipTrigger asChild>
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
							</TooltipTrigger>
							<TooltipContent>
								<span className='flex items-center gap-2'>
									{openChatLabel}
									<kbd className='text-[10px] opacity-60 font-sans'>
										{getShortcutLabel('toggle-story-chat')}
									</kbd>
								</span>
							</TooltipContent>
						</Tooltip>
					)}

					{live && <LiveStoryControls live={live} />}

					{storyId && <StoryFavoritedButton storyId={storyId} />}

					{onShare && <ShareButton isShared={isShared} onShare={onShare} />}

					{showActionsMenu && (
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
								{download && <StoryDownloadMenu {...download} />}
								{storyId && <StoryCertifyMenuItem storyId={storyId} />}
								{storyId && <StoryFavoriteMenuItem storyId={storyId} />}
								{onOpenAnalytics && (
									<DropdownMenuItem onSelect={onOpenAnalytics}>
										<Info strokeWidth={2.25} />
										<span>Analytics</span>
									</DropdownMenuItem>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</header>

			{live?.lastRefreshFailure && <StoryRefreshFailureBanner failure={live.lastRefreshFailure} />}
			<StorySubHeader viewModeControls={viewModeControls} versionControls={versionControls} />
		</div>
	);
}

function ViewModeToggle({ controls }: { controls: ViewModeControls }) {
	if (isCustomStoryViewModeControls(controls)) {
		return <CustomStoryViewModeToggle {...controls} />;
	}

	const { viewMode, onViewModeChange, canEdit = false, isAgentRunning = false, isSaving = false } = controls;

	return (
		<div className='flex items-center gap-1.5 rounded-full border p-0.5'>
			<Button
				variant='ghost'
				className={cn(
					'size-5.5 px-2',
					viewMode === 'preview' && 'bg-accent rounded-full',
					'hover:rounded-full',
				)}
				onClick={() => onViewModeChange('preview')}
				disabled={isSaving}
				aria-label='Preview'
			>
				<Eye className='size-3' strokeWidth={2.25} />
			</Button>
			{canEdit && (
				<Button
					variant='ghost'
					className={cn(
						'size-5.5 px-2',
						viewMode === 'edit' && 'bg-accent rounded-full',
						'hover:rounded-full',
					)}
					onClick={() => onViewModeChange('edit')}
					disabled={isAgentRunning || isSaving}
					aria-label='Edit'
				>
					<Pencil className='size-3' strokeWidth={2.25} />
				</Button>
			)}
			<Button
				variant='ghost'
				className={cn('size-5.5 px-2', viewMode === 'code' && 'bg-accent rounded-full', 'hover:rounded-full')}
				onClick={() => onViewModeChange('code')}
				disabled={isSaving}
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
	const classicControls =
		viewModeControls && !isCustomStoryViewModeControls(viewModeControls) ? viewModeControls : undefined;
	const viewMode = classicControls?.viewMode ?? 'preview';
	const isCodeDirty = classicControls?.isCodeDirty ?? false;
	const isEditing = viewMode === 'edit' || (viewMode === 'code' && isCodeDirty);

	if (classicControls && isEditing) {
		const { onViewModeChange, onCancel, isCodeValid = true, onSave, isSaving = false } = classicControls;
		const isEditingCode = viewMode === 'code' && isCodeDirty;
		return (
			<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2 md:px-6'>
				<span className='text-xs text-muted-foreground'>
					{viewMode === 'edit' ? 'Editing' : isCodeValid ? 'Editing code' : 'Fix validation errors to save'}
				</span>
				<div className='flex items-center gap-2'>
					<Button
						variant='outline'
						size='sm'
						onClick={onCancel ?? (() => onViewModeChange('preview'))}
						disabled={isSaving}
					>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						size='sm'
						onClick={onSave}
						disabled={isSaving || (isEditingCode && !isCodeValid)}
						isLoading={isSaving}
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
					{describeViewedVersion(versionControls.versionDate, versionControls.currentVersion)}
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

function isCustomStoryViewModeControls(controls: ViewModeControls): controls is CustomStoryViewModeControls {
	return isCustomStoryViewMode(controls.viewMode);
}

function LiveStoryControls({ live }: { live: LiveControls }) {
	const {
		isLive,
		cachedAt,
		isRefreshing = false,
		canRefresh = Boolean(live.onRefresh),
		isUpdating = false,
		onRefresh,
		onOpenSettings,
		isDialogNotifManager,
	} = live;

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
							<SwitchIndicator checked={isLive} />
						</div>
					</TooltipTrigger>
					<TooltipContent>Live story</TooltipContent>
				</Tooltip>
				{cachedAt && <LiveStoryTimestamp cachedAt={cachedAt} />}
				{canRefresh && onRefresh && <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />}
			</>
		);
	}

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className='inline-flex' tabIndex={isUpdating ? 0 : undefined}>
						<button
							type='button'
							onClick={onOpenSettings}
							disabled={isUpdating}
							className={cn(
								'flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 border hover:bg-secondary rounded-full px-2 py-0.75',
								isUpdating && 'pointer-events-none',
							)}
						>
							<>
								<Activity className='size-3.5 text-foreground' strokeWidth={2.25} />
								<span className='text-xs font-medium'>Live story</span>
								{isUpdating ? (
									<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
								) : (
									<SwitchIndicator checked={isLive} />
								)}
							</>
						</button>
					</span>
				</TooltipTrigger>
				<TooltipContent>
					{isDialogNotifManager
						? 'Manage notifications'
						: isLive
							? isUpdating
								? 'Updating...'
								: 'Live story settings'
							: 'Enable live mode'}
				</TooltipContent>
			</Tooltip>
			{isLive && cachedAt && <LiveStoryTimestamp cachedAt={cachedAt} />}
			{isLive && canRefresh && onRefresh && <RefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />}
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

export function LiveStoryTimestamp({ cachedAt }: { cachedAt: string | Date }) {
	const timestampMs = new Date(cachedAt).getTime();
	const timeAgo = useTimeAgo(timestampMs);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className='flex items-center rounded-full py-0.75 text-xs text-muted-foreground -mr-1'>
					<span>{timeAgo.humanReadable.toLowerCase()}</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>Updated {new Date(cachedAt).toLocaleString()}</TooltipContent>
		</Tooltip>
	);
}

export function StoryRefreshFailureBanner({ failure }: { failure: StoryRefreshFailure }) {
	const failedAt = new Date(failure.failedAt);
	const timeAgo = useTimeAgo(failedAt.getTime());

	return (
		<div
			role='alert'
			className='flex items-start gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive md:px-6'
		>
			<CircleAlert className='mt-0.5 size-3.5 shrink-0' />
			<div className='min-w-0'>
				<span className='font-medium'>Story refresh failed.</span>{' '}
				<span className='break-words'>{failure.errorMessage}</span>
				<span className='ml-1 opacity-70' title={failedAt.toLocaleString()}>
					{timeAgo.humanReadable}
				</span>
			</div>
		</div>
	);
}
