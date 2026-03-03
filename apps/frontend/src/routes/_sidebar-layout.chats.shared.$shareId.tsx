import { useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/chats/shared/$shareId')({
	component: SharedChatRedirectPage,
});

function SharedChatRedirectPage() {
	const { shareId } = Route.useParams();
	const navigate = useNavigate();
	const shareQuery = useQuery(
		trpc.chatShare.get.queryOptions(
			{ id: shareId ?? '' },
			{ enabled: !!shareId },
		),
	);

	useEffect(() => {
		if (!shareQuery.data?.chatId) {
			return;
		}
		navigate({
			to: '/$chatId',
			params: { chatId: shareQuery.data.chatId },
			replace: true,
		});
	}, [shareQuery.data?.chatId, navigate]);

	if (shareQuery.isLoading || shareQuery.isFetching) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (shareQuery.isError) {
		return (
			<div className='flex flex-1 items-center justify-center p-4'>
				<div className='flex flex-col items-center gap-4 text-center'>
					<div className='flex size-10 items-center justify-center rounded-full bg-muted'>
						<ShieldX className='size-5 text-muted-foreground' />
					</div>
					<div className='space-y-1'>
						<p className='text-sm font-medium'>Chat not accessible</p>
						<p className='text-sm text-muted-foreground max-w-xs'>
							This link may have expired or you don't have permission to view it.
						</p>
					</div>
					<Button asChild variant='outline' size='sm'>
						<Link to='/'>Back to chats</Link>
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className='flex flex-1 items-center justify-center'>
			<Spinner />
		</div>
	);
}
