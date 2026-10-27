import { memo, useRef } from 'react';
import { Streamdown } from 'streamdown';

import type { IncrementalMarkdownBlockSplitter } from '@/lib/incremental-markdown-blocks';
import type { ComponentProps } from 'react';
import type { Components } from 'streamdown';

import {
	createIncrementalMarkdownBlockSplitter,
	updateIncrementalMarkdownBlocks,
} from '@/lib/incremental-markdown-blocks';
import { markdownPlugins } from '@/lib/markdown';
import { markdownLinkSafety } from '@/components/external-link-dialog';

interface StreamingMarkdownProps {
	allowedTags?: ComponentProps<typeof Streamdown>['allowedTags'];
	components?: Components;
	literalTagContent?: ComponentProps<typeof Streamdown>['literalTagContent'];
	text: string;
	transform?: (text: string) => string;
}

export const StreamingMarkdown = memo(
	({ allowedTags, components, literalTagContent, text, transform }: StreamingMarkdownProps) => {
		const splitterRef = useRef<IncrementalMarkdownBlockSplitter | null>(null);
		if (splitterRef.current === null) {
			splitterRef.current = createIncrementalMarkdownBlockSplitter(transform);
		}

		const { sealedBlocks, tail } = updateIncrementalMarkdownBlocks(splitterRef.current, text);
		const transformedTail = transform ? transform(tail) : tail;

		return (
			<>
				{sealedBlocks.map((block, index) => (
					<StreamingMarkdownBlock
						key={index}
						text={block}
						allowedTags={allowedTags}
						components={components}
						literalTagContent={literalTagContent}
					/>
				))}
				{transformedTail.length > 0 && (
					<Streamdown
						linkSafety={markdownLinkSafety}
						className='assistant-markdown'
						allowedTags={allowedTags}
						components={components}
						isAnimating
						literalTagContent={literalTagContent}
						mode='streaming'
						plugins={markdownPlugins}
					>
						{transformedTail}
					</Streamdown>
				)}
			</>
		);
	},
);

const StreamingMarkdownBlock = memo(
	({
		allowedTags,
		components,
		literalTagContent,
		text,
	}: Pick<StreamingMarkdownProps, 'allowedTags' | 'components' | 'literalTagContent' | 'text'>) => {
		return (
			<Streamdown
				linkSafety={markdownLinkSafety}
				className='assistant-markdown'
				allowedTags={allowedTags}
				components={components}
				literalTagContent={literalTagContent}
				mode='static'
				plugins={markdownPlugins}
			>
				{text}
			</Streamdown>
		);
	},
);
