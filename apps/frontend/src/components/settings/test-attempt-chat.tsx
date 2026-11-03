import { useQuery } from '@tanstack/react-query';

import type { TestRunResult } from '@/components/settings/test-run-types';
import { ChatMessagesReadonly } from '@/components/chat-messages/chat-messages-readonly';
import { StreamingMarkdown } from '@/components/chat-messages/streaming-markdown';
import { Spinner } from '@/components/ui/spinner';
import { ReadonlyAgentMessagesProvider } from '@/contexts/agent.provider';
import { ChatViewProvider } from '@/contexts/chat-view';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { trpc } from '@/main';

/** The chat reads as in a drawer pane rather than a page, so all of it is scaled down, tool calls included. */
const REPLAY_CONTENT_CLASS = 'px-3 py-3 [zoom:0.85]';

/** How the agent answered an attempt, as its chat shows it: the question, the tool calls and the rendered answer. */
export function AttemptAnswer({ result }: { result: TestRunResult }) {
	return (
		<div className='flex min-h-0 flex-1 flex-col'>
			{result.errorMessage && (
				<p className='shrink-0 border-b bg-destructive/5 px-3 py-1.5 text-destructive'>
					The attempt failed before it could answer: {result.errorMessage}
				</p>
			)}
			{result.chatId ? (
				<AttemptChat chatId={result.chatId} result={result} />
			) : (
				<RecordedAnswer result={result} />
			)}
		</div>
	);
}

function AttemptChat({ chatId, result }: { chatId: string; result: TestRunResult }) {
	const replay = useQuery(trpc.project.getChatReplay.queryOptions({ chatId }));
	if (replay.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}
	if (!replay.data) {
		return <RecordedAnswer result={result} />;
	}
	return (
		<ChatViewProvider expandOnError>
			<ChatIdContext.Provider value={chatId}>
				<ReadonlyAgentMessagesProvider messages={replay.data.messages} chatId={chatId}>
					<ChatMessagesReadonly
						className='min-h-0 flex-1'
						contentClassName={REPLAY_CONTENT_CLASS}
						messages={replay.data.messages}
						messageModels={replay.data.messageModels}
					/>
				</ReadonlyAgentMessagesProvider>
			</ChatIdContext.Provider>
		</ChatViewProvider>
	);
}

/** The answer text the run stored, for attempts whose chat is gone or cannot be opened. */
function RecordedAnswer({ result }: { result: TestRunResult }) {
	const answer = result.details?.responseText;
	return (
		<div className='min-h-0 flex-1 overflow-auto p-3 text-sm'>
			{answer ? (
				<StreamingMarkdown text={answer} />
			) : (
				<p className='text-xs text-muted-foreground'>No answer recorded.</p>
			)}
		</div>
	);
}
