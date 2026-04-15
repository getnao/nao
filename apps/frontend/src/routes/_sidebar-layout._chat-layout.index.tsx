import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { useSession } from '@/lib/auth-client';
import { capitalize } from '@/lib/utils';
import { ChatMessages } from '@/components/chat-messages/chat-messages';
import { useAgentContext } from '@/contexts/agent.provider';
import { SavedPromptSuggestions } from '@/components/chat-saved-prompt-suggestions';
import { ChatInput } from '@/components/chat-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MobileHeader } from '@/components/mobile-header';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/')({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session } = useSession();
	const username = session?.user?.name;
	const { messages } = useAgentContext();
	const project = useQuery({
		...trpc.project.getCurrent.queryOptions(),
		retry: false,
	});
	const showProjectSetupCue = project.error?.message === 'No project configured';
	const emptyStateTitle = showProjectSetupCue
		? 'Set up a project to start analyzing data'
		: `${username ? capitalize(username) : ''}, what do you want to analyze?`;

	return (
		<div className='flex flex-col h-full flex-1 bg-panel min-w-72 overflow-hidden justify-center'>
			<MobileHeader />
			{messages.length ? (
				<>
					<ChatMessages />
					<ChatInput />
				</>
			) : (
				<>
					<div className='flex flex-col items-center justify-center gap-4 p-4 mb-6 max-w-3xl mx-auto w-full flex-1'>
						<div className='text-xl md:text-3xl tracking-tight text-center px-6 mb-6'>
							{emptyStateTitle}
						</div>
						{showProjectSetupCue ? (
							<Card className='w-full max-w-2xl border-amber-500/30 bg-amber-500/5 shadow-none'>
								<CardContent className='flex flex-col gap-4 px-5 py-5'>
									<div className='flex items-start gap-3 text-left'>
										<div className='mt-0.5 rounded-full bg-amber-500/10 p-2 text-amber-600 dark:text-amber-400'>
											<Settings className='size-4' />
										</div>
										<div className='space-y-1'>
											<p className='font-medium text-foreground'>No project is configured yet</p>
											<p className='text-sm text-muted-foreground'>
												Open project settings to connect a project before starting a chat.
											</p>
										</div>
									</div>
									<div className='flex justify-start'>
										<Button asChild variant='secondary'>
											<Link to='/settings/project'>Open project settings</Link>
										</Button>
									</div>
								</CardContent>
							</Card>
						) : (
							<>
								<ChatInput />
								<SavedPromptSuggestions />
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
