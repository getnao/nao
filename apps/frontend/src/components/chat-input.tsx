import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, PencilRuler, Database } from 'lucide-react';
import { Button, ChatButton, MicButton } from './ui/button';
import { SlidingWaveform } from './chat-input-sliding-waveform';
import { ChatPrompt, STORY_MENTION_ID, DATABASE_MENTION_TRIGGER } from './chat-input-prompt';
import { ChatInputModelSelect } from './chat-input-model-select';
import { ChatInputMessageQueue } from './chat-input-message-queue';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import StoryIcon from './ui/story-icon';
import type { PromptHandle, SelectedMention } from 'prompt-mentions';
import type { FormEvent } from 'react';
import type { AgentHelpers } from '@/hooks/use-agent';
import { ContextWindowRing } from '@/components/ui/chat-input-context-window-ring';

import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
import { trpc } from '@/main';
import { useAgentContext } from '@/contexts/agent.provider';
import { useRegisterSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { useTranscribe } from '@/hooks/use-transcribe';
import { cn } from '@/lib/utils';
import { useChatId } from '@/hooks/use-chat-id';
import { messageQueueStore } from '@/stores/chat-message-queue';

type ChatInputBaseProps = {
	promptRef: React.RefObject<PromptHandle | null>;
	className?: string;
	placeholder?: string;
	initialText?: string;
	onCancel?: () => void;
	onSubmitMessage: AgentHelpers['queueOrSendMessage'];
	allowQueueing?: boolean;
};

type ChatInputInlineProps = {
	className?: string;
	initialText: string;
	onCancel: () => void;
	onSubmitMessage: AgentHelpers['queueOrSendMessage'];
};

export function ChatInput() {
	const promptRef = useRef<PromptHandle>(null);
	const { queueOrSendMessage } = useAgentContext();

	useRegisterSetChatInputCallback((text) => {
		promptRef.current?.clear();
		promptRef.current?.insertText(text);
		promptRef.current?.focus();
	});

	return <ChatInputBase promptRef={promptRef} onSubmitMessage={queueOrSendMessage} allowQueueing />;
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
	allowQueueing,
}: ChatInputBaseProps) {
	const [inputText, setInputText] = useState('');
	const { isRunning, stopAgent, isLoadingMessages, setMentions, submitQueuedMessageNow } = useAgentContext();
	const chatId = useChatId();
	const effectivePlaceholder = isRunning && allowQueueing ? 'Add a follow-up...' : placeholder;

	const agentSettings = useQuery(trpc.project.getAgentSettings.queryOptions());
	const transcribeModels = useQuery(trpc.project.getKnownTranscribeModels.queryOptions());
	const isTranscribeEnabled = agentSettings.data?.transcribe?.enabled ?? false;
	const hasTranscribeProvider = Object.values(transcribeModels.data ?? {}).some((p) => p.hasKey);
	const isTranscribeReady = isTranscribeEnabled && hasTranscribeProvider;

	const [micWarning, setMicWarning] = useState(false);
	const micWarningTimer = useRef(0);

	useEffect(() => promptRef.current?.focus(), [chatId, promptRef]);

	const showMicWarning = useCallback(() => {
		setMicWarning(true);
		window.clearTimeout(micWarningTimer.current);
		micWarningTimer.current = window.setTimeout(() => setMicWarning(false), 5000);
	}, []);

	const submitMessage = useCallback(
		async (text: string, currentMentions: SelectedMention[] = []) => {
			const trimmedInput = text.trim();

			if (!trimmedInput) {
				if (isRunning && allowQueueing) {
					const queue = messageQueueStore.getSnapshot(chatId);
					if (queue?.length) {
						await submitQueuedMessageNow(queue[0].id);
					}
				}
				return;
			}

			if (isRunning && !allowQueueing) {
				return;
			}

			setMentions(currentMentions.map((m) => ({ id: m.id, label: m.label, trigger: m.trigger })));
			promptRef.current?.clear();
			setInputText('');

			await onSubmitMessage({ text: trimmedInput });
		},
		[onSubmitMessage, isRunning, allowQueueing, setMentions, promptRef, chatId, submitQueuedMessageNow],
	);

	const {
		state: transcribeState,
		toggle: toggleRecording,
		isRecording,
		isTranscribing,
		analyserRef,
	} = useTranscribe({ onTranscribed: submitMessage });

	useEffect(() => {
		if (typeof initialText !== 'string') {
			return;
		}
		promptRef.current?.clear();
		promptRef.current?.insertText(initialText);
		setInputText(initialText);
		promptRef.current?.focus();
	}, [initialText, promptRef]);

	const handleSubmitMessage = async (e: FormEvent) => {
		e.preventDefault();
		const mentions = promptRef.current?.getMentions() ?? [];
		await submitMessage(inputText, mentions);
	};
	const isInputEmpty = !inputText.trim();

	const skills = useQuery(trpc.skill.list.queryOptions());
	const databaseObjects = useQuery(trpc.project.getDatabaseObjects.queryOptions());
	const hasSkills = Boolean(skills.data?.length);
	const hasDatabases = Boolean(databaseObjects.data?.length);

	const handleEditQueuedMessage = useCallback(
		(text: string) => {
			promptRef.current?.clear();
			promptRef.current?.insertText(text);
			promptRef.current?.focus();
		},
		[promptRef],
	);

	const openSkillsMenu = useCallback(() => {
		promptRef.current?.insertText('/');
	}, [promptRef]);

	const openDatabaseMenu = useCallback(() => {
		promptRef.current?.insertText(DATABASE_MENTION_TRIGGER);
	}, [promptRef]);

	return (
		<div className={cn('px-3 pb-3 pt-0 md:px-4 md:pb-4 max-w-3xl w-full mx-auto', className)}>
			<ChatInputMessageQueue onEditMessage={handleEditQueuedMessage} onSubmitNow={submitQueuedMessageNow} />

			<form onSubmit={handleSubmitMessage} className='mx-auto relative'>
				<InputGroup htmlFor='chat-input' className='dark:bg-muted'>
					<ChatPrompt
						promptRef={promptRef}
						placeholder={effectivePlaceholder}
						onChange={(value) => setInputText(value)}
						onEnter={(value, mentions) => submitMessage(value, mentions)}
					/>

					<InputGroupAddon align='block-end'>
						{(!isTranscribeReady || (!isRecording && !isTranscribing)) && <ChatInputModelSelect />}

						{isTranscribeReady && isRecording && <SlidingWaveform analyserRef={analyserRef} />}

						<div className='flex items-center gap-1.5 md:gap-2 ml-auto relative'>
							<ChatInputPlusMenu
								hasDatabases={hasDatabases}
								hasSkills={hasSkills}
								onAddStory={() => {
									promptRef.current?.appendMention(
										{ id: STORY_MENTION_ID, label: 'Story mode' },
										'#',
									);
								}}
								onOpenSkills={openSkillsMenu}
								onOpenDatabase={openDatabaseMenu}
								onFocusPrompt={() => promptRef.current?.focus()}
							/>

							{onCancel && (
								<Button variant='ghost' type='button' size='sm' onClick={onCancel}>
									Cancel
								</Button>
							)}

							<ContextWindowRing />

							{isTranscribeReady && isRecording && <RecordingTimer />}
							<MicButton
								state={isTranscribeReady ? transcribeState : 'idle'}
								onClick={isTranscribeReady ? toggleRecording : showMicWarning}
								disabled={isRunning && !allowQueueing}
							/>
							{micWarning && <MicWarningBanner onDismiss={() => setMicWarning(false)} />}

							{allowQueueing && isRunning ? (
								<ChatButton
									showStop={isInputEmpty}
									disabled={false}
									onClick={isInputEmpty ? stopAgent : handleSubmitMessage}
									type='button'
								/>
							) : (
								<ChatButton
									showStop={isRunning}
									disabled={isLoadingMessages || isInputEmpty}
									onClick={isRunning ? stopAgent : handleSubmitMessage}
									type='button'
								/>
							)}
						</div>
					</InputGroupAddon>
				</InputGroup>
			</form>
		</div>
	);
}

function ChatInputPlusMenu({
	hasDatabases,
	hasSkills,
	onAddStory,
	onOpenSkills,
	onOpenDatabase,
	onFocusPrompt,
}: {
	hasDatabases: boolean;
	hasSkills: boolean;
	onAddStory: () => void;
	onOpenSkills: () => void;
	onOpenDatabase: () => void;
	onFocusPrompt: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					aria-label='Add context'
					className='inline-flex items-center justify-center rounded-full size-7 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer'
				>
					<Plus className='size-4 transition-transform duration-200 [[data-state=open]_&]:rotate-45' />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				side='top'
				align='start'
				collisionPadding={12}
				className='min-w-44'
				onCloseAutoFocus={(e) => {
					e.preventDefault();
					requestAnimationFrame(onFocusPrompt);
				}}
			>
				{hasDatabases && (
					<DropdownMenuItem onSelect={onOpenDatabase}>
						<Database className='size-4' />
						<span>Database tables</span>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={onAddStory}>
					<StoryIcon className='size-4' />
					<span>Story mode</span>
				</DropdownMenuItem>
				{hasSkills && (
					<DropdownMenuItem onSelect={onOpenSkills}>
						<PencilRuler className='size-4' />
						<span>Skills</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
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
