import { createRootRoute } from '@tanstack/react-router';
import { Header } from '../components/header';
import { Sidebar } from '@/components/sidebar';
import { ChatView } from '@/components/chat-view';
import { useDisposeInactiveAgents } from '@/hooks/useAgent';

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	useDisposeInactiveAgents();

	return (
		<div className='flex h-screen'>
			<Header />
			<Sidebar />
			<ChatView />
		</div>
	);
}
