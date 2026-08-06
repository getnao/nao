import { memo, useRef } from 'react';
import { Streamdown } from 'streamdown';

import type { IncrementalMarkdownBlockSplitter } from '@/lib/incremental-markdown-blocks';

import {
	createIncrementalMarkdownBlockSplitter,
	updateIncrementalMarkdownBlocks,
} from '@/lib/incremental-markdown-blocks';
import { markdownPlugins } from '@/lib/markdown';

interface StreamingMarkdownProps {
	text: string;
	transform?: (text: string) => string;
}

export const StreamingMarkdown = memo(({ text, transform }: StreamingMarkdownProps) => {
	const splitterRef = useRef<IncrementalMarkdownBlockSplitter | null>(null);
	if (splitterRef.current === null) {
		splitterRef.current = createIncrementalMarkdownBlockSplitter(transform);
	}

	const { sealedBlocks, tail } = updateIncrementalMarkdownBlocks(splitterRef.current, text);
	const transformedTail = transform ? transform(tail) : tail;

	return (
		<>
			{sealedBlocks.map((block, index) => (
				<StreamingMarkdownBlock key={index} text={block} />
			))}
			{transformedTail.length > 0 && (
				<Streamdown isAnimating mode='streaming' plugins={markdownPlugins}>
					{transformedTail}
				</Streamdown>
			)}
		</>
	);
});

const StreamingMarkdownBlock = memo(({ text }: { text: string }) => {
	return (
		<Streamdown mode='static' plugins={markdownPlugins}>
			{text}
		</Streamdown>
	);
});
