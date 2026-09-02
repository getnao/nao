import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Code, File, Loader2, Save } from 'lucide-react';
import { useDefaultLayout } from 'react-resizable-panels';
import { Streamdown } from 'streamdown';
import type { FileEditabilityGuidance } from '@nao/shared/types';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { FileSourceEditor } from '@/components/settings/file-source-editor';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { usePreviewHighlights } from '@/hooks/use-preview-highlights';
import { createLocalStorage } from '@/lib/local-storage';
import { joinMarkdownFrontmatter, markdownPlugins, parseMarkdownFrontmatter } from '@/lib/markdown';
import { isMac } from '@/lib/platform';
import { isForbiddenError } from '@/lib/trpc-error';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface FileContents {
	content: string;
	hash: string;
}

interface FileViewerProps {
	filePath: string | null;
	content: string | undefined;
	hash: string | undefined;
	isLoading: boolean;
	isError: boolean;
	isEditable: boolean;
	editabilityGuidance: FileEditabilityGuidance | null;
	searchQuery: string;
	sourceAutoOpenRequestId: number | null;
	onDirtyChange: (isDirty: boolean) => void;
	onOpenGuidancePath: (path: string, kind: 'file' | 'route') => void;
	onReload: () => Promise<FileContents | undefined>;
}

interface FileSaveError {
	message: string;
	isConflict: boolean;
}

const markdownSourceStorage = createLocalStorage<boolean>('nao-file-viewer-markdown-source-open', false);

export function FileViewer({
	filePath,
	content,
	hash,
	isLoading,
	isError,
	isEditable,
	editabilityGuidance,
	searchQuery,
	sourceAutoOpenRequestId,
	onDirtyChange,
	onOpenGuidancePath,
	onReload,
}: FileViewerProps) {
	if (!filePath) {
		return (
			<div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-2'>
				<File className='size-10 opacity-20' />
				<p className='text-sm'>Select a file to view its contents</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className='flex items-center justify-center h-full'>
				<Spinner />
			</div>
		);
	}

	if (isError || content === undefined || hash === undefined) {
		return (
			<div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-2'>
				<p className='text-sm'>Failed to load file</p>
			</div>
		);
	}

	return (
		<EditableFileViewer
			key={filePath}
			filePath={filePath}
			content={content}
			hash={hash}
			isEditable={isEditable}
			editabilityGuidance={editabilityGuidance}
			searchQuery={searchQuery}
			sourceAutoOpenRequestId={sourceAutoOpenRequestId}
			onDirtyChange={onDirtyChange}
			onOpenGuidancePath={onOpenGuidancePath}
			onReload={onReload}
		/>
	);
}

function EditableFileViewer({
	filePath,
	content,
	hash,
	isEditable,
	editabilityGuidance,
	searchQuery,
	sourceAutoOpenRequestId,
	onDirtyChange,
	onOpenGuidancePath,
	onReload,
}: Pick<
	FileViewerProps,
	| 'filePath'
	| 'content'
	| 'hash'
	| 'isEditable'
	| 'editabilityGuidance'
	| 'searchQuery'
	| 'sourceAutoOpenRequestId'
	| 'onDirtyChange'
	| 'onOpenGuidancePath'
	| 'onReload'
> & {
	filePath: string;
	content: string;
	hash: string;
}) {
	const queryClient = useQueryClient();
	const [isSourceOpenPreference, setIsSourceOpenPreference] = useLocalStorage(markdownSourceStorage);
	const [isSourceAutoOpened, setIsSourceAutoOpened] = useState(sourceAutoOpenRequestId !== null);
	const [draft, setDraft] = useState(content);
	const [savedContent, setSavedContent] = useState(content);
	const [expectedHash, setExpectedHash] = useState(hash);
	const [saveError, setSaveError] = useState<FileSaveError | null>(null);
	const [isReloadDialogOpen, setIsReloadDialogOpen] = useState(false);
	const [isReloading, setIsReloading] = useState(false);
	const activePathRef = useRef(filePath);
	const saveInProgressRef = useRef(false);
	activePathRef.current = filePath;

	const saveMutation = useMutation(trpc.contextExplorer.writeFile.mutationOptions());
	const isMarkdown = isMarkdownPath(filePath);
	const isSourceOpen = isSourceOpenPreference || isSourceAutoOpened;
	const isDirty = isEditable && draft !== savedContent;
	const debouncedPreview = useDebouncedValue(draft, 250);
	const parsedMarkdownDraft = useMemo(() => parseMarkdownFrontmatter(draft), [draft]);
	const estimatedTokenCount = useMemo(() => Math.ceil(draft.length / 4), [draft]);
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: 'context-explorer-source',
		storage: localStorage,
	});

	useEffect(() => {
		if (isDirty) {
			return;
		}
		setDraft(content);
		setSavedContent(content);
		setExpectedHash(hash);
		setSaveError(null);
	}, [content, hash, isDirty]);

	useEffect(() => {
		if (sourceAutoOpenRequestId !== null) {
			setIsSourceAutoOpened(true);
		}
	}, [sourceAutoOpenRequestId]);

	useEffect(() => {
		if (searchQuery.length < 2) {
			setIsSourceAutoOpened(false);
		}
	}, [searchQuery]);

	useEffect(() => {
		onDirtyChange(isDirty);
		return () => {
			if (isDirty) {
				onDirtyChange(false);
			}
		};
	}, [isDirty, onDirtyChange]);

	const handleSave = useCallback(() => {
		if (!isEditable || !isDirty || saveMutation.isPending || saveInProgressRef.current) {
			return;
		}

		const pathToSave = filePath;
		const contentToSave = draft;
		saveInProgressRef.current = true;
		setSaveError(null);
		saveMutation.mutate(
			{ path: pathToSave, content: contentToSave, expectedHash },
			{
				onSuccess: (result) => {
					saveInProgressRef.current = false;
					queryClient.setQueryData(
						trpc.contextExplorer.readFile.queryOptions({ path: pathToSave }).queryKey,
						(previous) =>
							previous ? { ...previous, content: contentToSave, hash: result.hash } : previous,
					);
					if (activePathRef.current === pathToSave) {
						setSavedContent(contentToSave);
						setExpectedHash(result.hash);
						setSaveError(null);
					}
					void queryClient.invalidateQueries({
						queryKey: trpc.contextExplorer.getChangedFiles.queryKey(),
					});
				},
				onError: (error) => {
					saveInProgressRef.current = false;
					if (isForbiddenError(error)) {
						void queryClient.invalidateQueries({
							queryKey: trpc.contextExplorer.readFile.queryOptions({ path: pathToSave }).queryKey,
						});
						return;
					}
					if (activePathRef.current === pathToSave) {
						setSaveError({
							message: getErrorMessage(error, 'Failed to save file'),
							isConflict: isConflictError(error),
						});
					}
				},
			},
		);
	}, [draft, expectedHash, filePath, isDirty, isEditable, queryClient, saveMutation]);

	const handleReload = useCallback(async () => {
		setIsReloading(true);
		try {
			const reloadedFile = await onReload();
			if (!reloadedFile) {
				throw new Error('Failed to reload file');
			}
			setDraft(reloadedFile.content);
			setSavedContent(reloadedFile.content);
			setExpectedHash(reloadedFile.hash);
			setSaveError(null);
			setIsReloadDialogOpen(false);
		} catch (error) {
			setSaveError({
				message: getErrorMessage(error, 'Failed to reload file'),
				isConflict: true,
			});
			setIsReloadDialogOpen(false);
		} finally {
			setIsReloading(false);
		}
	}, [onReload]);

	const handleSourceToggle = () => {
		setIsSourceOpenPreference(!isSourceOpen);
		setIsSourceAutoOpened(false);
	};

	const handleMarkdownChange = useCallback(
		(nextBody: string) => {
			setDraft(joinMarkdownFrontmatter(parsedMarkdownDraft.frontmatter, nextBody));
		},
		[parsedMarkdownDraft.frontmatter],
	);

	const fileName = getFileName(filePath);

	return (
		<div className='flex flex-col h-full'>
			<div className='flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 py-1 text-sm text-muted-foreground'>
				<div className='flex min-w-0 flex-1 items-start gap-2 overflow-hidden'>
					<FileExplorerIcon name={fileName} type='file' className='mt-px' />
					<div className='min-w-0 flex-1'>
						<div className='flex min-w-0 items-center gap-2'>
							<span className='min-w-0 truncate font-mono leading-4'>{fileName}</span>
							<TokenEstimate count={estimatedTokenCount} />
						</div>
						<span className='block truncate text-xs leading-4 opacity-60'>{filePath}</span>
					</div>
				</div>
				{(isEditable || isMarkdown) && (
					<div className='flex shrink-0 items-center gap-2'>
						{isEditable && isDirty && (
							<span className='flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400'>
								<span className='size-1.5 rounded-full bg-current' />
								Unsaved
							</span>
						)}
						{isMarkdown && parsedMarkdownDraft.label !== null && (
							<span className='shrink-0 text-xs text-muted-foreground'>{parsedMarkdownDraft.label}</span>
						)}
						{isMarkdown && <SourceToggle isOpen={isSourceOpen} onChange={handleSourceToggle} />}
						{isEditable && (
							<Button
								type='button'
								size='sm'
								className='h-7 gap-1.5'
								onClick={handleSave}
								disabled={!isDirty || saveMutation.isPending}
							>
								{saveMutation.isPending ? (
									<Loader2 className='size-3.5 animate-spin' />
								) : (
									<Save className='size-3.5' />
								)}
								Save
								<kbd className='font-sans text-[10px] opacity-60'>{isMac ? '⌘S' : 'Ctrl+S'}</kbd>
							</Button>
						)}
					</div>
				)}
			</div>
			{!isEditable && editabilityGuidance && (
				<ReadOnlyNote guidance={editabilityGuidance} onOpenPath={onOpenGuidancePath} />
			)}
			{isEditable && saveError && (
				<div className='flex shrink-0 items-center gap-2 border-b px-3 py-2'>
					<div className='min-w-0 flex-1'>
						<ErrorMessage message={saveError.message} />
					</div>
					{saveError.isConflict && (
						<Button type='button' variant='outline' size='sm' onClick={() => setIsReloadDialogOpen(true)}>
							Reload file
						</Button>
					)}
				</div>
			)}
			<div className='flex-1 min-h-0'>
				{isMarkdown ? (
					isSourceOpen ? (
						<ResizablePanelGroup
							orientation='horizontal'
							defaultLayout={defaultLayout ?? { preview: 1, source: 1 }}
							onLayoutChanged={onLayoutChanged}
						>
							<ResizablePanel id='preview' minSize={180}>
								<MarkdownPreview
									content={debouncedPreview}
									filePath={filePath}
									searchQuery={searchQuery}
								/>
							</ResizablePanel>
							<ResizableSeparator withHandle />
							<ResizablePanel id='source' minSize={180}>
								<FileSourceEditor
									key={isEditable ? 'editable' : 'read-only'}
									filePath={filePath}
									value={parsedMarkdownDraft.body}
									searchQuery={searchQuery}
									readOnly={!isEditable}
									onChange={handleMarkdownChange}
									onSave={isEditable ? handleSave : undefined}
								/>
							</ResizablePanel>
						</ResizablePanelGroup>
					) : (
						<MarkdownPreview content={debouncedPreview} filePath={filePath} searchQuery={searchQuery} />
					)
				) : (
					<FileSourceEditor
						key={isEditable ? 'editable' : 'read-only'}
						filePath={filePath}
						value={draft}
						searchQuery={searchQuery}
						readOnly={!isEditable}
						onChange={setDraft}
						onSave={isEditable ? handleSave : undefined}
					/>
				)}
			</div>
			<AlertDialog open={isReloadDialogOpen} onOpenChange={setIsReloadDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Reload this file?</AlertDialogTitle>
						<AlertDialogDescription>
							The file changed on disk. Reloading it will discard your unsaved changes.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isReloading}>Keep editing</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							isLoading={isReloading}
							disabled={isReloading}
							onClick={(event) => {
								event.preventDefault();
								void handleReload();
							}}
						>
							Discard and reload
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function ReadOnlyNote({
	guidance,
	onOpenPath,
}: {
	guidance: FileEditabilityGuidance;
	onOpenPath: (path: string, kind: 'file' | 'route') => void;
}) {
	const handleOpenPath = () => {
		if (guidance.actionPath) {
			onOpenPath(guidance.actionPath, guidance.actionKind);
		}
	};

	return (
		<div className='shrink-0 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground'>
			<span>{guidance.message}</span>
			{guidance.actionPath && (
				<button
					type='button'
					role='link'
					className='ml-1 text-primary underline-offset-4 hover:underline'
					onClick={handleOpenPath}
				>
					{guidance.actionLabel ?? 'Open file'}
				</button>
			)}
		</div>
	);
}

function MarkdownPreview({
	content,
	filePath,
	searchQuery,
}: {
	content: string;
	filePath: string;
	searchQuery: string;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const parsedMarkdown = useMemo(() => parseMarkdownFrontmatter(content), [content]);
	usePreviewHighlights({ containerRef, content: parsedMarkdown.body, filePath, searchQuery });

	return (
		<div ref={containerRef} className='h-full overflow-auto'>
			<div className='max-w-3xl mx-auto px-8 py-6'>
				<Streamdown mode='static' controls={false} plugins={markdownPlugins}>
					{parsedMarkdown.body}
				</Streamdown>
			</div>
		</div>
	);
}

function SourceToggle({ isOpen, onChange }: { isOpen: boolean; onChange: () => void }) {
	return (
		<SimpleTooltip content={isOpen ? 'Hide markdown source' : 'Show markdown source'}>
			<Button
				type='button'
				variant='outline'
				size='sm'
				className={cn('h-7 gap-1.5', isOpen && 'bg-accent text-accent-foreground dark:bg-accent/50')}
				onClick={onChange}
				aria-pressed={isOpen}
				aria-label={isOpen ? 'Hide markdown source' : 'Show markdown source'}
			>
				<Code className='size-3.5' />
				Source
			</Button>
		</SimpleTooltip>
	);
}

function TokenEstimate({ count }: { count: number }) {
	return (
		<SimpleTooltip content="Estimated tokens this file uses in the agent's context. It is approximated from the character count, not counted exactly.">
			<span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums'>
				{formatTokenCount(count)} tokens
			</span>
		</SimpleTooltip>
	);
}

function isMarkdownPath(filePath: string): boolean {
	const extension = filePath.split('.').pop()?.toLowerCase();
	return extension === 'md' || extension === 'mdx' || extension === 'markdown';
}

function getFileName(filePath: string): string {
	return filePath.split('/').pop() ?? filePath;
}

function formatTokenCount(count: number): string {
	if (count < 1_000) {
		return count.toLocaleString();
	}
	if (count < 1_000_000) {
		const thousands = Math.min(count / 1_000, 999.9);
		return `${thousands.toFixed(1).replace(/\.0$/, '')}k`;
	}
	return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return fallback;
}

function isConflictError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const trpcError = error as {
		data?: { code?: string };
		shape?: { data?: { code?: string } };
		message?: string;
	};
	return (
		trpcError.data?.code === 'CONFLICT' ||
		trpcError.shape?.data?.code === 'CONFLICT' ||
		trpcError.message === 'This file changed on disk. Reload it before saving your changes.'
	);
}
