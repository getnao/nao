import { memo } from 'react';
import { Streamdown } from 'streamdown';

import { stripAssistantTags } from '@nao/shared';

import { CitationPopover } from '@/components/citation-popover';
import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { StreamingMarkdown } from '@/components/chat-messages/streaming-markdown';
import { FileChip } from '@/components/file-chip';
import { isStoredFilePath } from '@/lib/attachments';
import { markdownPlugins } from '@/lib/markdown';

const CLOBBER_PREFIX = 'user-content-';
const SETTLED_COMPONENTS = {
	table: MarkdownTableRenderer,
	'citation-number': CitationNumberRenderer,
	'saved-file': SavedFileRenderer,
};
const STREAMING_COMPONENTS = {
	table: MarkdownTableRenderer,
};
const ALLOWED_TAGS = {
	'citation-number': ['id', 'column'],
	'saved-file': ['path'],
};
const LITERAL_TAG_CONTENT = ['citation-number', 'saved-file'];

export const AssistantTextWithCitation = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
	if (isStreaming) {
		return <StreamingMarkdown components={STREAMING_COMPONENTS} text={text} transform={stripAssistantTags} />;
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

/** A file the answer hands over. One nao cannot reach stays as the text the model wrote. */
function SavedFileRenderer({ path, children }: any) {
	const label = asText(children);
	const filePath = asText(path);
	if (!isStoredFilePath(filePath)) {
		return <>{label || filePath}</>;
	}

	return <FileChip path={filePath} label={label || undefined} className='mx-0.5' />;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

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
