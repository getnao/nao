import { memo, useState } from 'react';
import { Streamdown } from 'streamdown';
import { Conversation, ConversationContent } from '../ui/conversation';
import { Expandable } from '@/components/ui/expandable';

export const AssistantCompaction = memo(({ summary, isSummarizing }: { summary: string; isSummarizing: boolean }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<Expandable
			title={isSummarizing ? 'Compacting conversation' : 'Compacted conversation'}
			expanded={isExpanded}
			disabled={isSummarizing}
			isLoading={isSummarizing}
			onExpandedChange={setIsExpanded}
		>
			<div className='text-muted-foreground markdown-small'>
				<Conversation className='p-0'>
					<ConversationContent className='p-0 max-h-[200px]'>
						<Streamdown mode='static'>{summary}</Streamdown>
					</ConversationContent>
				</Conversation>
			</div>
		</Expandable>
	);
});
