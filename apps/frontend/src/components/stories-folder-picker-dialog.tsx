import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { FolderItem } from '@/lib/stories-page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FolderTreeSelect, getTargetVisibility } from '@/components/stories-folder-tree-select';
import { trpc } from '@/main';

type PickerTarget =
	| { type: 'story'; storyId: string }
	| { type: 'folder'; folderId: string; currentVisibility?: string };

export function FolderPickerDialog({
	open,
	onOpenChange,
	target,
	isOwner,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: PickerTarget;
	isOwner: boolean;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const { data: tree = [] } = useQuery(trpc.storyFolder.listTree.queryOptions());

	const moveStoryMutation = useMutation(
		trpc.storyFolder.moveStory.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
				onOpenChange(false);
			},
		}),
	);

	const moveFolderMutation = useMutation(
		trpc.storyFolder.move.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
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

	const selectedVisibility = getTargetVisibility(selectedId, tree);
	const sourceVisibility = target.type === 'folder' ? (target.currentVisibility ?? 'public') : null;
	const visibilityWillChange = sourceVisibility !== null && selectedVisibility !== sourceVisibility;

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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-sm'>
				<DialogHeader>
					<DialogTitle>Move to…</DialogTitle>
				</DialogHeader>

				<FolderTreeSelect
					tree={tree}
					selectedId={selectedId}
					onSelect={setSelectedId}
					isDisabled={(folder) =>
						disabledIds.has(folder.id) ||
						folder.systemType === 'shared_with_me' ||
						(!isOwner && folder.visibility === 'private')
					}
				/>

				{visibilityWillChange && (
					<p className='flex items-center gap-1.5 text-xs text-amber-600'>
						<TriangleAlert className='size-3.5 shrink-0' />
						{selectedVisibility === 'public'
							? 'Moving here will make the folder and its stories public.'
							: 'Moving here will make the folder and its stories private.'}
					</p>
				)}

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
