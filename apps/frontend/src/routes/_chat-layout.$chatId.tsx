import { createFileRoute, useParams } from '@tanstack/react-router';
import { ChatMessages } from '@/components/chat-messages';
import { useChatQuery } from '@/queries/useChatQuery';
import { Spinner } from '@/components/ui/spinner';

export const Route = createFileRoute('/_chat-layout/$chatId')({
	component: RouteComponent,
});

function RouteComponent() {
	const { chatId } = useParams({ from: '/_chat-layout/$chatId' });
	const chat = useChatQuery({ chatId });

	if (chat.isFetching) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	return <ChatMessages key={chatId} />;
}
