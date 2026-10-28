import {
	Activity,
	CircleAlert,
	Code,
	Ellipsis,
	Eye,
	Info,
	Loader2,
	Mail,
	Pencil,
	RefreshCw,
	RotateCcw,
	Save,
} from 'lucide-react';

import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import type { StoryDownloadOptions } from '@/components/story-download';
import type {
	CustomStoryElementSelection,
	CustomStoryViewModeControls,
} from '@/components/custom-story/custom-story-view-mode';
import type { StoryChatControls } from '@/components/story-chat-button';
import {
	ElementSelectionToggle,
	CustomStoryViewModeToggle,
	isCustomStoryViewMode,
} from '@/components/custom-story/custom-story-view-mode';
import { EditableStoryTitle } from '@/components/editable-story-title';
import { StoryChatButton } from '@/components/story-chat-button';
import { StoryDownloadMenu, canDownloadStory } from '@/components/story-download';
import {
	ShareButton,
	StoryCertifyMenuItem,
	StoryDuplicateMenuItem,
	StoryFavoriteMenuItem,
	StoryFavoritedButton,
	StoryFeedbackButtons,
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
import { useTimeAgo } from '@/hooks/use-time-ago';
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
	/** Viewers of a shared story get the live actions in the actions menu instead of the header badge. */
	isInActionsMenu?: boolean;
	onManageNotifications?: () => void;
}

export interface StoryRefreshFailure {
	errorMessage: string;
	failedAt: string | Date;
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
	storyChat?: StoryChatControls;
	/** Offers to copy the story into a new chat of the user. */
	canDuplicate?: boolean;
	live?: LiveControls;
	download?: StoryDownloadOptions;
	storyId?: string | null;
	canRename?: boolean;
	isShared?: boolean;
	onShare?: () => void;
	onOpenAnalytics?: () => void;
	viewModeControls?: ViewModeControls;
	versionControls?: VersionControls;
	elementSelection?: CustomStoryElementSelection;
}

export function StoryPageHeader({
	title,
	authorName,
	storyChat,
	canDuplicate = false,
	live,
	download,
	storyId,
	canRename = false,
	isShared = false,
	onShare,
	onOpenAnalytics,
	viewModeControls,
	versionControls,
	elementSelection,
}: StoryPageHeaderProps) {
	const liveMenu = live?.isLive && live.isInActionsMenu ? live : undefined;
	const showActionsMenu = (download && canDownloadStory(download)) || !!storyId || !!onOpenAnalytics || !!liveMenu;

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

					{storyChat && <StoryChatButton {...storyChat} />}

					{live && !live.isInActionsMenu && <LiveStoryControls live={live} />}
					{liveMenu?.cachedAt && <LiveStoryTimestamp cachedAt={liveMenu.cachedAt} />}

					{storyId && <StoryFeedbackButtons storyId={storyId} />}

					{storyId && <StoryFavoritedButton storyId={storyId} />}

					{onShare && <ShareButton isShared={isShared} onShare={onShare} />}

					{elementSelection && <ElementSelectionToggle {...elementSelection} />}

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
								{liveMenu && <LiveStoryMenuItems live={liveMenu} />}
								{canDuplicate && storyId && <StoryDuplicateMenuItem storyId={storyId} />}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</header>

			{live?.lastRefreshFailure && (
				<StoryRefreshFailureBanner failure={live.lastRefreshFailure} isRetrying={live.isRefreshing} />
			)}
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
				<Button
					variant='outline'
					size='sm'
					onClick={versionControls.onRestore}
					className='gap-1.5 rounded-full'
				>
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
				{canRefresh && onRefresh && <StoryRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />}
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
					{isLive ? (isUpdating ? 'Updating...' : 'Live story settings') : 'Enable live mode'}
				</TooltipContent>
			</Tooltip>
			{isLive && cachedAt && <LiveStoryTimestamp cachedAt={cachedAt} />}
			{isLive && canRefresh && onRefresh && (
				<StoryRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} />
			)}
		</>
	);
}

function LiveStoryMenuItems({ live }: { live: LiveControls }) {
	const { isRefreshing = false, canRefresh = Boolean(live.onRefresh), onRefresh, onManageNotifications } = live;

	return (
		<>
			{onManageNotifications && (
				<DropdownMenuItem onSelect={onManageNotifications}>
					<Mail strokeWidth={2.25} />
					<span>Notifications</span>
				</DropdownMenuItem>
			)}
			{canRefresh && onRefresh && (
				<DropdownMenuItem onSelect={onRefresh} disabled={isRefreshing}>
					{isRefreshing ? (
						<Loader2 className='animate-spin' strokeWidth={2.25} />
					) : (
						<RefreshCw strokeWidth={2.25} />
					)}
					<span>{isRefreshing ? 'Refreshing…' : 'Refresh data'}</span>
				</DropdownMenuItem>
			)}
		</>
	);
}

/** Stays hoverable while refreshing (no `disabled`) so its tooltip can say the refresh is in progress. */
export function StoryRefreshButton({ isRefreshing, onRefresh }: { isRefreshing: boolean; onRefresh: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full aria-disabled:cursor-default'
					onClick={isRefreshing ? undefined : onRefresh}
					aria-disabled={isRefreshing}
					aria-label='Refresh data'
				>
					{isRefreshing ? (
						<Loader2 className='size-3 animate-spin' strokeWidth={2.25} />
					) : (
						<RefreshCw className='size-3' strokeWidth={2.25} />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{isRefreshing ? 'Story is refreshing' : 'Refresh data'}</TooltipContent>
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

export function StoryRefreshFailureBanner({
	failure,
	isRetrying = false,
}: {
	failure: StoryRefreshFailure;
	isRetrying?: boolean;
}) {
	const failedAt = new Date(failure.failedAt);
	const timeAgo = useTimeAgo(failedAt.getTime());

	return (
		<div
			role={isRetrying ? 'status' : 'alert'}
			className='flex items-start gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive md:px-6'
		>
			{isRetrying ? (
				<Loader2 className='mt-0.5 size-3.5 shrink-0 animate-spin' />
			) : (
				<CircleAlert className='mt-0.5 size-3.5 shrink-0' />
			)}
			<div className='min-w-0'>
				<span className='font-medium'>
					{isRetrying ? 'Retrying story refresh… Last attempt failed:' : 'Story refresh failed.'}
				</span>{' '}
				<span className='break-words'>{failure.errorMessage}</span>
				<span className='ml-1 opacity-70' title={failedAt.toLocaleString()}>
					{timeAgo.humanReadable}
				</span>
			</div>
		</div>
	);
}
