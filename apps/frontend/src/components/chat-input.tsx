import { ArrowUpIcon, ChevronDown, SquareIcon } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FormEvent, KeyboardEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group';
import {
	DropdownMenu,
	DropdownMenuItem,
	DropdownMenuGroup,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpc } from '@/main';
import { useAgentContext } from '@/contexts/agent.provider';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';

export function ChatInput() {
	const { sendMessage, isRunning, stopAgent, isReadyForNewMessages, selectedModel, setSelectedModel } =
		useAgentContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const availableModels = useQuery(trpc.project.getAvailableModels.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());
	const [input, setInput] = useState('');

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
							<DropdownMenu>
								<DropdownMenuTrigger asChild disabled={!hasMultipleModels}>
									<button
										type='button'
										className={`
											flex items-center gap-1.5 text-sm font-normal text-muted-foreground outline-none
											${hasMultipleModels ? 'hover:text-foreground cursor-pointer' : 'cursor-default'}
										`}
									>
										{selectedModel && (
											<LlmProviderIcon provider={selectedModel.provider} className='size-3.5' />
										)}
										{selectedModel
											? getModelDisplayName(selectedModel.provider, selectedModel.modelId)
											: 'Select model'}
										{hasMultipleModels && <ChevronDown className='size-3' />}
									</button>
								</DropdownMenuTrigger>

								{hasMultipleModels && (
									<DropdownMenuContent align='start' side='top'>
										<DropdownMenuGroup>
											{models.map((model) => {
												const isSelected =
													selectedModel?.provider === model.provider &&
													selectedModel?.modelId === model.modelId;
												return (
													<DropdownMenuItem
														key={`${model.provider}-${model.modelId}`}
														onSelect={() => setSelectedModel(model)}
														className={isSelected ? 'bg-accent' : ''}
													>
														<LlmProviderIcon provider={model.provider} className='size-4' />
														{getModelDisplayName(model.provider, model.modelId)}
													</DropdownMenuItem>
												);
											})}
										</DropdownMenuGroup>
									</DropdownMenuContent>
								)}
							</DropdownMenu>
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
