import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import type { EditorChatCopy } from '@/components/editor-chat-panel';
import type { ContextEditorChanges } from '@/hooks/use-context-editor-changes';
import { EditorChatPanel, toPromptSuggestions, useEditorChatSession } from '@/components/editor-chat-panel';
import { useContextEditorChanges } from '@/hooks/use-context-editor-changes';
import { useContextRecommendationsEnabled } from '@/hooks/use-context-recommendations';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { invalidateExplorerQueries, invalidateRecommendationQueries } from '@/lib/context-explorer-queries';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

const CONTEXT_HUB_CHAT_COPY: EditorChatCopy = {
	placeholder: 'Ask to improve the context...',
	introTitle: 'Improve the context with nao',
	introDescription:
		'Ask nao to describe a table, write notes about its columns, update a doc or create a skill. Its edits show up here as your changes, for you to review and publish.',
	suggestions: toPromptSuggestions([
		'Describe this table and what its columns mean',
		'Which tables have no description yet?',
		'Create a skill to answer questions about weekly sales',
	]),
};

const CONTEXT_HUB_CHAT_COPY_WITH_RECOMMENDATIONS: EditorChatCopy = {
	...CONTEXT_HUB_CHAT_COPY,
	introDescription:
		'Ask nao to describe a table, write notes about its columns, update a doc, create a skill or apply its recommendations. Its edits show up here as your changes, for you to review and publish.',
	suggestions: toPromptSuggestions([
		'Which recommendations should I apply first?',
		'Describe this table and what its columns mean',
		'Create a skill to answer questions about weekly sales',
	]),
};

const panelOpenStorage = createLocalStorage('nao-context-hub-chat-panel-open', true);

export function useContextHubChatPanelOpen() {
	return useLocalStorage(panelOpenStorage);
}

/** A chat beside the Context Hub whose agent edits context files in the user's changes, told which file is open. */
export function ContextHubChatPanel({
	openPath,
	isOpen,
	onOpenChange,
}: {
	openPath: string | null;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const session = useContextHubChatSession();
	const hasRecommendations = useContextRecommendationsEnabled();
	const openPathRef = useRef(openPath);
	useEffect(() => {
		openPathRef.current = openPath;
	}, [openPath]);
	const getRequestBody = useCallback(() => ({ contextHub: { openPath: openPathRef.current } }), []);

	return (
		<EditorChatPanel
			session={session}
			copy={hasRecommendations ? CONTEXT_HUB_CHAT_COPY_WITH_RECOMMENDATIONS : CONTEXT_HUB_CHAT_COPY}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			getRequestBody={getRequestBody}
			sessionEffects={() => (
				<ContextHubRefresher onChange={(changes) => void refreshContextHub(queryClient, changes)} />
			)}
		/>
	);
}

function useContextHubChatSession() {
	const latestChat = useQuery(trpc.contextExplorer.latestEditChat.queryOptions());
	const startChat = useMutation(trpc.contextExplorer.startEditChat.mutationOptions());

	return useEditorChatSession({
		latestChatId: latestChat.data?.chatId,
		isLoadingLatestChat: latestChat.isLoading,
		startChat: () => startChat.mutateAsync(),
		isStarting: startChat.isPending,
		hasStartFailed: startChat.isError,
	});
}

function ContextHubRefresher({ onChange }: { onChange: (changes: ContextEditorChanges) => void }) {
	useContextEditorChanges(onChange);
	return null;
}

async function refreshContextHub(queryClient: QueryClient, changes: ContextEditorChanges): Promise<void> {
	await Promise.all([
		changes.paths.length > 0 && invalidateExplorerQueries(queryClient),
		changes.hasChangedRecommendations && invalidateRecommendationQueries(queryClient),
	]);
}
