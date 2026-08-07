import { memo } from 'react';
import { Streamdown } from 'streamdown';

import { stripAssistantTags } from '@nao/shared';

import { CitationPopover } from '@/components/citation-popover';
import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { FileChip } from '@/components/file-chip';
import { isStoredFilePath } from '@/lib/attachments';
import { markdownPlugins } from '@/lib/markdown';

const CLOBBER_PREFIX = 'user-content-';

function stripClobberPrefix(value: string): string {
	return value.startsWith(CLOBBER_PREFIX) ? value.slice(CLOBBER_PREFIX.length) : value;
}

export const AssistantTextWithCitation = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
	if (isStreaming) {
		return (
			<Streamdown
				isAnimating
				mode='streaming'
				plugins={markdownPlugins}
				components={{
					table: ({ node, className }: any) => <MarkdownTable node={node} className={className} />,
				}}
			>
				{stripAssistantTags(text)}
			</Streamdown>
		);
	}

	return (
		<Streamdown
			plugins={markdownPlugins}
			allowedTags={{
				'citation-number': ['id', 'column'],
				'saved-file': ['path'],
			}}
			literalTagContent={['citation-number', 'saved-file']}
			components={{
				table: ({ node, className }: any) => <MarkdownTable node={node} className={className} />,
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
				'saved-file': ({ path, children }: any) => <SavedFile path={asText(path)} label={asText(children)} />,
			}}
		>
			{text}
		</Streamdown>
	);
});

/** A file the answer hands over. One nao cannot reach stays as the text the model wrote. */
function SavedFile({ path, label }: { path: string; label: string }) {
	if (!isStoredFilePath(path)) {
		return <>{label || path}</>;
	}

	return <FileChip path={path} label={label || undefined} className='mx-0.5' />;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
