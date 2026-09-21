import { MessageSquare } from 'lucide-react';

import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { Button } from '@/components/ui/button';

export function FixInChatButton({ message, className }: { message: string; className?: string }) {
	const agent = useOptionalAgentContext();
	if (!agent || agent.isReadonly || !message.trim()) {
		return null;
	}

	return (
		<Button
			type='button'
			variant='outline'
			size='sm'
			className={className}
			onClick={() => {
				void agent.queueOrSendMessage({ text: message });
			}}
		>
			<MessageSquare className='size-3.5' />
			Fix in chat
		</Button>
	);
}
