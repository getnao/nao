import { createFileRoute } from '@tanstack/react-router';
import { ChatView } from '@/components/chat-view';
import { Sidebar } from '@/components/sidebar';

export const Route = createFileRoute('/_chat-layout')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<>
			<Sidebar />
			<ChatView />
		</>
	);
}
