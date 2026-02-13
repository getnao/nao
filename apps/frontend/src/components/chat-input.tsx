import { ArrowUpIcon, ChevronDown, SquareIcon } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Prompt } from 'prompt-mentions';
import type { PromptTheme, PromptHandle, SelectedMention } from 'prompt-mentions';
import 'prompt-mentions/style.css';
import type { FormEvent } from 'react';

import { InputGroup, InputGroupAddon, InputGroupButton } from '@/components/ui/input-group';
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
import { capitalize } from '@/lib/utils';

export function ChatInput() {
	const [hasInput, setHasInput] = useState(false);
	const promptRef = useRef<PromptHandle>(null);
	const { sendMessage, isRunning, stopAgent, isReadyForNewMessages, selectedModel, setSelectedModel, setMentions } =
		useAgentContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const availableModels = useQuery(trpc.project.getAvailableModels.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());
	const skills = useQuery(trpc.skill.list.queryOptions());

	useRegisterSetChatInputCallback((text) => {
		promptRef.current?.clear();
		promptRef.current?.insertText(text);
		promptRef.current?.focus();
	});

	useEffect(() => promptRef.current?.focus(), [chatId]);

	// Set default model when available models load, or reset if current selection is no longer available
	useEffect(() => {
		if (!availableModels.data || availableModels.data.length === 0) {
			return;
		}

		const isCurrentSelectionValid =
			selectedModel &&
			availableModels.data.some(
				(m) => m.provider === selectedModel.provider && m.modelId === selectedModel.modelId,
			);

		if (!isCurrentSelectionValid) {
			setSelectedModel(availableModels.data[0]);
		}
	}, [availableModels.data, selectedModel, setSelectedModel]);

	const submit = (text: string, currentMentions: SelectedMention[]) => {
		if (!text.trim() || isRunning) {
			return;
		}
		setMentions(currentMentions.map((m) => ({ id: m.id, label: m.label, trigger: m.trigger })));
		sendMessage({ text });
		promptRef.current?.clear();
	};

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		const value = promptRef.current?.getValue() ?? '';
		const mentions = promptRef.current?.getMentions() ?? [];
		submit(value, mentions);
	};

	const getModelDisplayName = (provider: string, modelId: string) => {
		const models = knownModels.data?.[provider as 'openai' | 'anthropic'] ?? [];
		const model = models.find((m) => m.id === modelId);
		return model?.name ?? modelId;
	};

	const models = availableModels.data ?? [];
	const hasMultipleModels = models.length > 1;

	const theme: PromptTheme = {
		backgroundColor: 'transparent',
		placeholderColor: 'var(--color-muted-foreground)',
		borderColor: 'transparent',
		focusBorderColor: 'transparent',
		focusBoxShadow: 'none',
		minHeight: '60px',
		color: 'var(--color-foreground)',
		menu: {
			minWidth: '400px',
			backgroundColor: 'var(--popover)',
			borderColor: 'var(--border)',
			color: 'var(--popover-foreground)',
			itemHoverColor: 'var(--accent)',
		},
		pill: {
			backgroundColor: 'var(--accent)',
			color: 'var(--accent-foreground)',
			padding: 'calc(var(--spacing) * 0.4) calc(var(--spacing) * 1.2)',
			borderRadius: 'var(--radius-sm)',
		},
	};

	return (
		<div className='p-4 pt-0 max-w-3xl w-full mx-auto'>
			<form onSubmit={handleSubmit} className='mx-auto relative'>
				<InputGroup htmlFor='chat-input'>
					<Prompt
						ref={promptRef}
						placeholder='Ask anything about your data...'
						mentionConfigs={[
							{
								trigger: '/',
								menuPosition: 'above',
								options:
									(skills.data &&
										skills.data.map((s) => ({
											id: s.name,
											label: capitalize(s.name.replace(/-/g, ' ')),
											labelRight: s.description,
										}))) ||
									[],
							},
						]}
						onChange={(value) => setHasInput(!!value.trim())}
						onEnter={(value, mentions) => submit(value, mentions)}
						className='w-full nao-input'
						theme={theme}
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
								disabled={!isReadyForNewMessages || !hasInput}
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
