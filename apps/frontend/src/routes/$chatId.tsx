import { createFileRoute, useParams } from '@tanstack/react-router';
import { ChatMessages } from '@/components/chat-messages';
import { useChatQuery } from '@/hooks/queries/useChatQuery';
import { Spinner } from '@/components/ui/spinner';

export const Route = createFileRoute('/$chatId')({
	component: RouteComponent,
});

function RouteComponent() {
	const { chatId } = useParams({ from: '/$chatId' });
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
