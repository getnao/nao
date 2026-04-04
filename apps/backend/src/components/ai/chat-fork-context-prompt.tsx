import { Block, Bold, Quote, Span, Title } from '../../lib/markdown';
import type { ForkMetadata } from '../../types/chat';

type ChatForkContextPromptProps = {
	basePrompt: string;
	forkMetadata: ForkMetadata;
};

export function ChatForkContextPrompt({ basePrompt, forkMetadata }: ChatForkContextPromptProps) {
	if (
		(forkMetadata.type === 'chat_selection' || forkMetadata.type === 'story_selection') &&
		forkMetadata.selectionText
	) {
		return (
			<Block>
				{basePrompt}
				<Title level={2}>Selection Context</Title>
				<Span>
					The user is asking about the following passage selected from <Bold>"{forkMetadata.title}"</Bold> by{' '}
					{forkMetadata.authorName}. Keep this selection as your primary focus when answering.
				</Span>
				<Quote>{forkMetadata.selectionText}</Quote>
			</Block>
		);
	}
	return <>{basePrompt}</>;
}
