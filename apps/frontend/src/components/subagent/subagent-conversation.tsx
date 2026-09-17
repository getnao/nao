import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { subagentLabel } from '@/components/tool-calls/call-subagent';
import { UserMessageBubble } from '@/components/chat-messages/user-message';
import { SubagentReport } from '@/components/subagent/subagent-report';
import { SubagentWork } from '@/components/subagent/subagent-work';
import { Button } from '@/components/ui/button';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { Spinner } from '@/components/ui/spinner';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { useAgentContext, useAgentMessagesSelector } from '@/contexts/agent.provider';
import { isToolSettled } from '@/lib/ai';
import { useChatQuery } from '@/queries/use-chat-query';

type SubagentPart = UIToolPart<'call_subagent'>;

/** A subagent run shown as its own conversation: the prompt it received, its work and its report. */
export function SubagentConversation({ chatId, toolCallId }: { chatId: string; toolCallId: string }) {
	const chat = useChatQuery({ chatId });
	const { isLoadingMessages, isRunning } = useAgentContext();
	const part = useAgentMessagesSelector((messages) => findSubagentPart(messages, toolCallId));
	const label = subagentLabel(part?.input?.subagent);
	const isSettled = !!part && (isToolSettled(part) || !isRunning);

	return (
		<div className='flex flex-col h-full flex-1 min-w-0 overflow-hidden bg-background'>
			<Header chatId={chatId} chatTitle={chat.data?.title} label={label} />
			{isLoadingMessages ? (
				<div className='flex flex-1 items-center justify-center'>
					<Spinner />
				</div>
			) : !part ? (
				<NotFound chatId={chatId} />
			) : (
				<Body part={part} isSettled={isSettled} />
			)}
		</div>
	);
}

function Header({ chatId, chatTitle, label }: { chatId: string; chatTitle: string | undefined; label: string }) {
	return (
		<div className='flex items-center justify-between gap-4 px-4 py-3 border-b'>
			<nav aria-label='Conversation navigation' className='flex items-center gap-1 min-w-0 text-sm'>
				<Link
					to='/$chatId'
					params={{ chatId }}
					className='truncate text-muted-foreground hover:text-foreground transition-colors'
				>
					{chatTitle ?? 'Conversation'}
				</Link>
				<ChevronRight className='size-4 text-muted-foreground/50 shrink-0' />
				<span className='shrink-0 text-foreground'>{label} subagent</span>
			</nav>
			<Button variant='ghost' size='sm' asChild>
				<Link to='/$chatId' params={{ chatId }}>
					<ArrowLeft />
					Back to conversation
				</Link>
			</Button>
		</div>
	);
}

function Body({ part, isSettled }: { part: SubagentPart; isSettled: boolean }) {
	const promptMessage = useMemo(() => toPromptMessage(part), [part]);
	const report = part.output?.report;

	return (
		<Conversation>
			<ConversationContent className='max-w-3xl mx-auto w-full gap-6 pb-12' data-selection-container>
				<div className='flex flex-col items-end w-full'>
					<UserMessageBubble message={promptMessage} />
				</div>
				<div className='px-3 flex flex-col gap-3'>
					<SubagentWork output={part.output} isSettled={isSettled} />
					{part.errorText ? (
						<pre className='p-3 rounded-lg bg-red-500/5 text-red-500 text-xs whitespace-pre-wrap'>
							{part.errorText}
						</pre>
					) : isSettled && report ? (
						<SubagentReport report={report} />
					) : (
						!isSettled && <TextShimmer showLogo />
					)}
				</div>
			</ConversationContent>
			<ConversationScrollButton />
		</Conversation>
	);
}

function NotFound({ chatId }: { chatId: string }) {
	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground'>
			<span>This subagent run is not part of the conversation.</span>
			<Button variant='outline' size='sm' asChild>
				<Link to='/$chatId' params={{ chatId }}>
					<ArrowLeft />
					Back to conversation
				</Link>
			</Button>
		</div>
	);
}

function findSubagentPart(messages: UIMessage[], toolCallId: string): SubagentPart | undefined {
	for (const message of messages) {
		for (const part of message.parts) {
			if (part.type === 'tool-call_subagent' && part.toolCallId === toolCallId) {
				return part;
			}
		}
	}
	return undefined;
}

function toPromptMessage(part: SubagentPart): UIMessage {
	return {
		id: part.toolCallId,
		role: 'user',
		parts: [{ type: 'text', text: part.input?.prompt ?? '' }],
	};
}
