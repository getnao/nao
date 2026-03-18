import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useSession } from '@/lib/auth-client';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/shared-chat/$shareId')({
	component: SharedChatPage,
});

function SharedChatPage() {
	const { shareId } = Route.useParams();
	const { data: session } = useSession();

	const shareQuery = useQuery(trpc.sharedChat.get.queryOptions({ id: shareId }));
	const chatQuery = useQuery(trpc.sharedChat.getChat.queryOptions({ shareId }));

	const isLoading = shareQuery.isLoading || chatQuery.isLoading;

	if (isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (!shareQuery.data || !chatQuery.data) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<p className='text-sm text-muted-foreground'>Chat not found.</p>
			</div>
		);
	}

	const share = shareQuery.data;
	const chat = chatQuery.data;
	const isOwner = session?.user?.id === share.userId;

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-panel min-w-0'>
			<header className='flex items-center gap-3 border-b px-4 py-3 md:px-6 md:py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{share.title}</h1>
				<span className='text-sm text-muted-foreground shrink-0'>by {share.authorName}</span>
				{isOwner && (
					<Button variant='outline' size='sm' className='ml-auto gap-1.5 shrink-0' asChild>
						<Link to='/$chatId' params={{ chatId: share.chatId }}>
							<MessageSquare className='size-3.5' />
							<span>Open chat</span>
						</Link>
					</Button>
				)}
			</header>

			<ChatMessagesReadonly messages={chat.messages} className='flex-1' />
		</div>
	);
}
