import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search, TextSearch } from 'lucide-react';
import type { FileTreeEntry } from '@nao/shared/types';
import { FileExplorerIcon } from '@/components/settings/file-explorer-icon';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { matchesOrderedTerms } from '@/lib/path-search';
import { cn } from '@/lib/utils';

type ContentMatch = {
	count: number;
	line: number;
	text: string;
};

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
}: FileTreeProps) {
	const isSearching = search.trim().length > 0;
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
				removeExpandedSubtree(nextPaths, entry.path);
			} else {
				for (const path of getAutoExpandPaths(entry)) {
					nextPaths.add(path);
				}
			}

			return nextPaths;
		});
	};

	return (
		<div className='flex flex-col h-full'>
			<div className='px-2 py-2 border-b border-border shrink-0'>
				<div className='relative'>
					{isContentSearchPending ? (
						<Spinner className='absolute left-2 top-1/2 -translate-y-1/2 size-3' />
					) : (
						<Search className='absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none' />
					)}
					<input
						type='text'
						value={search}
						onChange={(e) => onSearchChange(e.target.value)}
						placeholder='Search files...'
						className='w-full h-7 pl-7 pr-8 text-xs bg-muted/50 border border-border rounded-md outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/50'
					/>
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
								'absolute right-1 top-1/2 -translate-y-1/2 size-5 flex items-center justify-center rounded cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
								isContentSearchEnabled
									? 'bg-primary/15 text-primary ring-1 ring-primary/30'
									: 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted',
							)}
						>
							<TextSearch className='size-3.5' />
						</button>
					</SimpleTooltip>
				</div>
				<SearchStatusNote
					contentSearchFailed={contentSearchFailed}
					contentSearchTruncated={contentSearchTruncated}
				/>
			</div>
			<div className='flex-1 overflow-auto py-1'>
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
							expandedPaths={expandedPaths}
							onToggleDirectory={handleToggleDirectory}
						/>
					))
				)}
			</div>
		</div>
	);
}

function removeExpandedSubtree(paths: Set<string>, rootPath: string): void {
	const descendantPrefix = `${rootPath}/`;

	for (const path of paths) {
		if (path === rootPath || path.startsWith(descendantPrefix)) {
			paths.delete(path);
		}
	}
}

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

	return message ? <div className='px-1 pt-2 text-xs text-muted-foreground'>{message}</div> : null;
}

interface FileTreeNodeProps {
	entry: FileTreeEntry;
	depth: number;
	selectedPath: string | null;
	onSelectFile: (path: string, options: FileSelectionOptions) => void;
	contentMatches: Map<string, ContentMatch>;
	expandedPaths: Set<string>;
	onToggleDirectory: (entry: FileTreeEntry) => void;
}

function FileTreeNode({
	entry,
	depth,
	selectedPath,
	onSelectFile,
	contentMatches,
	expandedPaths,
	onToggleDirectory,
}: FileTreeNodeProps) {
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
					'flex items-center gap-1.5 w-full py-1 pr-2 text-sm cursor-pointer',
					'hover:bg-muted/50 rounded-sm transition-colors text-left',
					isSelected && 'bg-muted text-foreground font-medium',
				)}
				style={{ paddingLeft: `${depth * 16 + 8}px` }}
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
						<FileExplorerIcon name={entry.name} type='file' />
					</>
				)}
				<span className='truncate'>{entry.name}</span>
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
							expandedPaths={expandedPaths}
							onToggleDirectory={onToggleDirectory}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function getAutoExpandPaths(entry: FileTreeEntry): string[] {
	const paths: string[] = [];
	let current: FileTreeEntry | undefined = entry;

	while (current?.type === 'directory') {
		paths.push(current.path);
		const children: FileTreeEntry[] = current.children ?? [];
		if (children.length !== 1 || children[0].type !== 'directory') {
			break;
		}
		current = children[0];
	}

	return paths;
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
