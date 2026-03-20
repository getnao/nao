import { useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
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
	return (
		<div className='flex flex-col py-1'>
			{entries.map((entry) => (
				<FileTreeNode
					key={entry.path}
					entry={entry}
					depth={0}
					selectedPath={selectedPath}
					onSelectFile={onSelectFile}
				/>
			))}
		</div>
	);
}

interface FileTreeNodeProps {
	entry: FileTreeEntry;
	depth: number;
	selectedPath: string | null;
	onSelectFile: (path: string) => void;
}

function FileTreeNode({ entry, depth, selectedPath, onSelectFile }: FileTreeNodeProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const isDirectory = entry.type === 'directory';
	const isSelected = entry.path === selectedPath;

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
					'flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-muted/50 rounded-sm transition-colors text-left',
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
							<FolderOpen className='size-4 shrink-0 text-muted-foreground' />
						) : (
							<Folder className='size-4 shrink-0 text-muted-foreground' />
						)}
					</>
				) : (
					<>
						<span className='size-3.5 shrink-0' />
						<File className='size-4 shrink-0 text-muted-foreground' />
					</>
				)}
				<span className='truncate'>{entry.name}</span>
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
						/>
					))}
				</div>
			)}
		</div>
	);
}
