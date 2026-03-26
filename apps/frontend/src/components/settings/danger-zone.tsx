import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
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
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

export function DangerZone() {
	const navigate = useNavigate();
	const [isOpen, setIsOpen] = useState(false);

	const deleteAllChats = useMutation(
		trpc.chat.deleteAll.mutationOptions({
			onSuccess: (_data, _vars, _res, ctx) => {
				ctx.client.setQueryData(trpc.chat.list.queryKey(), (prev) => {
					if (!prev) {
						return prev;
					}
					return { ...prev, chats: prev.chats.filter((c) => c.isStarred) };
				});
				navigate({ to: '/' });
				setIsOpen(false);
			},
		}),
	);

	return (
		<>
			<SettingsCard title='Danger Zone' description='Irreversible actions.'>
				<div className='flex items-center justify-between'>
					<div>
						<p className='text-sm font-medium'>Delete all chats</p>
						<p className='text-xs text-muted-foreground'>
							Permanently delete all your non-starred chats. Starred chats will be preserved.
						</p>
					</div>
					<Button variant='destructive' size='sm' onClick={() => setIsOpen(true)}>
						<Trash2 className='size-4 mr-1.5' />
						Delete all
					</Button>
				</div>
			</SettingsCard>

			<AlertDialog open={isOpen} onOpenChange={setIsOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete all chats?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently delete all your non-starred chats. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteAllChats.error?.message && <ErrorMessage message={deleteAllChats.error.message} />}
					<AlertDialogFooter>
						<AlertDialogCancel variant='outline' size='sm' disabled={deleteAllChats.isPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							variant='destructive'
							size='sm'
							onClick={(e) => {
								e.preventDefault();
								deleteAllChats.mutate();
							}}
							disabled={deleteAllChats.isPending}
						>
							Delete all chats
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
