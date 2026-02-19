import { createFileRoute } from '@tanstack/react-router';
import NaoLogoGreyscale from '@/components/icons/nao-logo-greyscale.svg';
import { useSession } from '@/lib/auth-client';
import { capitalize } from '@/lib/utils';
import { ChatMessages } from '@/components/chat-messages';
import { useAgentContext } from '@/contexts/agent.provider';
import { SavedPromptSuggestions } from '@/components/chat-saved-prompt-suggestions';
import { ChatInput } from '@/components/chat-input';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/')({
	component: RouteComponent,
});

function RouteComponent() {
	const { data: session } = useSession();
	const username = session?.user?.name;
	const { messages } = useAgentContext();

	return (
		<div className='flex flex-col h-full flex-1 bg-panel min-w-72 overflow-hidden justify-center'>
			{messages.length ? (
				<>
					<ChatMessages />
					<ChatInput />
				</>
			) : (
				<>
					<div className='flex flex-col items-center justify-end gap-4 p-4 mb-6 max-w-3xl mx-auto w-full'>
						<div className='relative w-full flex items-center justify-center px-6'>
							<NaoLogoGreyscale className='w-[150px] h-auto select-none opacity-[0.05]' />
						</div>

						<div className='text-2xl md:text-2xl tracking-tight text-muted-foreground text-center px-6'>
							{username ? capitalize(username) : ''}, what do you want to analyze?
						</div>
					</div>
					<ChatInput />
					<SavedPromptSuggestions />
				</>
			)}
		</div>
	);
}
