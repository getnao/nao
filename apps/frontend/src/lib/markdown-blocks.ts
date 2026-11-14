import { parseMarkdownIntoBlocks } from 'streamdown';
import type { StoryCodeLines } from '@nao/shared/types';

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

/**
 * A rendered top-level block of a Markdown document holding some lines of its source, by its position among the
 * blocks that are not blank. `rows` are the list items or table rows holding them, or null for the whole block.
 */
export interface MarkdownLinesTarget {
	blockIndex: number;
	rows: number[] | null;
}

/** The rendered blocks, and the list items or table rows within them, that show these lines of a Markdown source. */
export function findMarkdownLinesTargets(markdown: string, lines: StoryCodeLines): MarkdownLinesTarget[] {
	const targets: MarkdownLinesTarget[] = [];
	let startLine = 1;
	let blockIndex = 0;
	for (const block of parseMarkdownIntoBlocks(markdown)) {
		const leadingBlankLines = LEADING_BLANK_LINES_PATTERN.exec(block)?.[0] ?? '';
		const content = block.slice(leadingBlankLines.length).trimEnd();
		if (content) {
			const firstLine = startLine + countLineBreaks(leadingBlankLines);
			const blockLines = content.split('\n');
			const lastLine = firstLine + blockLines.length - 1;
			if (firstLine <= lines.end && lastLine >= lines.start) {
				const rows = findRowsAtLines(blockLines, lines.start - firstLine, lines.end - firstLine);
				targets.push({ blockIndex, rows });
			}
			blockIndex += 1;
		}
		startLine += countLineBreaks(block);
	}
	return targets;
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

const LEADING_BLANK_LINES_PATTERN = /^(?:[ \t]*\n)+/;
const TABLE_SEPARATOR_PATTERN = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;

/** The table rows or list items of a block on its lines `first` to `last`, counted from 0, or null for other blocks. */
function findRowsAtLines(blockLines: string[], first: number, last: number): number[] | null {
	const rowOfLine = TABLE_SEPARATOR_PATTERN.test(blockLines[1] ?? '')
		? getTableRowOfLines(blockLines)
		: getListItemOfLines(blockLines);
	if (!rowOfLine) {
		return null;
	}
	const rows = new Set<number>();
	for (let line = Math.max(first, 0); line <= Math.min(last, blockLines.length - 1); line += 1) {
		const row = rowOfLine[line];
		if (row !== null) {
			rows.add(row);
		}
	}
	return rows.size > 0 ? [...rows] : null;
}

/** The header is the first row and the separator line no row. */
function getTableRowOfLines(blockLines: string[]): (number | null)[] {
	return blockLines.map((_line, index) => (index === 0 ? 0 : index === 1 ? null : index - 1));
}

/** Each line belongs to the item started on it or above it, at the indent of the first item. */
function getListItemOfLines(blockLines: string[]): (number | null)[] | null {
	const indent = LIST_ITEM_PATTERN.exec(blockLines[0])?.[1];
	if (indent === undefined) {
		return null;
	}
	let item = -1;
	return blockLines.map((line) => {
		if (LIST_ITEM_PATTERN.exec(line)?.[1] === indent) {
			item += 1;
		}
		return item;
	});
}

function countLineBreaks(text: string): number {
	return text.split('\n').length - 1;
}
