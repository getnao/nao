import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
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
import { Button } from '@/components/ui/button';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

export function DangerZone() {
	const [isOpen, setIsOpen] = useState(false);
	const navigate = useNavigate();

	const deleteAllNonStarred = useMutation(
		trpc.chat.deleteAllNonStarred.mutationOptions({
			onSuccess: (_data, _, __, ctx) => {
				ctx.client.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				setIsOpen(false);
				navigate({ to: '/' });
			},
		}),
	);

	return (
		<>
			<SettingsCard title='Danger Zone'>
				<div className='flex items-center justify-between gap-4'>
					<div className='space-y-0.5'>
						<p className='text-sm font-medium'>Delete all chats</p>
						<p className='text-xs text-muted-foreground'>
							Permanently delete all your non-starred conversations. Starred chats will be kept.
						</p>
					</div>
					<Button variant='destructive' size='sm' onClick={() => setIsOpen(true)}>
						Delete all
					</Button>
				</div>
			</SettingsCard>

			<AlertDialog open={isOpen} onOpenChange={setIsOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete all non-starred chats?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete all your conversations that are not starred. This action cannot
							be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							isLoading={deleteAllNonStarred.isPending}
							onClick={(e) => {
								e.preventDefault();
								deleteAllNonStarred.mutate();
							}}
						>
							Delete all
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
