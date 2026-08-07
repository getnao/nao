import { memo } from 'react';
import { Streamdown } from 'streamdown';

import { CITATION_TAG_REGEX } from '@nao/shared';

import { CitationPopover } from '@/components/citation-popover';
import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { StreamingMarkdown } from '@/components/chat-messages/streaming-markdown';
import { markdownPlugins } from '@/lib/markdown';

const CLOBBER_PREFIX = 'user-content-';
const SETTLED_COMPONENTS = {
	table: MarkdownTableRenderer,
	'citation-number': CitationNumberRenderer,
};
const STREAMING_COMPONENTS = {
	table: MarkdownTableRenderer,
};
const ALLOWED_TAGS = {
	'citation-number': ['id', 'column'],
};
const LITERAL_TAG_CONTENT = ['citation-number'];

export const AssistantTextWithCitation = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
	if (isStreaming) {
		return <StreamingMarkdown components={STREAMING_COMPONENTS} text={text} transform={stripCitations} />;
	}

	return (
		<Streamdown
			plugins={markdownPlugins}
			allowedTags={ALLOWED_TAGS}
			literalTagContent={LITERAL_TAG_CONTENT}
			components={SETTLED_COMPONENTS}
		>
			{text}
		</Streamdown>
	);
});

function stripCitations(text: string): string {
	return text.replace(CITATION_TAG_REGEX, '');
}

function MarkdownTableRenderer({ node, className }: any) {
	return <MarkdownTable node={node} className={className} />;
}

function CitationNumberRenderer({ id, column, children }: any) {
	return (
		<span className='inline-block align-baseline mx-1'>
			<CitationPopover
				value={String(children)}
				queryId={stripClobberPrefix(String(id))}
				column={String(column)}
			/>
		</span>
	);
}

function stripClobberPrefix(value: string): string {
	return value.startsWith(CLOBBER_PREFIX) ? value.slice(CLOBBER_PREFIX.length) : value;
}
