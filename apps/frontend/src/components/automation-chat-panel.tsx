import { useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { RefObject } from 'react';
import type { AutomationFormHandle } from '@/components/automations-form';

import type { EditorChatCopy, EditorChatSession } from '@/components/editor-chat-panel';
import type { HandledDraftUpdates } from '@/hooks/use-automation-draft-updates';
import { EditorChatPanel, toPromptSuggestions, useEditorChatSession } from '@/components/editor-chat-panel';
import { useAutomationDraftUpdates } from '@/hooks/use-automation-draft-updates';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

export { OpenEditorChatButton as OpenAutomationChatButton } from '@/components/editor-chat-panel';

const PLACEHOLDER = 'Ask to change the automation...';
const INTRO_TITLE = 'Work on this automation with nao';
const INTRO_DESCRIPTION =
	'Describe what you want to receive. nao explores your data, writes the instructions and sets up the schedule and delivery in the form. You review and save the changes.';

const NEW_AUTOMATION_COPY: EditorChatCopy = {
	placeholder: PLACEHOLDER,
	introTitle: INTRO_TITLE,
	introDescription: INTRO_DESCRIPTION,
	suggestions: toPromptSuggestions([
		'Every Monday at 9am, email me a summary of last week’s key metrics',
		'Help me write the instructions for a daily report',
		'Post a Slack alert when yesterday’s revenue drops more than 10%',
	]),
};

const EXISTING_AUTOMATION_COPY: EditorChatCopy = {
	...NEW_AUTOMATION_COPY,
	suggestions: toPromptSuggestions([
		'Why did the last runs fail?',
		'Make the report shorter and easier to scan',
		'Run it on weekdays at 8am instead',
	]),
};

const panelOpenStorage = createLocalStorage('nao-automation-chat-panel-open', true);

/** The panel's open state is remembered across automations. */
export function useAutomationChatPanelOpen() {
	return useLocalStorage(panelOpenStorage);
}

/**
 * A chat beside an automation's form, whose agent reads the form and changes it.
 * Changes stay unsaved in the form until the user saves it.
 */
export function AutomationChatPanel({
	automationId,
	formHandleRef,
	isOpen,
	onOpenChange,
	onChatStarted,
}: {
	/** Absent while the automation is being created. */
	automationId?: string;
	formHandleRef: RefObject<AutomationFormHandle | null>;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onChatStarted?: (chatId: string) => void;
}) {
	const session = useAutomationChatSession(automationId);
	const handledUpdatesRef = useRef<HandledDraftUpdates>(new Map());
	const getRequestBody = useCallback(() => ({ automationDraft: formHandleRef.current?.getDraft() }), [formHandleRef]);

	return (
		<EditorChatPanel
			session={session}
			copy={automationId ? EXISTING_AUTOMATION_COPY : NEW_AUTOMATION_COPY}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			getRequestBody={getRequestBody}
			sessionEffects={(current: EditorChatSession) => (
				<FormUpdater
					isResumed={current.isResumed}
					formHandleRef={formHandleRef}
					handledUpdates={handledUpdatesRef.current}
				/>
			)}
			onChatStarted={onChatStarted}
		/>
	);
}

function useAutomationChatSession(automationId: string | undefined) {
	const latestChat = useQuery({
		...trpc.automation.latestEditChat.queryOptions({ automationId: automationId ?? '' }),
		enabled: Boolean(automationId),
	});
	const startChat = useMutation(trpc.automation.startEditChat.mutationOptions());

	return useEditorChatSession({
		latestChatId: latestChat.data?.chatId,
		isLoadingLatestChat: latestChat.isLoading && Boolean(automationId),
		startChat: () => startChat.mutateAsync({ automationId }),
		isStarting: startChat.isPending,
		hasStartFailed: startChat.isError,
	});
}

function FormUpdater({
	isResumed,
	formHandleRef,
	handledUpdates,
}: {
	isResumed: boolean;
	formHandleRef: RefObject<AutomationFormHandle | null>;
	handledUpdates: HandledDraftUpdates;
}) {
	useAutomationDraftUpdates({
		isResumed,
		handledUpdates,
		onUpdate: (update) => formHandleRef.current?.applyDraftUpdate(update),
	});
	return null;
}
