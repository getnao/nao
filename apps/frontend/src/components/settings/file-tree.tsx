import { useEffect, useMemo, useState } from 'react';
import {
	ChevronRight,
	File,
	FileCode,
	FileJson,
	FileSpreadsheet,
	FileText,
	FileType,
	Folder,
	FolderOpen,
	Search,
	TextSearch,
} from 'lucide-react';
import type { FileTreeEntry } from '@nao/shared/types';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type ContentMatch = {
	count: number;
	line: number;
	text: string;
};

interface FileTreeProps {
	entries: FileTreeEntry[];
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
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
	const filteredEntries = useMemo(() => {
		const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
		return terms.length > 0 ? filterTree(entries, terms, contentMatches) : entries;
	}, [contentMatches, entries, search]);

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
							isSearching={isSearching}
							contentMatches={contentMatches}
						/>
					))
				)}
			</div>
		</div>
	);
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
	onSelectFile: (path: string) => void;
	isSearching: boolean;
	contentMatches: Map<string, ContentMatch>;
}

function FileTreeNode({ entry, depth, selectedPath, onSelectFile, isSearching, contentMatches }: FileTreeNodeProps) {
	const [isExpanded, setIsExpanded] = useState(isSearching);
	const isDirectory = entry.type === 'directory';
	const isSelected = entry.path === selectedPath;
	const contentMatch = contentMatches.get(entry.path);

	useEffect(() => {
		setIsExpanded(isSearching);
	}, [isSearching]);

	const handleClick = () => {
		if (isDirectory) {
			setIsExpanded((prev) => !prev);
		} else {
			onSelectFile(entry.path);
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
						{isExpanded ? (
							<FolderOpen className='size-4 shrink-0 text-amber-500' />
						) : (
							<Folder className='size-4 shrink-0 text-amber-500' />
						)}
					</>
				) : (
					<>
						<span className='size-3.5 shrink-0' />
						<FileIcon fileName={entry.name} />
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
							isSearching={isSearching}
							contentMatches={contentMatches}
						/>
					))}
				</div>
			)}
		</div>
	);
}

const ICON_MAP: Record<string, { icon: typeof File; color: string }> = {
	'.ts': { icon: FileCode, color: 'text-blue-500' },
	'.tsx': { icon: FileCode, color: 'text-blue-500' },
	'.js': { icon: FileCode, color: 'text-yellow-500' },
	'.jsx': { icon: FileCode, color: 'text-yellow-500' },
	'.py': { icon: FileCode, color: 'text-green-500' },
	'.sql': { icon: FileCode, color: 'text-orange-500' },
	'.sh': { icon: FileCode, color: 'text-green-600' },
	'.bash': { icon: FileCode, color: 'text-green-600' },
	'.json': { icon: FileJson, color: 'text-yellow-600' },
	'.yaml': { icon: FileCode, color: 'text-red-400' },
	'.yml': { icon: FileCode, color: 'text-red-400' },
	'.toml': { icon: FileCode, color: 'text-gray-500' },
	'.ini': { icon: FileCode, color: 'text-gray-500' },
	'.env': { icon: FileCode, color: 'text-yellow-700' },
	'.md': { icon: FileText, color: 'text-blue-400' },
	'.txt': { icon: FileText, color: 'text-muted-foreground' },
	'.csv': { icon: FileSpreadsheet, color: 'text-green-600' },
	'.html': { icon: FileCode, color: 'text-orange-500' },
	'.css': { icon: FileCode, color: 'text-purple-500' },
	'.xml': { icon: FileCode, color: 'text-orange-400' },
	'.svg': { icon: FileType, color: 'text-orange-400' },
};

function FileIcon({ fileName }: { fileName: string }) {
	const dotIndex = fileName.lastIndexOf('.');
	const ext = dotIndex !== -1 ? fileName.slice(dotIndex).toLowerCase() : '';
	const mapping = ICON_MAP[ext];
	const Icon = mapping?.icon ?? File;
	const color = mapping?.color ?? 'text-muted-foreground';
	return <Icon className={cn('size-4 shrink-0', color)} />;
}

function matchesQuery(path: string, terms: string[]): boolean {
	const lowercasedPath = path.toLowerCase();
	return terms.every((term) => lowercasedPath.includes(term));
}

function filterTree(
	entries: FileTreeEntry[],
	terms: string[],
	contentMatches: Map<string, ContentMatch>,
): FileTreeEntry[] {
	const result: FileTreeEntry[] = [];

	for (const entry of entries) {
		const pathMatch = matchesQuery(entry.path, terms);

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
