import { ArrowUpIcon, Loader2Icon } from 'lucide-react';
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import type { FormEvent, KeyboardEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';

export interface Props {
	onSubmit: (message: string) => void;
	isLoading: boolean;
	disabled?: boolean;
}

export function ChatInput({ onSubmit, isLoading, disabled = false }: Props) {
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
		<div className='p-4 pt-0 backdrop-blur-sm dark:bg-slate-900/50 mt-auto'>
			<form onSubmit={handleSubmit} className='mx-auto max-w-3xl'>
				<InputGroup htmlFor='chat-input'>
					<InputGroupTextarea
						key={chatId}
						autoFocus
						placeholder='Ask about the weather...'
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						id='chat-input'
					/>
					<InputGroupAddon align='block-end'>
						<InputGroupButton
							type='submit'
							variant='default'
							className='rounded-full ml-auto'
							size='icon-xs'
							disabled={disabled || !input || isLoading}
						>
							{isLoading ? <Loader2Icon className='animate-spin' /> : <ArrowUpIcon />}
							<span className='sr-only'>Send</span>
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
			</form>
		</div>
	);
}
