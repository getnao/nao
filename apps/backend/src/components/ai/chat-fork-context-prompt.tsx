import { Block, Bold, Quote, Span, Title } from '../../lib/markdown';
import type { ForkMetadata } from '../../types/chat';
import type { LinkedStory } from '../../types/tools';

const SELECTION_FORK_TYPES: ForkMetadata['type'][] = ['chat_selection', 'chat_question', 'story_selection'];

type ChatForkContextPromptProps = {
	basePrompt: string;
	forkMetadata: ForkMetadata;
	linkedStory?: LinkedStory;
};

export function ChatForkContextPrompt({ basePrompt, forkMetadata, linkedStory }: ChatForkContextPromptProps) {
	if (forkMetadata.type === 'story_question') {
		return (
			<Block>
				{basePrompt}
				<StoryQuestionContext forkMetadata={forkMetadata} linkedStory={linkedStory} />
			</Block>
		);
	}
	if (SELECTION_FORK_TYPES.includes(forkMetadata.type) && forkMetadata.selectionText) {
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

/** A quick question is short: the user sees only the last exchange, under the story itself. */
function StoryQuestionContext({
	forkMetadata,
	linkedStory,
}: {
	forkMetadata: ForkMetadata;
	linkedStory?: LinkedStory;
}) {
	return (
		<Block>
			<Title level={2}>Story Question</Title>
			<Span>
				The user is asking from the page of the story <Bold>{JSON.stringify(forkMetadata.title)}</Bold>, which
				reaches you in a &lt;referenced-story&gt; block. They only see your last answer, under the story: keep
				it short and self-contained.
			</Span>
			{forkMetadata.selectionText && (
				<>
					<Span>They are asking about this part of the story:</Span>
					<Quote>{forkMetadata.selectionText}</Quote>
				</>
			)}
			{linkedStory?.canEdit ? (
				<Span>
					{`Unlike other existing stories, this one is editable here: the user owns it and may ask to change it. Edit it with the story tool and the id ${JSON.stringify(linkedStory.slug)}, it updates the story itself. New charts can use queries you run here.`}
				</Span>
			) : (
				<Span>The story is read-only here: answer about it, never edit it.</Span>
			)}
		</Block>
	);
}
