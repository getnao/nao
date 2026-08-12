export interface IncrementalMarkdownBlockSplitter {
	sealedBlocks: string[];
	tail: string;
	consumedOffset: number;
	previousText: string;
	scanOffset: number;
	lineStart: number;
	pendingBoundary: number | null;
	fence: Fence | null;
	isInsideBlockMath: boolean;
	hasList: boolean;
	hasBlockquote: boolean;
	transformSealedBlock: (block: string) => string;
}

interface Fence {
	character: '`' | '~';
	length: number;
}

export interface IncrementalMarkdownBlocks {
	sealedBlocks: readonly string[];
	tail: string;
}

export function createIncrementalMarkdownBlockSplitter(
	transformSealedBlock: (block: string) => string = identity,
): IncrementalMarkdownBlockSplitter {
	return {
		sealedBlocks: [],
		tail: '',
		consumedOffset: 0,
		previousText: '',
		scanOffset: 0,
		lineStart: 0,
		pendingBoundary: null,
		fence: null,
		isInsideBlockMath: false,
		hasList: false,
		hasBlockquote: false,
		transformSealedBlock,
	};
}

export function updateIncrementalMarkdownBlocks(
	splitter: IncrementalMarkdownBlockSplitter,
	text: string,
): IncrementalMarkdownBlocks {
	if (!isAppend(splitter, text)) {
		resetSplitter(splitter);
	}

	const appendedText = text.slice(splitter.consumedOffset);
	splitter.previousText = text;
	splitter.consumedOffset = text.length;

	if (appendedText.length > 0) {
		splitter.tail += appendedText;
		scanAppendedText(splitter);
	}

	return {
		sealedBlocks: splitter.sealedBlocks,
		tail: splitter.tail,
	};
}

function scanAppendedText(splitter: IncrementalMarkdownBlockSplitter) {
	while (splitter.scanOffset < splitter.tail.length) {
		if (splitter.tail[splitter.scanOffset] === '\n') {
			const line = splitter.tail.slice(splitter.lineStart, splitter.scanOffset).replace(/\r$/, '');
			resolvePendingBoundary(splitter, line);
			processCompletedLine(splitter, line);
			splitter.lineStart = splitter.scanOffset + 1;
		}

		splitter.scanOffset += 1;
	}

	resolvePendingBoundaryFromPartialLine(splitter);
}

function resolvePendingBoundary(splitter: IncrementalMarkdownBlockSplitter, line: string) {
	if (splitter.pendingBoundary === null || isBlankLine(line)) {
		return;
	}

	if (continuesOpenContainer(splitter, line)) {
		splitter.pendingBoundary = null;
		return;
	}

	sealPendingBlock(splitter);
}

function resolvePendingBoundaryFromPartialLine(splitter: IncrementalMarkdownBlockSplitter) {
	if (splitter.pendingBoundary === null) {
		return;
	}

	const partialLine = splitter.tail.slice(splitter.lineStart);
	if (isBlankLine(partialLine)) {
		return;
	}

	if (splitter.hasList) {
		if (/^\s/.test(partialLine) || isListItem(partialLine)) {
			splitter.pendingBoundary = null;
			return;
		}

		if (couldBecomeListItem(partialLine)) {
			return;
		}
	}

	if (splitter.hasBlockquote && /^ {0,3}>/.test(partialLine)) {
		splitter.pendingBoundary = null;
		return;
	}

	sealPendingBlock(splitter);
}

function processCompletedLine(splitter: IncrementalMarkdownBlockSplitter, line: string) {
	if (splitter.fence) {
		if (isClosingFence(line, splitter.fence)) {
			splitter.fence = null;
		}
		return;
	}

	const openingFence = getOpeningFence(line);
	if (openingFence) {
		splitter.fence = openingFence;
		return;
	}

	const mathDelimiterCount = countMathDelimiters(line);
	if (splitter.isInsideBlockMath) {
		if (mathDelimiterCount % 2 === 1) {
			splitter.isInsideBlockMath = false;
		}
		return;
	}

	if (/^\s*\$\$/.test(line) && mathDelimiterCount % 2 === 1) {
		splitter.isInsideBlockMath = true;
		return;
	}

	if (isBlankLine(line)) {
		splitter.pendingBoundary = splitter.scanOffset + 1;
		return;
	}

	if (isListItem(line)) {
		splitter.hasList = true;
	}

	if (/^ {0,3}>/.test(line)) {
		splitter.hasBlockquote = true;
	}
}

function continuesOpenContainer(splitter: IncrementalMarkdownBlockSplitter, line: string): boolean {
	if (splitter.hasList && (/^\s+\S/.test(line) || isListItem(line))) {
		return true;
	}

	return splitter.hasBlockquote && /^ {0,3}>/.test(line);
}

function sealPendingBlock(splitter: IncrementalMarkdownBlockSplitter) {
	const boundary = splitter.pendingBoundary;
	if (boundary === null) {
		return;
	}

	const sealedBlock = splitter.tail.slice(0, boundary);
	splitter.sealedBlocks.push(splitter.transformSealedBlock(sealedBlock));
	splitter.tail = splitter.tail.slice(boundary);
	splitter.scanOffset -= boundary;
	splitter.lineStart -= boundary;
	resetBlockContext(splitter);
}

function resetSplitter(splitter: IncrementalMarkdownBlockSplitter) {
	splitter.sealedBlocks.length = 0;
	splitter.tail = '';
	splitter.consumedOffset = 0;
	splitter.previousText = '';
	splitter.scanOffset = 0;
	splitter.lineStart = 0;
	resetBlockContext(splitter);
}

function resetBlockContext(splitter: IncrementalMarkdownBlockSplitter) {
	splitter.pendingBoundary = null;
	splitter.fence = null;
	splitter.isInsideBlockMath = false;
	splitter.hasList = false;
	splitter.hasBlockquote = false;
}

function isAppend(splitter: IncrementalMarkdownBlockSplitter, text: string): boolean {
	return text.length >= splitter.consumedOffset && text.startsWith(splitter.previousText);
}

function getOpeningFence(line: string): Fence | null {
	const match = line.match(/^\s*(`{3,}|~{3,})/);
	if (!match) {
		return null;
	}

	const marker = match[1];
	return {
		character: marker[0] as Fence['character'],
		length: marker.length,
	};
}

function isClosingFence(line: string, fence: Fence): boolean {
	const match = line.match(/^\s*(`+|~+)\s*$/);
	if (!match) {
		return false;
	}

	const marker = match[1];
	return marker[0] === fence.character && marker.length >= fence.length;
}

function countMathDelimiters(line: string): number {
	let count = 0;
	let offset = 0;

	while (offset < line.length - 1) {
		const delimiterOffset = line.indexOf('$$', offset);
		if (delimiterOffset === -1) {
			break;
		}

		if (delimiterOffset === 0 || line[delimiterOffset - 1] !== '\\') {
			count += 1;
		}
		offset = delimiterOffset + 2;
	}

	return count;
}

function isListItem(line: string): boolean {
	return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function couldBecomeListItem(line: string): boolean {
	return /^[-+*]$/.test(line) || /^\d+[.)]?$/.test(line);
}

function isBlankLine(line: string): boolean {
	return /^\s*$/.test(line);
}

function identity(value: string): string {
	return value;
}
