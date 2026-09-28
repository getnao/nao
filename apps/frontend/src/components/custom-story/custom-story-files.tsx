import { STORY_APP_ENTRY_CANDIDATES } from '@nao/shared/story-app';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { File, Lock, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';

import type { CustomStoryFileSummary } from '@/components/custom-story/custom-story-body';
import type { CustomStoryFileSource } from '@/components/custom-story/story-data-options';
import { fileOptions } from '@/components/custom-story/story-data-options';
import { buildStoryFileTree, findContentMatches } from '@/components/custom-story/story-file-tree';
import {
	isStoryKitPath,
	STORY_KIT_FILE_PATHS,
	storyKitFileQueryOptions,
} from '@/components/custom-story/story-kit-sources';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { FileSourceEditor } from '@/components/settings/file-source-editor';
import { FileTree } from '@/components/settings/file-tree';
import { ResizablePanel, ResizablePanelGroup, ResizableSeparator } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { trpc } from '@/main';

interface CustomStoryFilesProps {
	source: CustomStoryFileSource;
	versionNumber: number;
	files: CustomStoryFileSummary[];
	editable?: boolean;
}

const MIN_CONTENT_SEARCH_LENGTH = 2;

/** Explorer over the files of the viewed version; editable by the owner on the latest version. */
export function CustomStoryFiles({ source, versionNumber, files, editable = false }: CustomStoryFilesProps) {
	const [selectedPath, setSelectedPath] = useState<string | null>(() => defaultFilePath(files));
	const edits = useStoryFileEdits(source, versionNumber);
	const [search, setSearch] = useState('');
	const [isContentSearchEnabled, setIsContentSearchEnabled] = useState(false);
	const debouncedSearch = useDebouncedValue(search.trim(), 250);
	const entries = useMemo(
		() => buildStoryFileTree([...files.map((file) => file.path), ...STORY_KIT_FILE_PATHS], isStoryKitPath),
		[files],
	);
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'custom-story-files', storage: localStorage });

	const isKitFileSelected = isStoryKitPath(selectedPath);
	const selectedStoryFile = useQuery({
		...fileOptions(source, selectedPath ?? '', versionNumber),
		enabled: selectedPath !== null && !isKitFileSelected,
	});
	const selectedKitFile = useQuery({
		...storyKitFileQueryOptions(selectedPath ?? ''),
		enabled: isKitFileSelected,
	});
	const selectedFile = isKitFileSelected ? selectedKitFile : selectedStoryFile;
	const shouldSearchContent = isContentSearchEnabled && debouncedSearch.length >= MIN_CONTENT_SEARCH_LENGTH;
	const searchedFiles = useQueries({
		queries: [
			...files.map((file) => ({
				...fileOptions(source, file.path, versionNumber),
				enabled: shouldSearchContent,
			})),
			...STORY_KIT_FILE_PATHS.map((path) => ({
				...storyKitFileQueryOptions(path),
				enabled: shouldSearchContent,
			})),
		],
	});
	const isContentSearchPending = shouldSearchContent && searchedFiles.some((query) => query.isPending);
	const contentMatches = useMemo(() => {
		if (!shouldSearchContent) {
			return new Map();
		}
		const loaded = searchedFiles.flatMap((query) => (query.data ? [query.data] : []));
		return findContentMatches(loaded, debouncedSearch);
	}, [debouncedSearch, searchedFiles, shouldSearchContent]);

	return (
		<div className='flex h-full flex-col'>
			{edits.hasChanges || edits.buildErrors.length > 0 ? (
				<StoryFileEditBar edits={edits} canSave={editable} />
			) : null}
			<ResizablePanelGroup
				orientation='horizontal'
				className='min-h-0 flex-1'
				defaultLayout={defaultLayout ?? { tree: 1.2, viewer: 3 }}
				onLayoutChanged={onLayoutChanged}
			>
				<ResizablePanel id='tree' minSize={140}>
					<div className='h-full overflow-hidden bg-card'>
						<FileTree
							entries={entries}
							selectedPath={selectedPath}
							onSelectFile={setSelectedPath}
							search={search}
							onSearchChange={setSearch}
							isContentSearchEnabled={isContentSearchEnabled}
							onContentSearchEnabledChange={setIsContentSearchEnabled}
							contentMatches={contentMatches}
							isContentSearchPending={isContentSearchPending}
							contentSearchFailed={shouldSearchContent && searchedFiles.some((query) => query.isError)}
							contentSearchTruncated={false}
						/>
					</div>
				</ResizablePanel>
				<ResizableSeparator />
				<ResizablePanel id='viewer' minSize={220}>
					<div className='h-full bg-background'>
						<StoryFileContent
							path={selectedPath}
							file={selectedFile.data}
							isLoading={selectedFile.isLoading}
							error={selectedFile.error}
							searchQuery={shouldSearchContent ? debouncedSearch : ''}
							editable={editable && !isKitFileSelected && !edits.isSaving}
							draft={selectedPath ? edits.drafts[selectedPath] : undefined}
							onChange={edits.setDraft}
						/>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

interface StoryFileContentProps {
	path: string | null;
	file: (CustomStoryFileSummary & { content: string }) | undefined;
	isLoading: boolean;
	error: { message: string } | null;
	searchQuery: string;
	editable: boolean;
	draft: string | undefined;
	onChange: (path: string, content: string, original: string) => void;
}

function StoryFileContent({
	path,
	file,
	isLoading,
	error,
	searchQuery,
	editable,
	draft,
	onChange,
}: StoryFileContentProps) {
	if (!path) {
		return (
			<div className='flex h-full flex-col items-center justify-center gap-2 text-muted-foreground'>
				<File className='size-10 opacity-20' />
				<p className='text-sm'>Select a file to view its contents</p>
			</div>
		);
	}
	if (isLoading) {
		return (
			<div className='flex h-full items-center justify-center'>
				<Spinner />
			</div>
		);
	}
	if (error || !file) {
		return (
			<div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
				{error?.message ?? 'Failed to load file'}
			</div>
		);
	}

	const fileName = file.path.split('/').pop() ?? file.path;
	const isKitFile = isStoryKitPath(file.path);
	return (
		<div className='flex h-full flex-col'>
			<div className='flex shrink-0 items-start gap-2 border-b border-border bg-muted/30 px-4 py-1.5 text-sm text-muted-foreground'>
				<FileExplorerIcon name={fileName} type='file' />
				<div className='min-w-0 flex-1'>
					<div className='flex min-w-0 items-baseline gap-2'>
						<span className='min-w-0 truncate font-mono leading-4'>{fileName}</span>
						<span className='shrink-0 whitespace-nowrap text-xs tabular-nums'>
							{formatFileSize(file.size)}
						</span>
						{isKitFile && <ReadOnlyBadge />}
					</div>
					<span className='block truncate text-xs leading-4 opacity-60'>{file.path}</span>
				</div>
			</div>
			{isKitFile && (
				<p className='shrink-0 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground'>
					The story kit is shared by every custom story, so its files can't be edited here. To change how a
					block looks or behaves, ask the agent, or build your own component in the story's files.
				</p>
			)}
			<div className='min-h-0 flex-1'>
				<FileSourceEditor
					key={file.path}
					filePath={file.path}
					value={draft ?? file.content}
					searchQuery={searchQuery}
					readOnly={!editable}
					onChange={(content) => onChange(file.path, content, file.content)}
				/>
			</div>
		</div>
	);
}

function ReadOnlyBadge() {
	return (
		<span className='flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium'>
			<Lock className='size-2.5' />
			Read-only
		</span>
	);
}

function defaultFilePath(files: CustomStoryFileSummary[]): string | null {
	const paths = files.map((file) => file.path);
	return STORY_APP_ENTRY_CANDIDATES.find((candidate) => paths.includes(candidate)) ?? paths[0] ?? null;
}

function formatFileSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
}

type StoryFileEdits = ReturnType<typeof useStoryFileEdits>;

function useStoryFileEdits(source: CustomStoryFileSource, versionNumber: number) {
	const queryClient = useQueryClient();
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [buildErrors, setBuildErrors] = useState<string[]>([]);
	const saveMutation = useMutation(trpc.story.saveCustomStoryFiles.mutationOptions());

	const setDraft = (path: string, content: string, original: string) => {
		setDrafts((current) => {
			const next = { ...current };
			if (content === original) {
				delete next[path];
			} else {
				next[path] = content;
			}
			return next;
		});
	};

	const save = async () => {
		if (source.kind !== 'owner') {
			return;
		}
		const { chatId, storySlug } = source;
		const files = Object.entries(drafts).map(([path, content]) => ({ path, content }));
		const result = await saveMutation.mutateAsync({ chatId, storySlug, versionNumber, files });
		if (!result.success) {
			setBuildErrors(result.buildErrors);
			return;
		}
		setDrafts({});
		setBuildErrors([]);
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }) }),
			queryClient.invalidateQueries({ queryKey: trpc.story.getCustomVersion.queryKey({ chatId, storySlug }) }),
		]);
	};

	const discard = () => {
		setDrafts({});
		setBuildErrors([]);
		saveMutation.reset();
	};

	return {
		drafts,
		setDraft,
		save,
		discard,
		buildErrors,
		saveError: saveMutation.error,
		isSaving: saveMutation.isPending,
		hasChanges: Object.keys(drafts).length > 0,
		changedCount: Object.keys(drafts).length,
	};
}

/** Publishing builds the files first: a build error keeps the edits and shows where it failed, nothing is published. */
function StoryFileEditBar({ edits, canSave }: { edits: StoryFileEdits; canSave: boolean }) {
	return (
		<div className='shrink-0 border-b bg-muted/30 px-4 py-2 text-xs'>
			<div className='flex items-center gap-2'>
				<span className='flex min-w-0 flex-1 items-center gap-1.5 text-amber-600 dark:text-amber-400'>
					<span className='size-1.5 shrink-0 rounded-full bg-current' />
					{edits.changedCount} unsaved {edits.changedCount === 1 ? 'file' : 'files'}
				</span>
				<Button variant='ghost' size='sm' className='h-7' onClick={edits.discard} disabled={edits.isSaving}>
					Discard
				</Button>
				<Button
					variant='primary-gradient'
					size='sm'
					className='h-7 gap-1.5'
					onClick={() => void edits.save()}
					disabled={!canSave || !edits.hasChanges || edits.isSaving}
					isLoading={edits.isSaving}
				>
					<Save className='size-3.5' />
					Save & publish
				</Button>
			</div>
			{edits.saveError && <p className='mt-2 text-destructive'>{edits.saveError.message}</p>}
			{edits.buildErrors.length > 0 && (
				<div className='mt-2 flex flex-col gap-1'>
					<p className='font-medium text-destructive'>The story did not build, nothing was published:</p>
					<pre className='max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground'>
						{edits.buildErrors.join('\n\n')}
					</pre>
				</div>
			)}
		</div>
	);
}
