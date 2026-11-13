export interface MarkdownToken {
	type: string;
	raw: string;
}

/** The top-level blocks of a Markdown source with the exact whitespace around them, so it can be written back as is. */
export interface MarkdownLayout {
	leading: string;
	blocks: { type: string; content: string; gap: string }[];
	trailing: string;
}

export function getMarkdownLayout(tokens: MarkdownToken[]): MarkdownLayout {
	const layout: MarkdownLayout = { leading: '', blocks: [], trailing: '' };
	for (const token of tokens) {
		const lastBlock = layout.blocks.at(-1);
		if (token.type === 'space') {
			if (lastBlock) {
				lastBlock.gap += token.raw;
			} else {
				layout.leading += token.raw;
			}
			continue;
		}
		const content = token.raw.trimEnd();
		layout.blocks.push({ type: token.type, content, gap: token.raw.slice(content.length) });
	}
	const lastBlock = layout.blocks.at(-1);
	if (lastBlock) {
		layout.trailing = lastBlock.gap;
		lastBlock.gap = '';
	}
	return layout;
}

/** Whether a token, or one nested in it such as inline HTML in a paragraph, has the given type. */
export function containsTokenType(token: unknown, type: string): boolean {
	if (Array.isArray(token)) {
		return token.some((child) => containsTokenType(child, type));
	}
	if (typeof token !== 'object' || token === null) {
		return false;
	}
	return (
		(token as { type?: unknown }).type === type ||
		Object.values(token).some((value) => typeof value === 'object' && containsTokenType(value, type))
	);
}

/**
 * Writes edited Markdown blocks back over their source. A block that still serializes like a source block keeps the
 * text it was written with, so editing one paragraph does not reformat the rest of the file. `sourceCanonicals` are
 * the source blocks as the editor serializes them, in the order of `layout.blocks`.
 */
export function writeMarkdownBlocks(
	layout: MarkdownLayout,
	sourceCanonicals: string[],
	editedBlocks: string[],
): string {
	const usedSourceIndexes = new Set<number>();
	let markdown = '';
	let previousSourceIndex = -1;
	for (const editedBlock of editedBlocks.filter((block) => block.trim().length > 0)) {
		const sourceIndex = findSourceBlock(sourceCanonicals, editedBlock, previousSourceIndex + 1, usedSourceIndexes);
		const isSourceNeighbor =
			sourceIndex !== -1 && previousSourceIndex !== -1 && sourceIndex === previousSourceIndex + 1;
		if (!markdown) {
			markdown += sourceIndex === 0 ? layout.leading : '';
		} else {
			markdown += isSourceNeighbor ? layout.blocks[previousSourceIndex].gap : '\n\n';
		}
		markdown += sourceIndex === -1 ? editedBlock.trim() : layout.blocks[sourceIndex].content;
		if (sourceIndex !== -1) {
			usedSourceIndexes.add(sourceIndex);
		}
		previousSourceIndex = sourceIndex;
	}
	if (!markdown) {
		return '';
	}
	return markdown + (layout.blocks.length > 0 ? layout.trailing : '\n');
}

/** The unused source block written like this one, preferring those that follow the previous block in the source. */
function findSourceBlock(
	sourceCanonicals: string[],
	editedBlock: string,
	preferredStart: number,
	usedSourceIndexes: Set<number>,
): number {
	const isMatch = (canonical: string, index: number) => canonical === editedBlock && !usedSourceIndexes.has(index);
	const following = sourceCanonicals.findIndex(
		(canonical, index) => index >= preferredStart && isMatch(canonical, index),
	);
	return following !== -1 ? following : sourceCanonicals.findIndex(isMatch);
}
