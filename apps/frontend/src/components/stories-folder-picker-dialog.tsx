import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { FolderItem } from '@/lib/stories-page';
import { describeTeamGroups, getFolderSubtreeIds, ownsTeamGroups } from '@/lib/stories-page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FolderTreeSelect, getTargetAudience } from '@/components/stories-folder-tree-select';
import { invalidateStoryPlacementCaches } from '@/lib/stories-cache';
import { trpc } from '@/main';

type PickerTarget =
	| { type: 'story'; storyId: string }
	| { type: 'folder'; folderId: string }
	| { type: 'selection'; storyIds: string[]; folderIds: string[] };

type FolderPlacement = { storyId: string; folderId: string };

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
	const [pickedId, setPickedId] = useState<string | null>();
	const queryClient = useQueryClient();

	const { data: tree = [], isSuccess: isTreeLoaded } = useQuery(trpc.storyFolder.listTree.queryOptions());
	const { data: folderItems = [], isSuccess: areFolderItemsLoaded } = useQuery(
		trpc.storyFolder.listItems.queryOptions(),
	);
	const isFolderDataLoaded = isTreeLoaded && areFolderItemsLoaded;

	const currentId = isFolderDataLoaded ? getCurrentFolderId(target, folderItems, tree) : undefined;
	const selectedId = pickedId === undefined ? (currentId ?? null) : pickedId;
	const isCurrentSelected = selectedId === currentId;

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

	const selectedAudienceKey = getAudienceKey(selectedId, tree);
	const audienceWillChange = [
		...getMovedFolderIds(target).filter((folderId) => !staysTeamFolder(folderId, selectedId, tree)),
		...getMovedStoryIds(target).map((storyId) => getStoryFolderId(storyId, folderItems)),
	].some((folderId) => getAudienceKey(folderId, tree) !== selectedAudienceKey);

	function handleMove() {
		if (isCurrentSelected || disabledIds.has(selectedId ?? '')) {
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
					currentId={currentId}
					onSelect={setPickedId}
					isDisabled={(folder) =>
						disabledIds.has(folder.id) ||
						folder.systemType === 'shared_with_me' ||
						(!isOwner && folder.visibility === 'private')
					}
				/>

				{audienceWillChange && (
					<p className='flex items-center gap-1.5 text-xs text-amber-600'>
						<TriangleAlert className='size-3.5 shrink-0' />
						{getAudienceWarning(target, selectedId, tree)}
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
						disabled={isPending || !isFolderDataLoaded || isCurrentSelected}
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

/** The folder holding every moved item, or undefined when they sit in different places. */
function getCurrentFolderId(
	target: PickerTarget,
	folderItems: FolderPlacement[],
	tree: FolderItem[],
): string | null | undefined {
	const locations = new Set([
		...getMovedFolderIds(target).map((folderId) => findFolder(folderId, tree)?.parentId ?? null),
		...getMovedStoryIds(target).map((storyId) => getStoryFolderId(storyId, folderItems)),
	]);
	return locations.size === 1 ? [...locations][0] : undefined;
}

function getMovedStoryIds(target: PickerTarget): string[] {
	if (target.type === 'story') {
		return [target.storyId];
	}
	if (target.type === 'selection') {
		return target.storyIds;
	}
	return [];
}

/** A team folder moved into an open folder keeps its own groups, as the server does. */
function staysTeamFolder(folderId: string, targetFolderId: string | null, tree: FolderItem[]): boolean {
	const folder = findFolder(folderId, tree);
	return folder !== undefined && ownsTeamGroups(folder, tree) && getTargetAudience(targetFolderId, tree) === 'public';
}

/** Two team folders only share an audience when they belong to the same groups. */
function getAudienceKey(folderId: string | null, tree: FolderItem[]): string {
	const audience = getTargetAudience(folderId, tree);
	const groupIds = audience === 'team' ? (findFolder(folderId, tree)?.teamGroupIds ?? []) : [];
	return [audience, ...[...groupIds].sort()].join(':');
}

function findFolder(folderId: string | null, tree: FolderItem[]): FolderItem | undefined {
	return tree.find((folder) => folder.id === folderId);
}

function getStoryFolderId(storyId: string, folderItems: FolderPlacement[]): string | null {
	return folderItems.find((item) => item.storyId === storyId)?.folderId ?? null;
}

const SUBJECTS: Record<PickerTarget['type'], string> = {
	story: 'this story',
	folder: 'the folder and its stories',
	selection: 'the selected items',
};

function getAudienceWarning(target: PickerTarget, folderId: string | null, tree: FolderItem[]): string {
	return `Moving here will make ${SUBJECTS[target.type]} ${describeAudience(folderId, tree)}.`;
}

function describeAudience(folderId: string | null, tree: FolderItem[]): string {
	const audience = getTargetAudience(folderId, tree);
	if (audience !== 'team') {
		return audience;
	}
	return `visible only to ${describeTeamGroups(findFolder(folderId, tree)?.teamGroupNames ?? [])}`;
}
