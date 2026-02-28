import { memo, useState } from 'react';
import { Streamdown } from 'streamdown';
import { Conversation, ConversationContent } from '../ui/conversation';
import { ErrorMessage } from '../ui/error-message';
import type { CompactionPart } from '@nao/backend/chat';
import { Expandable } from '@/components/ui/expandable';

export const AssistantCompaction = memo(({ part }: { part?: CompactionPart }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const title = !part ? 'Compacting conversation' : part.error ? 'Compaction failed' : 'Compacted conversation';

	return (
		<Expandable
			title={title}
			expanded={isExpanded}
			disabled={!part}
			isLoading={!part}
			onExpandedChange={setIsExpanded}
		>
			<div className='text-muted-foreground markdown-small'>
				<Conversation className='p-0'>
					<ConversationContent className='p-0 max-h-[200px]'>
						{part?.error ? (
							<ErrorMessage message={part.error} />
						) : (
							<Streamdown mode='static'>{part?.summary}</Streamdown>
						)}
					</ConversationContent>
				</Conversation>
			</div>
		</Expandable>
	);
});
