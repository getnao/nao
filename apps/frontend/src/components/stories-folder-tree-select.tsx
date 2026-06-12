import { ChevronRight, Folder, FolderLock, Globe, Home, Lock } from 'lucide-react';

import type { FolderItem } from '@/lib/stories-page';
import { cn } from '@/lib/utils';

export type FolderTreeSelectProps = {
	tree: FolderItem[];
	selectedId: string | null;
	onSelect: (id: string | null) => void;
	isDisabled?: (folder: FolderItem) => boolean;
};

export function FolderTreeSelect({ tree, selectedId, onSelect, isDisabled }: FolderTreeSelectProps) {
	const rootSelected = selectedId === null;

	return (
		<div className='flex flex-col gap-0.5 max-h-64 overflow-y-auto rounded-md border p-1'>
			<FolderTreeItem
				label='Root'
				icon={<Home className='size-3.5' />}
				visibility='public'
				selected={rootSelected}
				disabled={false}
				depth={0}
				onSelect={() => onSelect(null)}
			/>
			{tree
				.filter((f) => f.parentId === null && f.id !== '__shared_with_me__')
				.map((f) => (
					<FolderTreeNode
						key={f.id}
						folder={f}
						allFolders={tree}
						selectedId={selectedId}
						depth={1}
						onSelect={onSelect}
						isDisabled={isDisabled}
					/>
				))}
		</div>
	);
}

export function getTargetVisibility(folderId: string | null, tree: FolderItem[]): string {
	if (folderId === null) {
		return 'public';
	}
	return tree.find((f) => f.id === folderId)?.visibility ?? 'public';
}

function FolderTreeNode({
	folder,
	allFolders,
	selectedId,
	depth,
	onSelect,
	isDisabled,
}: {
	folder: FolderItem;
	allFolders: FolderItem[];
	selectedId: string | null;
	depth: number;
	onSelect: (id: string | null) => void;
	isDisabled?: (folder: FolderItem) => boolean;
}) {
	const children = allFolders.filter((f) => f.parentId === folder.id);
	const disabled = isDisabled ? isDisabled(folder) : false;

	return (
		<>
			<FolderTreeItem
				label={folder.name}
				icon={
					folder.visibility === 'private' ? (
						<FolderLock className='size-3.5' />
					) : (
						<Folder className='size-3.5' />
					)
				}
				visibility={folder.visibility ?? 'public'}
				selected={selectedId === folder.id}
				disabled={disabled}
				depth={depth}
				onSelect={() => onSelect(folder.id)}
			/>
			{children.map((child) => (
				<FolderTreeNode
					key={child.id}
					folder={child}
					allFolders={allFolders}
					selectedId={selectedId}
					depth={depth + 1}
					onSelect={onSelect}
					isDisabled={isDisabled}
				/>
			))}
		</>
	);
}

function FolderTreeItem({
	label,
	icon,
	visibility,
	selected,
	disabled,
	depth,
	onSelect,
}: {
	label: string;
	icon: React.ReactNode;
	visibility: string;
	selected: boolean;
	disabled: boolean;
	depth: number;
	onSelect: () => void;
}) {
	return (
		<button
			type='button'
			disabled={disabled}
			onClick={onSelect}
			style={{ paddingLeft: `${Math.max(0, depth - 1) * 16 + 8}px` }}
			className={cn(
				'flex items-center gap-2 rounded px-2 py-1.5 text-sm w-full text-left transition-colors',
				selected && 'bg-accent text-accent-foreground',
				!selected && !disabled && 'hover:bg-accent/50',
				disabled && 'opacity-30 cursor-not-allowed',
			)}
		>
			{depth > 1 && <ChevronRight className='size-3 text-muted-foreground/50 shrink-0' />}
			<span className='text-muted-foreground shrink-0'>{icon}</span>
			<span className='truncate flex-1'>{label}</span>
			{visibility === 'private' ? (
				<Lock className='size-3 shrink-0 text-muted-foreground/60' />
			) : (
				<Globe className='size-3 shrink-0 text-muted-foreground/30' />
			)}
		</button>
	);
}
