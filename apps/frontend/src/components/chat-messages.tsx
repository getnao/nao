import { ToolCall } from './tool-call';
import type { UIMessage } from 'backend/chat';
import {
	AssistantMessageLoader,
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/conversation';
import { checkIsGenerating, isToolUIPart } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/contexts/agentProvider';

const DEBUG_MESSAGES = false;

export function ChatMessages() {
	const { messages, status } = useChatContext();
	const isGenerating = checkIsGenerating(status, messages);
	const isRunning = status === 'streaming' || status === 'submitted';

	return (
		<Conversation className='w-full'>
			<ConversationContent>
				{messages.length === 0 ? (
					<ConversationEmptyState />
				) : (
					messages.map((message) => <MessageBlock key={message.id} message={message} />)
				)}

				{!isGenerating && isRunning && <AssistantMessageLoader />}
			</ConversationContent>

			<ConversationScrollButton />
		</Conversation>
	);
}

function MessageBlock({ message }: { message: UIMessage }) {
	const isUser = message.role === 'user';

	if (DEBUG_MESSAGES) {
		return (
			<div
				className={cn(
					'flex gap-3',
					isUser ? 'justify-end bg-primary text-primary-foreground w-min ml-auto' : 'justify-start',
				)}
			>
				<pre>{JSON.stringify(message, null, 2)}</pre>
			</div>
		);
	}

	if (message.parts.length === 0) {
		return null;
	}

	if (isUser) {
		return <UserMessageBlock message={message} />;
	}

	return <AssistantMessageBlock message={message} />;
}

const UserMessageBlock = ({ message }: { message: UIMessage }) => {
	return (
		<div className={cn('rounded-3xl px-4 py-2 bg-primary text-primary-foreground ml-auto')}>
			{message.parts.map((p, i) => {
				switch (p.type) {
					case 'text':
						return (
							<span key={i} className='whitespace-pre-wrap'>
								{p.text}
							</span>
						);
					default:
						return null;
				}
			})}
		</div>
	);
};

const AssistantMessageBlock = ({ message }: { message: UIMessage }) => {
	return (
		<div className={cn('rounded-2xl px-4 py-2 bg-muted flex flex-col gap-2')}>
			{message.parts.map((p, i) => {
				if (isToolUIPart(p)) {
					return <ToolCall key={i} toolPart={p} />;
				}

				switch (p.type) {
					case 'text':
						return (
							<span key={i} className='whitespace-pre-wrap'>
								{p.text}
							</span>
						);
					default:
						return null;
				}
			})}
		</div>
	);
};
