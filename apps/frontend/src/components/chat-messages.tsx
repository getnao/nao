import { Streamdown } from 'streamdown';
import { ToolCall } from './tool-call';
import { AgentMessageLoader } from './ui/agent-message-loader';
import type { UIMessage } from 'backend/chat';
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from '@/components/ui/conversation';
import { checkIsGenerating, isToolUIPart } from '@/lib/ai';
import { cn } from '@/lib/utils';
import { useChatContext } from '@/contexts/agentProvider';

const DEBUG_MESSAGES = false;

export function ChatMessages() {
	const { messages, isRunning, status } = useChatContext();
	const isGenerating = checkIsGenerating(status, messages);

	return (
		<Conversation>
			<ConversationContent className='w-full md:w-full lg:w-full xl:w-full 2xl:w-1/2 mx-auto'>
				{messages.length === 0 ? (
					<ConversationEmptyState />
				) : (
					messages.map((message) => <MessageBlock key={message.id} message={message} />)
				)}

				{!isGenerating && isRunning && <AgentMessageLoader />}
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
	const { isRunning } = useChatContext();

	return (
		<div className={cn('rounded-2xl px-4 py-2 bg-muted flex flex-col gap-2')}>
			{message.parts.map((p, i) => {
				const isLastPart = i === message.parts.length - 1;
				const isPartStreaming = isRunning && isLastPart;

				if (isToolUIPart(p)) {
					return <ToolCall key={i} toolPart={p} />;
				}

				switch (p.type) {
					case 'text':
						return (
							<div key={i} className='px-3'>
								<Streamdown
									isAnimating={isPartStreaming}
									mode={isPartStreaming ? 'streaming' : 'static'} // Turn static mode if not generating for better performance.
									cdnUrl={null} // Streamdown makes requests to their CDN for code block languages that are not built-in.
								>
									{p.text}
								</Streamdown>
							</div>
						);
					default:
						return null;
				}
			})}
		</div>
	);
};
