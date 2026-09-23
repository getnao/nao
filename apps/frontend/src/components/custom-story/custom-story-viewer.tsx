import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoryBlockEditPayload } from '@nao/shared/story-app';

import type { CustomStoryRuntimeError } from '@/components/custom-story/custom-story-frame';
import type { StoryBlockEditTarget } from '@/stores/story-block-edit';
import { CustomStoryBlockEditDialog } from '@/components/custom-story/custom-story-block-edit';
import { CustomStoryFrame } from '@/components/custom-story/custom-story-frame';
import { ArchivedBanner } from '@/components/side-panel/story-archived-banner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { trpc } from '@/main';
import { storyBlockEditStore } from '@/stores/story-block-edit';

interface CustomStoryViewerProps {
	chatId: string;
	storySlug: string;
}

const MAX_RUNTIME_ERRORS = 5;

export function CustomStoryViewer({ chatId, storySlug }: CustomStoryViewerProps) {
	const { close, setCurrentStorySlug, isVisible } = useSidePanel();
	/** No close affordance in the standalone preview page — `isVisible` is only true inside a real side panel. */
	const showClose = isVisible;
	const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
	const [runtimeErrors, setRuntimeErrors] = useState<CustomStoryRuntimeError[]>([]);
	const [runtimeErrorCount, setRuntimeErrorCount] = useState(0);
	const [dialogTarget, setDialogTarget] = useState<StoryBlockEditTarget | null>(null);
	const isAgentRunning = useChatActivity(chatId).running;

	const versionsQuery = useQuery(trpc.story.listVersions.queryOptions({ chatId, storySlug }));
	const versionNumbers = useMemo(
		() => (versionsQuery.data?.versions ?? []).map((version) => version.version).sort((a, b) => a - b),
		[versionsQuery.data?.versions],
	);
	const latestVersion = versionNumbers.at(-1) ?? null;
	const viewedVersion = selectedVersion ?? latestVersion;
	const isViewingLatest = viewedVersion === latestVersion;

	const contentQuery = useQuery({
		...trpc.story.getCustomVersion.queryOptions({ chatId, storySlug, versionNumber: viewedVersion ?? undefined }),
		enabled: viewedVersion !== null,
	});
	const content = contentQuery.data;
	const styles = useMemo(() => content?.styles.map((style) => style.content) ?? [], [content?.styles]);

	const canEditBlocks = isViewingLatest && !isAgentRunning;

	const handleEditBlock = useCallback(
		(payload: StoryBlockEditPayload) => {
			if (!content) {
				return;
			}
			const target = { chatId, storySlug, versionNumber: content.version.number, payload };
			setSelectedVersion(null);
			if (isVisible) {
				storyBlockEditStore.open(target);
			} else {
				setDialogTarget(target);
			}
		},
		[chatId, content, isVisible, storySlug],
	);

	useRefreshWhenAgentStops(chatId, storySlug, isAgentRunning);
	useEffect(() => {
		if (!canEditBlocks) {
			setDialogTarget(null);
		}
	}, [canEditBlocks]);
	useEffect(() => {
		setCurrentStorySlug(storySlug);
	}, [setCurrentStorySlug, storySlug]);
	useEffect(() => {
		setRuntimeErrors([]);
		setRuntimeErrorCount(0);
	}, [content?.version.id]);

	const handleRuntimeError = useCallback((error: CustomStoryRuntimeError) => {
		setRuntimeErrors((current) => [...current, error].slice(-MAX_RUNTIME_ERRORS));
		setRuntimeErrorCount((current) => current + 1);
	}, []);
	const step = (delta: number) => {
		if (viewedVersion === null) {
			return;
		}
		const index = versionNumbers.indexOf(viewedVersion) + delta;
		setSelectedVersion(versionNumbers[index] ?? viewedVersion);
	};

	return (
		<div className='flex h-full w-full min-w-0 flex-1 flex-col'>
			<div className='flex shrink-0 items-center gap-2 border-b px-4 py-2' data-selection-ignore>
				{showClose && (
					<Button
						variant='ghost'
						size='icon-sm'
						className='hover:rounded-full'
						onClick={close}
						aria-label='Close'
					>
						<X className='size-3.5' strokeWidth={2.25} />
					</Button>
				)}
				<div className='min-w-0 flex-1'>
					<div className='truncate text-sm font-semibold' title={content?.title ?? versionsQuery.data?.title}>
						{content?.title ?? versionsQuery.data?.title ?? storySlug}
					</div>
				</div>
				{viewedVersion !== null && (
					<VersionStepper
						current={viewedVersion}
						total={versionNumbers.length}
						isFirst={versionNumbers[0] === viewedVersion}
						isLast={isViewingLatest}
						onPrevious={() => step(-1)}
						onNext={() => step(1)}
					/>
				)}
			</div>

			{Boolean(content?.archivedAt) && <ArchivedBanner chatId={chatId} storySlug={storySlug} />}
			{runtimeErrors.length > 0 && <RuntimeErrorBanner errors={runtimeErrors} count={runtimeErrorCount} />}

			<div className='min-h-0 flex-1'>
				{versionsQuery.isLoading || (latestVersion !== null && contentQuery.isLoading) ? (
					<Centered>
						<Spinner />
					</Centered>
				) : latestVersion === null ? (
					<Centered>This story has no published version yet.</Centered>
				) : contentQuery.error ? (
					<Centered>{contentQuery.error.message}</Centered>
				) : content?.bundle ? (
					<CustomStoryFrame
						key={content.version.id}
						chatId={chatId}
						bundle={content.bundle}
						styles={styles}
						theme={content.theme ?? DEFAULT_STORY_THEME}
						editable={canEditBlocks}
						onEditBlock={handleEditBlock}
						onError={handleRuntimeError}
					/>
				) : (
					<BuildFailure message={content?.bundleError ?? 'This version has no build output.'} />
				)}
			</div>

			<CustomStoryBlockEditDialog
				target={canEditBlocks ? dialogTarget : null}
				onClose={() => setDialogTarget(null)}
			/>
		</div>
	);
}

function useRefreshWhenAgentStops(chatId: string, storySlug: string, isRunning: boolean) {
	const queryClient = useQueryClient();
	const wasRunning = useRef(isRunning);
	useEffect(() => {
		if (wasRunning.current && !isRunning) {
			void queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }) });
		}
		wasRunning.current = isRunning;
	}, [chatId, isRunning, queryClient, storySlug]);
}

interface VersionStepperProps {
	current: number;
	total: number;
	isFirst: boolean;
	isLast: boolean;
	onPrevious: () => void;
	onNext: () => void;
}

function VersionStepper({ current, total, isFirst, isLast, onPrevious, onNext }: VersionStepperProps) {
	return (
		<div className='flex items-center gap-0.5 text-xs text-muted-foreground'>
			<Button
				variant='ghost'
				size='icon-xs'
				onClick={onPrevious}
				disabled={isFirst}
				aria-label='Previous version'
			>
				<ChevronLeft />
			</Button>
			<span className='tabular-nums'>
				v{current}
				{total > 1 && <span className='opacity-60'> / {total}</span>}
			</span>
			<Button variant='ghost' size='icon-xs' onClick={onNext} disabled={isLast} aria-label='Next version'>
				<ChevronRight />
			</Button>
		</div>
	);
}

function RuntimeErrorBanner({ errors, count }: { errors: CustomStoryRuntimeError[]; count: number }) {
	const latest = errors[errors.length - 1];
	return (
		<div className='flex items-start gap-2 border-b bg-red-500/5 px-4 py-2 text-xs text-red-600 dark:text-red-400'>
			<AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
			<Tooltip>
				<TooltipTrigger asChild>
					<span className='min-w-0 flex-1 truncate'>
						{count > 1 && <span className='mr-1 font-medium'>{count} errors ·</span>}
						{latest.message}
					</span>
				</TooltipTrigger>
				<TooltipContent className='max-w-md whitespace-pre-wrap font-mono text-[11px]'>
					{latest.stack ?? latest.message}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

function BuildFailure({ message }: { message: string }) {
	return (
		<div className='flex h-full flex-col gap-3 overflow-auto p-6 text-sm'>
			<div className='flex items-center gap-2 font-medium text-red-600 dark:text-red-400'>
				<AlertTriangle className='size-4' />
				This version did not build
			</div>
			<pre className='whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground'>
				{message}
			</pre>
		</div>
	);
}

function Centered({ children }: { children: React.ReactNode }) {
	return <div className='flex h-full items-center justify-center p-6 text-sm text-muted-foreground'>{children}</div>;
}
