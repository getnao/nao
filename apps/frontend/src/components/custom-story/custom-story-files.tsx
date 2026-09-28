import { STORY_APP_ENTRY_CANDIDATES } from '@nao/shared/story-app';
import { useQueries, useQuery } from '@tanstack/react-query';
import { File } from 'lucide-react';
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
import { Spinner } from '@/components/ui/spinner';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

interface CustomStoryFilesProps {
	source: CustomStoryFileSource;
	versionNumber: number;
	files: CustomStoryFileSummary[];
}

const MIN_CONTENT_SEARCH_LENGTH = 2;

/** Read-only explorer over the files of the viewed version */
export function CustomStoryFiles({ source, versionNumber, files }: CustomStoryFilesProps) {
	const [selectedPath, setSelectedPath] = useState<string | null>(() => defaultFilePath(files));
	const [search, setSearch] = useState('');
	const [isContentSearchEnabled, setIsContentSearchEnabled] = useState(false);
	const debouncedSearch = useDebouncedValue(search.trim(), 250);
	const entries = useMemo(
		() => buildStoryFileTree([...files.map((file) => file.path), ...STORY_KIT_FILE_PATHS]),
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
		<ResizablePanelGroup
			orientation='horizontal'
			className='h-full'
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
					/>
				</div>
			</ResizablePanel>
		</ResizablePanelGroup>
	);
}

interface StoryFileContentProps {
	path: string | null;
	file: (CustomStoryFileSummary & { content: string }) | undefined;
	isLoading: boolean;
	error: { message: string } | null;
	searchQuery: string;
}

function StoryFileContent({ path, file, isLoading, error, searchQuery }: StoryFileContentProps) {
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
					</div>
					<span className='block truncate text-xs leading-4 opacity-60'>{file.path}</span>
				</div>
			</div>
			<div className='min-h-0 flex-1'>
				<FileSourceEditor
					key={file.path}
					filePath={file.path}
					value={file.content}
					searchQuery={searchQuery}
					readOnly
					onChange={ignoreChange}
				/>
			</div>
		</div>
	);
}

function defaultFilePath(files: CustomStoryFileSummary[]): string | null {
	const paths = files.map((file) => file.path);
	return STORY_APP_ENTRY_CANDIDATES.find((candidate) => paths.includes(candidate)) ?? paths[0] ?? null;
}

function formatFileSize(bytes: number): string {
	return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
}

function ignoreChange() {}
