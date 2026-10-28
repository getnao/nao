import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { FolderItem } from '@/lib/stories-page';
import { getFolderSubtreeIds } from '@/lib/stories-page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FolderTreeSelect, getTargetVisibility } from '@/components/stories-folder-tree-select';
import { invalidateStoryPlacementCaches } from '@/lib/stories-cache';
import { trpc } from '@/main';

type PickerTarget =
	| { type: 'story'; storyId: string }
	| { type: 'folder'; folderId: string; currentVisibility?: string }
	| { type: 'selection'; storyIds: string[]; folderIds: string[] };

export function FolderPickerDialog({
	open,
	onOpenChange,
	target,
	isOwner,
	onMoved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target: PickerTarget;
	isOwner: boolean;
	onMoved?: () => void;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const { data: tree = [] } = useQuery(trpc.storyFolder.listTree.queryOptions());

	function handleMoved() {
		invalidateStoryPlacementCaches(queryClient);
		onMoved?.();
		onOpenChange(false);
	}

	const moveStoryMutation = useMutation(trpc.storyFolder.moveStory.mutationOptions({ onSuccess: handleMoved }));
	const moveFolderMutation = useMutation(trpc.storyFolder.move.mutationOptions({ onSuccess: handleMoved }));
	const bulkMoveMutation = useMutation(trpc.storyFolder.bulkMove.mutationOptions({ onSuccess: handleMoved }));

	const isPending = moveStoryMutation.isPending || moveFolderMutation.isPending || bulkMoveMutation.isPending;
	const moveError = moveStoryMutation.error ?? moveFolderMutation.error ?? bulkMoveMutation.error;

	const disabledIds = getFolderSubtreeIds(getMovedFolderIds(target), tree);

	const selectedVisibility = getTargetVisibility(selectedId, tree);
	const visibilityWillChange = getSourceVisibilities(target, tree).some(
		(visibility) => visibility !== selectedVisibility,
	);

	function handleMove() {
		if (disabledIds.has(selectedId ?? '')) {
			return;
		}
		if (target.type === 'story') {
			moveStoryMutation.mutate({ storyId: target.storyId, folderId: selectedId });
		} else if (target.type === 'folder') {
			moveFolderMutation.mutate({ id: target.folderId, newParentId: selectedId });
		} else {
			bulkMoveMutation.mutate({
				storyIds: target.storyIds,
				folderIds: target.folderIds,
				targetFolderId: selectedId,
			});
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

				{moveError && <p className='text-xs text-destructive'>{moveError.message}</p>}

				<DialogFooter>
					<Button
						variant='ghost'
						className='rounded-full border'
						onClick={() => onOpenChange(false)}
						disabled={isPending}
					>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						className='rounded-full'
						onClick={handleMove}
						disabled={isPending}
					>
						Move here
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function getMovedFolderIds(target: PickerTarget): string[] {
	if (target.type === 'folder') {
		return [target.folderId];
	}
	if (target.type === 'selection') {
		return target.folderIds;
	}
	return [];
}

function getSourceVisibilities(target: PickerTarget, tree: FolderItem[]): string[] {
	if (target.type === 'folder') {
		return [target.currentVisibility ?? 'public'];
	}
	if (target.type === 'selection') {
		return tree.filter((folder) => target.folderIds.includes(folder.id)).map((folder) => folder.visibility);
	}
	return [];
}
