import { AlertTriangle } from 'lucide-react';
import { DEFAULT_STORY_THEME_PAIR } from '@nao/shared/story-theme';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { StoryBlockEditPayload, StoryTableFormatEditRequest } from '@nao/shared/story-app';
import type { StoryTheme, StoryThemePair } from '@nao/shared/story-theme';
import type { StoryBlockReference } from '@nao/shared/types';

import type { CustomStoryRuntimeError } from '@/components/custom-story/custom-story-frame';
import type { CustomStoryDataSource } from '@/components/custom-story/story-data-options';
import { CustomStoryFrame } from '@/components/custom-story/custom-story-frame';
import NaoLogoAnimated from '@/components/icons/nao-logo-animated';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsDarkMode } from '@/contexts/theme.provider';

export type CustomStoryContent = inferRouterOutputs<TrpcRouter>['story']['getCustomVersion'];
export type CustomStoryFileSummary = CustomStoryContent['files'][number];

interface CustomStoryBodyProps {
	dataSource: CustomStoryDataSource;
	content: CustomStoryContent | undefined;
	isLoading: boolean;
	error: { message: string } | null;
	hasPublishedVersion: boolean;
	editable?: boolean;
	onEditBlock?: (payload: StoryBlockEditPayload) => void;
	onEditTableFormat?: (request: StoryTableFormatEditRequest) => void;
	onAskBlock?: (block: StoryBlockReference) => void;
}

const MAX_RUNTIME_ERRORS = 5;
const RUNTIME_ERROR_FLUSH_MS = 500;
const BUILDING_MESSAGE_INTERVAL_MS = 2500;
const BUILDING_MESSAGES = [
	'Story is building...',
	'Assembling your story...',
	'Crunching the numbers...',
	'Drawing the charts...',
	'Polishing the insights...',
	'Laying out the pages...',
	'Connecting the dots...',
	'Shaping the narrative...',
	'Almost there...',
	'Bringing your data to life...',
];

export function CustomStoryBody({
	dataSource,
	content,
	isLoading,
	error,
	hasPublishedVersion,
	editable = false,
	onEditBlock,
	onEditTableFormat,
	onAskBlock,
}: CustomStoryBodyProps) {
	const { runtimeErrors, runtimeErrorCount, handleRuntimeError } = useRuntimeErrors(content?.version.id);
	const styles = useMemo(() => content?.styles.map((style) => style.content) ?? [], [content?.styles]);
	const theme = useActiveStoryTheme(content?.theme);

	return (
		<>
			{runtimeErrors.length > 0 && <RuntimeErrorBanner errors={runtimeErrors} count={runtimeErrorCount} />}
			<div className='min-h-0 flex-1'>
				{isLoading || !hasPublishedVersion ? (
					<StoryBuilding />
				) : error ? (
					<Centered>{error.message}</Centered>
				) : content?.bundle ? (
					<CustomStoryFrame
						key={`${content.version.id}:${String(content.cachedAt)}`}
						dataSource={dataSource}
						bundle={content.bundle}
						styles={styles}
						theme={theme}
						editable={editable}
						onEditBlock={onEditBlock}
						onEditTableFormat={onEditTableFormat}
						onAskBlock={onAskBlock}
						onError={handleRuntimeError}
					/>
				) : (
					<BuildFailure message={content?.bundleError ?? 'This version has no build output.'} />
				)}
			</div>
		</>
	);
}

export function useActiveStoryTheme(pair: StoryThemePair | null | undefined): StoryTheme {
	const isDarkMode = useIsDarkMode();
	return (pair ?? DEFAULT_STORY_THEME_PAIR)[isDarkMode ? 'dark' : 'light'];
}

export function ActionErrorBanner({ message }: { message: string }) {
	return (
		<div className='border-b bg-red-500/5 px-4 py-2 text-xs text-red-600 dark:text-red-400' role='alert'>
			{message}
		</div>
	);
}

/** A story stuck in a throwing render loop reports errors non-stop: they are batched so the host re-renders at most twice a second. */
function useRuntimeErrors(versionId: string | undefined) {
	const [runtimeErrors, setRuntimeErrors] = useState<CustomStoryRuntimeError[]>([]);
	const [runtimeErrorCount, setRuntimeErrorCount] = useState(0);
	const queuedRef = useRef<CustomStoryRuntimeError[]>([]);
	const flushTimerRef = useRef<number | null>(null);

	useEffect(() => {
		queuedRef.current = [];
		setRuntimeErrors([]);
		setRuntimeErrorCount(0);
	}, [versionId]);

	useEffect(
		() => () => {
			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
			}
		},
		[],
	);

	const handleRuntimeError = useCallback((error: CustomStoryRuntimeError) => {
		queuedRef.current.push(error);
		if (flushTimerRef.current !== null) {
			return;
		}
		flushTimerRef.current = window.setTimeout(() => {
			const queued = queuedRef.current;
			queuedRef.current = [];
			flushTimerRef.current = null;
			setRuntimeErrors((current) => [...current, ...queued].slice(-MAX_RUNTIME_ERRORS));
			setRuntimeErrorCount((current) => current + queued.length);
		}, RUNTIME_ERROR_FLUSH_MS);
	}, []);

	return { runtimeErrors, runtimeErrorCount, handleRuntimeError };
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

function StoryBuilding() {
	const message = useCyclingMessage(BUILDING_MESSAGES, BUILDING_MESSAGE_INTERVAL_MS);
	return (
		<Centered>
			<div className='flex items-baseline justify-center gap-6'>
				<NaoLogoAnimated height={16} width={28} durationSeconds={2.2} title='' />
				<span className='font-medium text-foreground'>{message}</span>
			</div>
		</Centered>
	);
}

function useCyclingMessage(messages: string[], intervalMs: number) {
	const [index, setIndex] = useState(0);

	useEffect(() => {
		const timer = window.setInterval(() => {
			setIndex((current) => (current + 1) % messages.length);
		}, intervalMs);
		return () => {
			window.clearInterval(timer);
		};
	}, [messages, intervalMs]);

	return messages[index];
}

function Centered({ children }: { children: React.ReactNode }) {
	return <div className='flex h-full items-center justify-center p-6 text-sm text-muted-foreground'>{children}</div>;
}
