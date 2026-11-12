import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Lock, Search, TextSearch, X } from 'lucide-react';
import type { FileTreeEntry } from '@nao/shared/types';
import type { FileChangeKind } from '@/components/settings/change-kind';
import { ChangeKindLetter } from '@/components/settings/change-kind';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { matchesOrderedTerms } from '@/lib/path-search';
import { getAutoExpandKeys, getTreeNodePadding, removeExpandedSubtree } from '@/lib/tree-expansion';
import { cn } from '@/lib/utils';

export type ContentMatch = {
	count: number;
	line: number;
	text: string;
};

/** How a file changed, by the user or on the branch of a synced repository picked for tests. */
export interface FileChangeMark {
	kind: FileChangeKind;
	isUpstream: boolean;
}

export interface FileSelectionOptions {
	isContentMatch: boolean;
}

interface FileTreeProps {
	entries: FileTreeEntry[];
	selectedPath: string | null;
	onSelectFile: (path: string, options: FileSelectionOptions) => void;
	search: string;
	onSearchChange: (value: string) => void;
	isContentSearchEnabled: boolean;
	onContentSearchEnabledChange: (enabled: boolean) => void;
	contentMatches: Map<string, ContentMatch>;
	isContentSearchPending: boolean;
	contentSearchFailed: boolean;
	contentSearchTruncated: boolean;
	/** Changed files by path, colored in the tree with a dot on the folders holding them. */
	changeMarks?: Map<string, FileChangeMark>;
}

export function FileTree({
	entries,
	selectedPath,
	onSelectFile,
	search,
	onSearchChange,
	isContentSearchEnabled,
	onContentSearchEnabledChange,
	contentMatches,
	isContentSearchPending,
	contentSearchFailed,
	contentSearchTruncated,
	changeMarks,
}: FileTreeProps) {
	const isSearching = search.trim().length > 0;
	const treeChanges = useMemo(() => getTreeChanges(changeMarks), [changeMarks]);
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
	const filteredEntries = useMemo(() => {
		const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
		return terms.length > 0 ? filterTree(entries, terms, contentMatches) : entries;
	}, [contentMatches, entries, search]);

	useEffect(() => {
		if (isSearching) {
			setExpandedPaths(new Set(getDirectoryPaths(entries)));
		}
	}, [entries, isSearching]);

	useEffect(() => {
		if (!isSearching) {
			setExpandedPaths(new Set());
		}
	}, [isSearching]);

	const handleToggleDirectory = (entry: FileTreeEntry) => {
		setExpandedPaths((currentPaths) => {
			const nextPaths = new Set(currentPaths);

			if (currentPaths.has(entry.path)) {
				removeExpandedSubtree(nextPaths, entry.path, '/');
			} else {
				for (const path of getAutoExpandKeys(entry, FILE_TREE_EXPANSION_ADAPTER)) {
					nextPaths.add(path);
				}
			}

			return nextPaths;
		});
	};

	return (
		<div className='flex flex-col h-full'>
			<div className='flex h-10 shrink-0 items-center border-b px-2'>
				<FileTreeSearch
					search={search}
					isContentSearchEnabled={isContentSearchEnabled}
					isContentSearchPending={isContentSearchPending}
					onSearchChange={onSearchChange}
					onContentSearchEnabledChange={onContentSearchEnabledChange}
				/>
			</div>
			<div className='flex-1 overflow-auto p-2'>
				<SearchStatusNote
					contentSearchFailed={contentSearchFailed}
					contentSearchTruncated={contentSearchTruncated}
				/>
				{filteredEntries.length === 0 ? (
					<TreeEmptyState
						contentSearchFailed={contentSearchFailed}
						isContentSearchPending={isContentSearchPending}
					/>
				) : (
					filteredEntries.map((entry) => (
						<FileTreeNode
							key={entry.path}
							entry={entry}
							depth={0}
							selectedPath={selectedPath}
							onSelectFile={onSelectFile}
							contentMatches={contentMatches}
							treeChanges={treeChanges}
							expandedPaths={expandedPaths}
							onToggleDirectory={handleToggleDirectory}
						/>
					))
				)}
			</div>
		</div>
	);
}

/** A rounded search field that also searches inside files when its toggle is on; Escape clears it. */
function FileTreeSearch({
	search,
	isContentSearchEnabled,
	isContentSearchPending,
	onSearchChange,
	onContentSearchEnabledChange,
}: Pick<
	FileTreeProps,
	'search' | 'isContentSearchEnabled' | 'isContentSearchPending' | 'onSearchChange' | 'onContentSearchEnabledChange'
>) {
	return (
		<div className='flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-muted/60 pr-1 pl-2.5 text-muted-foreground transition-colors focus-within:bg-background focus-within:ring-1 focus-within:ring-ring'>
			{isContentSearchPending ? <Spinner className='size-3.5' /> : <Search className='size-3.5 shrink-0' />}
			<input
				type='text'
				value={search}
				onChange={(event) => onSearchChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape' && search) {
						event.preventDefault();
						onSearchChange('');
					}
				}}
				placeholder='Search files'
				aria-label='Search files'
				className='h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground'
			/>
			{search && (
				<button
					type='button'
					aria-label='Clear search'
					onClick={() => onSearchChange('')}
					className='flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-muted hover:text-foreground'
				>
					<X className='size-3' />
				</button>
			)}
			<SimpleTooltip
				content={
					<div className='flex flex-col'>
						<span>{isContentSearchEnabled ? 'Searching inside files' : 'Search inside files'}</span>
						<span>Turn off if your project is very large.</span>
					</div>
				}
			>
				<button
					type='button'
					onClick={() => onContentSearchEnabledChange(!isContentSearchEnabled)}
					aria-pressed={isContentSearchEnabled}
					aria-label='Search inside files'
					className={cn(
						'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
						isContentSearchEnabled
							? 'bg-primary/15 text-primary'
							: 'text-muted-foreground/70 hover:bg-muted hover:text-foreground',
					)}
				>
					<TextSearch className='size-3.5' />
				</button>
			</SimpleTooltip>
		</div>
	);
}

const FILE_TREE_EXPANSION_ADAPTER = {
	getKey: (entry: FileTreeEntry) => entry.path,
	getChildren: (entry: FileTreeEntry) => entry.children ?? [],
	isFolder: (entry: FileTreeEntry) => entry.type === 'directory',
};

function TreeEmptyState({
	contentSearchFailed,
	isContentSearchPending,
}: Pick<FileTreeProps, 'contentSearchFailed' | 'isContentSearchPending'>) {
	if (contentSearchFailed) {
		return null;
	}

	return (
		<div className='px-3 py-4 text-xs text-muted-foreground text-center'>
			{isContentSearchPending ? 'Searching…' : 'No files found'}
		</div>
	);
}

function SearchStatusNote({
	contentSearchFailed,
	contentSearchTruncated,
}: Pick<FileTreeProps, 'contentSearchFailed' | 'contentSearchTruncated'>) {
	const message = contentSearchFailed
		? "Couldn't search file contents."
		: contentSearchTruncated
			? 'Showing partial results.'
			: null;

	return message ? <div className='px-2 pb-2 text-xs text-muted-foreground'>{message}</div> : null;
}

interface FileTreeNodeProps {
	entry: FileTreeEntry;
	depth: number;
	selectedPath: string | null;
	onSelectFile: (path: string, options: FileSelectionOptions) => void;
	contentMatches: Map<string, ContentMatch>;
	treeChanges: TreeChanges;
	expandedPaths: Set<string>;
	onToggleDirectory: (entry: FileTreeEntry) => void;
}

function FileTreeNode({
	entry,
	depth,
	selectedPath,
	onSelectFile,
	contentMatches,
	treeChanges,
	expandedPaths,
	onToggleDirectory,
}: FileTreeNodeProps) {
	const changeMark = treeChanges.files.get(entry.path);
	const folderChange = treeChanges.folders.get(entry.path);
	const isDirectory = entry.type === 'directory';
	const isExpanded = expandedPaths.has(entry.path);
	const isSelected = entry.path === selectedPath;
	const contentMatch = contentMatches.get(entry.path);

	const handleClick = () => {
		if (isDirectory) {
			onToggleDirectory(entry);
		} else {
			onSelectFile(entry.path, { isContentMatch: contentMatch !== undefined });
		}
	};

	return (
		<div>
			<button
				onClick={handleClick}
				title={contentMatch ? `Line ${contentMatch.line}: ${contentMatch.text}` : undefined}
				className={cn(
					'flex h-7 w-full cursor-pointer items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors',
					isSelected
						? 'bg-muted text-foreground'
						: 'text-foreground/80 hover:bg-muted/50 hover:text-foreground',
				)}
				style={{ paddingLeft: `${getTreeNodePadding(depth)}px` }}
			>
				{isDirectory ? (
					<>
						<ChevronRight
							className={cn(
								'size-3.5 shrink-0 text-muted-foreground transition-transform',
								isExpanded && 'rotate-90',
							)}
						/>
						<FileExplorerIcon name={entry.name} type='directory' />
					</>
				) : (
					<>
						<span className='size-3.5 shrink-0' />
						<FileExplorerIcon name={entry.name} type='file' path={entry.path} />
					</>
				)}
				<span className={cn('truncate', changeMark && getChangeMarkColor(changeMark))}>{entry.name}</span>
				{entry.readOnly && (
					<SimpleTooltip content='Read-only'>
						<Lock className='size-3 shrink-0 text-muted-foreground/70' aria-label='Read-only' />
					</SimpleTooltip>
				)}
				{folderChange && (
					<span
						aria-label='Holds changed files'
						className={cn(
							'ml-auto size-1.5 shrink-0 rounded-full',
							folderChange === 'upstream' ? 'bg-primary' : 'bg-amber-500',
						)}
					/>
				)}
				{changeMark && (
					<ChangeKindLetter
						kind={changeMark.kind}
						className={cn('ml-auto', changeMark.isUpstream && 'text-primary dark:text-primary')}
					/>
				)}
				{contentMatch && (
					<span className='ml-auto shrink-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground'>
						{contentMatch.count}
					</span>
				)}
			</button>

			{isDirectory && isExpanded && entry.children && (
				<div>
					{entry.children.map((child) => (
						<FileTreeNode
							key={child.path}
							entry={child}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelectFile={onSelectFile}
							contentMatches={contentMatches}
							treeChanges={treeChanges}
							expandedPaths={expandedPaths}
							onToggleDirectory={onToggleDirectory}
						/>
					))}
				</div>
			)}
		</div>
	);
}

interface TreeChanges {
	files: Map<string, FileChangeMark>;
	/** Folders holding changed files, `own` when the user changed one of them, else `upstream`. */
	folders: Map<string, 'own' | 'upstream'>;
}

function getTreeChanges(changeMarks: Map<string, FileChangeMark> = new Map()): TreeChanges {
	const folders: TreeChanges['folders'] = new Map();
	for (const [path, mark] of changeMarks) {
		for (const folder of getAncestorFolders(path)) {
			if (folders.get(folder) !== 'own') {
				folders.set(folder, mark.isUpstream ? 'upstream' : 'own');
			}
		}
	}
	return { files: changeMarks, folders };
}

function getAncestorFolders(path: string): string[] {
	const segments = path.split('/').filter(Boolean).slice(0, -1);
	return segments.map((_segment, index) => `/${segments.slice(0, index + 1).join('/')}`);
}

function getChangeMarkColor(mark: FileChangeMark): string {
	if (mark.isUpstream) {
		return 'text-primary';
	}
	return mark.kind === 'added' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
}

function getDirectoryPaths(entries: FileTreeEntry[]): string[] {
	const paths: string[] = [];

	for (const entry of entries) {
		if (entry.type !== 'directory') {
			continue;
		}
		paths.push(entry.path);
		paths.push(...getDirectoryPaths(entry.children ?? []));
	}

	return paths;
}

function filterTree(
	entries: FileTreeEntry[],
	terms: string[],
	contentMatches: Map<string, ContentMatch>,
): FileTreeEntry[] {
	const result: FileTreeEntry[] = [];

	for (const entry of entries) {
		const pathMatch = matchesOrderedTerms(entry.path, terms);

		if (entry.type === 'directory' && entry.children) {
			if (pathMatch) {
				result.push(entry);
			} else {
				const filteredChildren = filterTree(entry.children, terms, contentMatches);
				if (filteredChildren.length > 0) {
					result.push({ ...entry, children: filteredChildren });
				}
			}
		} else if (pathMatch || contentMatches.has(entry.path)) {
			result.push(entry);
		}
	}

	return result;
}
