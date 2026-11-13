import { addContextFileHeader, updateContextFileHeader } from '@nao/shared/context-file-header';
import { isRootRulesPath, renderConditionalGroupBlocks } from '@nao/shared/rules-template';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, File, Lock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { Streamdown } from 'streamdown';
import type { ContextFileHeaderChanges } from '@nao/shared/context-file-header';
import type { UserRulesGroupAccess } from '@nao/shared/rules-template';
import type { FileEditabilityGuidance } from '@nao/shared/types';
import type { ReactNode } from 'react';

import type { UserGroupPickerOption } from '@/components/settings/user-group-picker';
import type { SegmentedControlOption } from '@/components/ui/segmented-control';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { FileHeaderEditor, FileHeaderSourceBar } from '@/components/settings/file-header-editor';
import { FileSourceEditor } from '@/components/settings/file-source-editor';
import { MarkdownFileEditor } from '@/components/settings/markdown-file-editor';
import { UserGroupPicker } from '@/components/settings/user-group-picker';
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
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useFileHeader } from '@/hooks/use-file-header';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { usePreviewHighlights } from '@/hooks/use-preview-highlights';
import { isMarkdownPath } from '@/lib/file-path';
import { createLocalStorage } from '@/lib/local-storage';
import { joinMarkdownFrontmatter, markdownPlugins, parseMarkdownFrontmatter } from '@/lib/markdown';
import { isForbiddenError } from '@/lib/trpc-error';
import { trpc } from '@/main';
import { markdownLinkSafety } from '@/components/external-link-dialog';

export { isRootRulesPath } from '@nao/shared/rules-template';

interface FileContents {
	content: string;
	hash: string;
}

export type RulesPreviewGroupsState =
	| { status: 'loading' }
	| { status: 'error' }
	| {
			status: 'ready';
			enforced: boolean;
			groups: UserGroupPickerOption[];
	  };

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
	/** Follows the content in the editor, saved or not. */
	onDraftChange?: (path: string, content: string) => void;
	onOpenGuidancePath: (path: string, kind: 'file' | 'route') => void;
	onReload: () => Promise<FileContents | undefined>;
	rulesPreviewGroups: RulesPreviewGroupsState;
}

interface FileSaveError {
	message: string;
	isConflict: boolean;
}

type MarkdownView = 'preview' | 'split' | 'source';

const MARKDOWN_VIEWS: SegmentedControlOption<MarkdownView>[] = [
	{ value: 'preview', label: 'Preview' },
	{ value: 'split', label: 'Split' },
	{ value: 'source', label: 'Source' },
];

const markdownViewStorage = createLocalStorage<MarkdownView>('nao-file-viewer-markdown-view', 'preview');

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
	onDraftChange,
	onOpenGuidancePath,
	onReload,
	rulesPreviewGroups,
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
			onDraftChange={onDraftChange}
			onOpenGuidancePath={onOpenGuidancePath}
			onReload={onReload}
			rulesPreviewGroups={rulesPreviewGroups}
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
	onDraftChange,
	onOpenGuidancePath,
	onReload,
	rulesPreviewGroups,
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
	| 'onDraftChange'
	| 'onOpenGuidancePath'
	| 'onReload'
	| 'rulesPreviewGroups'
> & {
	filePath: string;
	content: string;
	hash: string;
}) {
	const queryClient = useQueryClient();
	const [markdownViewPreference, setMarkdownViewPreference] = useLocalStorage(markdownViewStorage);
	const [isSourceAutoOpened, setIsSourceAutoOpened] = useState(sourceAutoOpenRequestId !== null);
	const [draft, setDraft] = useState(content);
	const [savedContent, setSavedContent] = useState(content);
	const [expectedHash, setExpectedHash] = useState(hash);
	const [saveError, setSaveError] = useState<FileSaveError | null>(null);
	const [isReloadDialogOpen, setIsReloadDialogOpen] = useState(false);
	const [isReloading, setIsReloading] = useState(false);
	const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
	const activePathRef = useRef(filePath);
	const saveInProgressRef = useRef(false);
	activePathRef.current = filePath;

	const saveMutation = useMutation(trpc.contextExplorer.writeFile.mutationOptions());
	const isMarkdown = isMarkdownPath(filePath);
	const isRootRules = isRootRulesPath(filePath);
	const markdownView = isSourceAutoOpened && markdownViewPreference === 'preview' ? 'split' : markdownViewPreference;
	const isDirty = isEditable && draft !== savedContent;
	const debouncedPreview = useDebouncedValue(draft, 250);
	const parsedMarkdownDraft = useMemo(() => parseMarkdownFrontmatter(draft), [draft]);
	const fileHeaderState = useFileHeader(filePath, draft, isMarkdown);
	const isPreviewEditable = useMemo(
		() => isEditable && isMarkdown && (!isRootRules || !hasRulesTemplate(draft)),
		[draft, isEditable, isMarkdown, isRootRules],
	);
	const rulesGroupAccess = useMemo(
		() => getRulesGroupAccess(isRootRules, rulesPreviewGroups, selectedGroupIds),
		[isRootRules, rulesPreviewGroups, selectedGroupIds],
	);
	const preview = useMemo(
		() => renderRulesPreview(debouncedPreview, isRootRules, rulesGroupAccess),
		[debouncedPreview, isRootRules, rulesGroupAccess],
	);
	const tokenPreview = useMemo(
		() => renderRulesPreview(draft, isRootRules, rulesGroupAccess),
		[draft, isRootRules, rulesGroupAccess],
	);
	const estimatedTokenCount = useMemo(() => Math.ceil(tokenPreview.content.length / 4), [tokenPreview.content]);
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
		onDraftChange?.(filePath, draft);
	}, [filePath, draft, onDraftChange]);

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
					void queryClient.invalidateQueries({
						queryKey: trpc.contextExplorer.getFileHeaderProblems.queryKey(),
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

	const handleMarkdownViewChange = (view: MarkdownView) => {
		setMarkdownViewPreference(view);
		setIsSourceAutoOpened(false);
	};

	const handleMarkdownChange = useCallback(
		(nextBody: string) => {
			setDraft(joinMarkdownFrontmatter(parsedMarkdownDraft.frontmatter, nextBody));
		},
		[parsedMarkdownDraft.frontmatter],
	);

	const handleHeaderChange = useCallback((changes: ContextFileHeaderChanges) => {
		setDraft((current) => updateContextFileHeader(current, changes));
	}, []);

	const showRulesPreviewToolbar = isRootRules && rulesPreviewGroups.status === 'ready' && rulesPreviewGroups.enforced;
	const rulesPreviewStatus =
		isRootRules && rulesPreviewGroups.status !== 'ready' ? rulesPreviewGroups.status : undefined;

	const fileHeader = fileHeaderState && (
		<FileHeaderEditor
			state={fileHeaderState}
			isEditable={isEditable}
			onChange={handleHeaderChange}
			onSave={handleSave}
		/>
	);
	const renderedMarkdown = (
		<MarkdownPreview
			content={preview.content}
			filePath={filePath}
			searchQuery={searchQuery}
			error={preview.error}
			status={rulesPreviewStatus}
			header={fileHeader}
		/>
	);
	const markdownPreview = isPreviewEditable ? (
		<MarkdownFileEditor
			value={parsedMarkdownDraft.body}
			filePath={filePath}
			searchQuery={searchQuery}
			onChange={handleMarkdownChange}
			onSave={handleSave}
			fallback={renderedMarkdown}
			header={fileHeader}
		/>
	) : (
		renderedMarkdown
	);
	const markdownSource = (
		<div className='flex h-full min-h-0 flex-col'>
			{fileHeaderState && (
				<FileHeaderSourceBar
					state={fileHeaderState}
					isEditable={isEditable}
					onAddHeader={() => setDraft((current) => addContextFileHeader(current, fileHeaderState.defaults))}
				/>
			)}
			<div className='min-h-0 flex-1'>
				<FileSourceEditor
					key={isEditable ? 'editable' : 'read-only'}
					filePath={filePath}
					value={draft}
					searchQuery={searchQuery}
					readOnly={!isEditable}
					onChange={setDraft}
					onSave={isEditable ? handleSave : undefined}
				/>
			</div>
		</div>
	);

	return (
		<div className='flex flex-col h-full'>
			<div className='flex h-8 shrink-0 items-center gap-2.5 border-b px-3 text-[11px] text-muted-foreground'>
				<FilePathBreadcrumb filePath={filePath} />
				{rulesPreviewStatus === undefined && <TokenEstimate count={estimatedTokenCount} />}
				{isMarkdown && parsedMarkdownDraft.label !== null && (
					<span className='shrink-0'>{parsedMarkdownDraft.label}</span>
				)}
				{isMarkdown && (
					<SegmentedControl
						label='Markdown view'
						options={MARKDOWN_VIEWS}
						value={markdownView}
						onChange={handleMarkdownViewChange}
					/>
				)}
				{!isEditable && (
					<span className='flex shrink-0 items-center gap-1.5'>
						<Lock className='size-3' />
						Read-only
					</span>
				)}
			</div>
			{showRulesPreviewToolbar && (
				<RulesPreviewToolbar
					groups={rulesPreviewGroups.groups}
					selectedGroupIds={selectedGroupIds}
					onSelectedGroupIdsChange={setSelectedGroupIds}
				/>
			)}
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
					markdownView === 'split' ? (
						<ResizablePanelGroup
							orientation='horizontal'
							defaultLayout={defaultLayout ?? { preview: 1, source: 1 }}
							onLayoutChanged={onLayoutChanged}
						>
							<ResizablePanel id='preview' minSize={180}>
								{markdownPreview}
							</ResizablePanel>
							<ResizableSeparator withHandle />
							<ResizablePanel id='source' minSize={180}>
								{markdownSource}
							</ResizablePanel>
						</ResizablePanelGroup>
					) : markdownView === 'source' ? (
						markdownSource
					) : (
						markdownPreview
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
	error,
	status,
	header,
}: {
	content: string;
	filePath: string;
	searchQuery: string;
	error?: string;
	status?: 'loading' | 'error';
	header?: ReactNode;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const parsedMarkdown = useMemo(() => parseMarkdownFrontmatter(content), [content]);
	usePreviewHighlights({ containerRef, content: parsedMarkdown.body, filePath, searchQuery });

	return (
		<section aria-label='Markdown preview' className='flex h-full min-h-0 flex-col'>
			<div ref={containerRef} className='min-h-0 flex-1 overflow-auto'>
				<div className='max-w-3xl mx-auto px-8 py-6'>
					{header}
					{status === 'loading' ? (
						<p className='text-sm text-muted-foreground'>Loading RULES.md preview access...</p>
					) : status === 'error' ? (
						<ErrorMessage message='Failed to load RULES.md preview access.' />
					) : error ? (
						<ErrorMessage message={error} />
					) : (
						<Streamdown
							linkSafety={markdownLinkSafety}
							mode='static'
							controls={false}
							plugins={markdownPlugins}
						>
							{parsedMarkdown.body}
						</Streamdown>
					)}
				</div>
			</div>
		</section>
	);
}

function RulesPreviewToolbar({
	groups,
	selectedGroupIds,
	onSelectedGroupIdsChange,
}: {
	groups: UserGroupPickerOption[];
	selectedGroupIds: string[];
	onSelectedGroupIdsChange: (groupIds: string[]) => void;
}) {
	return (
		<div
			role='toolbar'
			aria-label='Rules preview options'
			className='flex w-full shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-4 py-1'
		>
			<span className='shrink-0 text-xs font-medium text-muted-foreground'>Preview as</span>
			<UserGroupPicker
				groups={groups}
				selectedGroupIds={selectedGroupIds}
				compact
				onSelectedGroupIdsChange={onSelectedGroupIdsChange}
			/>
		</div>
	);
}

/** The path of the file as folders leading to it; folders shrink first when space runs out, so its name stays readable. */
function FilePathBreadcrumb({ filePath }: { filePath: string }) {
	const segments = filePath.replaceAll('\\', '/').split('/').filter(Boolean);
	const fileName = segments.pop() ?? filePath;

	return (
		<nav aria-label='File path' title={filePath} className='flex min-w-0 flex-1 items-center gap-1 text-xs'>
			<FileExplorerIcon name={fileName} type='file' path={filePath} className='mr-1 size-3 shrink-0' />
			{segments.map((segment, index) => (
				<span key={index} className='flex min-w-0 items-center gap-1'>
					<span className='min-w-[3ch] truncate'>{segment}</span>
					<ChevronRight className='size-3 shrink-0 opacity-60' />
				</span>
			))}
			<span className='shrink-0 text-foreground'>{fileName}</span>
		</nav>
	);
}

function TokenEstimate({ count }: { count: number }) {
	return (
		<SimpleTooltip content="Estimated tokens this file uses in the agent's context. It is approximated from the character count, not counted exactly.">
			<span className='shrink-0 whitespace-nowrap text-muted-foreground tabular-nums'>
				{formatTokenCount(count)} tokens
			</span>
		</SimpleTooltip>
	);
}

/** Whether RULES.md holds group conditions, even malformed ones, whose preview shows what a group sees rather than the file. */
function hasRulesTemplate(content: string): boolean {
	try {
		return renderConditionalGroupBlocks(content, { enforced: false }) !== content;
	} catch {
		return true;
	}
}

function getRulesGroupAccess(
	isRootRules: boolean,
	rulesPreviewGroups: FileViewerProps['rulesPreviewGroups'],
	selectedGroupIds: string[],
): UserRulesGroupAccess | null {
	if (!isRootRules) {
		return { enforced: false };
	}
	if (rulesPreviewGroups.status !== 'ready') {
		return null;
	}
	if (!rulesPreviewGroups.enforced) {
		return { enforced: false };
	}
	return {
		enforced: true,
		groupNames: rulesPreviewGroups.groups
			.filter((group) => group.isDefault || selectedGroupIds.includes(group.id))
			.map((group) => group.name),
	};
}

function renderRulesPreview(
	content: string,
	isRootRules: boolean,
	groupAccess: UserRulesGroupAccess | null,
): { content: string; error?: string } {
	if (!isRootRules) {
		return { content };
	}
	if (!groupAccess) {
		return { content: '' };
	}
	try {
		return { content: renderConditionalGroupBlocks(content, groupAccess) };
	} catch (error) {
		return {
			content: '',
			error: error instanceof Error ? error.message : 'RULES.md preview could not be rendered.',
		};
	}
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
