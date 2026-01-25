import { ArrowUpIcon, ChevronDown, SquareIcon } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FormEvent, KeyboardEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import { trpc } from '@/main';
import { useAgentContext } from '@/contexts/agent.provider';

export function ChatInput() {
	const { sendMessage, isRunning, stopAgent, isReadyForNewMessages, selectedModel, setSelectedModel } = useAgentContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const availableModels = useQuery(trpc.project.getAvailableModels.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());
	const [input, setInput] = useState('');
	const [showModelMenu, setShowModelMenu] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	// Close menu when clicking outside
	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setShowModelMenu(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	// Set default model when available models load, or reset if current selection is no longer available
	useEffect(() => {
		if (!availableModels.data || availableModels.data.length === 0) {
			return;
		}

		// Check if current selection is still valid
		const isCurrentSelectionValid =
			selectedModel &&
			availableModels.data.some(
				(m) => m.provider === selectedModel.provider && m.modelId === selectedModel.modelId,
			);

		if (!isCurrentSelectionValid) {
			// Set to first available model
			setSelectedModel(availableModels.data[0]);
		}
	}, [availableModels.data, selectedModel, setSelectedModel]);

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

	const getModelDisplayName = (provider: string, modelId: string) => {
		const models = knownModels.data?.[provider as 'openai' | 'anthropic'] ?? [];
		const model = models.find((m) => m.id === modelId);
		return model?.name ?? modelId;
	};

	const models = availableModels.data ?? [];
	const hasMultipleModels = models.length > 1;

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
						{/* Model selector */}
						{models.length > 0 && (
							<div className='relative' ref={menuRef}>
								<button
									type='button'
									onClick={() => hasMultipleModels && setShowModelMenu(!showModelMenu)}
									className={`
										flex items-center gap-1 text-sm font-normal text-muted-foreground
										${hasMultipleModels ? 'hover:text-foreground cursor-pointer' : 'cursor-default'}
									`}
								>
									{selectedModel
										? getModelDisplayName(selectedModel.provider, selectedModel.modelId)
										: 'Select model'}
									{hasMultipleModels && <ChevronDown className='size-3' />}
								</button>

								{showModelMenu && hasMultipleModels && (
									<div className='absolute bottom-full left-0 mb-2 py-1 min-w-[180px] rounded-md border border-border bg-popover shadow-lg z-50'>
										{models.map((model) => {
											const isSelected =
												selectedModel?.provider === model.provider &&
												selectedModel?.modelId === model.modelId;
											return (
												<button
													key={`${model.provider}-${model.modelId}`}
													type='button'
													onClick={() => {
														setSelectedModel(model);
														setShowModelMenu(false);
													}}
													className={`
														w-full px-3 py-1.5 text-left text-sm transition-colors
														${isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}
													`}
												>
													<span className='block'>{getModelDisplayName(model.provider, model.modelId)}</span>
													<span className='block text-xs text-muted-foreground capitalize'>
														{model.provider}
													</span>
												</button>
											);
										})}
									</div>
								)}
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
