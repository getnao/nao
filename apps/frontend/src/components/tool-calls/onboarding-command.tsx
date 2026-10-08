import { HelpCircle } from 'lucide-react';
import { useMemo } from 'react';

import type { ToolCallComponentProps } from '.';
import { CommandBlock } from '@/components/command-block';
import { Button } from '@/components/ui/button';
import { useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { useAssistantMessage } from '@/contexts/assistant-message';

export function OnboardingCommandToolCall({ toolPart }: ToolCallComponentProps<'onboarding_command'>) {
	const command = toolPart.input?.command;
	const messages = useAgentMessages();
	const { isRunning, queueOrSendMessage } = useAgentContext();
	const { isSettled } = useAssistantMessage();
	const needsConfirmation = useMemo(() => {
		const messageIndex = messages.findIndex((message) =>
			message.parts.some(
				(part) => part.type === 'tool-onboarding_command' && part.toolCallId === toolPart.toolCallId,
			),
		);
		if (messageIndex === -1) {
			return false;
		}

		const message = messages[messageIndex];
		const partIndex = message.parts.findIndex(
			(part) => part.type === 'tool-onboarding_command' && part.toolCallId === toolPart.toolCallId,
		);
		const hasLaterCommand = message.parts
			.slice(partIndex + 1)
			.some((part) => part.type === 'tool-onboarding_command');
		const hasClarification = message.parts.some((part) => part.type === 'tool-clarification');
		const hasAnswer = messages.slice(messageIndex + 1).some((nextMessage) => nextMessage.role === 'user');

		return !hasLaterCommand && !hasClarification && !hasAnswer;
	}, [messages, toolPart.toolCallId]);

	if (!command) {
		return null;
	}

	return (
		<div className='flex flex-col gap-3'>
			<CommandBlock command={command} />
			{isSettled && needsConfirmation && (
				<div className='flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3'>
					<div className='flex items-start gap-2'>
						<HelpCircle className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
						<div className='flex flex-col gap-0.5'>
							<span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
								Quick question
							</span>
							<p className='text-sm leading-relaxed'>Did this step complete successfully?</p>
						</div>
					</div>
					<div className='flex flex-wrap gap-2 pl-6'>
						<Button
							variant='outline'
							size='sm'
							disabled={isRunning}
							onClick={() =>
								queueOrSendMessage({ text: 'Yes, this step completed successfully.' }).catch(
									console.error,
								)
							}
							className='h-auto min-h-7 rounded-2xl py-1'
						>
							Yes, it worked
						</Button>
						<Button
							variant='outline'
							size='sm'
							disabled={isRunning}
							onClick={() =>
								queueOrSendMessage({ text: 'I ran into an error while completing this step.' }).catch(
									console.error,
								)
							}
							className='h-auto min-h-7 rounded-2xl py-1'
						>
							I ran into an error
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
