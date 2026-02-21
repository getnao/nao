import { ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Prompt } from 'prompt-mentions';
import { Button, ChatButton, MicButton } from './ui/button';
import { SlidingWaveform } from './sliding-waveform';

import type { PromptTheme, PromptHandle, SelectedMention } from 'prompt-mentions';
import 'prompt-mentions/style.css';
import type { FormEvent } from 'react';

import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
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
import { useTranscribe } from '@/hooks/use-transcribe';
import { capitalize, cn } from '@/lib/utils';

type ChatInputSubmitArgs = {
	text: string;
};

type ChatInputBaseProps = {
	promptRef: React.RefObject<PromptHandle | null>;
	className?: string;
	placeholder?: string;
	initialText?: string;
	onCancel?: () => void;
	onSubmitMessage: (args: ChatInputSubmitArgs) => Promise<void>;
};

type ChatInputProps = {
	className?: string;
	placeholder?: string;
};

type ChatInputInlineProps = {
	className?: string;
	initialText: string;
	onCancel: () => void;
	onSubmitMessage: (args: ChatInputSubmitArgs) => Promise<void>;
};

export function ChatInput({ className, placeholder }: ChatInputProps = {}) {
	const promptRef = useRef<PromptHandle>(null);
	const { sendMessage } = useAgentContext();

	useRegisterSetChatInputCallback((text) => {
		promptRef.current?.clear();
		promptRef.current?.insertText(text);
		promptRef.current?.focus();
	});

	return (
		<ChatInputBase
			promptRef={promptRef}
			className={className}
			placeholder={placeholder}
			onSubmitMessage={sendMessage}
		/>
	);
}

export function ChatInputInline({ className, initialText, onCancel, onSubmitMessage }: ChatInputInlineProps) {
	const promptRef = useRef<PromptHandle>(null);

	return (
		<ChatInputBase
			promptRef={promptRef}
			className={className}
			initialText={initialText}
			onCancel={onCancel}
			onSubmitMessage={onSubmitMessage}
		/>
	);
}

function ChatInputBase({
	promptRef,
	className,
	placeholder = 'Ask anything about your data...',
	initialText,
	onCancel,
	onSubmitMessage,
}: ChatInputBaseProps) {
	const [hasInput, setHasInput] = useState(false);
	const { isRunning, stopAgent, isLoadingMessages, selectedModel, setSelectedModel, setMentions } = useAgentContext();
	const chatId = useParams({ strict: false, select: (p) => p.chatId });
	const availableModels = useQuery(trpc.project.getAvailableModels.queryOptions());
	const knownModels = useQuery(trpc.project.getKnownModels.queryOptions());
	const skills = useQuery(trpc.skill.list.queryOptions());

	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const transcribeModels = useQuery(trpc.project.getKnownTranscribeModels.queryOptions());
	const isTranscribeEnabled = agentSettings.data?.transcribe?.enabled ?? false;
	const hasTranscribeProvider = Object.values(transcribeModels.data ?? {}).some((p) => p.hasKey);
	const isTranscribeReady = isTranscribeEnabled && hasTranscribeProvider;

	const [micWarning, setMicWarning] = useState(false);
	const micWarningTimer = useRef(0);

	const showMicWarning = useCallback(() => {
		setMicWarning(true);
		window.clearTimeout(micWarningTimer.current);
		micWarningTimer.current = window.setTimeout(() => setMicWarning(false), 5000);
	}, []);

	const submitMessage = useCallback(
		async (text: string, currentMentions: SelectedMention[]) => {
			const trimmedInput = text.trim();
			if (!trimmedInput || isRunning) {
				return;
			}
			setMentions(currentMentions.map((m) => ({ id: m.id, label: m.label, trigger: m.trigger })));
			promptRef.current?.clear();
			setHasInput(false);
			await onSubmitMessage({ text: trimmedInput });
		},
		[onSubmitMessage, isRunning, setMentions, promptRef],
	);

	const onTranscribed = useCallback(
		(text: string) => {
			if (isRunning) {
				return;
			}
			submitMessage(text, []);
		},
		[submitMessage, isRunning],
	);

	const { state: transcribeState, toggle: toggleRecording, analyserRef } = useTranscribe(onTranscribed);
	const isRecording = transcribeState === 'recording';
	const isTranscribing = transcribeState === 'transcribing';

	useEffect(() => promptRef.current?.focus(), [chatId, promptRef]);

	useEffect(() => {
		if (typeof initialText !== 'string') {
			return;
		}
		promptRef.current?.clear();
		promptRef.current?.insertText(initialText);
		setHasInput(!!initialText.trim());
		promptRef.current?.focus();
	}, [initialText, promptRef]);

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

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		const value = promptRef.current?.getValue() ?? '';
		const mentions = promptRef.current?.getMentions() ?? [];
		await submitMessage(value, mentions);
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
		padding: '12px',
		fontFamily: 'inherit',
		fontSize: '14px',
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
		<div className={cn('p-4 pt-0 max-w-3xl w-full mx-auto', className)}>
			<form onSubmit={handleSubmit} className='mx-auto relative'>
				<InputGroup htmlFor='chat-input'>
					<Prompt
						ref={promptRef}
						placeholder={placeholder}
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
						onEnter={(value, mentions) => submitMessage(value, mentions)}
						className='w-full nao-input'
						theme={theme}
					/>

					<InputGroupAddon align='block-end'>
						{(!isTranscribeReady || (!isRecording && !isTranscribing)) && models.length > 0 && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild disabled={!hasMultipleModels}>
									<Button
										variant='ghost-no-hover'
										className={cn(
											'flex items-center text-sm font-normal text-muted-foreground outline-none p-[0_!important] h-auto',
											hasMultipleModels
												? 'hover:text-foreground cursor-pointer'
												: 'cursor-default',
										)}
									>
										{selectedModel && (
											<LlmProviderIcon provider={selectedModel.provider} className='size-4' />
										)}
										{selectedModel
											? getModelDisplayName(selectedModel.provider, selectedModel.modelId)
											: 'Select model'}
										{hasMultipleModels && <ChevronDown className='size-3' />}
									</Button>
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

						{isTranscribeReady && isRecording && <SlidingWaveform analyserRef={analyserRef} />}

						<div className='flex items-center gap-2 ml-auto relative'>
							{onCancel && (
								<Button variant='ghost' type='button' size='sm' onClick={onCancel}>
									Cancel
								</Button>
							)}

							{isTranscribeReady && isRecording && <RecordingTimer />}
							<MicButton
								state={isTranscribeReady ? transcribeState : 'idle'}
								onClick={isTranscribeReady ? toggleRecording : showMicWarning}
								disabled={isRunning}
							/>
							{micWarning && <MicWarningBanner onDismiss={() => setMicWarning(false)} />}

							<ChatButton
								isRunning={isRunning}
								disabled={isLoadingMessages || !hasInput}
								onClick={isRunning ? stopAgent : handleSubmit}
								type='button'
							/>
						</div>
					</InputGroupAddon>
				</InputGroup>
			</form>
		</div>
	);
}

function RecordingTimer() {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		const id = setInterval(() => setElapsed((s) => s + 1), 1000);
		return () => clearInterval(id);
	}, []);

	const mins = Math.floor(elapsed / 60);
	const secs = elapsed % 60;

	return (
		<span className='text-xs tabular-nums text-muted-foreground'>
			{mins}:{secs.toString().padStart(2, '0')}
		</span>
	);
}

function MicWarningBanner({ onDismiss }: { onDismiss: () => void }) {
	return (
		<div className='absolute bottom-full right-0 mb-2 w-64 rounded-md border bg-popover p-3 text-popover-foreground shadow-md animate-in fade-in slide-in-from-bottom-2 duration-200'>
			<button
				type='button'
				onClick={onDismiss}
				className='absolute top-1 right-1.5 text-muted-foreground hover:text-foreground text-xs cursor-pointer'
			>
				&times;
			</button>
			<p className='text-sm'>
				Voice input is not configured.{' '}
				<Link
					to='/settings/project/models'
					className='font-medium text-primary underline underline-offset-2 hover:text-primary/80'
				>
					Go to Settings &rarr; Models
				</Link>{' '}
				to enable transcription and set up a provider. Ask your admin.
			</p>
		</div>
	);
}
