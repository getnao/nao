import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	Plus,
	PencilRuler,
	Database,
	Library,
	Paperclip,
	AlertTriangle,
	Shield,
	Check,
	MessageCircleOff,
	LockKeyhole,
} from 'lucide-react';
import { ALLOWED_IMAGE_MEDIA_TYPES, ATTACHMENT_ACCEPT } from '@nao/shared/attachments';
import { toStoryReferenceMentionId } from '@nao/shared';
import { story } from '@nao/shared/tools';
import { Button, ChatButton, MicButton } from './ui/button';
import { SlidingWaveform } from './chat-input-sliding-waveform';
import {
	ChatPrompt,
	DATABASE_MENTION_TRIGGER,
	openMentionMenuAtEnd,
	openReferenceMenuAtEnd,
	SKILL_MENTION_TRIGGER,
	STORY_REFERENCE_MENTION_TRIGGER,
	useStoryMentionOptions,
	useStoryReferenceOptions,
} from './chat-input-prompt';
import { ChatInputAnimatedBorder } from './chat-input-animated-border';
import { ChatInputModelSelect } from './chat-input-model-select';
import { ChatInputMessageQueue } from './chat-input-message-queue';
import { ChatInputAttachmentPreview } from './chat-input-attachment-preview';
import { ManagedCreditsExhausted } from './managed-credits-exhausted';
import { ContactSupportButton } from './contact-support-dialog';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './ui/dropdown-menu';
import type { MentionOption, PromptHandle, SelectedMention } from 'prompt-mentions';
import type { FormEvent } from 'react';
import type { AgentHelpers } from '@/hooks/use-agent';
import type { ChatAllowanceExhaustedScope } from '@/lib/ai';
import type { StoryReferences } from '@/lib/story-reference';
import { ContextWindowRing } from '@/components/ui/chat-input-context-window-ring';
import { SimpleTooltip } from '@/components/ui/tooltip';

import { InputGroup, InputGroupAddon } from '@/components/ui/input-group';
import { Callout } from '@/components/ui/callout';
import { trpc } from '@/main';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useRegisterSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { useTranscribe } from '@/hooks/use-transcribe';
import { useAttachmentUpload } from '@/hooks/use-attachment-upload';
import {
	hasManagedCreditsForRequest,
	parseBudgetError,
	parseChatAllowanceExhaustedError,
	parseManagedCreditsError,
} from '@/lib/ai';
import { cn } from '@/lib/utils';
import { useChatId } from '@/hooks/use-chat-id';
import { useModelSelection } from '@/hooks/use-model-selection';
import { usePermissions } from '@/hooks/use-permissions';
import { getShortcut } from '@/lib/keyboard-shortcuts';
import { matchesShortcut } from '@/lib/platform';
import {
	STORIES_ROOT_ID,
	TABLES_ROOT_ID,
	toStoryFolderReferenceOption,
	toStoryReferenceOption,
} from '@/lib/reference-mention-menu';
import { hasAnyStoryReference, mayCarryStories, readDroppedReferences } from '@/lib/story-reference';
import { takePendingStoryReferences, usePendingStoryReferences } from '@/stores/story-references';
import { messageQueueStore } from '@/stores/chat-message-queue';
import { chatInputRestoreStore, useChatInputRestore } from '@/stores/chat-input-restore';
import { chatPendingCitationStore, toMessageCitations } from '@/stores/chat-pending-citation';
import { useChatPendingCitations } from '@/hooks/use-chat-pending-citation';
import { CITATION_MENTION_TRIGGER, removeCitationTokens } from '@/lib/citation-mention';
import { useCitationPills } from '@/hooks/use-citation-pills';
import { useOpenCitation } from '@/hooks/use-open-citation';
import { CitationPillPreview } from '@/components/citation-pill-preview';
import { useEffectiveUserGroupFeatures } from '@/hooks/use-effective-user-group-features';
import { ChatInputSuggestions, SuggestionCard } from '@/components/chat-input-suggestions';
import { runWithStoryBeforeAgentSend, useStoryBeforeAgentSend } from '@/contexts/story-before-agent-send';
import { useIsCloud } from '@/hooks/use-nao-mode';

const cycleModelShortcut = getShortcut('cycle-model').shortcut;
const TRIAL_ATTACHMENT_ACCEPT = ALLOWED_IMAGE_MEDIA_TYPES.join(',');
const TRIAL_DOCUMENTS_DISABLED_REASON = 'Documents can be attached once your project is set up. Images work now.';

type ChatInputVariant = 'default' | 'onboarding';

type ChatInputBaseProps = {
	promptRef: React.RefObject<PromptHandle | null>;
	className?: string;
	variant?: ChatInputVariant;
	placeholder?: string;
	initialText?: string;
	onCancel?: () => void;
	onSubmitMessage: AgentHelpers['queueOrSendMessage'];
	allowQueueing?: boolean;
	acceptsPendingStoryReferences?: boolean;
};

type ChatInputInlineProps = {
	className?: string;
	initialText: string;
	onCancel?: () => void;
	onSubmitMessage: AgentHelpers['queueOrSendMessage'];
};

export function ChatInput({
	variant = 'default',
	acceptsPendingStoryReferences = false,
}: {
	variant?: ChatInputVariant;
	acceptsPendingStoryReferences?: boolean;
}) {
	const promptRef = useRef<PromptHandle>(null);
	const { queueOrSendMessage } = useAgentContext();

	useRegisterSetChatInputCallback((text) => {
		promptRef.current?.clear();
		if (text) {
			promptRef.current?.insertText(text);
		}
		requestAnimationFrame(() => promptRef.current?.focus());
	});

	return (
		<ChatInputBase
			promptRef={promptRef}
			variant={variant}
			onSubmitMessage={queueOrSendMessage}
			allowQueueing
			acceptsPendingStoryReferences={acceptsPendingStoryReferences}
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
	variant = 'default',
	placeholder,
	initialText,
	onCancel,
	onSubmitMessage,
	allowQueueing,
	acceptsPendingStoryReferences = false,
}: ChatInputBaseProps) {
	const [inputText, setInputText] = useState('');
	const [managedCreditDialogOpen, setManagedCreditDialogOpen] = useState(false);
	const [verifiedManagedCreditError, setVerifiedManagedCreditError] = useState<Error>();
	const {
		isRunning,
		cancelAgent,
		isLoadingMessages,
		adminMode,
		setAdminMode,
		setMentions,
		submitQueuedMessageNow,
		error,
		clearError,
		selectedModel,
		mode,
	} = useAgentContext();
	const navigate = useNavigate();
	const { canChatWithNaoData, isAdmin, isOrgAdmin } = usePermissions();
	const { storyCreationEnabled } = useEffectiveUserGroupFeatures();
	const storyMentionOptions = useStoryMentionOptions(storyCreationEnabled);
	const { options: storyReferenceOptions, isLoaded: areReferenceableStoriesLoaded } = useStoryReferenceOptions({
		excludeCurrentChat: true,
	});
	const chatId = useChatId();
	const storyBeforeAgentSend = useStoryBeforeAgentSend();

	const isAdminMode = canChatWithNaoData && adminMode;
	const adminModeLocked = useAgentMessagesSelector((messages) => messages.some((message) => message.role === 'user'));
	const handleSelectAdminMode = useCallback(() => {
		if (!adminModeLocked) {
			setAdminMode(!isAdminMode);
			return;
		}
		if (isAdminMode) {
			return;
		}
		navigate({ to: '/', search: { admin: true } });
	}, [adminModeLocked, isAdminMode, setAdminMode, navigate]);
	const { canCycleModels, cycleModel } = useModelSelection();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const hasProject = project.data != null;
	const isTrial = useIsCloud() && project.data === null;
	const uploadLimits = useQuery({
		...trpc.storage.getUploadLimits.queryOptions(),
		enabled: hasProject,
	});
	const attachmentUpload = useAttachmentUpload({
		documentsEnabled: isTrial ? false : uploadLimits.data?.enabled,
		documentsDisabledReason: isTrial ? TRIAL_DOCUMENTS_DISABLED_REASON : undefined,
		maxDocumentSizeMb: uploadLimits.data?.maxFileSizeMb ?? 0,
	});
	const chatInputRestore = useChatInputRestore(!!allowQueueing);

	const agentSettings = useQuery({
		...trpc.project.getAgentSettings.queryOptions(),
		enabled: hasProject,
	});
	const transcribeModels = useQuery({
		...trpc.project.getKnownTranscribeModels.queryOptions(),
		enabled: hasProject,
	});
	const isTranscribeEnabled = hasProject && (agentSettings.data?.transcribe?.enabled ?? false);
	const hasTranscribeProvider = Object.values(transcribeModels.data ?? {}).some((p) => p.hasKey);
	const isTranscribeReady = isTranscribeEnabled && hasTranscribeProvider;

	const budgetStatus = useQuery({
		...trpc.budget.checkBudgetStatus.queryOptions({ provider: selectedModel?.provider ?? 'openai' }),
		enabled: hasProject && !!selectedModel?.provider && selectedModel.provider !== 'nao',
		refetchOnWindowFocus: false,
	});
	const managedCreditError = parseManagedCreditsError(error);
	const requiredBalanceMicroUsd = managedCreditError?.requiredBalanceMicroUsd;
	const isManagedModel = selectedModel?.provider === 'nao';
	const managedCredit = useQuery({
		...trpc.account.getManagedCreditStatus.queryOptions(),
		enabled: hasProject && isManagedModel,
		refetchInterval: requiredBalanceMicroUsd ? 5_000 : false,
		refetchOnWindowFocus: 'always',
	});
	const refetchManagedCredit = managedCredit.refetch;
	const currentBalanceMicroUsd = managedCredit.data?.balanceMicroUsd;
	const hasVerifiedManagedCreditBalance = verifiedManagedCreditError === error;
	const isManagedCreditsBlocked =
		isManagedModel &&
		(managedCredit.data?.hasCredits === false ||
			(requiredBalanceMicroUsd !== undefined &&
				(!hasVerifiedManagedCreditBalance ||
					!hasManagedCreditsForRequest(currentBalanceMicroUsd, requiredBalanceMicroUsd))));
	const allowanceExhaustedScope = hasProject ? null : parseChatAllowanceExhaustedError(error);
	const isSendBlocked =
		!!parseBudgetError(error) ||
		!!allowanceExhaustedScope ||
		(hasProject && budgetStatus.data?.level === 'exceeded') ||
		isManagedCreditsBlocked;

	useEffect(() => {
		if (!error || !isManagedModel || requiredBalanceMicroUsd === undefined) {
			return;
		}
		let cancelled = false;
		setVerifiedManagedCreditError(undefined);
		setManagedCreditDialogOpen(true);
		void refetchManagedCredit().then(({ data, isSuccess }) => {
			if (cancelled) {
				return;
			}
			if (isSuccess && hasManagedCreditsForRequest(data?.balanceMicroUsd, requiredBalanceMicroUsd)) {
				setManagedCreditDialogOpen(false);
				clearError();
				return;
			}
			if (isSuccess) {
				setVerifiedManagedCreditError(error);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [error, isManagedModel, requiredBalanceMicroUsd, refetchManagedCredit, clearError]);

	useEffect(() => {
		if (
			!hasVerifiedManagedCreditBalance ||
			requiredBalanceMicroUsd === undefined ||
			!hasManagedCreditsForRequest(currentBalanceMicroUsd, requiredBalanceMicroUsd)
		) {
			return;
		}
		setManagedCreditDialogOpen(false);
		clearError();
	}, [hasVerifiedManagedCreditBalance, requiredBalanceMicroUsd, currentBalanceMicroUsd, clearError]);

	const [micWarning, setMicWarning] = useState(false);
	const micWarningTimer = useRef(0);
	const dropZoneRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState(false);

	useEffect(() => promptRef.current?.focus(), [chatId, promptRef]);

	const queryClient = useQueryClient();
	const currentProjectId = project.data?.id;

	/** Stories past the referenceable list, such as older ones in a large project, are resolved one by one. */
	const findStoryReferenceOption = useCallback(
		async (storyId: string): Promise<MentionOption | null> => {
			const option = storyReferenceOptions.find(
				(storyOption) => storyOption.id === toStoryReferenceMentionId(storyId),
			);
			if (option) {
				return option;
			}
			const resolved = await queryClient
				.fetchQuery(trpc.story.resolve.queryOptions({ storyId }))
				.catch(() => null);
			return resolved &&
				!resolved.isArchived &&
				resolved.chatId !== chatId &&
				resolved.projectId === currentProjectId
				? toStoryReferenceOption(resolved)
				: null;
		},
		[storyReferenceOptions, queryClient, chatId, currentProjectId],
	);

	const storyFolders = useQuery(trpc.storyFolder.listTree.queryOptions({ archived: false }));

	const findFolderReferenceOption = useCallback(
		(folderId: string): MentionOption | null => {
			const folder = storyFolders.data?.find((storyFolder) => storyFolder.id === folderId);
			return folder ? toStoryFolderReferenceOption(folder) : null;
		},
		[storyFolders.data],
	);

	const addStoryReferences = useCallback(
		async ({ storyIds, folderIds }: StoryReferences) => {
			const storyOptions = await Promise.all(storyIds.map(findStoryReferenceOption));
			for (const option of [...storyOptions, ...folderIds.map(findFolderReferenceOption)]) {
				if (option) {
					promptRef.current?.appendMention(option, STORY_REFERENCE_MENTION_TRIGGER);
				}
			}
			requestAnimationFrame(() => promptRef.current?.focus());
		},
		[findStoryReferenceOption, findFolderReferenceOption, promptRef],
	);

	const pendingStoryReferences = usePendingStoryReferences();

	const areReferencesLoaded = areReferenceableStoriesLoaded && storyFolders.isSuccess;

	useEffect(() => {
		if (!acceptsPendingStoryReferences || !hasAnyStoryReference(pendingStoryReferences) || !areReferencesLoaded) {
			return;
		}
		const references = takePendingStoryReferences();
		if (hasAnyStoryReference(references)) {
			addStoryReferences(references);
		}
	}, [acceptsPendingStoryReferences, pendingStoryReferences, areReferencesLoaded, addStoryReferences]);

	useEffect(() => {
		if (!allowQueueing || !chatInputRestore) {
			return;
		}

		chatInputRestoreStore.clear();
		promptRef.current?.clear();
		const restoredText = removeCitationTokens(chatInputRestore.text);
		promptRef.current?.insertText(restoredText);
		setInputText(restoredText);
		attachmentUpload.clearAttachments();
		attachmentUpload.restoreDocuments(chatInputRestore.documents);

		if (chatInputRestore.citations && chatId) {
			chatPendingCitationStore.restore(chatId, chatInputRestore.citations);
		}

		const restoreImages = async () => {
			const files = await Promise.all(
				chatInputRestore.images.map(({ url, mediaType }, index) =>
					dataUrlToFile(url, mediaType, `image-${index + 1}`),
				),
			);
			await attachmentUpload.addFiles(files);
			requestAnimationFrame(() => promptRef.current?.focus());
		};
		restoreImages();
	}, [allowQueueing, chatInputRestore]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		const el = dropZoneRef.current;
		if (!el) {
			return;
		}

		let dragCounter = 0;

		const handleDragEnter = (e: DragEvent) => {
			e.preventDefault();
			dragCounter++;
			if (e.dataTransfer?.types.includes('Files') || mayCarryStories(e.dataTransfer)) {
				setIsDragging(true);
			}
		};

		const handleDragLeave = (e: DragEvent) => {
			e.preventDefault();
			dragCounter--;
			if (dragCounter === 0) {
				setIsDragging(false);
			}
		};

		const handleDragOver = (e: DragEvent) => {
			e.preventDefault();
		};

		const handleDrop = (e: DragEvent) => {
			e.preventDefault();
			dragCounter = 0;
			setIsDragging(false);
			const references = readDroppedReferences(e.dataTransfer);
			if (hasAnyStoryReference(references)) {
				addStoryReferences(references);
				return;
			}
			if (e.dataTransfer?.files) {
				attachmentUpload.addFiles(e.dataTransfer.files);
			}
		};

		el.addEventListener('dragenter', handleDragEnter);
		el.addEventListener('dragleave', handleDragLeave);
		el.addEventListener('dragover', handleDragOver);
		el.addEventListener('drop', handleDrop);
		return () => {
			el.removeEventListener('dragenter', handleDragEnter);
			el.removeEventListener('dragleave', handleDragLeave);
			el.removeEventListener('dragover', handleDragOver);
			el.removeEventListener('drop', handleDrop);
		};
	}, [attachmentUpload.addFiles, addStoryReferences]); // eslint-disable-line

	useEffect(() => {
		const handler = (e: ClipboardEvent) => {
			if (dropZoneRef.current?.contains(e.target as Node)) {
				attachmentUpload.handlePaste(e);
			}
		};
		document.addEventListener('paste', handler);
		return () => document.removeEventListener('paste', handler);
	}, [attachmentUpload.handlePaste]); // eslint-disable-line

	const showMicWarning = useCallback(() => {
		setMicWarning(true);
		window.clearTimeout(micWarningTimer.current);
		micWarningTimer.current = window.setTimeout(() => setMicWarning(false), 5000);
	}, []);

	const runGuardedAgentSend = useCallback(
		(send: () => Promise<void>) =>
			runWithStoryBeforeAgentSend({
				beforeSend: () => (chatId ? storyBeforeAgentSend.run(chatId) : Promise.resolve({ canSend: true })),
				send,
			}),
		[chatId, storyBeforeAgentSend],
	);

	const submitQueuedMessageWithGuard = useCallback(
		async (messageId: string) => {
			await runGuardedAgentSend(() => submitQueuedMessageNow(messageId));
		},
		[runGuardedAgentSend, submitQueuedMessageNow],
	);

	const submitMessage = useCallback(
		async (text: string, currentMentions: SelectedMention[] = []) => {
			const trimmedInput = text.trim();
			const citationSnapshot = chatPendingCitationStore.getSnapshot();
			const pendingCitations =
				citationSnapshot && citationSnapshot.chatId === chatId ? citationSnapshot.citations : [];
			const hasCitation = pendingCitations.length > 0;

			if (!trimmedInput && !attachmentUpload.hasAttachments && !hasCitation) {
				if (isRunning && allowQueueing) {
					const queue = messageQueueStore.getSnapshot(chatId);
					if (queue?.length) {
						await submitQueuedMessageWithGuard(queue[0].id);
					}
				}
				return;
			}

			if (
				(isRunning && !allowQueueing) ||
				isSendBlocked ||
				attachmentUpload.isPreparing ||
				attachmentUpload.hasErrors
			) {
				return;
			}

			await runGuardedAgentSend(() => {
				const message = toMessageCitations(pendingCitations, trimmedInput);
				const citations = message.citations.length > 0 ? message.citations : undefined;
				if (hasCitation) {
					chatPendingCitationStore.clear();
				}

				setMentions(
					currentMentions
						.filter((m) => m.trigger !== CITATION_MENTION_TRIGGER)
						.map((m) => ({ id: m.id, label: m.label, trigger: m.trigger })),
				);
				promptRef.current?.clear();
				setInputText('');

				const { images, documents } = attachmentUpload.getPayload();
				attachmentUpload.clearAttachments();

				return onSubmitMessage({ text: message.text, images, documents, citations });
			});
		},
		[
			onSubmitMessage,
			isRunning,
			allowQueueing,
			isSendBlocked,
			setMentions,
			promptRef,
			attachmentUpload,
			chatId,
			runGuardedAgentSend,
			submitQueuedMessageWithGuard,
		],
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
	const citationChatId = allowQueueing ? chatId : undefined;
	const pendingCitations = useChatPendingCitations(citationChatId);
	const removePendingCitation = useCallback(
		(id: string) => {
			if (citationChatId) {
				chatPendingCitationStore.remove(citationChatId, id);
			}
		},
		[citationChatId],
	);
	const citationPills = useCitationPills({
		promptRef,
		containerRef: dropZoneRef,
		citations: pendingCitations,
		scope: citationChatId,
		onRemove: removePendingCitation,
	});
	const findPendingCitation = useCallback(
		(id: string) => pendingCitations.find((citation) => citation.id === id),
		[pendingCitations],
	);
	const openCitation = useOpenCitation();
	const isInputEmpty = !inputText.trim() && !attachmentUpload.hasAttachments;

	const skills = useQuery({ ...trpc.skill.list.queryOptions(), enabled: hasProject });
	const databaseObjects = useQuery({ ...trpc.project.getDatabaseObjects.queryOptions(), enabled: hasProject });
	const hasSkills = hasProject && Boolean(skills.data?.length);
	const hasDatabases = hasProject && Boolean(databaseObjects.data?.length);
	const shortcutPlaceholder = buildShortcutPlaceholder({
		hasContext: hasDatabases || storyReferenceOptions.length > 0,
		hasSkills,
		hasStoryMode: storyMentionOptions.length > 0,
	});
	const effectivePlaceholder =
		isRunning && allowQueueing
			? 'Add a follow-up...'
			: variant === 'onboarding'
				? 'Tell me where you are starting from...'
				: (placeholder ?? shortcutPlaceholder);

	const handleEditQueuedMessage = useCallback(
		(text: string) => {
			promptRef.current?.clear();
			promptRef.current?.insertText(text);
			promptRef.current?.focus();
		},
		[promptRef],
	);

	const openMentionMenu = useCallback(
		(trigger: string) => {
			if (promptRef.current) {
				openMentionMenuAtEnd(promptRef.current, trigger);
			}
		},
		[promptRef],
	);

	const openReferenceMenu = useCallback(
		(rootId: string) => {
			if (promptRef.current) {
				openReferenceMenuAtEnd(promptRef.current, rootId);
			}
		},
		[promptRef],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			const isTypingInPrompt = event.target instanceof HTMLElement && event.target.isContentEditable;
			if (!isTypingInPrompt || !canCycleModels || !matchesShortcut(event.nativeEvent, cycleModelShortcut)) {
				return;
			}
			event.preventDefault();
			cycleModel();
		},
		[canCycleModels, cycleModel],
	);

	return (
		<div ref={dropZoneRef} className={cn('px-3 pb-3 pt-0 md:px-3 md:pb-3 max-w-3xl w-full mx-auto', className)}>
			{allowanceExhaustedScope ? (
				<ChatAllowanceExhausted scope={allowanceExhaustedScope} />
			) : (
				<>
					<ChatInputMessageQueue
						onEditMessage={handleEditQueuedMessage}
						onSubmitNow={submitQueuedMessageWithGuard}
					/>
					<BudgetBanner />
					{allowQueueing && !isAdminMode && (
						<ChatInputSuggestions
							storyCreationEnabled={storyCreationEnabled}
							isHidden={inputText.trim().length > 0}
						/>
					)}
				</>
			)}
			{isAdminMode ? <ChatInputAdminBadge /> : null}

			{isManagedCreditsBlocked && (
				<>
					<ManagedCreditsExhausted
						open={managedCreditDialogOpen}
						onOpenChange={setManagedCreditDialogOpen}
						canAddProviderKey={isAdmin}
						creditOrganizationId={isOrgAdmin ? managedCredit.data?.organization?.id : undefined}
					/>
					<ManagedCreditsLockedComposer
						isExample={mode === 'example'}
						onOpen={() => setManagedCreditDialogOpen(true)}
					/>
				</>
			)}
			<form
				onSubmit={handleSubmitMessage}
				onKeyDown={handleKeyDown}
				className={cn('mx-auto relative', isManagedCreditsBlocked && 'hidden')}
			>
				<InputGroup
					htmlFor='chat-input'
					className={cn(
						'bg-background dark:bg-background shadow-xs border-none max-md:rounded-4xl',
						isDragging && 'ring-2 ring-primary/50 border-primary',
						isAdminMode && 'ring-4 ring-amber-500/60',
					)}
				>
					{!isAdminMode && (variant === 'default' || variant === 'onboarding') && <ChatInputAnimatedBorder />}
					<ChatInputAttachmentPreview
						attachments={attachmentUpload.attachments}
						rejection={attachmentUpload.rejection}
						onRemove={attachmentUpload.removeAttachment}
					/>
					<CitationPillPreview
						containerRef={dropZoneRef}
						findCitation={findPendingCitation}
						onOpen={openCitation}
					/>
					<ChatPrompt
						promptRef={promptRef}
						placeholder={effectivePlaceholder}
						storyCreationEnabled={storyCreationEnabled}
						citationOptions={citationPills.options}
						onChange={(value) => setInputText(value)}
						onEnter={(value, mentions) => submitMessage(value, mentions)}
						onMentionDeleted={citationPills.handleMentionDeleted}
					/>

					<input
						ref={attachmentUpload.fileInputRef}
						type='file'
						accept={isTrial ? TRIAL_ATTACHMENT_ACCEPT : ATTACHMENT_ACCEPT}
						multiple
						className='hidden'
						onChange={attachmentUpload.handleFileInputChange}
					/>

					<InputGroupAddon align='block-end'>
						{!isManagedCreditsBlocked &&
							variant !== 'onboarding' &&
							(!isTranscribeReady || (!isRecording && !isTranscribing)) && (
								<ChatInputModelSelect isExample={mode === 'example'} />
							)}

						{isTranscribeReady && isRecording && <SlidingWaveform analyserRef={analyserRef} />}

						<div className='flex items-center gap-1.5 md:gap-2 ml-auto relative'>
							{mode !== 'onboarding' && (
								<ChatInputPlusMenu
									hasDatabases={hasDatabases}
									hasStoryReferences={storyReferenceOptions.length > 0}
									hasSkills={hasSkills}
									storyMentions={storyMentionOptions}
									canChatWithNaoData={canChatWithNaoData}
									isAdminMode={isAdminMode}
									adminModeLocked={adminModeLocked}
									isTrial={isTrial}
									onSelectAdminMode={handleSelectAdminMode}
									onAddAttachment={attachmentUpload.openFilePicker}
									onAddStory={(mention) => {
										promptRef.current?.appendMention({ id: mention.id, label: mention.label }, '#');
									}}
									onOpenMentionMenu={openMentionMenu}
									onOpenReferenceMenu={openReferenceMenu}
									onFocusPrompt={() => promptRef.current?.focus()}
								/>
							)}

							{onCancel && (
								<Button variant='ghost' type='button' size='sm' onClick={onCancel}>
									Cancel
								</Button>
							)}

							<ContextWindowRing />

							{isTranscribeReady && isRecording && <RecordingTimer />}
							{hasTranscribeProvider && (
								<MicButton
									state={isTranscribeReady ? transcribeState : 'idle'}
									onClick={isTranscribeReady ? toggleRecording : showMicWarning}
									disabled={isRunning && !allowQueueing}
								/>
							)}
							{micWarning && <MicWarningBanner onDismiss={() => setMicWarning(false)} />}

							{allowQueueing && isRunning ? (
								<ChatButton
									showStop={isInputEmpty}
									disabled={!isInputEmpty && isSendBlocked}
									onClick={isInputEmpty ? cancelAgent : handleSubmitMessage}
									type='button'
								/>
							) : (
								<ChatButton
									showStop={isRunning}
									disabled={isLoadingMessages || isInputEmpty || (!isRunning && isSendBlocked)}
									onClick={isRunning ? cancelAgent : handleSubmitMessage}
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

function ManagedCreditsLockedComposer({ isExample, onOpen }: { isExample: boolean; onOpen: () => void }) {
	return (
		<InputGroup className='mx-auto h-12 border-none bg-muted/50 shadow-xs dark:bg-muted/30 max-md:rounded-4xl'>
			<button
				type='button'
				className='flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 px-4 text-left text-sm text-muted-foreground'
				onClick={onOpen}
			>
				<LockKeyhole className='size-4 shrink-0' />
				<span className='truncate'>
					<span className='sm:hidden'>Credits required</span>
					<span className='hidden sm:inline'>Credits required to continue chatting</span>
				</span>
			</button>
			<div className='shrink-0 pr-4'>
				<ChatInputModelSelect isExample={isExample} managedCreditsExhausted />
			</div>
		</InputGroup>
	);
}

function ChatAllowanceExhausted({ scope }: { scope: ChatAllowanceExhaustedScope }) {
	const isOnboarding = scope === 'onboarding';
	if (!isOnboarding) {
		return (
			<div className='pb-2'>
				<SuggestionCard
					icon={<MessageCircleOff className='size-4 text-muted-foreground' />}
					message='Example chat limit reached'
					description='Set up your own project to keep chatting with your data.'
				/>
			</div>
		);
	}

	return (
		<Callout icon={MessageCircleOff} className='mb-3 rounded-2xl px-4 py-3 text-sm shadow-xs' role='status'>
			<p className='font-medium text-foreground'>Guided setup chat limit reached</p>
			<p className='mt-1 text-muted-foreground'>
				Your progress is safe. Contact support if you need help completing setup.
			</p>
			<ContactSupportButton>Contact support</ContactSupportButton>
		</Callout>
	);
}

async function dataUrlToFile(url: string, mediaType: string, name: string): Promise<File> {
	const response = await fetch(url);
	const blob = await response.blob();
	return new File([blob], name, { type: mediaType });
}

function ChatInputAdminBadge() {
	return (
		<div className='flex justify-end pr-4'>
			<SimpleTooltip
				side='top'
				align='end'
				content='Chat with your internal nao data to understand what users are doing.'
			>
				<span
					className={cn(
						'flex w-fit cursor-help items-center gap-1 mb-1',
						'rounded-t-lg px-2 py-0.5',
						'text-[10px] font-medium text-amber-700 dark:text-amber-300',
						'bg-amber-500/60',
					)}
				>
					<Shield className='size-3' />
					Admin Mode
				</span>
			</SimpleTooltip>
		</div>
	);
}

function BudgetBanner() {
	const { error, clearError, selectedModel } = useAgentContext();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const hasProject = project.data != null;
	const selectedProvider = selectedModel?.provider;
	const prevProviderRef = useRef(selectedProvider);

	useEffect(() => {
		const prev = prevProviderRef.current;
		prevProviderRef.current = selectedProvider;
		if (prev && prev !== selectedProvider && (parseBudgetError(error) || parseManagedCreditsError(error))) {
			clearError();
		}
	}, [selectedProvider, error, clearError]);

	const isManaged = selectedModel?.provider === 'nao';
	const budgetStatus = useQuery({
		...trpc.budget.checkBudgetStatus.queryOptions({ provider: selectedModel?.provider ?? 'openai' }),
		enabled: hasProject && !!selectedModel?.provider && !isManaged,
		refetchOnWindowFocus: 'always',
	});

	const budgetError = parseBudgetError(error);
	const budgetLevel = budgetError ? 'exceeded' : (budgetStatus.data?.level ?? 'ok');
	const budgetMessage = budgetError ?? (budgetLevel !== 'ok' ? budgetStatus.data?.message : null);

	if (!budgetMessage) {
		return null;
	}

	const isExceeded = budgetLevel === 'exceeded';

	return (
		<div className='mb-2 flex items-start gap-2.5 rounded-2xl border border-input/50 bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-200'>
			<AlertTriangle className={cn('size-4 shrink-0 mt-0.5', isExceeded ? 'text-red-500' : 'text-amber-500')} />
			<p className='flex-1 min-w-0'>{budgetMessage}</p>
		</div>
	);
}

function ChatInputPlusMenu({
	hasDatabases,
	hasStoryReferences,
	hasSkills,
	storyMentions,
	canChatWithNaoData,
	isAdminMode,
	adminModeLocked,
	onSelectAdminMode,
	onAddAttachment,
	onAddStory,
	onOpenMentionMenu,
	onOpenReferenceMenu,
	onFocusPrompt,
}: {
	hasDatabases: boolean;
	hasStoryReferences: boolean;
	hasSkills: boolean;
	storyMentions: MentionOption[];
	canChatWithNaoData: boolean;
	isAdminMode: boolean;
	adminModeLocked: boolean;
	isTrial: boolean;
	onSelectAdminMode: () => void;
	onAddAttachment: () => void;
	onAddStory: (mention: MentionOption) => void;
	onOpenMentionMenu: (trigger: string) => void;
	onOpenReferenceMenu: (rootId: string) => void;
	onFocusPrompt: () => void;
}) {
	const pendingMentionMenuRef = useRef<(() => void) | null>(null);

	/** The menu takes focus back while closing, so the mention menu is opened once the prompt has it again. */
	const deferMentionMenu = (openMentionMenu: () => void) => {
		pendingMentionMenuRef.current = openMentionMenu;
	};

	const restorePromptFocus = () => {
		const openPendingMentionMenu = pendingMentionMenuRef.current;
		pendingMentionMenuRef.current = null;
		if (openPendingMentionMenu) {
			openPendingMentionMenu();
		} else {
			onFocusPrompt();
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type='button'
					aria-label='Add context'
					className='inline-flex items-center justify-center rounded-full size-7 text-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer'
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
					requestAnimationFrame(restorePromptFocus);
				}}
			>
				<DropdownMenuItem onSelect={onAddAttachment}>
					<Paperclip className='size-4' />
					<span>Attach file</span>
				</DropdownMenuItem>
				{hasDatabases && (
					<DropdownMenuItem onSelect={() => deferMentionMenu(() => onOpenReferenceMenu(TABLES_ROOT_ID))}>
						<Database className='size-4' />
						<span>Database tables</span>
					</DropdownMenuItem>
				)}
				{hasStoryReferences && (
					<DropdownMenuItem onSelect={() => deferMentionMenu(() => onOpenReferenceMenu(STORIES_ROOT_ID))}>
						<Library className='size-4' />
						<span>Reference stories</span>
					</DropdownMenuItem>
				)}
				{storyMentions.map((mention) => (
					<DropdownMenuItem key={mention.id} onSelect={() => onAddStory(mention)}>
						{mention.icon}
						<span>{mention.label}</span>
					</DropdownMenuItem>
				))}
				{hasSkills && (
					<DropdownMenuItem onSelect={() => deferMentionMenu(() => onOpenMentionMenu(SKILL_MENTION_TRIGGER))}>
						<PencilRuler className='size-4' />
						<span>Skills</span>
					</DropdownMenuItem>
				)}
				{canChatWithNaoData && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onSelect={onSelectAdminMode}
							disabled={adminModeLocked && isAdminMode}
							title={adminModeLocked && !isAdminMode ? 'Start a new chat in admin mode' : undefined}
						>
							<Shield className='size-4' />
							<span>Admin mode</span>
							{isAdminMode && <Check className='size-4 ml-auto' />}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function buildShortcutPlaceholder({
	hasContext,
	hasSkills,
	hasStoryMode,
}: {
	hasContext: boolean;
	hasSkills: boolean;
	hasStoryMode: boolean;
}): string {
	const shortcuts = [
		hasContext && `${DATABASE_MENTION_TRIGGER} context`,
		hasSkills && `${SKILL_MENTION_TRIGGER} skills`,
		hasStoryMode && `${story.MENTION_TRIGGER} story mode`,
	].filter(Boolean);
	const base = 'Ask anything about your data';
	return shortcuts.length > 0 ? `${base}, ${shortcuts.join(', ')}` : `${base}...`;
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
				Voice input is disabled.{' '}
				<Link
					to='/settings/project/models'
					className='font-medium text-primary underline underline-offset-2 hover:text-primary/80'
				>
					Go to Settings &rarr; Models
				</Link>{' '}
				to enable transcription. Ask your admin.
			</p>
		</div>
	);
}
