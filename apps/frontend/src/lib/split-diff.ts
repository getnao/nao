import { computeLineDiff } from '@/lib/line-diff';

/** A changed stretch of a line, from `start` to `end` characters. */
export interface ChangedRange {
	start: number;
	end: number;
}

/** The changed lines of one side, by index, with the stretches of each that the other side does not have. */
export type ChangedLines = Map<number, ChangedRange[]>;

interface WordToken {
	text: string;
	start: number;
	end: number;
}

const WORD_PATTERN = /\s+|[\p{L}\p{N}_]+|[<>=!|&:]+|[^\s\p{L}\p{N}_]/gu;
const WHITESPACE = /^\s+$/;

/**
 * Compares two texts like a split diff that ignores spacing and letter case: lines are paired from their longest common
 * subsequence, and within a changed line that replaces another, only the words that differ are marked.
 */
export function diffSplitLines(before: string, after: string): { before: ChangedLines; after: ChangedLines } {
	const beforeLines = before.split('\n');
	const afterLines = after.split('\n');
	const { lines } = computeLineDiff(normalizeLines(beforeLines), normalizeLines(afterLines));
	const changes = { before: new Map() as ChangedLines, after: new Map() as ChangedLines };
	let removed: number[] = [];
	let added: number[] = [];

	const flushBlock = () => {
		removed.forEach((beforeIndex, position) => {
			const afterIndex = added.at(position);
			if (afterIndex === undefined) {
				changes.before.set(beforeIndex, [wholeLine(beforeLines[beforeIndex])]);
				return;
			}
			const words = diffWords(beforeLines[beforeIndex], afterLines[afterIndex]);
			changes.before.set(beforeIndex, words.before);
			changes.after.set(afterIndex, words.after);
		});
		added.slice(removed.length).forEach((afterIndex) => {
			changes.after.set(afterIndex, [wholeLine(afterLines[afterIndex])]);
		});
		removed = [];
		added = [];
	};

	for (const line of lines) {
		if (line.type === 'remove' && line.oldNumber !== null) {
			removed.push(line.oldNumber - 1);
		} else if (line.type === 'add' && line.newNumber !== null) {
			added.push(line.newNumber - 1);
		} else {
			flushBlock();
		}
	}
	flushBlock();
	return changes;
}

/** The words of two lines that the other line does not have, ignoring spacing and letter case. */
function diffWords(before: string, after: string): { before: ChangedRange[]; after: ChangedRange[] } {
	const beforeWords = tokenizeWords(before);
	const afterWords = tokenizeWords(after);
	const lengths = buildCommonLengths(beforeWords, afterWords);
	const changedBefore: WordToken[] = [];
	const changedAfter: WordToken[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	while (beforeIndex < beforeWords.length || afterIndex < afterWords.length) {
		if (
			beforeIndex < beforeWords.length &&
			afterIndex < afterWords.length &&
			isSameWord(beforeWords[beforeIndex], afterWords[afterIndex])
		) {
			beforeIndex++;
			afterIndex++;
		} else if (
			afterIndex >= afterWords.length ||
			(beforeIndex < beforeWords.length &&
				lengths[beforeIndex + 1][afterIndex] >= lengths[beforeIndex][afterIndex + 1])
		) {
			changedBefore.push(beforeWords[beforeIndex++]);
		} else {
			changedAfter.push(afterWords[afterIndex++]);
		}
	}
	return { before: mergeRanges(changedBefore), after: mergeRanges(changedAfter) };
}

function tokenizeWords(line: string): WordToken[] {
	return [...line.matchAll(WORD_PATTERN)].map((match) => ({
		text: match[0],
		start: match.index,
		end: match.index + match[0].length,
	}));
}

function isSameWord(left: WordToken, right: WordToken): boolean {
	return (
		(WHITESPACE.test(left.text) && WHITESPACE.test(right.text)) ||
		left.text.toLowerCase() === right.text.toLowerCase()
	);
}

/** `lengths[i][j]` is the longest common subsequence of the words from `i` and from `j`. */
function buildCommonLengths(before: WordToken[], after: WordToken[]): number[][] {
	const lengths = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
	for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex--) {
		for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex--) {
			lengths[beforeIndex][afterIndex] = isSameWord(before[beforeIndex], after[afterIndex])
				? lengths[beforeIndex + 1][afterIndex + 1] + 1
				: Math.max(lengths[beforeIndex + 1][afterIndex], lengths[beforeIndex][afterIndex + 1]);
		}
	}
	return lengths;
}

/** Joins the changed words that follow each other, leaving out the spaces at the edges. */
function mergeRanges(words: WordToken[]): ChangedRange[] {
	const ranges: ChangedRange[] = [];
	for (const word of words.filter((candidate) => !WHITESPACE.test(candidate.text))) {
		const last = ranges.at(-1);
		if (last && word.start - last.end <= 1) {
			last.end = word.end;
		} else {
			ranges.push({ start: word.start, end: word.end });
		}
	}
	return ranges;
}

function wholeLine(line: string): ChangedRange {
	const start = line.length - line.trimStart().length;
	return { start, end: line.trimEnd().length };
}

function normalizeLines(lines: string[]): string {
	return lines.map((line) => line.trim().replace(/\s+/g, ' ').toLowerCase()).join('\n');
}
