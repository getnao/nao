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

/** Asks before leaving an editor whose edits are not saved yet. */
export function DiscardChangesDialog({
	open,
	onKeepEditing,
	onDiscard,
}: {
	open: boolean;
	onKeepEditing: () => void;
	onDiscard: () => void;
}) {
	return (
		<AlertDialog open={open} onOpenChange={(nextOpen) => !nextOpen && onKeepEditing()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
					<AlertDialogDescription>
						You have edits that are not saved yet. Continuing will discard them.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Keep editing</AlertDialogCancel>
					<AlertDialogAction
						variant='destructive'
						onClick={(event) => {
							event.preventDefault();
							onDiscard();
						}}
					>
						Discard changes
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
