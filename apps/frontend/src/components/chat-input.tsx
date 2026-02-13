import { ArrowUpIcon, ChevronDown, SquareIcon, SparklesIcon } from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
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
import { useRegisterSetChatInputCallback } from '@/contexts/set-chat-input-callback';

export function ChatInput() {
	const [input, setInput] = useState('');
	const [showSkillsMenu, setShowSkillsMenu] = useState(false);
	const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const { sendMessage, isRunning, stopAgent, isReadyForNewMessages, selectedModel, setSelectedModel } =
		useAgentContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const availableModels = useQuery(trpc.project.getAvailableModels.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());
	const skills = useQuery(trpc.skill.list.queryOptions());

	// Register the callback function for setting the input value
	useRegisterSetChatInputCallback((text) => {
		setInput(text);
		inputRef.current?.focus();
	});

	useEffect(() => inputRef.current?.focus(), [chatId]);

	// Detect slash command and filter skills
	const filteredSkills = useMemo(() => {
		if (!input.startsWith('/') || !skills.data) {
			return [];
		}

		const searchTerm = input.slice(1).toLowerCase();
		if (!searchTerm) {
			return skills.data;
		}

		return skills.data.filter(
			(skill) =>
				skill.name.toLowerCase().includes(searchTerm) || skill.description.toLowerCase().includes(searchTerm),
		);
	}, [input, skills.data]);

	// Show/hide skills menu based on input
	useEffect(() => {
		const shouldShow = input.startsWith('/') && filteredSkills.length > 0;
		setShowSkillsMenu(shouldShow);
		if (shouldShow) {
			setSelectedSkillIndex(0);
		}
	}, [input, filteredSkills.length]);

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

	const handleSkillSelect = (skillName: string) => {
		try {
			setInput('');
			setShowSkillsMenu(false);
			sendMessage({ text: `/${skillName}` });
		} catch (error) {
			console.error('Failed to load skill content:', error);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (showSkillsMenu) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				setSelectedSkillIndex((prev) => Math.min(prev + 1, filteredSkills.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				setSelectedSkillIndex((prev) => Math.max(prev - 1, 0));
			} else if (e.key === 'Escape') {
				e.preventDefault();
				setShowSkillsMenu(false);
			} else if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				const selectedSkill = filteredSkills[selectedSkillIndex];
				if (selectedSkill) {
					handleSkillSelect(selectedSkill.name);
				}
			}
		} else if (e.key === 'Enter' && !e.shiftKey) {
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
			<form onSubmit={handleSubmit} className='mx-auto relative'>
				{showSkillsMenu && (
					<div className='absolute bottom-full left-0 right-0 mb-2 bg-popover border rounded-lg shadow-lg max-h-64 overflow-y-auto z-50'>
						<div className='p-1'>
							{filteredSkills.map((skill, index) => (
								<button
									key={skill.name}
									type='button'
									onClick={() => handleSkillSelect(skill.name)}
									className={`
										w-full text-left px-3 py-2 rounded-md flex items-start gap-2 cursor-pointer
										${index === selectedSkillIndex ? 'bg-accent' : 'hover:bg-accent/50'}
									`}
								>
									<SparklesIcon className='size-4 mt-0.5 shrink-0 text-muted-foreground' />
									<div className='flex-1 min-w-0'>
										<div className='text-sm font-medium'>{skill.name}</div>
										<div className='text-xs text-muted-foreground truncate'>
											{skill.description}
										</div>
									</div>
								</button>
							))}
						</div>
					</div>
				)}

				<InputGroup htmlFor='chat-input'>
					<InputGroupTextarea
						ref={inputRef}
						autoFocus
						placeholder='Ask anything about your data...'
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						id='chat-input'
						className='max-h-64'
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
