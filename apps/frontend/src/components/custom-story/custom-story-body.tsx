import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { AlertTriangle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';
import type { StoryBlockEditPayload } from '@nao/shared/story-app';
import type { StoryBlockReference } from '@nao/shared/types';

import type { CustomStoryRuntimeError } from '@/components/custom-story/custom-story-frame';
import type { CustomStoryDataSource } from '@/components/custom-story/story-data-options';
import { CustomStoryFrame } from '@/components/custom-story/custom-story-frame';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
	onAskBlock?: (block: StoryBlockReference) => void;
}

const MAX_RUNTIME_ERRORS = 5;

export function CustomStoryBody({
	dataSource,
	content,
	isLoading,
	error,
	hasPublishedVersion,
	editable = false,
	onEditBlock,
	onAskBlock,
}: CustomStoryBodyProps) {
	const { runtimeErrors, runtimeErrorCount, handleRuntimeError } = useRuntimeErrors(content?.version.id);
	const styles = useMemo(() => content?.styles.map((style) => style.content) ?? [], [content?.styles]);

	return (
		<>
			{runtimeErrors.length > 0 && <RuntimeErrorBanner errors={runtimeErrors} count={runtimeErrorCount} />}
			<div className='min-h-0 flex-1'>
				{isLoading ? (
					<Centered>
						<Spinner />
					</Centered>
				) : !hasPublishedVersion ? (
					<Centered>This story has no published version yet.</Centered>
				) : error ? (
					<Centered>{error.message}</Centered>
				) : content?.bundle ? (
					<CustomStoryFrame
						key={`${content.version.id}:${String(content.cachedAt)}`}
						dataSource={dataSource}
						bundle={content.bundle}
						styles={styles}
						theme={content.theme ?? DEFAULT_STORY_THEME}
						editable={editable}
						onEditBlock={onEditBlock}
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

export function ActionErrorBanner({ message }: { message: string }) {
	return (
		<div className='border-b bg-red-500/5 px-4 py-2 text-xs text-red-600 dark:text-red-400' role='alert'>
			{message}
		</div>
	);
}

function useRuntimeErrors(versionId: string | undefined) {
	const [runtimeErrors, setRuntimeErrors] = useState<CustomStoryRuntimeError[]>([]);
	const [runtimeErrorCount, setRuntimeErrorCount] = useState(0);

	useEffect(() => {
		setRuntimeErrors([]);
		setRuntimeErrorCount(0);
	}, [versionId]);

	const handleRuntimeError = useCallback((error: CustomStoryRuntimeError) => {
		setRuntimeErrors((current) => [...current, error].slice(-MAX_RUNTIME_ERRORS));
		setRuntimeErrorCount((current) => current + 1);
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

function Centered({ children }: { children: React.ReactNode }) {
	return <div className='flex h-full items-center justify-center p-6 text-sm text-muted-foreground'>{children}</div>;
}
