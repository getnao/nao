import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Folder, Home } from 'lucide-react';
import { useState } from 'react';

import type { FolderItem } from '@/lib/stories-page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

type PickerTarget = { type: 'story'; storyId: string } | { type: 'folder'; folderId: string };

export function FolderPickerDialog({
	open,
	onOpenChange,
	target,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: PickerTarget;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const { data: tree = [] } = useQuery(trpc.storyFolder.listTree.queryOptions());

	const moveStoryMutation = useMutation(
		trpc.storyFolder.moveStory.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				onOpenChange(false);
			},
		}),
	);

	const moveFolderMutation = useMutation(
		trpc.storyFolder.move.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				onOpenChange(false);
			},
		}),
	);

	const isPending = moveStoryMutation.isPending || moveFolderMutation.isPending;

	function getDescendantIds(folderId: string, folders: FolderItem[]): Set<string> {
		const result = new Set<string>();
		const queue = [folderId];
		while (queue.length > 0) {
			const current = queue.shift()!;
			result.add(current);
			for (const f of folders) {
				if (f.parentId === current) {
					queue.push(f.id);
				}
			}
		}
		return result;
	}

	const disabledIds = target.type === 'folder' ? getDescendantIds(target.folderId, tree) : new Set<string>();

	function handleMove() {
		if (target.type === 'story') {
			moveStoryMutation.mutate({ storyId: target.storyId, folderId: selectedId });
		} else {
			if (disabledIds.has(selectedId ?? '')) {
				return;
			}
			moveFolderMutation.mutate({ id: target.folderId, newParentId: selectedId });
		}
	}

	const rootSelected = selectedId === null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-sm'>
				<DialogHeader>
					<DialogTitle>Move to…</DialogTitle>
				</DialogHeader>

				<div className='flex flex-col gap-0.5 max-h-64 overflow-y-auto rounded-md border p-1'>
					<FolderPickerItem
						label='Root'
						icon={<Home className='size-3.5' />}
						selected={rootSelected}
						disabled={false}
						depth={0}
						onSelect={() => setSelectedId(null)}
					/>
					{tree
						.filter((f) => f.parentId === null)
						.map((f) => (
							<FolderPickerNode
								key={f.id}
								folder={f}
								allFolders={tree}
								selectedId={selectedId}
								disabledIds={disabledIds}
								depth={1}
								onSelect={setSelectedId}
							/>
						))}
				</div>

				<DialogFooter>
					<Button variant='ghost' onClick={() => onOpenChange(false)} disabled={isPending}>
						Cancel
					</Button>
					<Button onClick={handleMove} disabled={isPending}>
						Move here
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FolderPickerNode({
	folder,
	allFolders,
	selectedId,
	disabledIds,
	depth,
	onSelect,
}: {
	folder: FolderItem;
	allFolders: FolderItem[];
	selectedId: string | null;
	disabledIds: Set<string>;
	depth: number;
	onSelect: (id: string | null) => void;
}) {
	const children = allFolders.filter((f) => f.parentId === folder.id);
	const isDisabled = disabledIds.has(folder.id);

	return (
		<>
			<FolderPickerItem
				label={folder.name}
				icon={<Folder className='size-3.5' />}
				selected={selectedId === folder.id}
				disabled={isDisabled}
				depth={depth}
				onSelect={() => onSelect(folder.id)}
			/>
			{children.map((child) => (
				<FolderPickerNode
					key={child.id}
					folder={child}
					allFolders={allFolders}
					selectedId={selectedId}
					disabledIds={disabledIds}
					depth={depth + 1}
					onSelect={onSelect}
				/>
			))}
		</>
	);
}

function FolderPickerItem({
	label,
	icon,
	selected,
	disabled,
	depth,
	onSelect,
}: {
	label: string;
	icon: React.ReactNode;
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
			style={{ paddingLeft: `${(depth - 1) * 16 + 8}px` }}
			className={cn(
				'flex items-center gap-2 rounded px-2 py-1.5 text-sm w-full text-left transition-colors',
				selected && 'bg-accent text-accent-foreground',
				!selected && !disabled && 'hover:bg-accent/50',
				disabled && 'opacity-30 cursor-not-allowed',
			)}
		>
			{depth > 1 && <ChevronRight className='size-3 text-muted-foreground/50 shrink-0' />}
			<span className='text-muted-foreground shrink-0'>{icon}</span>
			<span className='truncate'>{label}</span>
		</button>
	);
}
