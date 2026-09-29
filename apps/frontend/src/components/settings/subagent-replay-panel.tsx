import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';

import type { ReplayCrumb } from '@/components/settings/replay-breadcrumb';
import { CopyReplayLinkButton, ReplayHeader } from '@/components/settings/replay-header';
import { findSubagentPart, SubagentConversationBody } from '@/components/subagent/subagent-conversation';
import { taskTitle } from '@/components/tool-calls/task';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { ChatViewProvider } from '@/contexts/chat-view';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { trpc } from '@/main';

type SubagentReplayPanelProps = {
	chatId: string;
	toolCallId: string;
	origin: ReplayCrumb;
	onBackToChat: () => void;
};

/** A subagent run replayed on its own, with the parent chat replay one step back. */
export function SubagentReplayPanel({ chatId, toolCallId, origin, onBackToChat }: SubagentReplayPanelProps) {
	const chatReplayQuery = useQuery(
		trpc.project.getChatReplay.queryOptions({ chatId }, { enabled: !!chatId, refetchOnWindowFocus: 'always' }),
	);
	const messages = chatReplayQuery.data?.messages;
	const part = messages ? findSubagentPart(messages, toolCallId) : undefined;
	const chatTitle = chatReplayQuery.data?.title ?? 'Chat replay';
	const title = part ? taskTitle(part.input) : 'Subagent replay';

	return (
		<div className='flex flex-col h-full flex-1 min-w-0 overflow-hidden bg-background'>
			<ReplayHeader crumbs={[origin, { label: chatTitle, onClick: onBackToChat }, { label: title }]}>
				<CopyReplayLinkButton />
				<Button variant='ghost' size='sm' onClick={onBackToChat}>
					<ArrowLeft />
					Back to conversation
				</Button>
			</ReplayHeader>

			{chatReplayQuery.isLoading ? (
				<div className='flex flex-1 items-center justify-center'>
					<Spinner />
				</div>
			) : chatReplayQuery.isError ? (
				<div className='flex-1 overflow-auto p-4 text-sm text-destructive'>Failed to load chat.</div>
			) : !messages || !part ? (
				<div className='flex flex-1 items-center justify-center text-sm text-muted-foreground'>
					This subagent run is not part of the conversation.
				</div>
			) : (
				<ChatViewProvider expandOnError={true}>
					<ChatIdContext.Provider value={chatId}>
						<ReadonlyAgentMessagesProvider messages={messages} chatId={chatId}>
							<SubagentConversationBody part={part} isSettled={true} />
						</ReadonlyAgentMessagesProvider>
					</ChatIdContext.Provider>
				</ChatViewProvider>
			)}
		</div>
	);
}
