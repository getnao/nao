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
import { trpc } from '@/main';

export function FolderDeleteDialog({
	open,
	onOpenChange,
	folderId,
	folderName,
	parentName,
	hasChildren,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	folderId: string;
	folderName: string;
	parentName: string;
	hasChildren: boolean;
}) {
	const queryClient = useQueryClient();

	const deleteMutation = useMutation(
		trpc.storyFolder.delete.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listTree.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.storyFolder.listItems.queryKey() });
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
						{hasChildren
							? `Stories and sub-folders inside will be moved to ${parentName}. This action cannot be undone.`
							: 'This folder will be permanently deleted. This action cannot be undone.'}
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
