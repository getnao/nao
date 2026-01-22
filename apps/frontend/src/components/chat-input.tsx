import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FormEvent, KeyboardEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { trpc } from '@/main';
import { useAgentContext } from '@/contexts/agent.provider';

export interface Props {
	onSubmit: (message: string) => void;
	onStop: () => void;
	isLoading: boolean;
	disabled?: boolean;
}

export function ChatInput() {
	const { sendMessage, isRunning, stopAgent, isReadyForNewMessages } = useAgentContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const modelProvider = useQuery(trpc.project.getModelProvider.queryOptions());
	const [input, setInput] = useState('');

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isRunning) {
			return;
		}
		sendMessage({ text: input });
		setInput('');
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	};

	return (
		<div className='p-4 pt-0 max-w-3xl w-full mx-auto'>
			<form onSubmit={handleSubmit} className='mx-auto'>
				<InputGroup htmlFor='chat-input'>
					<InputGroupTextarea
						key={chatId}
						autoFocus
						placeholder='Ask anything about your data...'
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						id='chat-input'
					/>

					<InputGroupAddon align='block-end'>
						{modelProvider.data && (
							<div className='text-sm font-normal text-muted-foreground'>
								{modelProvider.data === 'anthropic' ? 'Opus 4.5' : 'GPT-5.1'}
							</div>
						)}

						{isRunning ? (
							<InputGroupButton
								type='button'
								variant='destructive'
								className='rounded-full ml-auto'
								size='icon-xs'
								onClick={stopAgent}
							>
								<SquareIcon />
								<span className='sr-only'>Stop</span>
							</InputGroupButton>
						) : (
							<InputGroupButton
								type='submit'
								variant='default'
								className='rounded-full ml-auto'
								size='icon-xs'
								disabled={!isReadyForNewMessages || !input}
							>
								<ArrowUpIcon />
								<span className='sr-only'>Send</span>
							</InputGroupButton>
						)}
					</InputGroupAddon>
				</InputGroup>
			</form>
		</div>
	);
}
