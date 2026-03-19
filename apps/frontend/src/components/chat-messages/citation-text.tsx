import { memo } from 'react';
import { Streamdown } from 'streamdown';

import { CitationPopover } from '@/components/citation-popover';

const CITATION_TAG_REGEX = /<\/?citation-number[^>]*>/g;
const CLOBBER_PREFIX = 'user-content-';

function stripClobberPrefix(value: string): string {
	return value.startsWith(CLOBBER_PREFIX) ? value.slice(CLOBBER_PREFIX.length) : value;
}

export const AssistantTextWithCitation = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
	if (isStreaming) {
		const strippedText = text.replace(CITATION_TAG_REGEX, '');
		return (
			<Streamdown isAnimating mode='streaming'>
				{strippedText}
			</Streamdown>
		);
	}

	return (
		<Streamdown
			allowedTags={{
				'citation-number': ['id', 'column'],
			}}
			literalTagContent={['citation-number']}
			components={{
				'citation-number': ({ id, column, children }: any) => {
					return (
						<span className='inline-block align-baseline mx-1'>
							<CitationPopover
								value={String(children)}
								queryId={stripClobberPrefix(String(id))}
								column={String(column)}
							/>
						</span>
					);
				},
			}}
		>
			{text}
		</Streamdown>
	);
});
