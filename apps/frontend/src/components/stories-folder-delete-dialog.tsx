import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ErrorMessage } from '@/components/ui/error-message';
import { invalidateStoryPlacementCaches } from '@/lib/stories-cache';
import { describeTeamGroups } from '@/lib/stories-page';
import { trpc } from '@/main';

export function FolderDeleteDialog({
	open,
	onOpenChange,
	folderId,
	folderName,
	parentName,
	hasChildren,
	teamGroupNames,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	folderId: string;
	folderName: string;
	parentName: string;
	hasChildren: boolean;
	teamGroupNames: string[];
}) {
	const queryClient = useQueryClient();

	const deleteMutation = useMutation(
		trpc.storyFolder.delete.mutationOptions({
			onSuccess: () => {
				invalidateStoryPlacementCaches(queryClient);
				onOpenChange(false);
			},
		}),
	);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete &ldquo;{folderName}&rdquo;?</AlertDialogTitle>
					<AlertDialogDescription>
						{describeDeletion({ parentName, hasChildren, teamGroupNames })}
					</AlertDialogDescription>
				</AlertDialogHeader>

				{deleteMutation.error?.message && <ErrorMessage message={deleteMutation.error.message} />}

				<AlertDialogFooter>
					<AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						isLoading={deleteMutation.isPending}
						onClick={(e) => {
							e.preventDefault();
							deleteMutation.mutate({ id: folderId });
						}}
						disabled={deleteMutation.isPending}
					>
						Delete folder
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function describeDeletion({
	parentName,
	hasChildren,
	teamGroupNames,
}: {
	parentName: string;
	hasChildren: boolean;
	teamGroupNames: string[];
}): string {
	if (!hasChildren) {
		return 'This folder will be permanently deleted. This action cannot be undone.';
	}
	if (teamGroupNames.length === 0) {
		return `Stories and sub-folders inside will be moved to ${parentName}. This action cannot be undone.`;
	}
	const groups = describeTeamGroups(teamGroupNames);
	return `Stories inside will go back to their owners' private folders and stop being shared with ${groups}. Sub-folders will be moved to ${parentName} and stay visible only to ${groups}. This action cannot be undone.`;
}
