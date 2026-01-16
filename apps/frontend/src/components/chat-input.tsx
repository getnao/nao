import { ArrowUpIcon, SquareIcon } from 'lucide-react';
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import type { FormEvent, KeyboardEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';

export interface Props {
	onSubmit: (message: string) => void;
	onStop: () => void;
	isLoading: boolean;
	disabled?: boolean;
}

export function ChatInput({ onSubmit, onStop, isLoading, disabled = false }: Props) {
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const [input, setInput] = useState('');

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isLoading) {
			return;
		}
		onSubmit(input);
		setInput('');
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	};

	return (
		<div className='p-4 pt-0 backdrop-blur-sm dark:bg-slate-900/50'>
			<form onSubmit={handleSubmit} className='mx-auto max-w-3xl'>
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
						{isLoading ? (
							<InputGroupButton
								type='button'
								variant='destructive'
								className='rounded-full ml-auto'
								size='icon-xs'
								onClick={onStop}
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
								disabled={disabled || !input}
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
