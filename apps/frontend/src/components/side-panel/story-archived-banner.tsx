import { ArchiveRestoreIcon } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { trpc } from '@/main';

interface ArchivedBannerProps {
	chatId: string;
	storyId: string;
}

export function ArchivedBanner({ chatId, storyId }: ArchivedBannerProps) {
	const queryClient = useQueryClient();

	const unarchiveMutation = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storyId }) });
				void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				void queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
			},
		}),
	);

	return (
		<div className='flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2'>
			<span className='text-xs text-muted-foreground'>This story has been archived.</span>
			<Button
				variant='outline'
				size='sm'
				className='gap-1.5 shrink-0'
				onClick={() => unarchiveMutation.mutate({ chatId, storyId })}
				disabled={unarchiveMutation.isPending}
			>
				<ArchiveRestoreIcon className='size-3' />
				<span>Unarchive</span>
			</Button>
		</div>
	);
}
