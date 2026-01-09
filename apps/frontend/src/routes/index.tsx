import { createFileRoute } from '@tanstack/react-router';
import { ChatMessages } from '@/components/chat-messages';

export const Route = createFileRoute('/')({
	component: RouteComponent,
});

function RouteComponent() {
	return <ChatMessages />;
}
