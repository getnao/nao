import { useMemo, useState } from 'react';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileTreeEntry {
	name: string;
	path: string;
	type: 'file' | 'directory';
	children?: FileTreeEntry[];
}

interface FileTreeProps {
	entries: FileTreeEntry[];
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
}

export function FileTree({ entries, selectedPath, onSelectFile }: FileTreeProps) {
	const [search, setSearch] = useState('');
	const filteredEntries = useMemo(() => {
		if (!search.trim()) {
			return entries;
		}
		return filterTree(entries, search.trim().toLowerCase());
	}, [entries, search]);

	return (
		<div className='flex flex-col h-full'>
			<div className='px-2 py-2 border-b border-border shrink-0'>
				<div className='relative'>
					<Search className='absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none' />
					<input
						type='text'
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder='Search files...'
						className='w-full h-7 pl-7 pr-2 text-xs bg-muted/50 border border-border rounded-md outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring/50'
					/>
				</div>
			</div>
			<div className='flex-1 overflow-auto py-1'>
				{filteredEntries.length === 0 ? (
					<div className='px-3 py-4 text-xs text-muted-foreground text-center'>No files found</div>
				) : (
					filteredEntries.map((entry) => (
						<FileTreeNode
							key={entry.path}
							entry={entry}
							depth={0}
							selectedPath={selectedPath}
							onSelectFile={onSelectFile}
							defaultExpanded={!!search.trim()}
						/>
					))
				)}
			</div>
		</div>
	);
}

interface FileTreeNodeProps {
	entry: FileTreeEntry;
	depth: number;
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
	defaultExpanded: boolean;
}

function FileTreeNode({ entry, depth, selectedPath, onSelectFile, defaultExpanded }: FileTreeNodeProps) {
	const [isExpanded, setIsExpanded] = useState(defaultExpanded);
	const isDirectory = entry.type === 'directory';
	const isSelected = entry.path === selectedPath;
	const expanded = defaultExpanded || isExpanded;

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
								expanded && 'rotate-90',
							)}
						/>
						{expanded ? (
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
			</button>

			{isDirectory && expanded && entry.children && (
				<div>
					{entry.children.map((child) => (
						<FileTreeNode
							key={child.path}
							entry={child}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelectFile={onSelectFile}
							defaultExpanded={defaultExpanded}
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

function fuzzyMatch(text: string, query: string): boolean {
	let qi = 0;
	for (let ti = 0; ti < text.length && qi < query.length; ti++) {
		if (text[ti] === query[qi]) {
			qi++;
		}
	}
	return qi === query.length;
}

function filterTree(entries: FileTreeEntry[], query: string): FileTreeEntry[] {
	const result: FileTreeEntry[] = [];

	for (const entry of entries) {
		const pathMatch = fuzzyMatch(entry.path.toLowerCase(), query);

		if (entry.type === 'directory' && entry.children) {
			if (pathMatch) {
				result.push(entry);
			} else {
				const filteredChildren = filterTree(entry.children, query);
				if (filteredChildren.length > 0) {
					result.push({ ...entry, children: filteredChildren });
				}
			}
		} else if (pathMatch) {
			result.push(entry);
		}
	}

	return result;
}
